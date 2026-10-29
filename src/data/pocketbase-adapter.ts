import PocketBase from 'pocketbase'
import type {
  AuditLogRecord,
  BackupPayload,
  ConfirmInventoryLineInput,
  CreateExitDocumentInput,
  CreateImportedInventorySessionInput,
  CreateInventoryDraftInput,
  CreatePurchaseDocumentInput,
  CreateUserInput,
  DataRepository,
  DraftPurchaseListRecord,
  ExitLineRecord,
  ExitRecord,
  ImportBatchRecord,
  InventoryLineRecord,
  InventorySessionRecord,
  MarkPurchasePaidOptions,
  PaymentEventRecord,
  ProductRecord,
  PurchaseLineRecord,
  PurchaseRecord,
  ReversalOptions,
  SaveInventoryDraftLineInput,
  SettingRecord,
  StockRecalculationReport,
  SupplierRecord,
  UserRecord,
  UserRole,
} from './types'
import {
  computeDashboardAnalytics,
  invalidateDashboardAnalyticsCache,
  type DashboardAnalyticsQueryOptions,
  type DashboardAnalyticsResult,
} from './analytics'
import {
  computeTargetedProductsStock,
  rebuildAndCompareStockCache,
  roundCurrency,
  roundQty,
} from '@/lib/stock-engine'
import { useAuthStore } from '@/stores/auth-store'

const PB_URL = import.meta.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8090'

export class PocketBaseDataRepository implements DataRepository {
  readonly adapterName = 'pocketbase' as const
  private pb: PocketBase

  constructor(url: string = PB_URL) {
    this.pb = new PocketBase(url)
    this.pb.autoCancellation(false)
  }

  private mapUserRecord(raw: Record<string, unknown>): UserRecord {
    return {
      id: String(raw.id ?? ''),
      email: String(raw.email ?? ''),
      name: String(raw.name ?? ''),
      role: (raw.role as UserRole) || 'consultation',
      active: raw.active !== false,
      created_at: String(raw.created ?? new Date().toISOString()),
      updated_at: String(raw.updated ?? new Date().toISOString()),
    }
  }

  async login(
    email: string,
    password: string
  ): Promise<{ user: UserRecord; token: string }> {
    const authData = await this.pb
      .collection('users')
      .authWithPassword(email.trim(), password)

    const user = this.mapUserRecord(
      authData.record as unknown as Record<string, unknown>
    )
    if (!user.active) {
      this.pb.authStore.clear()
      throw new Error(
        'Ce compte a été désactivé par un administrateur. Connexion refusée.'
      )
    }

    useAuthStore.getState().auth.setSession(user, authData.token)
    return { user, token: authData.token }
  }

  async logout(): Promise<void> {
    this.pb.authStore.clear()
    useAuthStore.getState().auth.reset()
  }

  async getCurrentUser(): Promise<UserRecord | null> {
    if (this.pb.authStore.isValid && this.pb.authStore.record) {
      return this.mapUserRecord(
        this.pb.authStore.record as unknown as Record<string, unknown>
      )
    }
    return useAuthStore.getState().auth.user
  }

  async listUsers(): Promise<UserRecord[]> {
    const actor = await this.getCurrentUser()
    if (actor && actor.role !== 'admin') {
      return [actor]
    }
    try {
      const records = await this.pb.collection('users').getFullList({
        sort: '-created',
      })
      return records.map((r) =>
        this.mapUserRecord(r as unknown as Record<string, unknown>)
      )
    } catch {
      return actor ? [actor] : []
    }
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const created = await this.pb.collection('users').create({
      email: input.email.trim().toLowerCase(),
      emailVisibility: true,
      name: input.name.trim(),
      role: input.role,
      active: true,
      password: input.password,
      passwordConfirm: input.password,
    })
    return this.mapUserRecord(created as unknown as Record<string, unknown>)
  }

  async updateUserRole(userId: string, role: UserRole): Promise<UserRecord> {
    const updated = await this.pb.collection('users').update(userId, { role })
    return this.mapUserRecord(updated as unknown as Record<string, unknown>)
  }

  async setUserActive(userId: string, active: boolean): Promise<UserRecord> {
    const updated = await this.pb.collection('users').update(userId, { active })
    return this.mapUserRecord(updated as unknown as Record<string, unknown>)
  }

  async listProducts(): Promise<ProductRecord[]> {
    return await this.pb.collection('products').getFullList<ProductRecord>({
      sort: 'ref',
    })
  }

  async createProduct(
    input: Omit<ProductRecord, 'id' | 'created_at' | 'updated_at'>
  ): Promise<ProductRecord> {
    return await this.pb.collection('products').create<ProductRecord>(input)
  }

  async updateProduct(
    id: string,
    input: Partial<Omit<ProductRecord, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<ProductRecord> {
    return await this.pb.collection('products').update<ProductRecord>(id, input)
  }

  async bulkUpdateProducts(
    ids: string[],
    patch: Partial<
      Pick<
        ProductRecord,
        'category' | 'unit' | 'location' | 'min_stock' | 'archived'
      >
    >
  ): Promise<number> {
    let count = 0
    for (const id of ids) {
      await this.pb.collection('products').update<ProductRecord>(id, patch)
      count++
    }
    return count
  }

  async renameOrMergeCategory(
    fromCategory: string,
    toCategory: string
  ): Promise<number> {
    const cleanFrom = fromCategory.trim()
    const cleanTo = toCategory.trim()
    const all = await this.listProducts()
    let count = 0
    for (const p of all) {
      if (p.category.trim().toLowerCase() === cleanFrom.toLowerCase()) {
        await this.pb
          .collection('products')
          .update<ProductRecord>(p.id, { category: cleanTo })
        count++
      }
    }
    return count
  }

  async renameOrMergeUnit(fromUnit: string, toUnit: string): Promise<number> {
    const cleanFrom = fromUnit.trim()
    const cleanTo = toUnit.trim()
    const all = await this.listProducts()
    let count = 0
    for (const p of all) {
      if (p.unit.trim().toLowerCase() === cleanFrom.toLowerCase()) {
        await this.pb
          .collection('products')
          .update<ProductRecord>(p.id, { unit: cleanTo })
        count++
      }
    }
    return count
  }

  async renameOrMergeLocation(
    fromLocation: string,
    toLocation: string
  ): Promise<number> {
    const cleanFrom = fromLocation.trim()
    const cleanTo = toLocation.trim()
    const all = await this.listProducts()
    let count = 0
    for (const p of all) {
      if (p.location.trim().toLowerCase() === cleanFrom.toLowerCase()) {
        await this.pb
          .collection('products')
          .update<ProductRecord>(p.id, { location: cleanTo })
        count++
      }
    }
    return count
  }

  async listSuppliers(): Promise<SupplierRecord[]> {
    return await this.pb.collection('suppliers').getFullList<SupplierRecord>({
      sort: 'name',
    })
  }

  async createSupplier(
    input: Omit<SupplierRecord, 'id' | 'created_at' | 'updated_at'>
  ): Promise<SupplierRecord> {
    return await this.pb.collection('suppliers').create<SupplierRecord>(input)
  }

  async updateSupplier(
    id: string,
    input: Partial<Omit<SupplierRecord, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<SupplierRecord> {
    return await this.pb
      .collection('suppliers')
      .update<SupplierRecord>(id, input)
  }

  async mergeSuppliers(
    sourceSupplierId: string,
    targetSupplierId: string
  ): Promise<{ movedPurchasesCount: number }> {
    const purchases = await this.pb
      .collection('purchases')
      .getFullList<PurchaseRecord>({
        filter: `supplier = "${sourceSupplierId}"`,
      })
    for (const p of purchases) {
      await this.pb
        .collection('purchases')
        .update<PurchaseRecord>(p.id, { supplier: targetSupplierId })
    }
    await this.pb.collection('suppliers').update<SupplierRecord>(
      sourceSupplierId,
      { archived: true }
    )
    return { movedPurchasesCount: purchases.length }
  }

  async listPurchases(): Promise<{
    headers: PurchaseRecord[]
    lines: PurchaseLineRecord[]
  }> {
    const [headers, lines] = await Promise.all([
      this.pb.collection('purchases').getFullList<PurchaseRecord>({
        sort: '-date',
      }),
      this.pb.collection('purchase_lines').getFullList<PurchaseLineRecord>(),
    ])
    return { headers, lines }
  }

  async createPurchaseDocument(input: CreatePurchaseDocumentInput): Promise<{
    header: PurchaseRecord
    lines: PurchaseLineRecord[]
  }> {
    const header = await this.pb.collection('purchases').create<PurchaseRecord>(
      {
        date: input.date,
        supplier: input.supplier,
        invoice_no: input.invoice_no,
        payment_status: input.payment_status,
        payment_date: input.payment_date ?? null,
        notes: input.notes ?? '',
      }
    )

    const lines: PurchaseLineRecord[] = []
    for (const line of input.lines) {
      const createdLine = await this.pb
        .collection('purchase_lines')
        .create<PurchaseLineRecord>({
          purchase: header.id,
          product: line.product,
          qty: line.qty,
          unit_price: line.unit_price,
        })
      lines.push(createdLine)
    }

    return { header, lines }
  }

  async markPurchasePaid(
    purchaseId: string,
    paymentDate: string,
    options?: MarkPurchasePaidOptions
  ): Promise<PurchaseRecord> {
    invalidateDashboardAnalyticsCache()
    const cleanDate =
      paymentDate.trim() || new Date().toISOString().slice(0, 10)
    return await this.pb
      .collection('purchases')
      .update<PurchaseRecord>(purchaseId, {
        payment_status: 'paid',
        payment_date: cleanDate,
        payment_method: options?.method?.trim() || 'Virement',
        payment_reference: options?.reference?.trim() || '',
        ...(options?.amount !== undefined ? { amount_paid: options.amount } : {}),
      })
  }

  async bulkMarkPurchasesPaid(
    purchaseIds: string[],
    paymentDate: string,
    options?: MarkPurchasePaidOptions
  ): Promise<number> {
    let count = 0
    for (const id of purchaseIds) {
      await this.markPurchasePaid(id, paymentDate, options)
      count++
    }
    return count
  }

  async reversePurchasePayment(
    purchaseId: string,
    reason: string
  ): Promise<PurchaseRecord> {
    invalidateDashboardAnalyticsCache()
    const cleanReason = reason.trim()
    if (!cleanReason) {
      throw new Error(
        'Un motif obligatoire est requis pour annuler un paiement.'
      )
    }
    return await this.pb
      .collection('purchases')
      .update<PurchaseRecord>(purchaseId, {
        payment_status: 'unpaid',
        payment_date: null,
        amount_paid: 0,
        reversal_reason: cleanReason,
      })
  }

  async listPaymentEvents(): Promise<PaymentEventRecord[]> {
    const [purchases, suppliers] = await Promise.all([
      this.listPurchases(),
      this.listSuppliers(),
    ])
    const supMap = new Map(suppliers.map((s) => [s.id, s.name]))
    const events: PaymentEventRecord[] = []

    for (const p of purchases.headers) {
      if (p.reversed_of || p.correction_status === 'reversed') continue
      if (Array.isArray(p.payment_events) && p.payment_events.length > 0) {
        events.push(...p.payment_events)
      } else if (p.payment_status === 'paid') {
        const lines = purchases.lines.filter((l) => l.purchase === p.id)
        const docTotal = roundCurrency(
          lines.reduce((acc, l) => acc + Number(l.amount || l.qty * l.unit_price || 0), 0)
        )
        events.push({
          id: `pay-init-${p.id}`,
          purchase_id: p.id,
          invoice_no: p.invoice_no || 'Sans n°',
          supplier_id: p.supplier,
          supplier_name: supMap.get(p.supplier) ?? p.supplier,
          date: (p.payment_date || p.date).slice(0, 10),
          timestamp: p.created_at || p.date,
          amount: docTotal,
          method: p.payment_method || 'Règlement',
          reference: p.payment_reference || '',
          user_id: p.recorded_by,
          user_name: p.recorded_by_name || 'Économat',
          type: 'payment',
        })
      }
    }
    return events.sort((a, b) => b.date.localeCompare(a.date))
  }

  async listDraftPurchaseLists(): Promise<DraftPurchaseListRecord[]> {
    const settings = await this.listSettings()
    const found = settings.find((s) => s.key === 'replenishment_draft_lists')
    if (!found || !Array.isArray(found.value)) return []
    return [...(found.value as DraftPurchaseListRecord[])].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at)
    )
  }

  async saveDraftPurchaseList(
    input: Omit<DraftPurchaseListRecord, 'id' | 'created_at' | 'updated_at'> & {
      id?: string
    }
  ): Promise<DraftPurchaseListRecord> {
    const current = await this.listDraftPurchaseLists()
    const now = new Date().toISOString()
    if (input.id) {
      const idx = current.findIndex((l) => l.id === input.id)
      if (idx !== -1) {
        const updated: DraftPurchaseListRecord = {
          ...current[idx],
          ...input,
          id: input.id,
          updated_at: now,
        }
        current[idx] = updated
        await this.upsertSetting('replenishment_draft_lists', current)
        return updated
      }
    }
    const created: DraftPurchaseListRecord = {
      id: input.id || `dpl-${Date.now().toString(36)}`,
      name: input.name.trim() || `Liste d’achat du ${now.slice(0, 10)}`,
      date: input.date || now.slice(0, 10),
      status: input.status || 'Brouillon',
      notes: input.notes ?? '',
      created_by: input.created_by || 'Économat',
      created_at: now,
      updated_at: now,
      lines: input.lines,
    }
    current.unshift(created)
    await this.upsertSetting('replenishment_draft_lists', current)
    return created
  }

  async deleteDraftPurchaseList(id: string): Promise<void> {
    const current = await this.listDraftPurchaseLists()
    await this.upsertSetting(
      'replenishment_draft_lists',
      current.filter((l) => l.id !== id)
    )
  }

  async reversePurchaseDocument(
    purchaseId: string,
    reason: string,
    options?: ReversalOptions
  ): Promise<{
    status: 'reversed' | 'pending_approval'
    header: PurchaseRecord
    lines: PurchaseLineRecord[]
  }> {
    const original = await this.pb
      .collection('purchases')
      .getOne<PurchaseRecord>(purchaseId)
    const origLines = await this.pb
      .collection('purchase_lines')
      .getFullList<PurchaseLineRecord>({
        filter: `purchase = "${purchaseId}"`,
      })

    const mode = options?.mode ?? 'cancel'
    const header = await this.pb.collection('purchases').create<PurchaseRecord>(
      {
        date: original.date,
        supplier: original.supplier,
        invoice_no: `REV-${original.invoice_no}`,
        payment_status: original.payment_status,
        reversed_of: original.id,
        reversal_reason: reason,
        notes: `Contre-passation (${mode === 'correct' ? 'Correction' : 'Annulation'}): ${reason}`,
      }
    )

    const lines: PurchaseLineRecord[] = []
    for (const l of origLines) {
      const revLine = await this.pb
        .collection('purchase_lines')
        .create<PurchaseLineRecord>({
          purchase: header.id,
          product: l.product,
          qty: -l.qty,
          unit_price: l.unit_price,
        })
      lines.push(revLine)
    }

    return { status: 'reversed', header, lines }
  }

  async listExits(): Promise<{
    headers: ExitRecord[]
    lines: ExitLineRecord[]
  }> {
    const [headers, lines] = await Promise.all([
      this.pb.collection('exits').getFullList<ExitRecord>({ sort: '-date' }),
      this.pb.collection('exit_lines').getFullList<ExitLineRecord>(),
    ])
    return { headers, lines }
  }

  async createExitDocument(input: CreateExitDocumentInput): Promise<{
    header: ExitRecord
    lines: ExitLineRecord[]
  }> {
    const res = await this.pb.send<{ id: string }>('/api/monarq/exits', {
      method: 'POST',
      body: input,
    })
    const header = await this.pb
      .collection('exits')
      .getOne<ExitRecord>(res.id)
    const lines = await this.pb
      .collection('exit_lines')
      .getFullList<ExitLineRecord>({
        filter: `exit = "${res.id}"`,
      })
    return { header, lines }
  }

  async reverseExitDocument(
    exitId: string,
    reason: string,
    options?: ReversalOptions
  ): Promise<{
    status: 'reversed' | 'pending_approval'
    header: ExitRecord
    lines: ExitLineRecord[]
  }> {
    const original = await this.pb
      .collection('exits')
      .getOne<ExitRecord>(exitId)
    const origLines = await this.pb
      .collection('exit_lines')
      .getFullList<ExitLineRecord>({
        filter: `exit = "${exitId}"`,
      })

    const mode = options?.mode ?? 'cancel'
    const header = await this.pb.collection('exits').create<ExitRecord>({
      date: original.date,
      destination: original.destination,
      reversed_of: original.id,
      reversal_reason: reason,
      notes: `Contre-passation (${mode === 'correct' ? 'Correction' : 'Annulation'}): ${reason}`,
    })

    const lines: ExitLineRecord[] = []
    for (const l of origLines) {
      const revLine = await this.pb
        .collection('exit_lines')
        .create<ExitLineRecord>({
          exit: header.id,
          product: l.product,
          qty_consumed: -l.qty_consumed,
          qty_wasted: -l.qty_wasted,
          loss_reason: l.loss_reason ?? null,
          unit_cost_snapshot: l.unit_cost_snapshot,
        })
      lines.push(revLine)
    }

    return { status: 'reversed', header, lines }
  }

  async listInventories(): Promise<{
    sessions: InventorySessionRecord[]
    lines: InventoryLineRecord[]
  }> {
    const [sessions, lines] = await Promise.all([
      this.pb
        .collection('inventory_sessions')
        .getFullList<InventorySessionRecord>({ sort: '-date' }),
      this.pb.collection('inventory_lines').getFullList<InventoryLineRecord>(),
    ])
    return { sessions, lines }
  }

  async createImportedInventorySession(
    input: CreateImportedInventorySessionInput
  ): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }> {
    const session = await this.pb
      .collection('inventory_sessions')
      .create<InventorySessionRecord>({
        date: input.date,
        scope: 'full',
        category: null,
        status: 'confirmed',
        confirmed_by: input.confirmed_by,
        confirmed_at: input.date,
        notes: input.notes ?? 'Session d’inventaire importée depuis Excel',
        import_batch_id: input.import_batch_id ?? null,
      })

    const lines: InventoryLineRecord[] = []
    for (const l of input.lines) {
      const createdLine = await this.pb
        .collection('inventory_lines')
        .create<InventoryLineRecord>({
          session: session.id,
          product: l.product,
          theoretical: l.theoretical,
          counted: l.counted,
          diff: l.diff,
          value_diff: l.value_diff,
          comment: l.comment ?? null,
          source_row_id: l.source_row_id ?? null,
          import_batch_id: input.import_batch_id ?? null,
          order_index: l.order_index ?? null,
        })
      lines.push(createdLine)
    }

    return { session, lines }
  }

  async createInventoryDraftSession(input: CreateInventoryDraftInput): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }> {
    const categories =
      input.scope === 'category' && Array.isArray(input.categories)
        ? input.categories.map((c) => c.trim()).filter(Boolean)
        : []
    const session = await this.pb
      .collection('inventory_sessions')
      .create<InventorySessionRecord>({
        date: input.date,
        scope: input.scope,
        category: categories.length > 0 ? categories.join(', ') : null,
        categories: categories.length > 0 ? categories : null,
        location: input.location?.trim() || null,
        status: 'draft',
        created_by: useAuthStore.getState().auth.user?.id ?? null,
        notes: input.notes ?? '',
      })
    return { session, lines: [] }
  }

  async saveInventoryDraftLines(
    sessionId: string,
    lines: SaveInventoryDraftLineInput[],
    notes?: string
  ): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }> {
    const session = await this.pb
      .collection('inventory_sessions')
      .update<InventorySessionRecord>(sessionId, {
        ...(notes !== undefined ? { notes: notes.trim() } : {}),
      })

    const [products, purchases, exits, inventories] = await Promise.all([
      this.listProducts(),
      this.listPurchases(),
      this.listExits(),
      this.listInventories(),
    ])

    const validInputs = lines.filter(
      (l) =>
        l.counted !== null &&
        l.counted !== undefined &&
        !Number.isNaN(Number(l.counted))
    )

    const stockMap = computeTargetedProductsStock({
      targetProductIds: validInputs.map((l) => l.product),
      products,
      purchases: purchases.headers,
      purchaseLines: purchases.lines,
      exits: exits.headers,
      exitLines: exits.lines,
      inventorySessions: inventories.sessions,
      inventoryLines: inventories.lines,
      asOfDate: session.date,
      excludeSessionId: sessionId,
      skipCacheUpdate: true,
    })

    const savedLines: InventoryLineRecord[] = []
    for (let i = 0; i < validInputs.length; i++) {
      const item = validInputs[i]
      const countedNum = roundQty(Number(item.counted))
      const st = stockMap.get(item.product)
      const theoretical = st ? st.stock : 0
      const diff = roundQty(countedNum - theoretical)
      const valueDiff =
        st?.averagePrice !== null && st?.averagePrice !== undefined
          ? roundCurrency(diff * st.averagePrice)
          : null

      const created = await this.pb
        .collection('inventory_lines')
        .create<InventoryLineRecord>({
          session: sessionId,
          product: item.product,
          theoretical,
          counted: countedNum,
          diff,
          value_diff: valueDiff,
          comment: item.comment?.trim() || null,
          order_index: i + 1,
        })
      savedLines.push(created)
    }

    return { session, lines: savedLines }
  }

  async confirmInventorySession(
    sessionId: string,
    lines: ConfirmInventoryLineInput[],
    notes?: string
  ): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }> {
    const countedInputs = lines.filter(
      (l) =>
        l.counted !== null &&
        l.counted !== undefined &&
        !Number.isNaN(Number(l.counted))
    )
    const [products, purchases, exits, inventories] = await Promise.all([
      this.listProducts(),
      this.listPurchases(),
      this.listExits(),
      this.listInventories(),
    ])
    const currentSession = inventories.sessions.find((s) => s.id === sessionId)
    const stockMap = computeTargetedProductsStock({
      targetProductIds: countedInputs.map((l) => l.product),
      products,
      purchases: purchases.headers,
      purchaseLines: purchases.lines,
      exits: exits.headers,
      exitLines: exits.lines,
      inventorySessions: inventories.sessions,
      inventoryLines: inventories.lines,
      asOfDate: currentSession?.date ?? null,
      excludeSessionId: sessionId,
      skipCacheUpdate: true,
    })

    const savedLines: InventoryLineRecord[] = []
    for (let i = 0; i < countedInputs.length; i++) {
      const item = countedInputs[i]
      const countedNum = roundQty(Number(item.counted))
      const st = stockMap.get(item.product)
      const theoretical = st ? st.stock : 0
      const diff = roundQty(countedNum - theoretical)
      const valueDiff =
        st?.averagePrice !== null && st?.averagePrice !== undefined
          ? roundCurrency(diff * st.averagePrice)
          : null

      const created = await this.pb
        .collection('inventory_lines')
        .create<InventoryLineRecord>({
          session: sessionId,
          product: item.product,
          theoretical,
          counted: countedNum,
          diff,
          value_diff: valueDiff,
          comment: item.comment?.trim() || null,
          order_index: i + 1,
        })
      savedLines.push(created)
    }

    const session = await this.pb
      .collection('inventory_sessions')
      .update<InventorySessionRecord>(sessionId, {
        status: 'confirmed',
        confirmed_by: useAuthStore.getState().auth.user?.id ?? null,
        confirmed_at: new Date().toISOString(),
        ...(notes !== undefined ? { notes: notes.trim() } : {}),
      })

    return { session, lines: savedLines }
  }

  async reverseInventorySession(
    sessionId: string,
    reason: string
  ): Promise<InventorySessionRecord> {
    return await this.pb
      .collection('inventory_sessions')
      .update<InventorySessionRecord>(sessionId, {
        status: 'reversed',
        reversed_by: useAuthStore.getState().auth.user?.id ?? null,
        reversed_at: new Date().toISOString(),
        reversal_reason: reason.trim(),
      })
  }

  async recalculateAllStock(): Promise<StockRecalculationReport> {
    const [products, purchases, exits, inventories] = await Promise.all([
      this.listProducts(),
      this.listPurchases(),
      this.listExits(),
      this.listInventories(),
    ])
    return rebuildAndCompareStockCache({
      products,
      purchases: purchases.headers,
      purchaseLines: purchases.lines,
      exits: exits.headers,
      exitLines: exits.lines,
      inventorySessions: inventories.sessions,
      inventoryLines: inventories.lines,
    })
  }

  async listImportBatches(): Promise<ImportBatchRecord[]> {
    return await this.pb
      .collection('import_batches')
      .getFullList<ImportBatchRecord>({ sort: '-created_at' })
  }

  async createImportBatch(
    input: Omit<ImportBatchRecord, 'id' | 'created_at'>
  ): Promise<ImportBatchRecord> {
    return await this.pb
      .collection('import_batches')
      .create<ImportBatchRecord>(input)
  }

  async reverseImportBatch(
    batchId: string,
    reason: string
  ): Promise<ImportBatchRecord> {
    const cleanReason =
      reason.trim() || `Annulation du lot d'import ${batchId}`
    const purchases = await this.pb
      .collection('purchases')
      .getFullList<PurchaseRecord>({
        filter: `import_batch_id = "${batchId}" && reversed_of = ""`,
      })
    for (const p of purchases) {
      await this.reversePurchaseDocument(p.id, cleanReason)
    }

    const exits = await this.pb.collection('exits').getFullList<ExitRecord>({
      filter: `import_batch_id = "${batchId}" && reversed_of = ""`,
    })
    for (const x of exits) {
      await this.reverseExitDocument(x.id, cleanReason)
    }

    return await this.pb
      .collection('import_batches')
      .update<ImportBatchRecord>(batchId, { status: 'reversed' })
  }

  async listAuditLogs(): Promise<AuditLogRecord[]> {
    const actor = await this.getCurrentUser()
    if (
      actor &&
      actor.role !== 'admin' &&
      actor.role !== 'manager' &&
      actor.role !== 'consultation'
    ) {
      return []
    }
    try {
      return await this.pb.collection('audit_log').getFullList<AuditLogRecord>({
        sort: '-timestamp',
      })
    } catch {
      return []
    }
  }

  async listSettings(): Promise<SettingRecord[]> {
    return await this.pb.collection('settings').getFullList<SettingRecord>()
  }

  async upsertSetting(key: string, value: unknown): Promise<SettingRecord> {
    const existing = await this.pb
      .collection('settings')
      .getFullList<SettingRecord>({
        filter: `key = "${key}"`,
      })
    if (existing.length > 0) {
      invalidateDashboardAnalyticsCache()
      return await this.pb
        .collection('settings')
        .update<SettingRecord>(existing[0].id, { key, value })
    }
    invalidateDashboardAnalyticsCache()
    return await this.pb
      .collection('settings')
      .create<SettingRecord>({ key, value })
  }

  async getDashboardAnalytics(
    options?: DashboardAnalyticsQueryOptions
  ): Promise<DashboardAnalyticsResult> {
    const currentUser = await this.getCurrentUser()
    const effectiveRole: UserRole =
      currentUser?.role === 'cuisine'
        ? 'cuisine'
        : (options?.role ?? currentUser?.role ?? 'consultation')

    try {
      const serverRes = await this.pb.send<DashboardAnalyticsResult>(
        '/api/monarq/dashboard',
        {
          method: 'GET',
          query: {
            preset: options?.preset ?? 'this_month',
            customFrom: options?.customFrom ?? '',
            customTo: options?.customTo ?? '',
            referenceDate: options?.referenceDate ?? '',
          },
        }
      )
      if (serverRes && serverRes.kpis && serverRes.charts) {
        return serverRes
      }
    } catch {
      // Fallback to repository-level aggregation if custom hook endpoint is not mounted
    }

    const [
      products,
      suppliers,
      purchases,
      exits,
      inventories,
      settings,
    ] = await Promise.all([
      this.listProducts(),
      effectiveRole === 'cuisine'
        ? Promise.resolve([])
        : this.listSuppliers(),
      effectiveRole === 'cuisine'
        ? Promise.resolve({ headers: [], lines: [] })
        : this.listPurchases(),
      this.listExits(),
      effectiveRole === 'cuisine'
        ? Promise.resolve({ sessions: [], lines: [] })
        : this.listInventories(),
      this.listSettings(),
    ])

    return computeDashboardAnalytics(
      {
        products,
        suppliers,
        purchases: purchases.headers,
        purchaseLines: purchases.lines,
        exits: exits.headers,
        exitLines: exits.lines,
        inventorySessions: inventories.sessions,
        inventoryLines: inventories.lines,
        settings,
      },
      {
        ...options,
        role: effectiveRole,
      }
    )
  }

  async exportBackup(): Promise<BackupPayload> {
    const [
      users,
      products,
      suppliers,
      purchases,
      exits,
      inventories,
      auditLog,
      settings,
      importBatches,
    ] = await Promise.all([
      this.listUsers(),
      this.listProducts(),
      this.listSuppliers(),
      this.listPurchases(),
      this.listExits(),
      this.listInventories(),
      this.listAuditLogs(),
      this.listSettings(),
      this.pb.collection('import_batches').getFullList<ImportBatchRecord>(),
    ])

    return {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      adapter: 'pocketbase',
      collections: {
        users,
        products,
        suppliers,
        purchases: purchases.headers,
        purchase_lines: purchases.lines,
        exits: exits.headers,
        exit_lines: exits.lines,
        inventory_sessions: inventories.sessions,
        inventory_lines: inventories.lines,
        audit_log: auditLog,
        settings,
        import_batches: importBatches,
      },
    }
  }

  async restoreBackup(payload: BackupPayload): Promise<void> {
    const actor = await this.getCurrentUser()
    if (!actor || actor.role !== 'admin') {
      throw new Error(
        'Seul un Administrateur peut restaurer une sauvegarde complète.'
      )
    }
    if (!payload || !payload.collections) {
      throw new Error('Fichier de sauvegarde invalide : collections manquantes.')
    }

    for (const s of payload.collections.settings ?? []) {
      await this.upsertSetting(s.key, s.value)
    }

    const upsertRecord = async (
      collectionName: string,
      record: { id: string } & Record<string, unknown>
    ) => {
      try {
        await this.pb.collection(collectionName).update(record.id, record)
      } catch {
        try {
          await this.pb.collection(collectionName).create(record)
        } catch {
          // Ignore individual conflict on restore
        }
      }
    }

    for (const p of payload.collections.products ?? []) {
      await upsertRecord('products', p as unknown as { id: string } & Record<string, unknown>)
    }
    for (const sup of payload.collections.suppliers ?? []) {
      await upsertRecord('suppliers', sup as unknown as { id: string } & Record<string, unknown>)
    }
    for (const pur of payload.collections.purchases ?? []) {
      await upsertRecord('purchases', pur as unknown as { id: string } & Record<string, unknown>)
    }
    for (const pl of payload.collections.purchase_lines ?? []) {
      await upsertRecord('purchase_lines', pl as unknown as { id: string } & Record<string, unknown>)
    }
    for (const ex of payload.collections.exits ?? []) {
      await upsertRecord('exits', ex as unknown as { id: string } & Record<string, unknown>)
    }
    for (const xl of payload.collections.exit_lines ?? []) {
      await upsertRecord('exit_lines', xl as unknown as { id: string } & Record<string, unknown>)
    }
    for (const sess of payload.collections.inventory_sessions ?? []) {
      await upsertRecord('inventory_sessions', sess as unknown as { id: string } & Record<string, unknown>)
    }
    for (const il of payload.collections.inventory_lines ?? []) {
      await upsertRecord('inventory_lines', il as unknown as { id: string } & Record<string, unknown>)
    }
    for (const ib of payload.collections.import_batches ?? []) {
      await upsertRecord('import_batches', ib as unknown as { id: string } & Record<string, unknown>)
    }

    invalidateDashboardAnalyticsCache()
  }
}
