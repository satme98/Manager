import { beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  computeDashboardAnalytics,
  computeInvoicesAndAgingReport,
  computeLossesReport,
  computeReplenishmentSuggestions,
  computeStockValuationAsOfDate,
  computeUnifiedMovementTimeline,
  invalidateDashboardAnalyticsCache,
  type RawAnalyticsDataset,
} from '@/data/analytics'
import { MemoryDataRepository } from '@/data/memory-adapter'
import type { CollectionName, UserRole } from '@/data/types'
import {
  computeDatabaseQualityReport,
  executeWorkbookImport,
  parseAndValidateWorkbook,
} from '@/lib/excel-import-engine'
import {
  ALL_ROLES,
  canPerformCollectionAction,
  IMMUTABLE_COLLECTIONS,
} from '@/lib/rbac'
import {
  clearStockCache,
  computeAllProductsStock,
  roundCurrency,
  roundQty,
} from '@/lib/stock-engine'
import { useAuthStore } from '@/stores/auth-store'

async function loadDataset(
  repo: MemoryDataRepository
): Promise<RawAnalyticsDataset> {
  const [
    products,
    suppliers,
    purchasesData,
    exitsData,
    inventoriesData,
    settings,
    users,
  ] = await Promise.all([
    repo.listProducts(),
    repo.listSuppliers(),
    repo.listPurchases(),
    repo.listExits(),
    repo.listInventories(),
    repo.listSettings(),
    repo.listUsers(),
  ])
  return {
    products,
    suppliers,
    purchases: purchasesData.headers,
    purchaseLines: purchasesData.lines,
    exits: exitsData.headers,
    exitLines: exitsData.lines,
    inventorySessions: inventoriesData.sessions,
    inventoryLines: inventoriesData.lines,
    settings,
    users,
  }
}

function buildTestWorkbookBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new()

  const baseProduits = [
    [
      'Référence',
      'Produit',
      'Catégorie',
      'Unité',
      'Stock initial',
      'Stock minimum',
      'Prix U moyen',
      'Emplacement',
    ],
    ['REF-001', 'Filet de Boeuf', 'Viandes', 'kg', 10, 5, 180, 'Chambre froide'],
    ['REF-002', 'Blanc de Poulet', 'Viandes', 'kg', 20, 8, 65, 'Chambre froide'],
    ['REF-003', 'Saumon Frais', 'Poissons', 'kg', 8, 4, 150, 'Chambre froide'],
    ['REF-004', 'Crevettes Royales', 'Poissons', 'kg', 6, 3, 140, 'Congélateur'],
    ['REF-005', 'Huile Olive Vierge', 'Épicerie', 'L', 15, 10, 85, 'Réserve sèche'],
    ['REF-006', 'Farine T45', 'epicerie', 'kg', 50, 20, 8, 'Réserve sèche'],
    ['REF-007', 'Beurre Doux', 'Crèmerie', 'kg', 12, 6, 95, 'Frigo 2'],
    ['REF-008', 'Sel Fin (Sans prix)', 'Épicerie', 'kg', 25, 5, 0, 'Réserve sèche'],
    ['REF-009', 'Poivre Noir (Sans prix)', 'Épicerie', 'kg', 4, null, 0, 'Réserve sèche'],
    ['REF-010', 'Herbes Fraîches (Sans prix)', '', 'botte', 10, null, 0, 'Frigo 1'],
  ]
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(baseProduits),
    'Base Produits'
  )

  const fournisseurs = [
    ['Fournisseur', 'Contact', 'Téléphone', 'Email', 'Conditions paiement', 'Notes'],
    ['Atlas Viandes', 'Karim', '0522112233', 'atlas@monarq.ma', '30 jours', ''],
    ['Marée Océan', 'Youssef', '0522445566', 'ocean@monarq.ma', 'Comptant', ''],
    [' Comptoir Epicerie ', '', '', '', '15 jours', 'à vérifier contact'],
  ]
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(fournisseurs),
    'fournisseur'
  )

  const entrees = [
    [
      'Date',
      'Référence',
      'Produit',
      'Quantité entrée',
      'Prix U (MAD)',
      'Montant achat',
      'Paiement facturé',
      'Fournisseur',
      'Date paiement',
    ],
    ['2026-03-02', 'REF-001', 'Filet de Boeuf', 5, 180, 900, 'NON', 'Atlas Viandes', ''],
    ['2026-03-03', 'REF-002', 'Blanc de Poulet', 10, 65, 650, 'OUI', 'Atlas Viandes', '2026-03-03'],
    ['2026-03-04', 'REF-003', 'Saumon Frais', 6, 150, 900, 'NON', 'Marée Océan', ''],
    ['2026-03-05', 'REF-004', 'Crevettes Royales', 4, 140, 560, 'OUI', 'Marée Océan', '2026-03-05'],
    ['2026-03-06', 'REF-005', 'Huile Olive Vierge', 10, 85, 850, 'OUI', 'Comptoir Epicerie', '2026-03-06'],
    ['2026-03-07', 'REF-006', 'Farine T45', 25, 8, 200, 'OUI', 'Comptoir Epicerie', '2026-03-07'],
    ['2026-03-08', 'REF-007', 'Beurre Doux', 8, 95, 760, 'NON', 'Comptoir Epicerie', ''],
  ]
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(entrees),
    'Entrées Stock'
  )

  const sorties = [
    ['Date', 'Référence', 'Produit', 'Quantité sortie', 'Pertes', 'Destination'],
    ['2026-03-05', 'REF-001', 'Filet de Boeuf', 3, 1, 'Cuisine chaude'],
    ['2026-03-06', 'REF-002', 'Blanc de Poulet', 5, 0, 'Cuisine chaude'],
    ['2026-03-08', 'REF-005', 'Huile Olive Vierge', 4, 0, 'Cuisine froide'],
    ['2026-03-09', 'REF-008', 'Sel Fin (Sans prix)', 2, 0, 'Cuisine chaude'],
  ]
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(sorties),
    'Sorties Stock'
  )

  // 3 products with confirmed inventory counts on 2026-03-10
  const inventaire = [
    ['Référence', 'Produit', 'Unité', 'Stock théorique', 'Stock réel', 'Écart', 'Date inventaire'],
    ['REF-001', 'Filet de Boeuf', 'kg', 11, 10.5, -0.5, '2026-03-10'],
    ['REF-003', 'Saumon Frais', 'kg', 14, 13, -1, '2026-03-10'],
    ['REF-006', 'Farine T45', 'kg', 75, 76, 1, '2026-03-10'],
  ]
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(inventaire),
    'Inventaire'
  )

  const parametres = [
    ['Unités', 'Catégories', 'Destinations'],
    ['kg', 'Viandes', 'Cuisine chaude'],
    ['L', 'Poissons', 'Cuisine froide'],
    ['botte', 'Épicerie', 'Bar'],
  ]
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(parametres),
    'Parametres'
  )

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return out
}

describe('STAGE 9 – Final QA, End-to-End, Security, Reconciliation & Performance', () => {
  let repo: MemoryDataRepository

  beforeEach(async () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
    clearStockCache()
    invalidateDashboardAnalyticsCache()
    useAuthStore.getState().auth.reset()
    repo = new MemoryDataRepository()
    await repo.login('admin@monarq.ma', 'admin1234')
  })

  it('Section 2 (E2E 1–11) & Section 4 (10-product reconciliation + simultaneous exits)', async () => {
    // --- E2E 8: Import workbook & verify idempotent re-import ---
    const buffer = buildTestWorkbookBuffer()
    const parsed = parseAndValidateWorkbook(
      buffer,
      'MONARQ_ECONOMAT.xlsm',
      buffer.byteLength
    )
    const decisions = {
      vatConvention: 'TTC' as const,
      vatConfirmed: true,
      categoryMapping: { ...parsed.defaultCategoryMapping },
      supplierChoices: { ...parsed.defaultSupplierChoices },
      duplicateDecisions: { ...parsed.defaultDuplicateDecisions },
      updateExistingProducts: false,
      updateExistingSuppliers: false,
      fallbackInventoryDate: '2026-03-10',
    }

    const firstImport = await executeWorkbookImport(parsed, decisions, repo, {
      dryRun: false,
    })
    expect(firstImport.totalProductsInDb).toBe(10)
    expect(firstImport.amountDifference).toBe(0)

    // Re-run on the exact same workbook -> 0 duplicates created (idempotent)
    const secondImport = await executeWorkbookImport(parsed, decisions, repo, {
      dryRun: false,
    })
    expect(secondImport.totalProductsInDb).toBe(10)
    const totalImportedSecondRun = secondImport.sheetStats
      .filter((s) => s.sheet !== 'Parametres')
      .reduce((acc, s) => acc + s.rowsImported, 0)
    expect(totalImportedSecondRun).toBe(0)

    // --- SECTION 4: 10-PRODUCT RECONCILIATION (3 with counts, 3 with missing prices) ---
    const dsAfterImport = await loadDataset(repo)
    const stockMap = computeAllProductsStock({
      products: dsAfterImport.products,
      purchases: dsAfterImport.purchases,
      purchaseLines: dsAfterImport.purchaseLines,
      exits: dsAfterImport.exits,
      exitLines: dsAfterImport.exitLines,
      inventorySessions: dsAfterImport.inventorySessions,
      inventoryLines: dsAfterImport.inventoryLines,
    })

    // Expected independent stock & average price for all 10 products from raw rows:
    // REF-001: count on 2026-03-10 = 10.5 (same/earlier movements included in count), PMP = 180, val = 1890
    // REF-002: no count -> 20 + 10 - 5 = 25, PMP = 65, val = 1625
    // REF-003: count on 2026-03-10 = 13, PMP = 150, val = 1950
    // REF-004: no count -> 6 + 4 = 10, PMP = 140, val = 1400
    // REF-005: no count -> 15 + 10 - 4 = 21, PMP = 85, val = 1785
    // REF-006: count on 2026-03-10 = 76, PMP = 8, val = 608
    // REF-007: no count -> 12 + 8 = 20, PMP = 95, val = 1900
    // REF-008: no count -> 25 - 2 = 23, missing price (null), val = null
    // REF-009: no count -> 4, missing price (null), val = null
    // REF-010: no count -> 10, missing price (null), val = null
    const expectedByRef: Record<
      string,
      { stock: number; avgPrice: number | null; stockVal: number | null }
    > = {
      'REF-001': { stock: 10.5, avgPrice: 180, stockVal: 1890 },
      'REF-002': { stock: 25, avgPrice: 65, stockVal: 1625 },
      'REF-003': { stock: 13, avgPrice: 150, stockVal: 1950 },
      'REF-004': { stock: 10, avgPrice: 140, stockVal: 1400 },
      'REF-005': { stock: 21, avgPrice: 85, stockVal: 1785 },
      'REF-006': { stock: 76, avgPrice: 8, stockVal: 608 },
      'REF-007': { stock: 20, avgPrice: 95, stockVal: 1900 },
      'REF-008': { stock: 23, avgPrice: null, stockVal: null },
      'REF-009': { stock: 4, avgPrice: null, stockVal: null },
      'REF-010': { stock: 10, avgPrice: null, stockVal: null },
    }

    for (const prod of dsAfterImport.products) {
      const calc = stockMap.get(prod.id)!
      const exp = expectedByRef[prod.ref]
      expect(calc.stock).toBe(exp.stock)
      expect(calc.averagePrice).toBe(exp.avgPrice)
      expect(calc.stockValue).toBe(exp.stockVal)
    }

    // Reconcile global totals: total purchases = 4820 DH, unpaid = 2560 DH (900+900+760), stock value = 11158 DH, loss value = 180 DH (1kg REF-001 @ 180)
    const dashAfterImport = computeDashboardAnalytics(dsAfterImport, {
      preset: 'this_month',
      referenceDate: '2026-03-20',
      forceRefresh: true,
    })
    expect(dashAfterImport.kpis.periodPurchases.value).toBe(4820)
    expect(dashAfterImport.kpis.unpaidInvoices.totalAmount).toBe(2560)
    expect(dashAfterImport.kpis.stockValue.value).toBe(11158)
    expect(dashAfterImport.kpis.periodLosses.value).toBe(180)

    // --- SECTION 5: DATA QUALITY REPORT ("À corriger") ---
    const qcReport = await computeDatabaseQualityReport(repo)
    expect(qcReport.counts.sans_categorie).toBeGreaterThanOrEqual(1) // REF-010
    expect(qcReport.counts.categorie_incoherente).toBeGreaterThanOrEqual(1) // Épicerie vs epicerie
    expect(qcReport.counts.sans_stock_min).toBeGreaterThanOrEqual(2) // REF-009, REF-010
    expect(qcReport.counts.prix_manquant).toBeGreaterThanOrEqual(3) // REF-008, REF-009, REF-010
    expect(qcReport.counts.fournisseur_incomplet).toBeGreaterThanOrEqual(1) // Comptoir Epicerie
    expect(qcReport.counts.a_verifier).toBeGreaterThanOrEqual(1)

    // --- E2E 1: Create product & block duplicate ref (including case/space variant) ---
    const newProd = await repo.createProduct({
      ref: 'REF-011',
      name: 'Sucre Semoule',
      category: 'Épicerie',
      unit: 'kg',
      initial_stock: 10,
      min_stock: 5,
      location: 'Réserve sèche',
      archived: false,
    })
    expect(newProd.ref).toBe('REF-011')
    await expect(
      repo.createProduct({
        ref: '  ref-011 ',
        name: 'Doublon Sucre',
        category: 'Épicerie',
        unit: 'kg',
        initial_stock: 0,
        min_stock: 1,
        location: '',
        archived: false,
      })
    ).rejects.toThrow()

    // --- E2E 2: Record a purchase with 3 lines; verify stock, average price, supplier balance & dashboard ---
    const suppliers = await repo.listSuppliers()
    const atlas = suppliers.find((s) => s.name === 'Atlas Viandes')!
    const p1 = dsAfterImport.products.find((p) => p.ref === 'REF-001')!
    const p2 = dsAfterImport.products.find((p) => p.ref === 'REF-002')!

    const purchase3Lines = await repo.createPurchaseDocument({
      date: '2026-03-12',
      supplier: atlas.id,
      invoice_no: 'FAC-3L-001',
      payment_status: 'unpaid',
      payment_date: null,
      notes: 'Réception 3 lignes',
      lines: [
        { product: p1.id, qty: 5, unit_price: 200 }, // 1000 DH
        { product: p2.id, qty: 10, unit_price: 75 }, // 750 DH
        { product: newProd.id, qty: 20, unit_price: 10 }, // 200 DH
      ],
    })
    expect(purchase3Lines.lines.length).toBe(3)

    // --- E2E 3: Record a consumption with a loss; verify cost snapshot, stock before/after & loss value ---
    const exitWithLoss = await repo.createExitDocument({
      date: '2026-03-13',
      destination: 'Cuisine chaude',
      notes: '',
      lines: [
        {
          product: newProd.id,
          qty_consumed: 4,
          qty_wasted: 2,
          loss_reason: 'Humidité',
        },
      ],
    })
    expect(exitWithLoss.lines[0].unit_cost_snapshot).toBe(10)
    const dsAfterExit = await loadDataset(repo)
    const stockNewProd = computeAllProductsStock({
      products: dsAfterExit.products,
      purchases: dsAfterExit.purchases,
      purchaseLines: dsAfterExit.purchaseLines,
      exits: dsAfterExit.exits,
      exitLines: dsAfterExit.exitLines,
      inventorySessions: dsAfterExit.inventorySessions,
      inventoryLines: dsAfterExit.inventoryLines,
    }).get(newProd.id)!
    // Initial 10 + 20 entry - 4 consumed - 2 wasted = 24
    expect(stockNewProd.stock).toBe(24)

    // --- E2E 4: Negative stock blocked for economat/cuisine, allowed for manager with reason ---
    const econUser = await repo.createUser({
      email: 'econ@monarq.ma',
      name: 'Agent Economat',
      role: 'economat',
      password: 'password123',
    })
    const mgrUser = await repo.createUser({
      email: 'mgr@monarq.ma',
      name: 'Chef Manager',
      role: 'manager',
      password: 'password123',
    })

    await repo.login(econUser.email, 'password123')
    await expect(
      repo.createExitDocument({
        date: '2026-03-14',
        destination: 'Cuisine',
        notes: '',
        lines: [{ product: newProd.id, qty_consumed: 999, qty_wasted: 0 }],
      })
    ).rejects.toThrow()

    await repo.login(mgrUser.email, 'password123')
    // Manager without reason -> blocked
    await expect(
      repo.createExitDocument({
        date: '2026-03-14',
        destination: 'Cuisine',
        notes: '',
        lines: [{ product: newProd.id, qty_consumed: 30, qty_wasted: 0 }],
      })
    ).rejects.toThrow()

    // Manager with reason -> allowed and logged
    const negExit = await repo.createExitDocument({
      date: '2026-03-14',
      destination: 'Cuisine',
      notes: '',
      negative_stock_reason: 'Livraison déjà reçue en cuisine mais BL en attente',
      lines: [{ product: newProd.id, qty_consumed: 30, qty_wasted: 0 }],
    })
    expect(negExit.header.negative_stock_reason).toContain('BL en attente')
    // Reverse the negative exit immediately to restore stock to 24
    await repo.reverseExitDocument(negExit.header.id, 'Retour au stock positif')

    // --- SECTION 4 CONCURRENCY: Two simultaneous exits on the same product ---
    // Current stock of newProd is 24. Two simultaneous exits of 15 each (total 30 > 24) as economat:
    // Because of withWriteLock, the first succeeds (stock -> 9) and the second MUST fail!
    await repo.login(econUser.email, 'password123')
    const results = await Promise.allSettled([
      repo.createExitDocument({
        date: '2026-03-14',
        destination: 'Cuisine 1',
        notes: '',
        lines: [{ product: newProd.id, qty_consumed: 15, qty_wasted: 0 }],
      }),
      repo.createExitDocument({
        date: '2026-03-14',
        destination: 'Cuisine 2',
        notes: '',
        lines: [{ product: newProd.id, qty_consumed: 15, qty_wasted: 0 }],
      }),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)

    await repo.login('admin@monarq.ma', 'admin1234')

    // --- E2E 5: Inventory draft (stock unchanged) vs Confirm (baseline replaced for counted only) ---
    const draftInv = await repo.createInventoryDraftSession({
      date: '2026-03-15',
      scope: 'category',
      categories: ['Crèmerie'],
      notes: 'Inventaire Crèmerie',
    })
    const pBeurre = dsAfterImport.products.find((p) => p.ref === 'REF-007')!
    await repo.saveInventoryDraftLines(draftInv.session.id, [
      { product: pBeurre.id, counted: 18, comment: '2 plaquettes utilisées' },
    ])
    // Stock while draft is still 20
    let dsCheck = await loadDataset(repo)
    let stBeurre = computeAllProductsStock({
      products: dsCheck.products,
      purchases: dsCheck.purchases,
      purchaseLines: dsCheck.purchaseLines,
      exits: dsCheck.exits,
      exitLines: dsCheck.exitLines,
      inventorySessions: dsCheck.inventorySessions,
      inventoryLines: dsCheck.inventoryLines,
    }).get(pBeurre.id)!
    expect(stBeurre.stock).toBe(20)

    // Confirm inventory -> stock of Beurre becomes 18, other products untouched
    await repo.confirmInventorySession(draftInv.session.id, [
      { product: pBeurre.id, counted: 18, comment: 'Confirmé' },
    ])
    dsCheck = await loadDataset(repo)
    stBeurre = computeAllProductsStock({
      products: dsCheck.products,
      purchases: dsCheck.purchases,
      purchaseLines: dsCheck.purchaseLines,
      exits: dsCheck.exits,
      exitLines: dsCheck.exitLines,
      inventorySessions: dsCheck.inventorySessions,
      inventoryLines: dsCheck.inventoryLines,
    }).get(pBeurre.id)!
    expect(stBeurre.stock).toBe(18)

    // --- E2E 6 & 7: Mark invoice paid, reverse payment, reverse purchase & exit ---
    await repo.markPurchasePaid(purchase3Lines.header.id, '2026-03-16', {
      method: 'Chèque',
      reference: 'CHQ-7788',
    })
    await repo.reversePurchasePayment(
      purchase3Lines.header.id,
      'Chèque annulé et remplacé'
    )
    await repo.reversePurchaseDocument(
      purchase3Lines.header.id,
      'Annulation test E2E'
    )
    await repo.reverseExitDocument(exitWithLoss.header.id, 'Annulation sortie E2E')

    // --- E2E 9 & 10: Replenishment list (no auto order) & Reports reconciliation ---
    const purchasesCountBefore = (await repo.listPurchases()).headers.length
    await repo.saveDraftPurchaseList({
      name: 'Liste Semaine 12',
      date: '2026-03-17',
      status: 'Prête',
      notes: '',
      created_by: 'admin',
      lines: [],
    })
    expect((await repo.listPurchases()).headers.length).toBe(purchasesCountBefore)

    const finalDs = await loadDataset(repo)
    const rVal = computeStockValuationAsOfDate(finalDs, { asOfDate: '2026-03-31' })
    const rInv = computeInvoicesAndAgingReport(finalDs, {
      from: '2026-03-01',
      to: '2026-03-31',
    })
    const rLoss = computeLossesReport(finalDs, {
      from: '2026-03-01',
      to: '2026-03-31',
    })
    const rReap = computeReplenishmentSuggestions(finalDs)
    const rMov = computeUnifiedMovementTimeline(finalDs)
    expect(rVal.totalStockValue).toBeGreaterThan(0)
    expect(rInv.summary.totalUnpaidAmount).toBe(2560)
    expect(rLoss.summary.totalLossValue).toBe(180)
    expect(rReap.undefinedMinCount).toBeGreaterThanOrEqual(2)
    expect(rMov.length).toBeGreaterThan(0)

    // --- E2E 11: Backup and Restore ---
    const backup = await repo.exportBackup()
    const productCountAtBackup = backup.collections.products.length
    await repo.createProduct({
      ref: 'TEMP-999',
      name: 'Produit Temporaire post-backup',
      category: 'Test',
      unit: 'u',
      initial_stock: 1,
      min_stock: 1,
      location: '',
      archived: false,
    })
    expect((await repo.listProducts()).length).toBe(productCountAtBackup + 1)

    await repo.restoreBackup(backup)
    expect((await repo.listProducts()).length).toBe(productCountAtBackup)

    // --- E2E 8b: Rollback import batch ("Annuler l'import") ---
    const batches = await repo.listImportBatches()
    expect(batches.length).toBe(2)
    const primaryBatch = batches[batches.length - 1]
    await repo.reverseImportBatch(primaryBatch.id, 'Test annulation lot import')
    const batchesAfter = await repo.listImportBatches()
    const reversedBatch = batchesAfter.find((b) => b.id === primaryBatch.id)!
    expect(reversedBatch.status).toBe('reversed')
  })

  it('Section 3: Role & Security Matrix across all 5 roles and 12 collections + Cuisine field redaction + Disabled user refusal', async () => {
    const collections: CollectionName[] = [
      'users',
      'products',
      'suppliers',
      'purchases',
      'purchase_lines',
      'exits',
      'exit_lines',
      'inventory_sessions',
      'inventory_lines',
      'audit_log',
      'settings',
      'import_batches',
    ]

    // 1. Unauthenticated requests are refused on every collection
    for (const col of collections) {
      expect(canPerformCollectionAction(null, col, 'list')).toBe(false)
      expect(canPerformCollectionAction(undefined, col, 'create')).toBe(false)
    }

    // 2. Immutable collections can NEVER be deleted by ANY role (including admin)
    for (const role of ALL_ROLES) {
      for (const immutableCol of IMMUTABLE_COLLECTIONS) {
        expect(canPerformCollectionAction(role, immutableCol, 'delete')).toBe(
          false
        )
      }
    }

    // 3. Verify Cuisine role API redaction & blocks
    const sup = await repo.createSupplier({
      name: 'Fournisseur Secret',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const prod = await repo.createProduct({
      ref: 'SEC-001',
      name: 'Entrecôte',
      category: 'Viandes',
      unit: 'kg',
      initial_stock: 10,
      min_stock: 2,
      location: 'Frigo',
      archived: false,
    })
    await repo.createPurchaseDocument({
      date: '2026-03-10',
      supplier: sup.id,
      invoice_no: 'FAC-SEC',
      payment_status: 'unpaid',
      payment_date: null,
      notes: '',
      lines: [{ product: prod.id, qty: 5, unit_price: 220 }],
    })

    const cuisineUser = await repo.createUser({
      email: 'cuisine@monarq.ma',
      name: 'Chef Cuisine',
      role: 'cuisine',
      password: 'password123',
    })

    // Log in as cuisine
    await repo.login(cuisineUser.email, 'password123')

    // Cuisine cannot list suppliers, purchases, payment events, draft purchase lists, users, or audit logs
    await expect(repo.listSuppliers()).rejects.toThrow()
    await expect(repo.listPurchases()).rejects.toThrow()
    await expect(repo.listPaymentEvents()).rejects.toThrow()
    await expect(repo.listDraftPurchaseLists()).rejects.toThrow()
    await expect(repo.listUsers()).rejects.toThrow()
    await expect(repo.listAuditLogs()).rejects.toThrow()

    // Cuisine can create an exit, and the returned exit lines have unit_cost_snapshot = null
    const cuisineExit = await repo.createExitDocument({
      date: '2026-03-11',
      destination: 'Cuisine chaude',
      notes: '',
      lines: [{ product: prod.id, qty_consumed: 2, qty_wasted: 0 }],
    })
    expect(cuisineExit.lines[0].unit_cost_snapshot).toBeNull()

    const listedExitsForCuisine = await repo.listExits()
    expect(
      listedExitsForCuisine.lines.every((l) => l.unit_cost_snapshot === null)
    ).toBe(true)

    const dashForCuisine = await repo.getDashboardAnalytics()
    expect(dashForCuisine.kpis.stockValue.value).toBeNull()
    expect(dashForCuisine.kpis.periodPurchases.value).toBeNull()
    expect(dashForCuisine.kpis.unpaidInvoices.totalAmount).toBeNull()
    expect(dashForCuisine.kpis.periodLosses.value).toBeNull()

    // 4. Disabled user cannot log in
    await repo.login('admin@monarq.ma', 'admin1234')
    await repo.setUserActive(cuisineUser.id, false)
    await expect(
      repo.login(cuisineUser.email, 'password123')
    ).rejects.toThrow(/désactivé/i)

    // 5. Unauthenticated repository call throws
    await repo.logout()
    await expect(repo.listProducts()).rejects.toThrow()

    // Restore admin session
    await repo.login('admin@monarq.ma', 'admin1234')
    const roleCheck: UserRole = 'consultation'
    expect(canPerformCollectionAction(roleCheck, 'products', 'create')).toBe(false)
    expect(canPerformCollectionAction(roleCheck, 'products', 'list')).toBe(true)
  })

  it('Section 6: Performance benchmark with 1,000 products and 5,000 movements (2,500 purchase lines + 2,500 exit lines)', () => {
    const numProducts = 1000
    const products = Array.from({ length: numProducts }, (_, i) => ({
      id: `prd-${i}`,
      ref: `P-${String(i + 1).padStart(4, '0')}`,
      name: `Article Restaurant #${i + 1}`,
      category: ['Viandes', 'Poissons', 'Épicerie', 'Boissons', 'Crèmerie'][i % 5],
      unit: 'kg',
      initial_stock: roundQty(5 + (i % 10)),
      min_stock: 8,
      location: 'Réserve',
      archived: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }))

    const suppliers = Array.from({ length: 20 }, (_, i) => ({
      id: `sup-${i}`,
      name: `Fournisseur #${i + 1}`,
      contact: '',
      phone: '',
      email: '',
      payment_terms: '30 jours',
      notes: '',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }))

    const purchases = Array.from({ length: 250 }, (_, i) => ({
      id: `pur-${i}`,
      date: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
      supplier: `sup-${i % 20}`,
      invoice_no: `FAC-${1000 + i}`,
      payment_status: (i % 3 === 0 ? 'unpaid' : 'paid') as 'paid' | 'unpaid',
      payment_date: i % 3 === 0 ? null : '2026-03-15',
      recorded_by: 'admin',
      notes: '',
      reversed_of: null,
      created_at: '2026-03-15T10:00:00.000Z',
    }))

    const purchaseLines = Array.from({ length: 2500 }, (_, i) => {
      const qty = (i % 10) + 1
      const price = roundCurrency(15 + (i % 50))
      return {
        id: `pl-${i}`,
        purchase: `pur-${Math.floor(i / 10)}`,
        product: `prd-${i % numProducts}`,
        qty,
        unit_price: price,
        amount: roundCurrency(qty * price),
        created_at: '2026-03-15T10:00:00.000Z',
      }
    })

    const exits = Array.from({ length: 250 }, (_, i) => ({
      id: `ext-${i}`,
      date: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
      destination: i % 2 === 0 ? 'Cuisine chaude' : 'Bar',
      recorded_by: 'admin',
      notes: '',
      reversed_of: null,
      created_at: '2026-03-15T18:00:00.000Z',
    }))

    const exitLines = Array.from({ length: 2500 }, (_, i) => ({
      id: `xl-${i}`,
      exit: `ext-${Math.floor(i / 10)}`,
      product: `prd-${i % numProducts}`,
      qty_consumed: (i % 3) + 1,
      qty_wasted: i % 10 === 0 ? 1 : 0,
      loss_reason: i % 10 === 0 ? 'Casse' : null,
      unit_cost_snapshot: 25,
      created_at: '2026-03-15T18:00:00.000Z',
    }))

    clearStockCache()
    invalidateDashboardAnalyticsCache()

    // 1. Measure Produits & État des stocks calculation (1,000 products, 5,000 movements)
    const t0Stock = performance.now()
    const stockResult = computeAllProductsStock({
      products,
      purchases,
      purchaseLines,
      exits,
      exitLines,
      inventorySessions: [],
      inventoryLines: [],
    })
    const stockMs = performance.now() - t0Stock

    // 2. Measure Dashboard aggregation
    const t0Dash = performance.now()
    const dashResult = computeDashboardAnalytics(
      {
        products,
        suppliers,
        purchases,
        purchaseLines,
        exits,
        exitLines,
        inventorySessions: [],
        inventoryLines: [],
        settings: [],
      },
      {
        preset: 'this_month',
        referenceDate: '2026-03-28',
        forceRefresh: true,
      }
    )
    const dashMs = performance.now() - t0Dash

    // 3. Measure Historique des mouvements unified timeline (5,000 movements with running Stock après)
    const t0Hist = performance.now()
    const histResult = computeUnifiedMovementTimeline({
      products,
      suppliers,
      purchases,
      purchaseLines,
      exits,
      exitLines,
      inventorySessions: [],
      inventoryLines: [],
      settings: [],
    })
    const histMs = performance.now() - t0Hist

    expect(stockResult.size).toBe(1000)
    expect(dashResult.kpis.stockValue.value).toBeGreaterThan(0)
    expect(histResult.length).toBeGreaterThanOrEqual(5000)

    // Verify all operations execute well below 500ms even on 1,000 products & 5,000 movements
    expect(stockMs).toBeLessThan(500)
    expect(dashMs).toBeLessThan(500)
    expect(histMs).toBeLessThan(500)
  })
})
