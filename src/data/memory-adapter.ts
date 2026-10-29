import type {
  AuditAction,
  AuditLogRecord,
  BackupPayload,
  CollectionName,
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
import { canConfirmInventory, canPerformCollectionAction } from '@/lib/rbac'
import {
  checkDocumentBeforeInventoryCutoff,
  clearStockCache,
  computePurchaseLineAmount,
  computeTargetedProductsStock,
  normalizeProductRef,
  normalizeSupplierName,
  rebuildAndCompareStockCache,
  resolveInventorySessionCutoffDate,
  roundCurrency,
  roundQty,
  validateNegativeStockGuard,
} from '@/lib/stock-engine'
import { useAuthStore } from '@/stores/auth-store'

interface MemoryDatabaseState {
  users: Array<UserRecord & { passwordHash: string }>
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

const STORAGE_KEY = 'monarq_economat_memory_db_v1'

function createInitialEmptyState(): MemoryDatabaseState {
  const now = new Date().toISOString()
  return {
    users: [
      {
        id: 'usr-admin-01',
        email: 'admin@monarq.ma',
        name: 'Administrateur Monarq',
        role: 'admin',
        active: true,
        passwordHash: 'admin1234',
        created_at: now,
        updated_at: now,
      },
    ],
    products: [],
    suppliers: [],
    purchases: [],
    purchase_lines: [],
    exits: [],
    exit_lines: [],
    inventory_sessions: [],
    inventory_lines: [],
    audit_log: [],
    settings: [],
    import_batches: [],
  }
}

function loadState(): MemoryDatabaseState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return createInitialEmptyState()
    const parsed = JSON.parse(raw) as MemoryDatabaseState
    if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
      return createInitialEmptyState()
    }
    return parsed
  } catch {
    return createInitialEmptyState()
  }
}

function saveState(state: MemoryDatabaseState): void {
  invalidateDashboardAnalyticsCache()
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }
  } catch {
    // Ignore storage quota errors in headless tests
  }
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export class MemoryDataRepository implements DataRepository {
  readonly adapterName = 'memory' as const
  private state: MemoryDatabaseState
  private writeQueue: Promise<unknown> = Promise.resolve()

  constructor() {
    this.state = loadState()
  }

  private withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation)
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private getActiveAuthUser(): UserRecord {
    const authUser = useAuthStore.getState().auth.user
    if (!authUser) {
      throw new Error('Authentification requise. Veuillez vous connecter.')
    }
    const dbUser = this.state.users.find(
      (u) => u.id === authUser.id || u.email === authUser.email
    )
    if (dbUser && !dbUser.active) {
      throw new Error('Ce compte utilisateur a été désactivé.')
    }
    return (
      dbUser ?? {
        id: authUser.id,
        email: authUser.email,
        name: authUser.name,
        role: authUser.role,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    )
  }

  private assertPermission(
    collection: CollectionName,
    operation: 'list' | 'view' | 'create' | 'update' | 'delete' | 'reverse'
  ): UserRecord {
    const user = this.getActiveAuthUser()
    if (!canPerformCollectionAction(user.role, collection, operation)) {
      throw new Error(
        `Accès refusé : le rôle « ${user.role} » n'est pas autorisé à effectuer l'opération « ${operation} » sur « ${collection} ».`
      )
    }
    return user
  }

  private recordAudit(
    user: UserRecord,
    action: AuditAction,
    collection: CollectionName,
    recordId: string,
    details: Record<string, unknown>
  ): void {
    const entry: AuditLogRecord = {
      id: generateId('aud'),
      user: user.id,
      user_email: user.email,
      timestamp: new Date().toISOString(),
      action,
      collection,
      record_id: recordId,
      details,
    }
    this.state.audit_log.unshift(entry)
    saveState(this.state)
  }

  async login(
    email: string,
    password: string
  ): Promise<{ user: UserRecord; token: string }> {
    const normalizedEmail = email.trim().toLowerCase()
    const found = this.state.users.find(
      (u) => u.email.trim().toLowerCase() === normalizedEmail
    )
    if (!found) {
      throw new Error('Identifiants incorrects (utilisateur introuvable).')
    }
    if (!found.active) {
      throw new Error(
        'Ce compte a été désactivé par un administrateur. Connexion refusée.'
      )
    }
    if (found.passwordHash !== password) {
      throw new Error('Mot de passe incorrect.')
    }

    const { passwordHash: _, ...cleanUser } = found
    const token = `mem-pb-token-${found.id}-${Date.now()}`
    useAuthStore.getState().auth.setSession(cleanUser, token)
    return { user: cleanUser, token }
  }

  async logout(): Promise<void> {
    useAuthStore.getState().auth.reset()
  }

  async getCurrentUser(): Promise<UserRecord | null> {
    return useAuthStore.getState().auth.user
  }

  async listUsers(): Promise<UserRecord[]> {
    this.assertPermission('users', 'list')
    return this.state.users.map(({ passwordHash: _, ...u }) => u)
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const actor = this.assertPermission('users', 'create')
    const normalizedEmail = input.email.trim().toLowerCase()
    const cleanName = input.name.trim()

    if (!normalizedEmail || !cleanName) {
      throw new Error("Le nom complet et l'adresse e-mail sont obligatoires.")
    }
    if (input.password.length < 8) {
      throw new Error(
        'Le mot de passe initial doit contenir au moins 8 caractères.'
      )
    }
    if (
      this.state.users.some(
        (u) => u.email.trim().toLowerCase() === normalizedEmail
      )
    ) {
      throw new Error(
        `Un utilisateur avec l'adresse « ${normalizedEmail} » existe déjà.`
      )
    }

    const now = new Date().toISOString()
    const newRecord: UserRecord & { passwordHash: string } = {
      id: generateId('usr'),
      email: normalizedEmail,
      name: cleanName,
      role: input.role,
      active: true,
      passwordHash: input.password,
      created_at: now,
      updated_at: now,
    }

    this.state.users.push(newRecord)
    const { passwordHash: _, ...cleanUser } = newRecord
    this.recordAudit(actor, 'create', 'users', cleanUser.id, {
      email: cleanUser.email,
      name: cleanUser.name,
      role: cleanUser.role,
    })
    return cleanUser
  }

  async updateUserRole(userId: string, role: UserRole): Promise<UserRecord> {
    const actor = this.assertPermission('users', 'update')
    const target = this.state.users.find((u) => u.id === userId)
    if (!target) {
      throw new Error('Utilisateur introuvable.')
    }
    const previousRole = target.role
    target.role = role
    target.updated_at = new Date().toISOString()

    // If actor updated their own role, sync session store
    if (actor.id === target.id) {
      const { passwordHash: _, ...cleanSelf } = target
      useAuthStore
        .getState()
        .auth.setSession(cleanSelf, useAuthStore.getState().auth.accessToken)
    }

    this.recordAudit(actor, 'role_change', 'users', target.id, {
      email: target.email,
      previous_role: previousRole,
      new_role: role,
    })

    const { passwordHash: _, ...cleanUser } = target
    return cleanUser
  }

  async setUserActive(userId: string, active: boolean): Promise<UserRecord> {
    const actor = this.assertPermission('users', 'update')
    const target = this.state.users.find((u) => u.id === userId)
    if (!target) {
      throw new Error('Utilisateur introuvable.')
    }
    if (target.id === actor.id && !active) {
      throw new Error(
        'Vous ne pouvez pas désactiver votre propre compte administrateur actif.'
      )
    }

    target.active = active
    target.updated_at = new Date().toISOString()

    this.recordAudit(actor, 'status_change', 'users', target.id, {
      email: target.email,
      active,
    })

    const { passwordHash: _, ...cleanUser } = target
    return cleanUser
  }

  private productHasMovements(productId: string): boolean {
    return (
      this.state.purchase_lines.some((pl) => pl.product === productId) ||
      this.state.exit_lines.some((xl) => xl.product === productId) ||
      this.state.inventory_lines.some((il) => il.product === productId)
    )
  }

  async listProducts(): Promise<ProductRecord[]> {
    this.assertPermission('products', 'list')
    computeTargetedProductsStock({
      targetProductIds: this.state.products.map((p) => p.id),
      products: this.state.products,
      purchases: this.state.purchases,
      purchaseLines: this.state.purchase_lines,
      exits: this.state.exits,
      exitLines: this.state.exit_lines,
      inventorySessions: this.state.inventory_sessions,
      inventoryLines: this.state.inventory_lines,
    })
    return [...this.state.products]
  }

  async createProduct(
    input: Omit<ProductRecord, 'id' | 'created_at' | 'updated_at'>
  ): Promise<ProductRecord> {
    const actor = this.assertPermission('products', 'create')
    const normalizedRef = normalizeProductRef(input.ref)
    if (!normalizedRef || !input.name.trim()) {
      throw new Error('La référence et le nom du produit sont obligatoires.')
    }
    if (
      this.state.products.some(
        (p) => normalizeProductRef(p.ref) === normalizedRef
      )
    ) {
      throw new Error(`La référence produit « ${normalizedRef} » existe déjà.`)
    }

    const now = new Date().toISOString()
    const record: ProductRecord = {
      ...input,
      id: generateId('prd'),
      ref: normalizedRef,
      name: input.name.trim(),
      notes: input.notes ?? '',
      created_at: now,
      updated_at: now,
    }
    this.state.products.push(record)
    this.recordAudit(actor, 'create', 'products', record.id, {
      ref: record.ref,
      name: record.name,
    })
    return record
  }

  async updateProduct(
    id: string,
    input: Partial<Omit<ProductRecord, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<ProductRecord> {
    const actor = this.assertPermission('products', 'update')
    const idx = this.state.products.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error('Produit introuvable.')

    const current = this.state.products[idx]
    const hasMovements = this.productHasMovements(id)

    if (input.ref !== undefined) {
      const normalizedRef = normalizeProductRef(input.ref)
      if (!normalizedRef) {
        throw new Error('La référence du produit est obligatoire.')
      }
      if (normalizedRef !== normalizeProductRef(current.ref)) {
        if (hasMovements) {
          throw new Error(
            "Impossible de modifier la référence d'un produit ayant déjà des mouvements enregistrés."
          )
        }
        if (
          this.state.products.some(
            (p) => p.id !== id && normalizeProductRef(p.ref) === normalizedRef
          )
        ) {
          throw new Error(
            `La référence produit « ${normalizedRef} » existe déjà.`
          )
        }
      }
      input.ref = normalizedRef
    }

    if (
      input.unit !== undefined &&
      input.unit.trim() !== current.unit.trim() &&
      hasMovements
    ) {
      if (actor.role !== 'admin' && actor.role !== 'manager') {
        throw new Error(
          "Seul un Manager ou Administrateur peut modifier l'unité d'un produit ayant déjà des mouvements."
        )
      }
    }

    const updated: ProductRecord = {
      ...current,
      ...input,
      updated_at: new Date().toISOString(),
    }
    this.state.products[idx] = updated
    this.recordAudit(actor, 'update', 'products', id, {
      ref: updated.ref,
      changes: input,
    })
    return updated
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
    const actor = this.assertPermission('products', 'update')
    const idSet = new Set(ids)
    const now = new Date().toISOString()
    let updatedCount = 0

    for (let i = 0; i < this.state.products.length; i++) {
      const p = this.state.products[i]
      if (!idSet.has(p.id)) continue

      if (
        patch.unit !== undefined &&
        patch.unit.trim() !== p.unit.trim() &&
        this.productHasMovements(p.id) &&
        actor.role !== 'admin' &&
        actor.role !== 'manager'
      ) {
        throw new Error(
          `Seul un Manager ou Administrateur peut modifier l'unité du produit « ${p.name} » (${p.ref}) qui possède déjà des mouvements.`
        )
      }

      this.state.products[i] = {
        ...p,
        ...patch,
        updated_at: now,
      }
      updatedCount++
    }

    if (updatedCount > 0) {
      this.recordAudit(actor, 'update', 'products', 'bulk', {
        operation: 'bulk_update',
        count: updatedCount,
        patch,
        product_ids: ids,
      })
    }

    return updatedCount
  }

  async renameOrMergeCategory(
    fromCategory: string,
    toCategory: string
  ): Promise<number> {
    const actor = this.assertPermission('products', 'update')
    const cleanFrom = fromCategory.trim()
    const cleanTo = toCategory.trim()
    if (!cleanFrom || !cleanTo) {
      throw new Error(
        'Les noms de catégorie source et cible sont obligatoires.'
      )
    }

    const now = new Date().toISOString()
    let movedCount = 0

    for (let i = 0; i < this.state.products.length; i++) {
      const p = this.state.products[i]
      if (p.category.trim().toLowerCase() === cleanFrom.toLowerCase()) {
        this.state.products[i] = {
          ...p,
          category: cleanTo,
          updated_at: now,
        }
        movedCount++
      }
    }

    // Update categories_list setting if present
    const catSetting = this.state.settings.find(
      (s) => s.key === 'categories_list'
    )
    if (catSetting && Array.isArray(catSetting.value)) {
      const nextList = Array.from(
        new Set(
          (catSetting.value as string[])
            .map((c) =>
              c.trim().toLowerCase() === cleanFrom.toLowerCase() ? cleanTo : c
            )
            .concat([cleanTo])
        )
      )
      catSetting.value = nextList
      catSetting.updated_at = now
    }

    this.recordAudit(actor, 'update', 'products', `category:${cleanFrom}`, {
      operation: 'category_merge_or_rename',
      from_category: cleanFrom,
      to_category: cleanTo,
      moved_products_count: movedCount,
    })

    return movedCount
  }

  async renameOrMergeUnit(fromUnit: string, toUnit: string): Promise<number> {
    const actor = this.assertPermission('products', 'update')
    const cleanFrom = fromUnit.trim()
    const cleanTo = toUnit.trim()
    if (!cleanFrom || !cleanTo) {
      throw new Error("Les unités source et cible sont obligatoires.")
    }

    const now = new Date().toISOString()
    let movedCount = 0

    for (let i = 0; i < this.state.products.length; i++) {
      const p = this.state.products[i]
      if (p.unit.trim().toLowerCase() === cleanFrom.toLowerCase()) {
        this.state.products[i] = {
          ...p,
          unit: cleanTo,
          updated_at: now,
        }
        movedCount++
      }
    }

    const unitSetting = this.state.settings.find((s) => s.key === 'units_list')
    if (unitSetting && Array.isArray(unitSetting.value)) {
      const nextList = Array.from(
        new Set(
          (unitSetting.value as string[])
            .map((u) =>
              u.trim().toLowerCase() === cleanFrom.toLowerCase() ? cleanTo : u
            )
            .concat([cleanTo])
        )
      )
      unitSetting.value = nextList
      unitSetting.updated_at = now
    }

    this.recordAudit(actor, 'update', 'products', `unit:${cleanFrom}`, {
      operation: 'unit_merge_or_rename',
      from_unit: cleanFrom,
      to_unit: cleanTo,
      moved_products_count: movedCount,
    })

    return movedCount
  }

  async renameOrMergeLocation(
    fromLocation: string,
    toLocation: string
  ): Promise<number> {
    const actor = this.assertPermission('products', 'update')
    const cleanFrom = fromLocation.trim()
    const cleanTo = toLocation.trim()
    if (!cleanFrom || !cleanTo) {
      throw new Error(
        'Les emplacements source et cible sont obligatoires.'
      )
    }

    const now = new Date().toISOString()
    let movedCount = 0

    for (let i = 0; i < this.state.products.length; i++) {
      const p = this.state.products[i]
      if (p.location.trim().toLowerCase() === cleanFrom.toLowerCase()) {
        this.state.products[i] = {
          ...p,
          location: cleanTo,
          updated_at: now,
        }
        movedCount++
      }
    }

    const locSetting = this.state.settings.find(
      (s) => s.key === 'locations_list'
    )
    if (locSetting && Array.isArray(locSetting.value)) {
      const nextList = Array.from(
        new Set(
          (locSetting.value as string[])
            .map((l) =>
              l.trim().toLowerCase() === cleanFrom.toLowerCase() ? cleanTo : l
            )
            .concat([cleanTo])
        )
      )
      locSetting.value = nextList
      locSetting.updated_at = now
    }

    this.recordAudit(actor, 'update', 'products', `location:${cleanFrom}`, {
      operation: 'location_merge_or_rename',
      from_location: cleanFrom,
      to_location: cleanTo,
      moved_products_count: movedCount,
    })

    return movedCount
  }

  async listSuppliers(): Promise<SupplierRecord[]> {
    this.assertPermission('suppliers', 'list')
    return [...this.state.suppliers]
  }

  async createSupplier(
    input: Omit<SupplierRecord, 'id' | 'created_at' | 'updated_at'>
  ): Promise<SupplierRecord> {
    const actor = this.assertPermission('suppliers', 'create')
    const normalizedName = normalizeSupplierName(input.name)
    if (!normalizedName) {
      throw new Error('Le nom du fournisseur est obligatoire.')
    }
    if (
      this.state.suppliers.some(
        (s) => normalizeSupplierName(s.name) === normalizedName
      )
    ) {
      throw new Error(`Le fournisseur « ${input.name.trim()} » existe déjà.`)
    }

    const now = new Date().toISOString()
    const record: SupplierRecord = {
      ...input,
      id: generateId('sup'),
      name: input.name.trim(),
      archived: input.archived ?? false,
      created_at: now,
      updated_at: now,
    }
    this.state.suppliers.push(record)
    this.recordAudit(actor, 'create', 'suppliers', record.id, {
      name: record.name,
    })
    return record
  }

  async updateSupplier(
    id: string,
    input: Partial<Omit<SupplierRecord, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<SupplierRecord> {
    const actor = this.assertPermission('suppliers', 'update')
    const idx = this.state.suppliers.findIndex((s) => s.id === id)
    if (idx === -1) throw new Error('Fournisseur introuvable.')

    if (input.name !== undefined) {
      const normalizedName = normalizeSupplierName(input.name)
      if (!normalizedName) {
        throw new Error('Le nom du fournisseur est obligatoire.')
      }
      if (
        this.state.suppliers.some(
          (s) => s.id !== id && normalizeSupplierName(s.name) === normalizedName
        )
      ) {
        throw new Error(`Le fournisseur « ${input.name.trim()} » existe déjà.`)
      }
      input.name = input.name.trim()
    }

    const updated: SupplierRecord = {
      ...this.state.suppliers[idx],
      ...input,
      updated_at: new Date().toISOString(),
    }
    this.state.suppliers[idx] = updated
    this.recordAudit(actor, 'update', 'suppliers', id, { changes: input })
    return updated
  }

  async mergeSuppliers(
    sourceSupplierId: string,
    targetSupplierId: string
  ): Promise<{ movedPurchasesCount: number }> {
    const actor = this.assertPermission('suppliers', 'update')
    if (sourceSupplierId === targetSupplierId) {
      throw new Error(
        'Les fournisseurs source et cible doivent être différents.'
      )
    }
    const sourceIdx = this.state.suppliers.findIndex(
      (s) => s.id === sourceSupplierId
    )
    const targetIdx = this.state.suppliers.findIndex(
      (s) => s.id === targetSupplierId
    )
    if (sourceIdx === -1 || targetIdx === -1) {
      throw new Error('Fournisseur source ou cible introuvable.')
    }

    const source = this.state.suppliers[sourceIdx]
    const target = this.state.suppliers[targetIdx]

    let movedPurchasesCount = 0
    for (let i = 0; i < this.state.purchases.length; i++) {
      if (this.state.purchases[i].supplier === sourceSupplierId) {
        this.state.purchases[i] = {
          ...this.state.purchases[i],
          supplier: targetSupplierId,
        }
        movedPurchasesCount++
      }
    }

    const now = new Date().toISOString()
    this.state.suppliers[sourceIdx] = {
      ...source,
      archived: true,
      notes: source.notes
        ? `${source.notes} | Fusionné vers ${target.name} le ${now.slice(0, 10)}`
        : `Fusionné vers ${target.name} le ${now.slice(0, 10)}`,
      updated_at: now,
    }

    this.recordAudit(actor, 'update', 'suppliers', targetSupplierId, {
      operation: 'supplier_merge',
      source_supplier_id: sourceSupplierId,
      source_supplier_name: source.name,
      target_supplier_id: targetSupplierId,
      target_supplier_name: target.name,
      moved_purchases_count: movedPurchasesCount,
    })

    return { movedPurchasesCount }
  }

  async listPurchases(): Promise<{
    headers: PurchaseRecord[]
    lines: PurchaseLineRecord[]
  }> {
    this.assertPermission('purchases', 'list')
    const userMap = new Map(
      this.state.users.map((u) => [u.id, u.name || u.email])
    )
    const headers = this.state.purchases.map((h) => ({
      ...h,
      recorded_by_name:
        h.recorded_by_name || userMap.get(h.recorded_by) || h.recorded_by,
    }))
    return {
      headers,
      lines: [...this.state.purchase_lines],
    }
  }

  async createPurchaseDocument(input: CreatePurchaseDocumentInput): Promise<{
    header: PurchaseRecord
    lines: PurchaseLineRecord[]
  }> {
    return this.withWriteLock(async () => {
      const actor = this.assertPermission('purchases', 'create')
      if (!input.lines || input.lines.length === 0) {
        throw new Error(
          'Un bon d’entrée doit contenir au moins une ligne produit.'
        )
      }

      for (const line of input.lines) {
        if (line.qty <= 0) {
          throw new Error(
            'La quantité de chaque ligne d’entrée doit être strictement supérieure à 0.'
          )
        }
        if (line.unit_price < 0) {
          throw new Error('Le prix unitaire ne peut pas être négatif.')
        }
        const prod = this.state.products.find((p) => p.id === line.product)
        if (!prod) {
          throw new Error('Produit introuvable dans une ligne du bon d’entrée.')
        }
        if (prod.archived && !input.import_batch_id) {
          throw new Error(
            `Le produit « ${prod.name} » (${prod.ref}) est archivé et ne peut pas être sélectionné.`
          )
        }
      }

      const now = new Date().toISOString()
      const header: PurchaseRecord = {
        id: generateId('pur'),
        date: input.date || now,
        supplier: input.supplier,
        invoice_no: input.invoice_no.trim(),
        payment_status: input.payment_status,
        payment_date:
          input.payment_status === 'paid'
            ? (input.payment_date ?? now.slice(0, 10))
            : null,
        recorded_by: actor.id,
        recorded_by_name: actor.name || actor.email,
        notes: input.notes ?? '',
        reversed_of: null,
        correction_status: 'none',
        import_batch_id: input.import_batch_id ?? null,
        order_index: input.order_index ?? this.state.purchases.length + 1,
        created_at: now,
      }

      const createdLines: PurchaseLineRecord[] = input.lines.map(
        (line, idx) => ({
          id: generateId('pLN'),
          purchase: header.id,
          product: line.product,
          qty: line.qty,
          unit_price: line.unit_price,
          amount: computePurchaseLineAmount(line.qty, line.unit_price),
          source_row_id: line.source_row_id ?? null,
          import_batch_id: input.import_batch_id ?? null,
          order_index:
            line.order_index ?? (header.order_index ?? 0) * 100 + idx,
          created_at: now,
        })
      )

      // Commit header and all lines together in one transaction
      this.state.purchases.push(header)
      this.state.purchase_lines.push(...createdLines)

      // Recompute only affected products
      const affectedProductIds = Array.from(
        new Set(createdLines.map((l) => l.product))
      )
      computeTargetedProductsStock({
        targetProductIds: affectedProductIds,
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
      })

      this.recordAudit(actor, 'create', 'purchases', header.id, {
        invoice_no: header.invoice_no,
        supplier: header.supplier,
        payment_status: header.payment_status,
        lines_count: createdLines.length,
        import_batch_id: header.import_batch_id,
      })

      return { header, lines: createdLines }
    })
  }

  async markPurchasePaid(
    purchaseId: string,
    paymentDate: string,
    options?: MarkPurchasePaidOptions
  ): Promise<PurchaseRecord> {
    return this.withWriteLock(async () => {
      const actor = this.assertPermission('purchases', 'update')
      const idx = this.state.purchases.findIndex((p) => p.id === purchaseId)
      if (idx === -1) {
        throw new Error('Bon d’entrée introuvable.')
      }
      const cleanDate =
        paymentDate.trim() || new Date().toISOString().slice(0, 10)
      const current = this.state.purchases[idx]
      const lines = this.state.purchase_lines.filter(
        (l) => l.purchase === purchaseId
      )
      const docTotal = roundCurrency(
        lines.reduce((acc, l) => acc + Number(l.amount || l.qty * l.unit_price || 0), 0)
      )
      const prevPaid = roundCurrency(
        current.payment_status === 'paid'
          ? docTotal
          : Number(current.amount_paid ?? 0)
      )
      const requestedAmt =
        options?.amount !== undefined &&
        options?.amount !== null &&
        !Number.isNaN(Number(options.amount)) &&
        Number(options.amount) > 0
          ? roundCurrency(Number(options.amount))
          : roundCurrency(Math.max(0, docTotal - prevPaid)) || docTotal

      const nextPaid = roundCurrency(Math.min(docTotal, prevPaid + requestedAmt))
      const nextStatus =
        nextPaid >= docTotal - 0.01 && docTotal > 0
          ? 'paid'
          : nextPaid > 0
            ? 'partial'
            : 'paid'

      const supName =
        this.state.suppliers.find((s) => s.id === current.supplier)?.name ??
        current.supplier
      const method = options?.method?.trim() || 'Virement'
      const reference = options?.reference?.trim() || ''

      const event: PaymentEventRecord = {
        id: generateId('pay'),
        purchase_id: current.id,
        invoice_no: current.invoice_no || 'Sans n°',
        supplier_id: current.supplier,
        supplier_name: supName,
        date: cleanDate,
        timestamp: new Date().toISOString(),
        amount: requestedAmt,
        method,
        reference,
        user_id: actor.id,
        user_name: actor.name || actor.email,
        type: 'payment',
      }

      const updated: PurchaseRecord = {
        ...current,
        payment_status: nextStatus,
        payment_date: cleanDate,
        payment_method: method,
        payment_reference: reference,
        amount_paid: nextStatus === 'paid' ? docTotal : nextPaid,
        payment_events: [...(current.payment_events ?? []), event],
      }
      this.state.purchases[idx] = updated
      saveState(this.state)

      this.recordAudit(actor, 'update', 'purchases', purchaseId, {
        operation: 'mark_paid',
        invoice_no: updated.invoice_no || 'Sans n°',
        payment_date: cleanDate,
        payment_status: nextStatus,
        amount_paid: requestedAmt,
        method,
        reference,
      })

      return updated
    })
  }

  async bulkMarkPurchasesPaid(
    purchaseIds: string[],
    paymentDate: string,
    options?: MarkPurchasePaidOptions
  ): Promise<number> {
    let count = 0
    for (const id of purchaseIds) {
      const existing = this.state.purchases.find((p) => p.id === id)
      if (existing && existing.payment_status !== 'paid') {
        await this.markPurchasePaid(id, paymentDate, options)
        count++
      }
    }
    return count
  }

  async reversePurchasePayment(
    purchaseId: string,
    reason: string
  ): Promise<PurchaseRecord> {
    return this.withWriteLock(async () => {
      const actor = this.getActiveAuthUser()
      if (actor.role !== 'admin' && actor.role !== 'manager') {
        throw new Error(
          'Seul un Manager ou Administrateur peut annuler un paiement enregistré.'
        )
      }
      const cleanReason = reason.trim()
      if (!cleanReason) {
        throw new Error(
          'Un motif obligatoire est requis pour annuler un paiement.'
        )
      }

      const idx = this.state.purchases.findIndex((p) => p.id === purchaseId)
      if (idx === -1) {
        throw new Error('Facture / Bon d’entrée introuvable.')
      }
      const current = this.state.purchases[idx]
      if (current.payment_status === 'unpaid') {
        throw new Error('Cette facture est déjà au statut Impayé.')
      }

      const lines = this.state.purchase_lines.filter(
        (l) => l.purchase === purchaseId
      )
      const docTotal = roundCurrency(
        lines.reduce((acc, l) => acc + Number(l.amount || l.qty * l.unit_price || 0), 0)
      )
      const reversedAmount =
        current.amount_paid !== undefined && current.amount_paid !== null
          ? Number(current.amount_paid)
          : docTotal

      const supName =
        this.state.suppliers.find((s) => s.id === current.supplier)?.name ??
        current.supplier

      const nowIso = new Date().toISOString()
      const reversalEvent: PaymentEventRecord = {
        id: generateId('payRev'),
        purchase_id: current.id,
        invoice_no: current.invoice_no || 'Sans n°',
        supplier_id: current.supplier,
        supplier_name: supName,
        date: nowIso.slice(0, 10),
        timestamp: nowIso,
        amount: -Math.abs(reversedAmount),
        method: current.payment_method || 'Annulation règlement',
        reference: current.payment_reference || '',
        user_id: actor.id,
        user_name: actor.name || actor.email,
        type: 'reversal',
        reversal_reason: cleanReason,
      }

      const updated: PurchaseRecord = {
        ...current,
        payment_status: 'unpaid',
        payment_date: null,
        amount_paid: 0,
        payment_events: [...(current.payment_events ?? []), reversalEvent],
      }
      this.state.purchases[idx] = updated
      saveState(this.state)

      this.recordAudit(actor, 'reversal', 'purchases', purchaseId, {
        operation: 'reverse_payment',
        invoice_no: current.invoice_no || 'Sans n°',
        previous_payment_status: current.payment_status,
        previous_payment_date: current.payment_date,
        reversed_amount: reversedAmount,
        reason: cleanReason,
      })

      return updated
    })
  }

  async listPaymentEvents(): Promise<PaymentEventRecord[]> {
    this.assertPermission('purchases', 'list')
    const supMap = new Map(this.state.suppliers.map((s) => [s.id, s.name]))
    const userMap = new Map(
      this.state.users.map((u) => [u.id, u.name || u.email])
    )
    const events: PaymentEventRecord[] = []

    for (const p of this.state.purchases) {
      if (p.reversed_of || p.correction_status === 'reversed' || p.correction_status === 'corrected') {
        continue
      }
      if (Array.isArray(p.payment_events) && p.payment_events.length > 0) {
        events.push(...p.payment_events)
      } else if (p.payment_status === 'paid') {
        const lines = this.state.purchase_lines.filter((l) => l.purchase === p.id)
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
          method: p.payment_method || (p.import_batch_id ? 'Import Excel (OUI)' : 'Règlement initial'),
          reference: p.payment_reference || '',
          user_id: p.recorded_by,
          user_name:
            p.recorded_by_name || userMap.get(p.recorded_by) || 'Économat',
          type: 'payment',
        })
      }
    }

    return events.sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date)
      return b.timestamp.localeCompare(a.timestamp)
    })
  }

  async listDraftPurchaseLists(): Promise<DraftPurchaseListRecord[]> {
    const actor = this.getActiveAuthUser()
    if (actor.role === 'cuisine') {
      throw new Error(
        'Accès refusé : le rôle Cuisine n’a pas accès aux listes d’achat fournisseurs.'
      )
    }
    const setting = this.state.settings.find(
      (s) => s.key === 'replenishment_draft_lists'
    )
    if (!setting || !Array.isArray(setting.value)) return []
    return [...(setting.value as DraftPurchaseListRecord[])].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at)
    )
  }

  async saveDraftPurchaseList(
    input: Omit<DraftPurchaseListRecord, 'id' | 'created_at' | 'updated_at'> & {
      id?: string
    }
  ): Promise<DraftPurchaseListRecord> {
    const actor = this.getActiveAuthUser()
    if (actor.role === 'consultation' || actor.role === 'cuisine') {
      throw new Error(
        'Votre rôle ne permet pas de créer ou modifier une liste d’achat.'
      )
    }
    const currentLists = await this.listDraftPurchaseLists()
    const now = new Date().toISOString()

    if (input.id) {
      const idx = currentLists.findIndex((l) => l.id === input.id)
      if (idx !== -1) {
        const updated: DraftPurchaseListRecord = {
          ...currentLists[idx],
          ...input,
          id: input.id,
          updated_at: now,
        }
        currentLists[idx] = updated
        await this.upsertSetting('replenishment_draft_lists', currentLists)
        return updated
      }
    }

    const created: DraftPurchaseListRecord = {
      id: input.id || generateId('dpl'),
      name: input.name.trim() || `Liste d’achat du ${now.slice(0, 10)}`,
      date: input.date || now.slice(0, 10),
      status: input.status || 'Brouillon',
      notes: input.notes ?? '',
      created_by: input.created_by || actor.name || actor.email,
      created_at: now,
      updated_at: now,
      lines: input.lines,
    }
    currentLists.unshift(created)
    await this.upsertSetting('replenishment_draft_lists', currentLists)
    return created
  }

  async deleteDraftPurchaseList(id: string): Promise<void> {
    const actor = this.getActiveAuthUser()
    if (actor.role === 'consultation' || actor.role === 'cuisine') {
      throw new Error('Votre rôle ne permet pas de supprimer une liste d’achat.')
    }
    const currentLists = await this.listDraftPurchaseLists()
    const filtered = currentLists.filter((l) => l.id !== id)
    await this.upsertSetting('replenishment_draft_lists', filtered)
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
    return this.withWriteLock(async () => {
      const actor = this.assertPermission('purchases', 'reverse')
      const cleanReason = reason.trim()
      if (!cleanReason) {
        throw new Error(
          'Un motif de contre-passation est obligatoire pour corriger ou annuler une entrée.'
        )
      }

      const originalIdx = this.state.purchases.findIndex(
        (p) => p.id === purchaseId
      )
      if (originalIdx === -1) throw new Error('Entrée de stock introuvable.')
      const original = this.state.purchases[originalIdx]

      if (original.reversed_of) {
        throw new Error(
          'Impossible d’annuler une écriture qui est déjà une contre-passation.'
        )
      }
      if (
        this.state.purchases.some((p) => p.reversed_of === purchaseId) ||
        original.correction_status === 'reversed' ||
        original.correction_status === 'corrected'
      ) {
        throw new Error('Ce bon d’entrée a déjà fait l’objet d’une contre-passation.')
      }

      const origLines = this.state.purchase_lines.filter(
        (l) => l.purchase === purchaseId
      )
      const now = new Date().toISOString()

      // Check confirmed inventory cutoff for affected products
      const confirmedCounts = this.state.inventory_lines
        .map((il, idx) => {
          const s = this.state.inventory_sessions.find(
            (sess) => sess.id === il.session && sess.status === 'confirmed'
          )
          if (!s) return null
          return {
            id: il.id,
            sessionId: s.id,
            productId: il.product,
            date: resolveInventorySessionCutoffDate(s),
            counted: il.counted,
            status: s.status,
            confirmedAt: s.confirmed_at ?? s.date,
            confirmedOrder: il.order_index ?? idx,
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)

      const cutoffCheck = checkDocumentBeforeInventoryCutoff(
        original.date,
        origLines.map((l) => l.product),
        confirmedCounts
      )

      const isSameDayOwnDoc =
        original.recorded_by === actor.id &&
        original.created_at.slice(0, 10) === now.slice(0, 10)

      // Economat rule: economat can request/execute a correction on documents they created the same day (if not before cutoff);
      // all others (different day, created by another user, simple cancellation, or before inventory cutoff) require manager/admin approval.
      const requiresManagerApproval =
        actor.role === 'economat' &&
        (!isSameDayOwnDoc ||
          cutoffCheck.isBeforeCutoff ||
          options?.mode !== 'correct')

      if (requiresManagerApproval) {
        const updatedOriginal: PurchaseRecord = {
          ...original,
          correction_status: 'pending_approval',
          pending_reversal_reason: cleanReason,
          pending_reversal_requested_by: actor.id,
          pending_reversal_requested_by_name: actor.name || actor.email,
          pending_reversal_requested_at: now,
          pending_reversal_mode: options?.mode ?? 'cancel',
        }
        this.state.purchases[originalIdx] = updatedOriginal
        this.recordAudit(actor, 'update', 'purchases', original.id, {
          operation: 'request_reversal_approval',
          reason: cleanReason,
          mode: options?.mode ?? 'cancel',
          before_inventory_cutoff: cutoffCheck.isBeforeCutoff,
        })
        return {
          status: 'pending_approval',
          header: updatedOriginal,
          lines: origLines,
        }
      }

      const mode =
        options?.mode ?? original.pending_reversal_mode ?? 'cancel'

      const revHeader: PurchaseRecord = {
        id: generateId('pur-rev'),
        date: original.date,
        supplier: original.supplier,
        invoice_no: original.invoice_no ? `REV-${original.invoice_no}` : 'REV',
        payment_status: original.payment_status,
        payment_date: original.payment_date,
        recorded_by: actor.id,
        recorded_by_name: actor.name || actor.email,
        notes: `Contre-passation (${mode === 'correct' ? 'Correction' : 'Annulation'}) de ${original.invoice_no || original.id}: ${cleanReason}`,
        reversed_of: original.id,
        reversal_reason: cleanReason,
        correction_status: 'none',
        order_index: this.state.purchases.length + 1,
        created_at: now,
      }

      const revLines: PurchaseLineRecord[] = origLines.map((l, idx) => ({
        id: generateId('pLN-rev'),
        purchase: revHeader.id,
        product: l.product,
        qty: -l.qty,
        unit_price: l.unit_price,
        amount: -l.amount,
        order_index: (revHeader.order_index ?? 0) * 100 + idx,
        created_at: now,
      }))

      this.state.purchases[originalIdx] = {
        ...original,
        correction_status: mode === 'correct' ? 'corrected' : 'reversed',
        pending_reversal_reason: null,
        pending_reversal_requested_by: null,
        pending_reversal_requested_by_name: null,
        pending_reversal_requested_at: null,
        pending_reversal_mode: null,
      }

      this.state.purchases.push(revHeader)
      this.state.purchase_lines.push(...revLines)

      // Recompute only affected products
      computeTargetedProductsStock({
        targetProductIds: Array.from(new Set(origLines.map((l) => l.product))),
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
      })

      this.recordAudit(actor, 'reversal', 'purchases', revHeader.id, {
        reversed_of: original.id,
        reason: cleanReason,
        mode,
        approved_pending: Boolean(options?.approvePending),
        before_inventory_cutoff: cutoffCheck.isBeforeCutoff,
      })

      return { status: 'reversed', header: revHeader, lines: revLines }
    })
  }

  async listExits(): Promise<{
    headers: ExitRecord[]
    lines: ExitLineRecord[]
  }> {
    const actor = this.assertPermission('exits', 'list')
    const userMap = new Map(
      this.state.users.map((u) => [u.id, u.name || u.email])
    )
    const headers = this.state.exits.map((h) => ({
      ...h,
      recorded_by_name:
        h.recorded_by_name || userMap.get(h.recorded_by) || h.recorded_by,
    }))
    const lines = this.state.exit_lines.map((l) =>
      actor.role === 'cuisine' ? { ...l, unit_cost_snapshot: null } : { ...l }
    )
    return {
      headers,
      lines,
    }
  }

  async createExitDocument(input: CreateExitDocumentInput): Promise<{
    header: ExitRecord
    lines: ExitLineRecord[]
  }> {
    return this.withWriteLock(async () => {
      const actor = this.assertPermission('exits', 'create')
      if (!input.lines || input.lines.length === 0) {
        throw new Error(
          'Un bon de sortie doit contenir au moins une ligne produit.'
        )
      }

      // Aggregate requested deduction per product across all lines in this document
      const requestedDeductionByProduct = new Map<string, number>()
      for (const line of input.lines) {
        if (line.qty_consumed < 0 || line.qty_wasted < 0) {
          throw new Error(
            'Les quantités consommées et perdues doivent être positives ou nulles.'
          )
        }
        if (line.qty_consumed === 0 && line.qty_wasted === 0) {
          throw new Error(
            'Chaque ligne de sortie doit avoir une quantité consommée ou perdue supérieure à 0.'
          )
        }
        const product = this.state.products.find((p) => p.id === line.product)
        if (!product) throw new Error('Produit introuvable dans la ligne.')
        if (product.archived && !input.import_batch_id) {
          throw new Error(
            `Le produit « ${product.name} » (${product.ref}) est archivé et ne peut pas être utilisé.`
          )
        }
        const prev = requestedDeductionByProduct.get(line.product) ?? 0
        requestedDeductionByProduct.set(
          line.product,
          prev + line.qty_consumed + line.qty_wasted
        )
      }

      const targetProductIds = Array.from(requestedDeductionByProduct.keys())
      const targetedStockMap = computeTargetedProductsStock({
        targetProductIds,
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
      })

      const snapshots = new Map<string, number | null>()
      let usedNegativeOverride = false

      for (const [productId, totalDeduction] of requestedDeductionByProduct.entries()) {
        const stockState = targetedStockMap.get(productId)
        if (!stockState) {
          throw new Error('État de stock introuvable pour le produit.')
        }

        if (!input.skipNegativeStockGuard) {
          const guard = validateNegativeStockGuard({
            currentStock: stockState.stock,
            requestedDeduction: totalDeduction,
            userRole: actor.role,
            negativeStockReason: input.negative_stock_reason,
          })

          if (!guard.allowed) {
            throw new Error(guard.errorMessage)
          }
          if (guard.requiresManagerOverride) {
            usedNegativeOverride = true
          }
        }
        snapshots.set(productId, stockState.averagePrice)
      }

      const now = new Date().toISOString()
      const header: ExitRecord = {
        id: generateId('ext'),
        date: input.date || now,
        destination: input.destination,
        recorded_by: actor.id,
        recorded_by_name: actor.name || actor.email,
        notes: input.notes ?? '',
        reversed_of: null,
        negative_stock_reason: input.negative_stock_reason ?? null,
        correction_status: 'none',
        import_batch_id: input.import_batch_id ?? null,
        order_index: input.order_index ?? this.state.exits.length + 1,
        created_at: now,
      }

      // Store the real cost snapshot in the database even when recorded by 'cuisine'
      const storedLines: ExitLineRecord[] = input.lines.map((line, idx) => ({
        id: generateId('xLN'),
        exit: header.id,
        product: line.product,
        qty_consumed: line.qty_consumed,
        qty_wasted: line.qty_wasted,
        loss_reason: line.loss_reason ?? null,
        unit_cost_snapshot: snapshots.get(line.product) ?? null,
        source_row_id: line.source_row_id ?? null,
        import_batch_id: input.import_batch_id ?? null,
        order_index:
          line.order_index ?? (header.order_index ?? 0) * 100 + idx,
        created_at: now,
      }))

      this.state.exits.push(header)
      this.state.exit_lines.push(...storedLines)

      // Recompute only affected products
      computeTargetedProductsStock({
        targetProductIds,
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
      })

      this.recordAudit(actor, 'create', 'exits', header.id, {
        destination: header.destination,
        lines_count: storedLines.length,
        negative_stock_override: usedNegativeOverride,
        negative_stock_reason: header.negative_stock_reason,
        import_batch_id: header.import_batch_id,
      })

      // Mask unit_cost_snapshot if caller is 'cuisine'
      const responseLines = storedLines.map((l) =>
        actor.role === 'cuisine'
          ? { ...l, unit_cost_snapshot: null }
          : { ...l }
      )

      return { header, lines: responseLines }
    })
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
    return this.withWriteLock(async () => {
      const actor = this.assertPermission('exits', 'reverse')
      const cleanReason = reason.trim()
      if (!cleanReason) {
        throw new Error(
          'Un motif de contre-passation est obligatoire pour corriger ou annuler une sortie.'
        )
      }

      const originalIdx = this.state.exits.findIndex((x) => x.id === exitId)
      if (originalIdx === -1) throw new Error('Sortie de stock introuvable.')
      const original = this.state.exits[originalIdx]

      if (original.reversed_of) {
        throw new Error(
          'Impossible d’annuler une écriture qui est déjà une contre-passation.'
        )
      }
      if (
        this.state.exits.some((x) => x.reversed_of === exitId) ||
        original.correction_status === 'reversed' ||
        original.correction_status === 'corrected'
      ) {
        throw new Error('Ce bon de sortie a déjà fait l’objet d’une contre-passation.')
      }

      const origLines = this.state.exit_lines.filter((l) => l.exit === exitId)
      const now = new Date().toISOString()

      const confirmedCounts = this.state.inventory_lines
        .map((il, idx) => {
          const s = this.state.inventory_sessions.find(
            (sess) => sess.id === il.session && sess.status === 'confirmed'
          )
          if (!s) return null
          return {
            id: il.id,
            sessionId: s.id,
            productId: il.product,
            date: resolveInventorySessionCutoffDate(s),
            counted: il.counted,
            status: s.status,
            confirmedAt: s.confirmed_at ?? s.date,
            confirmedOrder: il.order_index ?? idx,
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)

      const cutoffCheck = checkDocumentBeforeInventoryCutoff(
        original.date,
        origLines.map((l) => l.product),
        confirmedCounts
      )

      const isSameDayOwnDoc =
        original.recorded_by === actor.id &&
        original.created_at.slice(0, 10) === now.slice(0, 10)

      const requiresManagerApproval =
        actor.role === 'economat' &&
        (!isSameDayOwnDoc ||
          cutoffCheck.isBeforeCutoff ||
          options?.mode !== 'correct')

      if (requiresManagerApproval) {
        const updatedOriginal: ExitRecord = {
          ...original,
          correction_status: 'pending_approval',
          pending_reversal_reason: cleanReason,
          pending_reversal_requested_by: actor.id,
          pending_reversal_requested_by_name: actor.name || actor.email,
          pending_reversal_requested_at: now,
          pending_reversal_mode: options?.mode ?? 'cancel',
        }
        this.state.exits[originalIdx] = updatedOriginal
        this.recordAudit(actor, 'update', 'exits', original.id, {
          operation: 'request_reversal_approval',
          reason: cleanReason,
          mode: options?.mode ?? 'cancel',
          before_inventory_cutoff: cutoffCheck.isBeforeCutoff,
        })
        return {
          status: 'pending_approval',
          header: updatedOriginal,
          lines: origLines,
        }
      }

      const mode =
        options?.mode ?? original.pending_reversal_mode ?? 'cancel'

      const revHeader: ExitRecord = {
        id: generateId('ext-rev'),
        date: original.date,
        destination: original.destination,
        recorded_by: actor.id,
        recorded_by_name: actor.name || actor.email,
        notes: `Contre-passation (${mode === 'correct' ? 'Correction' : 'Annulation'}) de ${original.id}: ${cleanReason}`,
        reversed_of: original.id,
        reversal_reason: cleanReason,
        correction_status: 'none',
        order_index: this.state.exits.length + 1,
        created_at: now,
      }

      const revLines: ExitLineRecord[] = origLines.map((l, idx) => ({
        id: generateId('xLN-rev'),
        exit: revHeader.id,
        product: l.product,
        qty_consumed: -l.qty_consumed,
        qty_wasted: -l.qty_wasted,
        loss_reason: l.loss_reason ?? null,
        unit_cost_snapshot: l.unit_cost_snapshot,
        order_index: (revHeader.order_index ?? 0) * 100 + idx,
        created_at: now,
      }))

      this.state.exits[originalIdx] = {
        ...original,
        correction_status: mode === 'correct' ? 'corrected' : 'reversed',
        pending_reversal_reason: null,
        pending_reversal_requested_by: null,
        pending_reversal_requested_by_name: null,
        pending_reversal_requested_at: null,
        pending_reversal_mode: null,
      }

      this.state.exits.push(revHeader)
      this.state.exit_lines.push(...revLines)

      // Recompute only affected products
      computeTargetedProductsStock({
        targetProductIds: Array.from(new Set(origLines.map((l) => l.product))),
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
      })

      this.recordAudit(actor, 'reversal', 'exits', revHeader.id, {
        reversed_of: original.id,
        reason: cleanReason,
        mode,
        approved_pending: Boolean(options?.approvePending),
        before_inventory_cutoff: cutoffCheck.isBeforeCutoff,
      })

      return { status: 'reversed', header: revHeader, lines: revLines }
    })
  }

  async listInventories(): Promise<{
    sessions: InventorySessionRecord[]
    lines: InventoryLineRecord[]
  }> {
    const actor = this.assertPermission('inventory_sessions', 'list')
    const userMap = new Map(
      this.state.users.map((u) => [u.id, u.name || u.email])
    )

    // Consultation role sees only confirmed/reversed sessions (no draft count sessions)
    const visibleSessions = this.state.inventory_sessions
      .filter((s) => (actor.role === 'consultation' ? s.status !== 'draft' : true))
      .map((s) => ({
        ...s,
        created_by_name:
          s.created_by_name ||
          (s.created_by ? userMap.get(s.created_by) || s.created_by : null),
        confirmed_by_name:
          s.confirmed_by_name ||
          (s.confirmed_by ? userMap.get(s.confirmed_by) || s.confirmed_by : null),
        reversed_by_name:
          s.reversed_by_name ||
          (s.reversed_by ? userMap.get(s.reversed_by) || s.reversed_by : null),
      }))

    const visibleSessionIds = new Set(visibleSessions.map((s) => s.id))
    const lines = this.state.inventory_lines
      .filter((l) => visibleSessionIds.has(l.session))
      .map((l) =>
        actor.role === 'cuisine' ? { ...l, value_diff: null } : { ...l }
      )

    return {
      sessions: visibleSessions,
      lines,
    }
  }

  async createImportedInventorySession(
    input: CreateImportedInventorySessionInput
  ): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }> {
    return this.withWriteLock(async () => {
      const actor = this.assertPermission('inventory_sessions', 'create')
      const now = new Date().toISOString()
      // Reuse existing confirmed session on same date for same import if present, or create one
      let session = this.state.inventory_sessions.find(
        (s) =>
          s.date === input.date &&
          s.status === 'confirmed' &&
          s.confirmed_by === input.confirmed_by
      )
      if (!session) {
        session = {
          id: generateId('inv'),
          date: input.date,
          scope: 'full',
          category: null,
          categories: null,
          location: null,
          status: 'confirmed',
          created_by: actor.id,
          created_by_name: actor.name || actor.email,
          confirmed_by: input.confirmed_by,
          confirmed_by_name: input.confirmed_by,
          confirmed_at: input.date,
          notes: input.notes ?? 'Session d’inventaire importée depuis Excel',
          import_batch_id: input.import_batch_id ?? null,
          created_at: now,
        }
        this.state.inventory_sessions.push(session)
      }

      const activeSessionId = session.id
      const createdLines: InventoryLineRecord[] = input.lines.map((l) => ({
        id: generateId('iLN'),
        session: activeSessionId,
        product: l.product,
        theoretical: l.theoretical,
        counted: l.counted,
        diff: l.diff,
        value_diff: l.value_diff,
        comment: l.comment ?? null,
        source_row_id: l.source_row_id ?? null,
        import_batch_id: input.import_batch_id ?? null,
        order_index: l.order_index ?? null,
        created_at: now,
      }))

      this.state.inventory_lines.push(...createdLines)

      computeTargetedProductsStock({
        targetProductIds: Array.from(new Set(createdLines.map((l) => l.product))),
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
      })

      this.recordAudit(
        actor,
        'confirm_inventory',
        'inventory_sessions',
        session.id,
        {
          date: session.date,
          lines_count: createdLines.length,
          confirmed_by: session.confirmed_by,
          import_batch_id: input.import_batch_id,
        }
      )

      return { session, lines: createdLines }
    })
  }

  async createInventoryDraftSession(input: CreateInventoryDraftInput): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }> {
    return this.withWriteLock(async () => {
      const actor = this.assertPermission('inventory_sessions', 'create')
      const now = new Date().toISOString()
      const cleanDate = (input.date || now).trim()
      const categories =
        input.scope === 'category' && Array.isArray(input.categories)
          ? input.categories.map((c) => c.trim()).filter(Boolean)
          : []
      const categoryStr =
        input.scope === 'category' && categories.length > 0
          ? categories.join(', ')
          : null

      const session: InventorySessionRecord = {
        id: generateId('inv'),
        date: cleanDate,
        scope: input.scope,
        category: categoryStr,
        categories: categories.length > 0 ? categories : null,
        location: input.location?.trim() || null,
        status: 'draft',
        created_by: actor.id,
        created_by_name: actor.name || actor.email,
        confirmed_by: null,
        confirmed_by_name: null,
        confirmed_at: null,
        notes: input.notes?.trim() ?? '',
        import_batch_id: null,
        created_at: now,
      }

      this.state.inventory_sessions.unshift(session)
      this.recordAudit(actor, 'create', 'inventory_sessions', session.id, {
        date: session.date,
        scope: session.scope,
        categories,
        location: session.location,
        status: 'draft',
      })

      return { session, lines: [] }
    })
  }

  async saveInventoryDraftLines(
    sessionId: string,
    lines: SaveInventoryDraftLineInput[],
    notes?: string
  ): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }> {
    return this.withWriteLock(async () => {
      this.assertPermission('inventory_sessions', 'update')
      const sessionIdx = this.state.inventory_sessions.findIndex(
        (s) => s.id === sessionId
      )
      if (sessionIdx === -1) {
        throw new Error('Session d’inventaire introuvable.')
      }
      const session = this.state.inventory_sessions[sessionIdx]
      if (session.status !== 'draft') {
        throw new Error(
          'Impossible de modifier une session d’inventaire déjà confirmée ou contre-passée.'
        )
      }

      if (notes !== undefined) {
        session.notes = notes.trim()
      }

      // Compute theoretical stock as of session.date for the products being saved in draft
      const validDraftInputs = lines.filter(
        (l) =>
          (l.counted !== null &&
            l.counted !== undefined &&
            !Number.isNaN(Number(l.counted))) ||
          Boolean(l.comment?.trim())
      )
      const targetIds = Array.from(
        new Set(validDraftInputs.map((l) => l.product))
      )
      const stockMap = computeTargetedProductsStock({
        targetProductIds: targetIds,
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
        asOfDate: session.date,
        excludeSessionId: session.id,
        skipCacheUpdate: true,
      })

      // Replace existing draft lines for this session with the current non-empty draft lines
      this.state.inventory_lines = this.state.inventory_lines.filter(
        (il) => il.session !== sessionId
      )

      const now = new Date().toISOString()
      const savedLines: InventoryLineRecord[] = []

      validDraftInputs.forEach((item, idx) => {
        if (item.counted === null || item.counted === undefined) return
        const countedNum = roundQty(Number(item.counted))
        if (Number.isNaN(countedNum) || countedNum < 0) {
          throw new Error(
            'La quantité comptée doit être un nombre supérieur ou égal à 0.'
          )
        }
        const st = stockMap.get(item.product)
        const theoretical = st ? st.stock : 0
        const diff = roundQty(countedNum - theoretical)
        const avgPrice = st?.averagePrice ?? null
        const valueDiff =
          avgPrice !== null ? roundCurrency(diff * avgPrice) : null

        savedLines.push({
          id: generateId('iLN'),
          session: sessionId,
          product: item.product,
          theoretical,
          counted: countedNum,
          diff,
          value_diff: valueDiff,
          comment: item.comment?.trim() || null,
          order_index: idx + 1,
          created_at: now,
        })
      })

      this.state.inventory_lines.push(...savedLines)
      saveState(this.state)

      return { session: { ...session }, lines: savedLines }
    })
  }

  async confirmInventorySession(
    sessionId: string,
    lines: ConfirmInventoryLineInput[],
    notes?: string
  ): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }> {
    return this.withWriteLock(async () => {
      const actor = this.getActiveAuthUser()
      const allowEconomatSetting = Boolean(
        this.state.settings.find(
          (s) => s.key === 'allow_economat_confirm_inventory'
        )?.value
      )
      if (!canConfirmInventory(actor.role, allowEconomatSetting)) {
        throw new Error(
          'Accès refusé : seul un Manager ou Administrateur peut confirmer un inventaire.'
        )
      }

      const sessionIdx = this.state.inventory_sessions.findIndex(
        (s) => s.id === sessionId
      )
      if (sessionIdx === -1) {
        throw new Error('Session d’inventaire introuvable.')
      }
      const session = this.state.inventory_sessions[sessionIdx]
      if (session.status !== 'draft') {
        throw new Error(
          'Cette session d’inventaire a déjà été confirmée ou contre-passée.'
        )
      }

      // Only save lines where a count was actually entered (counted !== null/undefined)
      // Uncounted products remain untouched and keep their current stock unchanged.
      const countedInputs = lines.filter(
        (l) =>
          l.counted !== null &&
          l.counted !== undefined &&
          !Number.isNaN(Number(l.counted))
      )
      if (countedInputs.length === 0) {
        throw new Error(
          'Veuillez saisir au moins un produit compté avant de confirmer l’inventaire.'
        )
      }

      for (const item of countedInputs) {
        if (Number(item.counted) < 0) {
          throw new Error(
            'Les quantités comptées ne peuvent pas être négatives.'
          )
        }
      }

      const targetIds = Array.from(
        new Set(countedInputs.map((l) => l.product))
      )
      const stockAtSessionDate = computeTargetedProductsStock({
        targetProductIds: targetIds,
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
        asOfDate: session.date,
        excludeSessionId: session.id,
        skipCacheUpdate: true,
      })

      const now = new Date().toISOString()
      const baseOrder = (this.state.inventory_sessions.length + 1) * 1000

      // Remove any previous draft lines for this session
      this.state.inventory_lines = this.state.inventory_lines.filter(
        (il) => il.session !== sessionId
      )

      const confirmedLines: InventoryLineRecord[] = countedInputs.map(
        (item, idx) => {
          const countedNum = roundQty(Number(item.counted))
          const st = stockAtSessionDate.get(item.product)
          const theoretical = st ? st.stock : 0
          const diff = roundQty(countedNum - theoretical)
          const avgPrice = st?.averagePrice ?? null
          const valueDiff =
            avgPrice !== null ? roundCurrency(diff * avgPrice) : null

          return {
            id: generateId('iLN'),
            session: sessionId,
            product: item.product,
            theoretical,
            counted: countedNum,
            diff,
            value_diff: valueDiff,
            comment: item.comment?.trim() || null,
            order_index: baseOrder + idx + 1,
            created_at: now,
          }
        }
      )

      const updatedSession: InventorySessionRecord = {
        ...session,
        status: 'confirmed',
        confirmed_by: actor.id,
        confirmed_by_name: actor.name || actor.email,
        confirmed_at: now,
        notes: notes !== undefined ? notes.trim() : session.notes,
      }

      this.state.inventory_sessions[sessionIdx] = updatedSession
      this.state.inventory_lines.push(...confirmedLines)

      // Incrementally recompute stock cache for the counted products only
      // (Never creates fake entry/exit movements — no double counting)
      computeTargetedProductsStock({
        targetProductIds: targetIds,
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
      })

      this.recordAudit(
        actor,
        'confirm_inventory',
        'inventory_sessions',
        sessionId,
        {
          date: updatedSession.date,
          scope: updatedSession.scope,
          counted_products_count: confirmedLines.length,
          confirmed_by: actor.id,
          confirmed_by_name: updatedSession.confirmed_by_name,
        }
      )

      return { session: updatedSession, lines: confirmedLines }
    })
  }

  async reverseInventorySession(
    sessionId: string,
    reason: string
  ): Promise<InventorySessionRecord> {
    return this.withWriteLock(async () => {
      const actor = this.assertPermission('inventory_sessions', 'reverse')
      const cleanReason = reason.trim()
      if (!cleanReason) {
        throw new Error(
          'Un motif obligatoire est requis pour contre-passer une session d’inventaire confirmée.'
        )
      }

      const sessionIdx = this.state.inventory_sessions.findIndex(
        (s) => s.id === sessionId
      )
      if (sessionIdx === -1) {
        throw new Error('Session d’inventaire introuvable.')
      }
      const session = this.state.inventory_sessions[sessionIdx]
      if (session.status !== 'confirmed') {
        throw new Error(
          'Seule une session d’inventaire confirmée peut faire l’objet d’une contre-passation.'
        )
      }

      const now = new Date().toISOString()
      const updatedSession: InventorySessionRecord = {
        ...session,
        status: 'reversed',
        reversed_by: actor.id,
        reversed_by_name: actor.name || actor.email,
        reversed_at: now,
        reversal_reason: cleanReason,
      }

      this.state.inventory_sessions[sessionIdx] = updatedSession

      const affectedIds = Array.from(
        new Set(
          this.state.inventory_lines
            .filter((il) => il.session === sessionId)
            .map((il) => il.product)
        )
      )

      computeTargetedProductsStock({
        targetProductIds: affectedIds,
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
      })

      this.recordAudit(actor, 'reversal', 'inventory_sessions', sessionId, {
        date: session.date,
        reason: cleanReason,
        affected_products_count: affectedIds.length,
      })

      return updatedSession
    })
  }

  async recalculateAllStock(): Promise<StockRecalculationReport> {
    return this.withWriteLock(async () => {
      const actor = this.getActiveAuthUser()
      if (actor.role !== 'admin' && actor.role !== 'manager') {
        throw new Error(
          'Seul un Administrateur ou Manager peut lancer un recalcul complet du stock.'
        )
      }

      const report = rebuildAndCompareStockCache({
        products: this.state.products,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
      })

      this.recordAudit(actor, 'update', 'products', 'stock-recalculation', {
        operation: 'recalculate_all_stock',
        total_products_checked: report.totalProductsChecked,
        differences_count: report.differencesCount,
        total_stock_value: report.totalStockValue,
      })

      return report
    })
  }

  async listImportBatches(): Promise<ImportBatchRecord[]> {
    this.assertPermission('import_batches', 'list')
    return [...this.state.import_batches]
  }

  async createImportBatch(
    input: Omit<ImportBatchRecord, 'id' | 'created_at'>
  ): Promise<ImportBatchRecord> {
    const actor = this.assertPermission('import_batches', 'create')
    const now = new Date().toISOString()
    const batch: ImportBatchRecord = {
      ...input,
      id: generateId('imp'),
      created_at: now,
    }
    this.state.import_batches.unshift(batch)
    this.recordAudit(actor, 'import_batch', 'import_batches', batch.id, {
      source_id: batch.source_id,
      filename: batch.filename,
      counts: batch.counts,
    })
    return batch
  }

  async reverseImportBatch(
    batchId: string,
    reason: string
  ): Promise<ImportBatchRecord> {
    const actor = this.assertPermission('import_batches', 'reverse')
    const batch = this.state.import_batches.find(
      (b) => b.id === batchId || b.source_id === batchId
    )
    if (!batch) {
      throw new Error('Lot d’importation introuvable.')
    }
    if (batch.status === 'reversed') {
      throw new Error('Ce lot d’importation a déjà été contre-passé.')
    }

    const cleanReason =
      reason.trim() || `Annulation du lot d'import ${batch.source_id}`

    // 1. Reverse all purchases from this batch that have not yet been reversed
    const batchPurchases = this.state.purchases.filter(
      (p) =>
        (p.import_batch_id === batch.id ||
          p.import_batch_id === batch.source_id) &&
        !p.reversed_of &&
        !this.state.purchases.some((other) => other.reversed_of === p.id)
    )
    for (const p of batchPurchases) {
      await this.reversePurchaseDocument(p.id, cleanReason)
    }

    // 2. Reverse all exits from this batch that have not yet been reversed
    const batchExits = this.state.exits.filter(
      (x) =>
        (x.import_batch_id === batch.id ||
          x.import_batch_id === batch.source_id) &&
        !x.reversed_of &&
        !this.state.exits.some((other) => other.reversed_of === x.id)
    )
    for (const x of batchExits) {
      await this.reverseExitDocument(x.id, cleanReason)
    }

    // 3. Mark inventory sessions from this batch as reversed so they no longer act as confirmed counts
    for (const sess of this.state.inventory_sessions) {
      if (
        sess.import_batch_id === batch.id ||
        sess.import_batch_id === batch.source_id
      ) {
        sess.status = 'reversed'
      }
    }

    batch.status = 'reversed'
    this.recordAudit(
      actor,
      'reverse_import_batch',
      'import_batches',
      batch.id,
      {
        source_id: batch.source_id,
        reason: cleanReason,
        purchases_reversed: batchPurchases.length,
        exits_reversed: batchExits.length,
      }
    )

    return { ...batch }
  }

  async listAuditLogs(): Promise<AuditLogRecord[]> {
    this.assertPermission('audit_log', 'list')
    return [...this.state.audit_log]
  }

  async listSettings(): Promise<SettingRecord[]> {
    const actor = this.assertPermission('settings', 'list')
    if (actor.role === 'cuisine') {
      return this.state.settings.filter(
        (s) =>
          s.key !== 'replenishment_draft_lists' &&
          s.key !== 'payment_methods_list' &&
          s.key !== 'enable_partial_payments'
      )
    }
    return [...this.state.settings]
  }

  async upsertSetting(key: string, value: unknown): Promise<SettingRecord> {
    const actor = this.assertPermission('settings', 'update')
    const now = new Date().toISOString()
    const existing = this.state.settings.find((s) => s.key === key)
    if (existing) {
      existing.value = value
      existing.updated_at = now
      this.recordAudit(actor, 'update', 'settings', existing.id, { key, value })
      return { ...existing }
    }

    const created: SettingRecord = {
      id: generateId('cfg'),
      key,
      value,
      updated_at: now,
    }
    this.state.settings.push(created)
    this.recordAudit(actor, 'create', 'settings', created.id, { key, value })
    return created
  }

  async getDashboardAnalytics(
    options?: DashboardAnalyticsQueryOptions
  ): Promise<DashboardAnalyticsResult> {
    const actor = this.getActiveAuthUser()
    // Enforce server/repository role so a client cannot spoof a higher role to see prices
    const effectiveRole: UserRole =
      actor.role === 'cuisine' ? 'cuisine' : (options?.role ?? actor.role)

    return computeDashboardAnalytics(
      {
        products: this.state.products,
        suppliers: this.state.suppliers,
        purchases: this.state.purchases,
        purchaseLines: this.state.purchase_lines,
        exits: this.state.exits,
        exitLines: this.state.exit_lines,
        inventorySessions: this.state.inventory_sessions,
        inventoryLines: this.state.inventory_lines,
        settings: this.state.settings,
        users: this.state.users.map(({ passwordHash: _, ...u }) => u),
      },
      {
        ...options,
        role: effectiveRole,
      }
    )
  }

  async exportBackup(): Promise<BackupPayload> {
    const actor = this.getActiveAuthUser()
    if (actor.role !== 'admin' && actor.role !== 'manager') {
      throw new Error(
        'Seul un Administrateur ou Manager peut exporter une sauvegarde complète.'
      )
    }

    this.recordAudit(actor, 'backup_export', 'settings', 'backup', {
      adapter: 'memory',
    })

    return {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      adapter: 'memory',
      collections: {
        users: this.state.users.map(({ passwordHash: _, ...u }) => u),
        products: [...this.state.products],
        suppliers: [...this.state.suppliers],
        purchases: [...this.state.purchases],
        purchase_lines: [...this.state.purchase_lines],
        exits: [...this.state.exits],
        exit_lines: [...this.state.exit_lines],
        inventory_sessions: [...this.state.inventory_sessions],
        inventory_lines: [...this.state.inventory_lines],
        audit_log: [...this.state.audit_log],
        settings: [...this.state.settings],
        import_batches: [...this.state.import_batches],
      },
    }
  }

  async restoreBackup(payload: BackupPayload): Promise<void> {
    return this.withWriteLock(async () => {
      const actor = this.getActiveAuthUser()
      if (actor.role !== 'admin') {
        throw new Error(
          'Seul un Administrateur peut restaurer une sauvegarde complète.'
        )
      }
      if (!payload || !payload.collections) {
        throw new Error('Fichier de sauvegarde invalide : collections manquantes.')
      }

      const existingPasswords = new Map(
        this.state.users.map((u) => [u.id, u.passwordHash])
      )
      const restoredUsers = (payload.collections.users ?? []).map((u) => ({
        ...u,
        passwordHash: existingPasswords.get(u.id) || 'admin1234',
      }))

      this.state = {
        users:
          restoredUsers.length > 0 ? restoredUsers : [...this.state.users],
        products: [...(payload.collections.products ?? [])],
        suppliers: [...(payload.collections.suppliers ?? [])],
        purchases: [...(payload.collections.purchases ?? [])],
        purchase_lines: [...(payload.collections.purchase_lines ?? [])],
        exits: [...(payload.collections.exits ?? [])],
        exit_lines: [...(payload.collections.exit_lines ?? [])],
        inventory_sessions: [...(payload.collections.inventory_sessions ?? [])],
        inventory_lines: [...(payload.collections.inventory_lines ?? [])],
        audit_log: [...(payload.collections.audit_log ?? [])],
        settings: [...(payload.collections.settings ?? [])],
        import_batches: [...(payload.collections.import_batches ?? [])],
      }

      clearStockCache()
      invalidateDashboardAnalyticsCache()
      saveState(this.state)

      this.recordAudit(actor, 'update', 'settings', 'backup_restore', {
        operation: 'restore_backup',
        exported_at: payload.exported_at,
        products_restored: this.state.products.length,
        purchases_restored: this.state.purchases.length,
        exits_restored: this.state.exits.length,
      })
    })
  }
}
