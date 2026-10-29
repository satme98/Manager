export type UserRole =
  | 'admin'
  | 'manager'
  | 'economat'
  | 'cuisine'
  | 'consultation'

export type PaymentStatus = 'paid' | 'unpaid' | 'partial'

export type InventoryScope = 'full' | 'category'

export type InventorySessionStatus = 'draft' | 'confirmed' | 'reversed'

export type StockStatusLabel =
  | 'Alerte'
  | 'À surveiller'
  | 'OK'
  | 'À définir'

export type VatConvention = 'HT' | 'TTC'

export type AuditAction =
  | 'create'
  | 'update'
  | 'reversal'
  | 'confirm_inventory'
  | 'role_change'
  | 'status_change'
  | 'backup_export'
  | 'import_batch'
  | 'reverse_import_batch'

export interface UserRecord {
  id: string
  email: string
  name: string
  role: UserRole
  active: boolean
  created_at: string
  updated_at: string
}

export interface ProductRecord {
  id: string
  ref: string
  name: string
  category: string
  unit: string
  initial_stock: number
  min_stock: number | null
  location: string
  notes?: string
  archived: boolean
  source_row_id?: string | null
  import_batch_id?: string | null
  created_at: string
  updated_at: string
}

export interface SupplierRecord {
  id: string
  name: string
  contact: string
  phone: string
  email: string
  payment_terms: string
  notes: string
  archived?: boolean
  source_row_id?: string | null
  import_batch_id?: string | null
  created_at: string
  updated_at: string
}

export type CorrectionStatus =
  | 'none'
  | 'pending_approval'
  | 'reversed'
  | 'corrected'

export interface PaymentEventRecord {
  id: string
  purchase_id: string
  invoice_no: string
  supplier_id: string
  supplier_name: string
  date: string
  timestamp: string
  amount: number
  method: string
  reference: string
  user_id: string
  user_name: string
  type: 'payment' | 'reversal'
  reversal_reason?: string | null
}

export interface MarkPurchasePaidOptions {
  method?: string
  reference?: string
  amount?: number | null
}

export type DraftPurchaseListStatus = 'Brouillon' | 'Prête' | 'Convertie'

export interface DraftPurchaseListLine {
  productId: string
  ref: string
  name: string
  category: string
  unit: string
  currentStock: number
  minStock: number
  suggestedQty: number
  orderedQty: number
  supplierId: string
  supplierName: string
  unitPrice: number | null
  estimatedCost: number | null
}

export interface DraftPurchaseListRecord {
  id: string
  name: string
  date: string
  status: DraftPurchaseListStatus
  notes: string
  created_by: string
  created_at: string
  updated_at: string
  lines: DraftPurchaseListLine[]
}

export interface PurchaseRecord {
  id: string
  date: string
  supplier: string
  invoice_no: string
  payment_status: PaymentStatus
  payment_date: string | null
  payment_method?: string | null
  payment_reference?: string | null
  amount_paid?: number | null
  payment_events?: PaymentEventRecord[]
  recorded_by: string
  recorded_by_name?: string
  notes: string
  reversed_of: string | null
  reversal_reason?: string | null
  correction_status?: CorrectionStatus
  pending_reversal_reason?: string | null
  pending_reversal_requested_by?: string | null
  pending_reversal_requested_by_name?: string | null
  pending_reversal_requested_at?: string | null
  pending_reversal_mode?: 'cancel' | 'correct' | null
  import_batch_id?: string | null
  order_index?: number | null
  created_at: string
}

export interface PurchaseLineRecord {
  id: string
  purchase: string
  product: string
  qty: number
  unit_price: number
  amount: number
  source_row_id?: string | null
  import_batch_id?: string | null
  order_index?: number | null
  created_at: string
}

export interface ExitRecord {
  id: string
  date: string
  destination: string
  recorded_by: string
  recorded_by_name?: string
  notes: string
  reversed_of: string | null
  reversal_reason?: string | null
  negative_stock_reason?: string | null
  correction_status?: CorrectionStatus
  pending_reversal_reason?: string | null
  pending_reversal_requested_by?: string | null
  pending_reversal_requested_by_name?: string | null
  pending_reversal_requested_at?: string | null
  pending_reversal_mode?: 'cancel' | 'correct' | null
  import_batch_id?: string | null
  order_index?: number | null
  created_at: string
}

export interface ExitLineRecord {
  id: string
  exit: string
  product: string
  qty_consumed: number
  qty_wasted: number
  loss_reason?: string | null
  unit_cost_snapshot: number | null
  source_row_id?: string | null
  import_batch_id?: string | null
  order_index?: number | null
  created_at: string
}

export interface InventorySessionRecord {
  id: string
  date: string
  scope: InventoryScope
  category: string | null
  categories?: string[] | null
  location?: string | null
  status: InventorySessionStatus
  created_by?: string | null
  created_by_name?: string | null
  confirmed_by: string | null
  confirmed_by_name?: string | null
  confirmed_at: string | null
  reversed_by?: string | null
  reversed_by_name?: string | null
  reversed_at?: string | null
  reversal_reason?: string | null
  notes?: string
  import_batch_id?: string | null
  created_at: string
}

export interface InventoryLineRecord {
  id: string
  session: string
  product: string
  theoretical: number
  counted: number
  diff: number
  value_diff: number | null
  comment?: string | null
  source_row_id?: string | null
  import_batch_id?: string | null
  order_index?: number | null
  created_at: string
}

export interface AuditLogRecord {
  id: string
  user: string
  user_email: string
  timestamp: string
  action: AuditAction
  collection: CollectionName
  record_id: string
  details: Record<string, unknown>
}

export interface SettingRecord {
  id: string
  key: string
  value: unknown
  updated_at: string
}

export interface ImportBatchCounts {
  rows_read: number
  rows_imported: number
  rows_skipped: number
  rows_flagged: number
}

export interface ImportBatchRecord {
  id: string
  source_id: string
  filename: string
  status: 'completed' | 'partial' | 'failed' | 'reversed'
  counts: ImportBatchCounts
  created_at: string
}

export type CollectionName =
  | 'users'
  | 'products'
  | 'suppliers'
  | 'purchases'
  | 'purchase_lines'
  | 'exits'
  | 'exit_lines'
  | 'inventory_sessions'
  | 'inventory_lines'
  | 'audit_log'
  | 'settings'
  | 'import_batches'

export interface CreateUserInput {
  email: string
  name: string
  role: UserRole
  password: string
}

export interface CreatePurchaseDocumentInput {
  date: string
  supplier: string
  invoice_no: string
  payment_status: PaymentStatus
  payment_date?: string | null
  notes?: string
  import_batch_id?: string | null
  order_index?: number | null
  lines: Array<{
    product: string
    qty: number
    unit_price: number
    source_row_id?: string | null
    order_index?: number | null
  }>
}

export interface ReversalOptions {
  mode?: 'cancel' | 'correct'
  approvePending?: boolean
  approveBeforeInventoryCutoff?: boolean
  approveCutoff?: boolean
}

export interface CreateExitDocumentInput {
  date: string
  destination: string
  notes?: string
  negative_stock_reason?: string | null
  skipNegativeStockGuard?: boolean
  import_batch_id?: string | null
  order_index?: number | null
  lines: Array<{
    product: string
    qty_consumed: number
    qty_wasted: number
    loss_reason?: string | null
    source_row_id?: string | null
    order_index?: number | null
  }>
}

export interface CreateImportedInventorySessionInput {
  date: string
  confirmed_by: string
  notes?: string
  import_batch_id?: string | null
  lines: Array<{
    product: string
    theoretical: number
    counted: number
    diff: number
    value_diff: number | null
    comment?: string | null
    source_row_id?: string | null
    order_index?: number | null
  }>
}

export interface CreateInventoryDraftInput {
  date: string
  scope: InventoryScope
  categories?: string[]
  location?: string | null
  notes?: string
}

export interface SaveInventoryDraftLineInput {
  product: string
  counted: number | null
  comment?: string | null
}

export interface ConfirmInventoryLineInput {
  product: string
  counted: number | null
  comment?: string | null
}

export interface StockRecalculationDiffItem {
  productId: string
  ref: string
  name: string
  previousStock: number
  newStock: number
  previousAvgPrice: number | null
  newAvgPrice: number | null
  previousValue: number | null
  newValue: number | null
}

export interface StockRecalculationReport {
  recalculatedAt: string
  totalProductsChecked: number
  differencesCount: number
  differences: StockRecalculationDiffItem[]
  totalStockValue: number
  alertCount: number
  watchCount: number
  missingPriceCount: number
  missingMinCount: number
}

export interface BackupPayload {
  version: string
  exported_at: string
  adapter: 'pocketbase' | 'memory'
  collections: {
    users: Omit<UserRecord, 'password'>[]
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
}

export interface DataRepository {
  readonly adapterName: 'pocketbase' | 'memory'

  // Auth
  login(email: string, password: string): Promise<{
    user: UserRecord
    token: string
  }>
  logout(): Promise<void>
  getCurrentUser(): Promise<UserRecord | null>

  // Users (Admin only for mutations)
  listUsers(): Promise<UserRecord[]>
  createUser(input: CreateUserInput): Promise<UserRecord>
  updateUserRole(userId: string, role: UserRole): Promise<UserRecord>
  setUserActive(userId: string, active: boolean): Promise<UserRecord>

  // Products
  listProducts(): Promise<ProductRecord[]>
  createProduct(
    input: Omit<ProductRecord, 'id' | 'created_at' | 'updated_at'>
  ): Promise<ProductRecord>
  updateProduct(
    id: string,
    input: Partial<Omit<ProductRecord, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<ProductRecord>
  bulkUpdateProducts(
    ids: string[],
    patch: Partial<
      Pick<
        ProductRecord,
        'category' | 'unit' | 'location' | 'min_stock' | 'archived'
      >
    >
  ): Promise<number>
  renameOrMergeCategory(
    fromCategory: string,
    toCategory: string
  ): Promise<number>
  renameOrMergeUnit(fromUnit: string, toUnit: string): Promise<number>
  renameOrMergeLocation(
    fromLocation: string,
    toLocation: string
  ): Promise<number>

  // Suppliers
  listSuppliers(): Promise<SupplierRecord[]>
  createSupplier(
    input: Omit<SupplierRecord, 'id' | 'created_at' | 'updated_at'>
  ): Promise<SupplierRecord>
  updateSupplier(
    id: string,
    input: Partial<Omit<SupplierRecord, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<SupplierRecord>
  mergeSuppliers(
    sourceSupplierId: string,
    targetSupplierId: string
  ): Promise<{ movedPurchasesCount: number }>

  // Purchases (Transactional multi-line + Reversal)
  listPurchases(): Promise<{
    headers: PurchaseRecord[]
    lines: PurchaseLineRecord[]
  }>
  createPurchaseDocument(input: CreatePurchaseDocumentInput): Promise<{
    header: PurchaseRecord
    lines: PurchaseLineRecord[]
  }>
  markPurchasePaid(
    purchaseId: string,
    paymentDate: string,
    options?: MarkPurchasePaidOptions
  ): Promise<PurchaseRecord>
  bulkMarkPurchasesPaid(
    purchaseIds: string[],
    paymentDate: string,
    options?: MarkPurchasePaidOptions
  ): Promise<number>
  reversePurchasePayment(
    purchaseId: string,
    reason: string
  ): Promise<PurchaseRecord>
  listPaymentEvents(): Promise<PaymentEventRecord[]>
  reversePurchaseDocument(
    purchaseId: string,
    reason: string,
    options?: ReversalOptions
  ): Promise<{
    status: 'reversed' | 'pending_approval'
    header: PurchaseRecord
    lines: PurchaseLineRecord[]
  }>

  // Replenishment Draft Purchase Lists
  listDraftPurchaseLists(): Promise<DraftPurchaseListRecord[]>
  saveDraftPurchaseList(
    input: Omit<DraftPurchaseListRecord, 'id' | 'created_at' | 'updated_at'> & {
      id?: string
    }
  ): Promise<DraftPurchaseListRecord>
  deleteDraftPurchaseList(id: string): Promise<void>

  // Exits (Transactional multi-line + Reversal)
  listExits(): Promise<{
    headers: ExitRecord[]
    lines: ExitLineRecord[]
  }>
  createExitDocument(input: CreateExitDocumentInput): Promise<{
    header: ExitRecord
    lines: ExitLineRecord[]
  }>
  reverseExitDocument(
    exitId: string,
    reason: string,
    options?: ReversalOptions
  ): Promise<{
    status: 'reversed' | 'pending_approval'
    header: ExitRecord
    lines: ExitLineRecord[]
  }>

  // Inventories
  listInventories(): Promise<{
    sessions: InventorySessionRecord[]
    lines: InventoryLineRecord[]
  }>
  createImportedInventorySession(
    input: CreateImportedInventorySessionInput
  ): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }>
  createInventoryDraftSession(input: CreateInventoryDraftInput): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }>
  saveInventoryDraftLines(
    sessionId: string,
    lines: SaveInventoryDraftLineInput[],
    notes?: string
  ): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }>
  confirmInventorySession(
    sessionId: string,
    lines: ConfirmInventoryLineInput[],
    notes?: string
  ): Promise<{
    session: InventorySessionRecord
    lines: InventoryLineRecord[]
  }>
  reverseInventorySession(
    sessionId: string,
    reason: string
  ): Promise<InventorySessionRecord>
  recalculateAllStock(): Promise<StockRecalculationReport>

  // Import batches & Reversal
  listImportBatches(): Promise<ImportBatchRecord[]>
  createImportBatch(
    input: Omit<ImportBatchRecord, 'id' | 'created_at'>
  ): Promise<ImportBatchRecord>
  reverseImportBatch(
    batchId: string,
    reason: string
  ): Promise<ImportBatchRecord>

  // Audit Log (Append-only)
  listAuditLogs(): Promise<AuditLogRecord[]>

  // Settings
  listSettings(): Promise<SettingRecord[]>
  upsertSetting(key: string, value: unknown): Promise<SettingRecord>

  // Dashboard Analytics (Server / Repository aggregation)
  getDashboardAnalytics(
    options?: import('./analytics').DashboardAnalyticsQueryOptions
  ): Promise<import('./analytics').DashboardAnalyticsResult>

  // Backup export & restore
  exportBackup(): Promise<BackupPayload>
  restoreBackup(payload: BackupPayload): Promise<void>
}

