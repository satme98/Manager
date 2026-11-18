import type {
  AuditLogRecord,
  BackupPayload,
  ExitLineRecord,
  ExitRecord,
  ImportBatchRecord,
  InventoryLineRecord,
  InventorySessionRecord,
  ProductRecord,
  PurchaseLineRecord,
  PurchaseRecord,
  SettingRecord,
  SupplierRecord,
  UserRecord,
} from './types'
import { buildMonarqCleanImportWorkbookBuffer } from './monarq-real-import-dataset'
import {
  type ParsedInventoryRow,
  parseAndValidateWorkbook,
} from '@/lib/excel-import-engine'
import {
  computeInventoryExcelTheoretical,
  computePurchaseLineAmount,
  computeRawWeightedAveragePrice,
  computeWeightedAveragePrice,
  normalizeProductRef,
  normalizeSupplierName,
} from '@/lib/stock-engine'

export interface SeededUserRecord extends UserRecord {
  passwordHash: string
}

export interface PermanentDatabaseState {
  users: SeededUserRecord[]
  products: ProductRecord[]
  suppliers: SupplierRecord[]
  purchases: PurchaseRecord[]
  purchase_lines: PurchaseLineRecord[]
  exits: ExitRecord[]
  exit_lines: ExitLineRecord[]
  inventory_sessions: InventorySessionRecord[]
  inventory_lines: InventoryLineRecord[]
  audit_log: AuditLogRecord[]
  settings: SettingRecord[]
  import_batches: ImportBatchRecord[]
}

function fnv1aHash(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function makePbId(tag: string, index: number): string {
  const prefix = `monarq${tag}`
  const numLen = 15 - prefix.length
  return `${prefix}${String(index).padStart(numLen, '0')}`
}

let cachedSeedTemplate: PermanentDatabaseState | null = null

function cloneState<T>(obj: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj)
  }
  return JSON.parse(JSON.stringify(obj)) as T
}

function buildSeedTemplate(): PermanentDatabaseState {
  const seedTimestamp = '2026-10-22T18:00:00.000Z'

  const users: SeededUserRecord[] = [
    {
      id: makePbId('usr', 1),
      email: 'admin@monarq.ma',
      name: 'Administrateur Monarq',
      role: 'admin',
      active: true,
      passwordHash: 'admin1234',
      created_at: seedTimestamp,
      updated_at: seedTimestamp,
    },
    {
      id: makePbId('usr', 2),
      email: 'manager@monarq.ma',
      name: 'Responsable Économat',
      role: 'manager',
      active: true,
      passwordHash: 'manager1234',
      created_at: seedTimestamp,
      updated_at: seedTimestamp,
    },
    {
      id: makePbId('usr', 3),
      email: 'magasinier@monarq.ma',
      name: 'Magasinier Monarq',
      role: 'economat',
      active: true,
      passwordHash: 'magasinier1234',
      created_at: seedTimestamp,
      updated_at: seedTimestamp,
    },
    {
      id: makePbId('usr', 4),
      email: 'cuisine@monarq.ma',
      name: 'Chef Cuisine',
      role: 'cuisine',
      active: true,
      passwordHash: 'cuisine1234',
      created_at: seedTimestamp,
      updated_at: seedTimestamp,
    },
    {
      id: makePbId('usr', 5),
      email: 'consultation@monarq.ma',
      name: 'Auditeur Consultation',
      role: 'consultation',
      active: true,
      passwordHash: 'consultation1234',
      created_at: seedTimestamp,
      updated_at: seedTimestamp,
    },
  ]

  const adminUser = users[0]
  const buffer = buildMonarqCleanImportWorkbookBuffer()
  const fileName = 'MONARQ_ECONOMAT_import_propre.xlsx'
  const parsed = parseAndValidateWorkbook(buffer, fileName, buffer.byteLength)

  const batchSourceId = `excel-${fnv1aHash(
    `${parsed.fileName}|${parsed.products.length}|${parsed.purchases.length}|${parsed.exits.length}|${parsed.inventories.length}`
  )}`

  // 1. Suppliers (19 official + 14 auto-created from Entrées Stock)
  const suppliers: SupplierRecord[] = []
  const supplierByNormName = new Map<string, SupplierRecord>()
  let supIdx = 1

  for (const sup of parsed.suppliers) {
    if (sup.blocking) continue
    if (supplierByNormName.has(sup.normalizedName)) continue
    const rec: SupplierRecord = {
      id: makePbId('sup', supIdx++),
      name: sup.name,
      contact: sup.contact,
      phone: sup.phone,
      email: sup.email,
      payment_terms: sup.paymentTerms,
      notes: sup.notes,
      archived: false,
      missing_from_supplier_sheet: false,
      source_row_id: sup.sourceRowId,
      import_batch_id: batchSourceId,
      created_at: seedTimestamp,
      updated_at: seedTimestamp,
    }
    suppliers.push(rec)
    supplierByNormName.set(sup.normalizedName, rec)
  }

  for (const choice of Object.values(parsed.defaultSupplierChoices)) {
    const targetName = choice.targetSupplierName.trim()
    const normTarget = normalizeSupplierName(targetName)
    if (normTarget && !supplierByNormName.has(normTarget)) {
      const rec: SupplierRecord = {
        id: makePbId('sup', supIdx++),
        name: targetName,
        contact: '',
        phone: '',
        email: '',
        payment_terms: '',
        notes: 'Créé automatiquement lors de l’import des Entrées Stock',
        archived: false,
        missing_from_supplier_sheet: true,
        source_row_id: null,
        import_batch_id: batchSourceId,
        created_at: seedTimestamp,
        updated_at: seedTimestamp,
      }
      suppliers.push(rec)
      supplierByNormName.set(normTarget, rec)
    }
  }

  // 2. Products (345 rows, preserving raw ref & raw category)
  const products: ProductRecord[] = []
  const productByRef = new Map<string, ProductRecord>()
  let prdIdx = 1

  for (const prd of parsed.products) {
    if (prd.blocking) continue
    if (productByRef.has(prd.canonicalRef)) continue
    const rec: ProductRecord = {
      id: makePbId('prd', prdIdx++),
      ref: prd.rawRef.trim() || prd.canonicalRef,
      name: prd.name,
      category: prd.rawCategory,
      unit: prd.unit,
      initial_stock: prd.initialStock,
      min_stock: prd.minStock,
      location: prd.location,
      notes: '',
      archived: false,
      source_row_id: prd.sourceRowId,
      import_batch_id: batchSourceId,
      created_at: seedTimestamp,
      updated_at: seedTimestamp,
    }
    products.push(rec)
    productByRef.set(normalizeProductRef(rec.ref), rec)
  }

  // 3. Purchases & Purchase Lines (247 documents)
  const purchases: PurchaseRecord[] = []
  const purchase_lines: PurchaseLineRecord[] = []
  let purIdx = 1

  for (const pur of parsed.purchases) {
    if (pur.blocking || !pur.date || pur.qty === null) continue
    const product = productByRef.get(pur.canonicalRef)
    if (!product) continue

    const supChoice = parsed.defaultSupplierChoices[pur.rawSupplier]
    const targetSupplierName = supChoice?.targetSupplierName || pur.rawSupplier
    const supplier = supplierByNormName.get(
      normalizeSupplierName(targetSupplierName)
    )
    const effectivePaymentStatus = pur.isAmbiguousPayment
      ? 'unpaid'
      : pur.paymentStatus
    const unitPrice = pur.unitPrice ?? 0

    const headerId = makePbId('pur', purIdx)
    const lineId = makePbId('pln', purIdx)
    purIdx++

    purchases.push({
      id: headerId,
      date: pur.date,
      supplier: supplier?.id ?? targetSupplierName,
      invoice_no: pur.invoiceNo || '',
      payment_status: effectivePaymentStatus,
      payment_date:
        effectivePaymentStatus === 'paid'
          ? pur.paymentDate || pur.date
          : null,
      raw_payment_status: pur.rawPaymentStatus,
      is_ambiguous_payment: pur.isAmbiguousPayment,
      recorded_by: adminUser.id,
      recorded_by_name: pur.recordedByName || adminUser.name,
      notes: pur.notes,
      reversed_of: null,
      correction_status: 'none',
      import_batch_id: batchSourceId,
      order_index: pur.orderIndex,
      created_at: seedTimestamp,
    })

    purchase_lines.push({
      id: lineId,
      purchase: headerId,
      product: product.id,
      qty: pur.qty,
      unit_price: unitPrice,
      amount: computePurchaseLineAmount(pur.qty, unitPrice),
      is_duplicate_candidate: pur.isDuplicateCandidate,
      duplicate_verified: false,
      source_row_id: pur.sourceRowId,
      import_batch_id: batchSourceId,
      order_index: pur.orderIndex,
      created_at: seedTimestamp,
    })
  }

  // Prepare entry list for PMP lookup on exits and inventories
  const allEntriesForCalc = purchase_lines.map((pl, idx) => {
    const h = purchases[idx]
    return {
      id: pl.id,
      productId: pl.product,
      date: h?.date ?? seedTimestamp,
      qty: pl.qty,
      unitPrice: pl.unit_price,
      amount: pl.amount,
    }
  })

  const avgPriceByProductId = new Map<string, number | null>()
  for (const p of products) {
    avgPriceByProductId.set(
      p.id,
      computeWeightedAveragePrice(p.id, allEntriesForCalc)
    )
  }

  // 4. Exits & Exit Lines (143 documents)
  const exits: ExitRecord[] = []
  const exit_lines: ExitLineRecord[] = []
  let extIdx = 1

  for (const ext of parsed.exits) {
    if (ext.blocking || !ext.date) continue
    const product = productByRef.get(ext.canonicalRef)
    if (!product) continue

    const headerId = makePbId('ext', extIdx)
    const lineId = makePbId('xln', extIdx)
    extIdx++

    exits.push({
      id: headerId,
      date: ext.date,
      destination: ext.destination,
      recorded_by: adminUser.id,
      recorded_by_name: ext.recordedByName || adminUser.name,
      notes: ext.notes,
      reversed_of: null,
      negative_stock_reason: null,
      correction_status: 'none',
      import_batch_id: batchSourceId,
      order_index: ext.orderIndex,
      created_at: seedTimestamp,
    })

    exit_lines.push({
      id: lineId,
      exit: headerId,
      product: product.id,
      qty_consumed: ext.qtyConsumed,
      qty_wasted: ext.qtyWasted,
      loss_reason: null,
      unit_cost_snapshot: avgPriceByProductId.get(product.id) ?? null,
      is_duplicate_candidate: ext.isDuplicateCandidate,
      duplicate_verified: false,
      source_row_id: ext.sourceRowId,
      import_batch_id: batchSourceId,
      order_index: ext.orderIndex,
      created_at: seedTimestamp,
    })
  }

  const allExitsForCalc = exit_lines.map((xl, idx) => {
    const h = exits[idx]
    return {
      id: xl.id,
      productId: xl.product,
      date: h?.date ?? seedTimestamp,
      qtyConsumed: xl.qty_consumed,
      qtyWasted: xl.qty_wasted,
    }
  })

  // 5. Inventory Sessions & Inventory Lines (119 lines across 2 confirmed sessions)
  const inventory_sessions: InventorySessionRecord[] = []
  const inventory_lines: InventoryLineRecord[] = []
  const invByDate = new Map<string, ParsedInventoryRow[]>()

  for (const inv of parsed.inventories) {
    if (inv.blocking) continue
    const sessionDate = inv.date || '2026-10-13'
    const list = invByDate.get(sessionDate) ?? []
    list.push(inv)
    invByDate.set(sessionDate, list)
  }

  let sessIdx = 1
  let ilnIdx = 1
  for (const [sessionDate, rows] of invByDate.entries()) {
    const sessionId = makePbId('inv', sessIdx++)
    const sessionLines: InventoryLineRecord[] = []

    for (const r of rows) {
      const product = productByRef.get(r.canonicalRef)
      if (!product) continue

      const rawAvg = computeRawWeightedAveragePrice(
        product.id,
        allEntriesForCalc
      )
      const prodEntriesTotal = allEntriesForCalc
        .filter((e) => e.productId === product.id)
        .reduce((acc, e) => acc + e.qty, 0)
      const prodConsumedTotal = allExitsForCalc
        .filter((x) => x.productId === product.id)
        .reduce((acc, x) => acc + x.qtyConsumed, 0)
      const prodWastedTotal = allExitsForCalc
        .filter((x) => x.productId === product.id)
        .reduce((acc, x) => acc + x.qtyWasted, 0)

      const calc = computeInventoryExcelTheoretical({
        initialStock: product.initial_stock,
        totalEntries: prodEntriesTotal,
        totalConsumed: prodConsumedTotal,
        totalWasted: prodWastedTotal,
        counted: r.counted,
        rawAveragePrice: rawAvg,
      })

      sessionLines.push({
        id: makePbId('iln', ilnIdx++),
        session: sessionId,
        product: product.id,
        theoretical: calc.theoretical,
        counted: r.counted,
        diff: calc.diff,
        value_diff: calc.valueDiff,
        comment: null,
        source_row_id: r.sourceRowId,
        import_batch_id: batchSourceId,
        order_index: r.orderIndex,
        created_at: seedTimestamp,
      })
    }

    if (sessionLines.length > 0) {
      inventory_sessions.push({
        id: sessionId,
        date: sessionDate,
        scope: 'full',
        category: null,
        categories: null,
        location: null,
        status: 'confirmed',
        created_by: adminUser.id,
        created_by_name: adminUser.name,
        confirmed_by: adminUser.id,
        confirmed_by_name: 'Import Excel',
        confirmed_at: sessionDate,
        notes: `Import Excel (${parsed.fileName}) — ${sessionLines.length} produits comptés`,
        import_batch_id: batchSourceId,
        created_at: seedTimestamp,
      })
      inventory_lines.push(...sessionLines)
    }
  }

  // 6. Settings
  const categoriesList = Array.from(
    new Set([
      ...parsed.parametres.categories,
      ...parsed.distinctProductCategories,
    ])
  ).filter(Boolean)
  const unitsList = Array.from(
    new Set([
      ...parsed.parametres.units,
      ...parsed.products.map((p) => p.unit),
    ])
  ).filter(Boolean)
  const destinationsList = Array.from(
    new Set([
      ...parsed.parametres.destinations,
      ...parsed.exits.map((x) => x.destination),
    ])
  ).filter(Boolean)

  const rawSettings: Array<{ key: string; value: unknown }> = [
    { key: 'restaurant_name', value: 'MONARQ ÉCONOMAT' },
    { key: 'vat_convention', value: 'TTC' },
    { key: 'vat_rate', value: 20 },
    { key: 'watch_threshold_pct', value: 150 },
    { key: 'variance_alert_pct', value: 5 },
    { key: 'replenishment_multiplier', value: 2 },
    { key: 'allow_negative_stock', value: false },
    { key: 'partial_payments_enabled', value: true },
    { key: 'categories_list', value: categoriesList },
    { key: 'units_list', value: unitsList },
    { key: 'destinations_list', value: destinationsList },
    {
      key: 'locations_list',
      value: [
        'Économat Principal',
        'Économat central',
        'Chambre froide positive',
        'Chambre froide négative',
        'Cave à vins',
        'Réserve sèche',
      ],
    },
    {
      key: 'waste_reasons_list',
      value: [
        'Péremption / DLC dépassée',
        'Casse / Chute',
        'Erreur de préparation',
        'Altération / Chaîne du froid',
        'Retour client',
      ],
    },
    {
      key: 'payment_methods_list',
      value: [
        'Espèces',
        'Virement bancaire',
        'Chèque',
        'Carte bancaire',
        'Effet de commerce',
      ],
    },
  ]

  const settings: SettingRecord[] = rawSettings.map((s, idx) => ({
    id: makePbId('cfg', idx + 1),
    key: s.key,
    value: s.value,
    updated_at: seedTimestamp,
  }))

  // 7. Import Batch & Audit Log
  const import_batches: ImportBatchRecord[] = [
    {
      id: makePbId('imp', 1),
      source_id: batchSourceId,
      filename: parsed.fileName,
      status: 'completed',
      counts: {
        rows_read:
          products.length +
          parsed.suppliers.length +
          purchases.length +
          exits.length +
          inventory_lines.length,
        rows_imported:
          products.length +
          suppliers.length +
          purchases.length +
          exits.length +
          inventory_lines.length,
        rows_skipped: 0,
        rows_flagged: parsed.aVerifierRows.length,
      },
      created_at: seedTimestamp,
    },
  ]

  const audit_log: AuditLogRecord[] = [
    {
      id: makePbId('aud', 1),
      user: adminUser.id,
      user_email: adminUser.email,
      timestamp: seedTimestamp,
      action: 'import_batch',
      collection: 'import_batches',
      record_id: import_batches[0].id,
      details: {
        source_id: batchSourceId,
        filename: parsed.fileName,
        products_count: products.length,
        suppliers_count: suppliers.length,
        purchases_count: purchases.length,
        exits_count: exits.length,
        inventory_lines_count: inventory_lines.length,
      },
    },
  ]

  return {
    users,
    products,
    suppliers,
    purchases,
    purchase_lines,
    exits,
    exit_lines,
    inventory_sessions,
    inventory_lines,
    audit_log,
    settings,
    import_batches,
  }
}

export function buildPermanentMonarqDatabaseState(): PermanentDatabaseState {
  if (!cachedSeedTemplate) {
    cachedSeedTemplate = buildSeedTemplate()
  }
  return cloneState(cachedSeedTemplate)
}

export function buildPermanentMonarqBackupPayload(
  adapter: 'memory' | 'pocketbase' = 'memory'
): BackupPayload {
  const state = buildPermanentMonarqDatabaseState()
  return {
    version: '1.0.0',
    exported_at: new Date().toISOString(),
    adapter,
    collections: {
      users: state.users.map(({ passwordHash: _, ...u }) => u),
      products: state.products,
      suppliers: state.suppliers,
      purchases: state.purchases,
      purchase_lines: state.purchase_lines,
      exits: state.exits,
      exit_lines: state.exit_lines,
      inventory_sessions: state.inventory_sessions,
      inventory_lines: state.inventory_lines,
      audit_log: state.audit_log,
      settings: state.settings,
      import_batches: state.import_batches,
    },
  }
}
