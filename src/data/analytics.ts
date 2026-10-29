import type {
  ExitLineRecord,
  ExitRecord,
  InventoryLineRecord,
  InventorySessionRecord,
  ProductRecord,
  PurchaseLineRecord,
  PurchaseRecord,
  SettingRecord,
  StockStatusLabel,
  SupplierRecord,
  UserRecord,
  UserRole,
  VatConvention,
} from './types'
import { formatDateFR } from '@/lib/formatters'
import {
  computeAllProductsStock,
  roundCurrency,
  roundQty,
  type ProductStockResult,
} from '@/lib/stock-engine'

export type DashboardRangePreset =
  | 'today'
  | '7d'
  | '30d'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'all'
  | 'custom'

export type ChartGranularity = 'day' | 'week' | 'month'

export interface DashboardAnalyticsQueryOptions {
  preset?: DashboardRangePreset
  customFrom?: string | null
  customTo?: string | null
  referenceDate?: string // Optional YYYY-MM-DD override for deterministic testing
  role?: UserRole
  forceRefresh?: boolean
}

export interface ResolvedDashboardDateRange {
  preset: DashboardRangePreset
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  label: string
  shortPeriodLabel: string
  daysCount: number
  previousFrom: string // YYYY-MM-DD
  previousTo: string // YYYY-MM-DD
  previousLabel: string
  referenceDate: string // YYYY-MM-DD
}

export interface PeriodTrend {
  previousValue: number
  percentChange: number
  direction: 'up' | 'down' | 'flat'
  previousPeriodLabel: string
}

export interface DashboardKpis {
  vatConvention: VatConvention
  stockValue: {
    value: number | null
    activeProductsCount: number
    missingPriceCount: number
    hasData: boolean
    periodLabel: string
  }
  periodPurchases: {
    value: number | null
    documentsCount: number
    linesCount: number
    hasData: boolean
    periodLabel: string
    trend: PeriodTrend | null
  }
  unpaidInvoices: {
    totalAmount: number | null
    invoicesCount: number
    hasData: boolean
    periodLabel: string
  }
  alertProducts: {
    alertCount: number
    watchCount: number
    okCount: number
    undefinedMinCount: number
    activeProductsCount: number
    hasData: boolean
    periodLabel: string
  }
  periodLosses: {
    value: number | null
    totalWastedQty: number
    eventsCount: number
    hasData: boolean
    periodLabel: string
    trend: PeriodTrend | null
  }
  periodExits: {
    value: number | null
    totalConsumedQty: number
    documentsCount: number
    hasData: boolean
    periodLabel: string
    trend: PeriodTrend | null
  }
}

export interface PriorityRestockItem {
  productId: string
  ref: string
  name: string
  category: string
  unit: string
  stock: number
  minStock: number
  deficit: number
  averagePrice: number | null
}

export interface PriorityMissingMinItem {
  productId: string
  ref: string
  name: string
  category: string
  unit: string
  stock: number
}

export interface PriorityUnpaidInvoiceItem {
  purchaseId: string
  invoiceNo: string
  date: string
  supplierId: string
  supplierName: string
  amount: number | null
  daysOverdue: number
}

export interface PriorityInventoryVarianceItem {
  lineId: string
  sessionId: string
  sessionDate: string
  productId: string
  ref: string
  name: string
  unit: string
  theoretical: number
  counted: number
  diff: number
  valueDiff: number | null
  comment: string | null
}

export interface PriorityMissingPriceItem {
  productId: string
  ref: string
  name: string
  category: string
  unit: string
  stock: number
}

export interface PriorityPendingApprovalItem {
  id: string
  type: 'purchase' | 'exit'
  date: string
  label: string
  requestedBy: string
  reason: string
  mode: 'cancel' | 'correct'
  linkTo: '/entrees-de-stock' | '/sorties-de-stock'
}

export interface DashboardPriorityActions {
  restockAlerts: {
    totalCount: number
    items: PriorityRestockItem[]
  }
  missingMinStock: {
    totalCount: number
    items: PriorityMissingMinItem[]
  }
  oldestUnpaidInvoices: {
    totalCount: number
    totalAmount: number | null
    items: PriorityUnpaidInvoiceItem[]
  }
  inventoryVariancesToVerify: {
    sessionId: string | null
    sessionDate: string | null
    totalCount: number
    items: PriorityInventoryVarianceItem[]
  }
  missingPriceProducts: {
    totalCount: number
    items: PriorityMissingPriceItem[]
  }
  pendingApprovals: {
    totalCount: number
    items: PriorityPendingApprovalItem[]
  }
}

export interface PurchasesEvolutionPoint {
  bucketKey: string
  label: string
  date: string
  amount: number | null
  count: number
}

export interface CategoryStockValuePoint {
  category: string
  stockValue: number | null
  productsCount: number
  totalQty: number
  sharePct: number | null
}

export interface TopConsumedProductPoint {
  productId: string
  ref: string
  name: string
  category: string
  unit: string
  qtyConsumed: number
  consumedValue: number | null
}

export interface SupplierPurchasePoint {
  supplierId: string
  supplierName: string
  amount: number | null
  documentsCount: number
  sharePct: number | null
}

export interface StockStatusDistributionPoint {
  status: StockStatusLabel
  count: number
  sharePct: number
  stockValue: number | null
  color: string
}

export interface LossesEvolutionPoint {
  bucketKey: string
  label: string
  date: string
  wastedValue: number | null
  wastedQty: number
}

export interface MonthlySpendingPoint {
  monthKey: string
  label: string
  amount: number | null
  documentsCount: number
}

export interface InventoryVarianceSessionPoint {
  sessionId: string
  date: string
  label: string
  scope: string
  shortageValue: number | null // Positive magnitude of negative variances (Manquants)
  surplusValue: number | null // Positive magnitude of positive variances (Excédents)
  netValueDiff: number | null
  shortageQty: number
  surplusQty: number
  countedProductsCount: number
}

export interface DashboardCharts {
  purchasesEvolution: {
    hasData: boolean
    byDay: PurchasesEvolutionPoint[]
    byWeek: PurchasesEvolutionPoint[]
    byMonth: PurchasesEvolutionPoint[]
  }
  stockValueByCategory: {
    hasData: boolean
    items: CategoryStockValuePoint[]
  }
  topConsumedProducts: {
    hasData: boolean
    byQuantity: TopConsumedProductPoint[]
    byValue: TopConsumedProductPoint[]
  }
  purchasesBySupplier: {
    hasData: boolean
    items: SupplierPurchasePoint[]
  }
  stockStatusDistribution: {
    hasData: boolean
    totalActiveProducts: number
    items: StockStatusDistributionPoint[]
  }
  lossesEvolution: {
    hasData: boolean
    byDay: LossesEvolutionPoint[]
    byWeek: LossesEvolutionPoint[]
    byMonth: LossesEvolutionPoint[]
  }
  monthlySpending12Months: {
    hasData: boolean
    items: MonthlySpendingPoint[]
  }
  inventoryVariancesBySession: {
    hasData: boolean
    items: InventoryVarianceSessionPoint[]
  }
}

export interface RecentActivityItem {
  id: string
  type: 'entry' | 'exit' | 'inventory' | 'reversal'
  date: string
  timestamp: string
  title: string
  subtitle: string
  userName: string
  amountOrQtyLabel: string | null
  linkTo: '/entrees-de-stock' | '/sorties-de-stock' | '/inventaires'
  docId: string
}

export interface DashboardAnalyticsResult {
  generatedAt: string
  role: UserRole
  priceHidden: boolean
  vatConvention: VatConvention
  databaseEmpty: boolean
  range: ResolvedDashboardDateRange
  kpis: DashboardKpis
  priorityActions: DashboardPriorityActions
  charts: DashboardCharts
  recentActivity: RecentActivityItem[]
}

export interface RawAnalyticsDataset {
  products: ProductRecord[]
  suppliers: SupplierRecord[]
  purchases: PurchaseRecord[]
  purchaseLines: PurchaseLineRecord[]
  exits: ExitRecord[]
  exitLines: ExitLineRecord[]
  inventorySessions: InventorySessionRecord[]
  inventoryLines: InventoryLineRecord[]
  settings?: SettingRecord[]
  users?: UserRecord[]
}

// ============================================================================
// DATE HELPERS (UTC / ISO YYYY-MM-DD arithmetic without timezone shift)
// ============================================================================

function parseIsoDayUTC(isoDate: string): Date {
  const clean = isoDate.trim().slice(0, 10)
  const [y, m, d] = clean.split('-').map((n) => parseInt(n, 10))
  return new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1))
}

function formatIsoDayUTC(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDaysISO(isoDate: string, days: number): string {
  const dt = parseIsoDayUTC(isoDate)
  dt.setUTCDate(dt.getUTCDate() + days)
  return formatIsoDayUTC(dt)
}

function diffDaysInclusive(fromIso: string, toIso: string): number {
  const d1 = parseIsoDayUTC(fromIso).getTime()
  const d2 = parseIsoDayUTC(toIso).getTime()
  const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24))
  return Math.max(1, diff + 1)
}

function diffDaysRaw(olderIso: string, newerIso: string): number {
  const d1 = parseIsoDayUTC(olderIso).getTime()
  const d2 = parseIsoDayUTC(newerIso).getTime()
  return Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)))
}

function startOfMonthISO(isoDate: string): string {
  const dt = parseIsoDayUTC(isoDate)
  return formatIsoDayUTC(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1)))
}

function endOfMonthISO(isoDate: string): string {
  const dt = parseIsoDayUTC(isoDate)
  return formatIsoDayUTC(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)))
}

function startOfPreviousMonthISO(isoDate: string): string {
  const dt = parseIsoDayUTC(isoDate)
  return formatIsoDayUTC(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() - 1, 1)))
}

function endOfPreviousMonthISO(isoDate: string): string {
  const dt = parseIsoDayUTC(isoDate)
  return formatIsoDayUTC(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 0)))
}

function startOfWeekMondayISO(isoDate: string): string {
  const dt = parseIsoDayUTC(isoDate)
  const day = dt.getUTCDay() // 0 = Sun, 1 = Mon, ...
  const diffToMonday = day === 0 ? -6 : 1 - day
  dt.setUTCDate(dt.getUTCDate() + diffToMonday)
  return formatIsoDayUTC(dt)
}

const FRENCH_SHORT_MONTHS = [
  'Janv.',
  'Févr.',
  'Mars',
  'Avr.',
  'Mai',
  'Juin',
  'Juil.',
  'Août',
  'Sept.',
  'Oct.',
  'Nov.',
  'Déc.',
]

function formatMonthKeyFR(monthKey: string): string {
  const [y, m] = monthKey.split('-').map((n) => parseInt(n, 10))
  const monthLabel = FRENCH_SHORT_MONTHS[(m || 1) - 1] ?? monthKey
  return `${monthLabel} ${y}`
}

/**
 * Resolves a dashboard date range preset (or custom range) into exact YYYY-MM-DD bounds
 * and computes the immediately preceding period of the exact same length.
 */
export function resolveDashboardDateRange(
  options?: DashboardAnalyticsQueryOptions
): ResolvedDashboardDateRange {
  const preset: DashboardRangePreset = options?.preset ?? 'this_month'
  const refDate = (
    options?.referenceDate?.trim() || new Date().toISOString().slice(0, 10)
  ).slice(0, 10)

  let from = refDate
  let to = refDate
  let presetTitle = 'Ce mois'

  switch (preset) {
    case 'today': {
      from = refDate
      to = refDate
      presetTitle = "Aujourd'hui"
      break
    }
    case '7d': {
      from = addDaysISO(refDate, -6)
      to = refDate
      presetTitle = '7 derniers jours'
      break
    }
    case '30d': {
      from = addDaysISO(refDate, -29)
      to = refDate
      presetTitle = '30 derniers jours'
      break
    }
    case 'this_month': {
      from = startOfMonthISO(refDate)
      to = endOfMonthISO(refDate)
      presetTitle = 'Ce mois'
      break
    }
    case 'last_month': {
      from = startOfPreviousMonthISO(refDate)
      to = endOfPreviousMonthISO(refDate)
      presetTitle = 'Mois dernier'
      break
    }
    case 'this_year': {
      const year = refDate.slice(0, 4)
      from = `${year}-01-01`
      to = `${year}-12-31`
      presetTitle = 'Cette année'
      break
    }
    case 'all': {
      from = '2020-01-01'
      to = '2099-12-31'
      presetTitle = 'Cumulé (Tout)'
      break
    }
    case 'custom': {
      const cFrom = options?.customFrom?.trim().slice(0, 10)
      const cTo = options?.customTo?.trim().slice(0, 10)
      if (cFrom && cTo) {
        from = cFrom <= cTo ? cFrom : cTo
        to = cFrom <= cTo ? cTo : cFrom
      } else if (cFrom) {
        from = cFrom
        to = refDate >= cFrom ? refDate : cFrom
      } else if (cTo) {
        to = cTo
        from = startOfMonthISO(cTo)
      } else {
        from = startOfMonthISO(refDate)
        to = endOfMonthISO(refDate)
      }
      presetTitle = 'Période personnalisée'
      break
    }
  }

  const daysCount = diffDaysInclusive(from, to)
  const previousTo = addDaysISO(from, -1)
  const previousFrom = addDaysISO(from, -daysCount)

  const shortPeriodLabel =
    from === to
      ? `Le ${formatDateFR(from)}`
      : `${formatDateFR(from)} – ${formatDateFR(to)}`
  const label = `${presetTitle} (${shortPeriodLabel})`
  const previousLabel =
    previousFrom === previousTo
      ? `Le ${formatDateFR(previousFrom)}`
      : `${formatDateFR(previousFrom)} – ${formatDateFR(previousTo)}`

  return {
    preset,
    from,
    to,
    label,
    shortPeriodLabel,
    daysCount,
    previousFrom,
    previousTo,
    previousLabel,
    referenceDate: refDate,
  }
}

/**
 * Computes trend vs immediately preceding period ONLY when comparable data exists.
 */
export function computePeriodTrend(
  currentValue: number | null,
  previousValue: number | null,
  previousHasData: boolean,
  previousPeriodLabel: string
): PeriodTrend | null {
  if (
    !previousHasData ||
    currentValue === null ||
    previousValue === null ||
    previousValue <= 0
  ) {
    return null
  }
  const percentChange = roundCurrency(
    ((currentValue - previousValue) / previousValue) * 100
  )
  const direction: 'up' | 'down' | 'flat' =
    percentChange > 0 ? 'up' : percentChange < 0 ? 'down' : 'flat'

  return {
    previousValue: roundCurrency(previousValue),
    percentChange,
    direction,
    previousPeriodLabel,
  }
}

// ============================================================================
// IN-MEMORY AGGREGATION CACHE & INVALIDATION
// ============================================================================

const analyticsCache = new Map<string, DashboardAnalyticsResult>()

export function invalidateDashboardAnalyticsCache(): void {
  analyticsCache.clear()
}

export function getDashboardAnalyticsCacheSize(): number {
  return analyticsCache.size
}

function buildDatasetFingerprint(dataset: RawAnalyticsDataset): string {
  const paidCount = dataset.purchases.filter(
    (p) => p.payment_status === 'paid'
  ).length
  const partialCount = dataset.purchases.filter(
    (p) => p.payment_status === 'partial'
  ).length
  const reversedPurchasesCount = dataset.purchases.filter(
    (p) =>
      Boolean(p.reversed_of) ||
      p.correction_status === 'reversed' ||
      p.correction_status === 'corrected'
  ).length
  return [
    dataset.products.length,
    dataset.suppliers.length,
    dataset.purchases.length,
    paidCount,
    partialCount,
    reversedPurchasesCount,
    dataset.purchaseLines.length,
    dataset.exits.length,
    dataset.exitLines.length,
    dataset.inventorySessions.length,
    dataset.inventoryLines.length,
    dataset.settings?.length ?? 0,
  ].join(':')
}

/**
 * Checks whether a purchase or exit header is reversed or is itself a reversal document.
 */
export function isDocumentReversedOrReversal(
  header: {
    id: string
    reversed_of?: string | null
    correction_status?: string | null
  },
  reversedOriginalIds: Set<string>
): boolean {
  return (
    Boolean(header.reversed_of) ||
    reversedOriginalIds.has(header.id) ||
    header.correction_status === 'reversed' ||
    header.correction_status === 'corrected'
  )
}

/**
 * Main pure aggregation function for Stage 7 Dashboard.
 * Enforces role-based financial masking (cuisine receives null for all price/value fields).
 */
export function computeDashboardAnalytics(
  dataset: RawAnalyticsDataset,
  options?: DashboardAnalyticsQueryOptions
): DashboardAnalyticsResult {
  const role: UserRole = options?.role ?? 'admin'
  const priceHidden = role === 'cuisine'
  const range = resolveDashboardDateRange(options)

  const cacheKey = `${role}|${range.preset}|${range.from}|${range.to}|${range.referenceDate}|${buildDatasetFingerprint(dataset)}`
  if (!options?.forceRefresh && analyticsCache.has(cacheKey)) {
    return analyticsCache.get(cacheKey)!
  }

  // 1. Resolve settings (VAT convention)
  let vatConvention: VatConvention = 'TTC'
  if (Array.isArray(dataset.settings)) {
    const vatSetting = dataset.settings.find(
      (s) => s.key === 'vat_convention' || s.key === 'price_convention'
    )
    if (vatSetting?.value === 'HT' || vatSetting?.value === 'TTC') {
      vatConvention = vatSetting.value
    }
  }

  const databaseEmpty =
    dataset.products.length === 0 &&
    dataset.purchases.length === 0 &&
    dataset.exits.length === 0 &&
    dataset.inventorySessions.length === 0

  // 2. Compute stock for all products via the single source of truth stock-engine
  const stockMap: Map<string, ProductStockResult> = computeAllProductsStock({
    products: dataset.products,
    purchases: dataset.purchases,
    purchaseLines: dataset.purchaseLines,
    exits: dataset.exits,
    exitLines: dataset.exitLines,
    inventorySessions: dataset.inventorySessions,
    inventoryLines: dataset.inventoryLines,
  })

  const productById = new Map<string, ProductRecord>()
  const activeProducts: ProductRecord[] = []
  for (const p of dataset.products) {
    productById.set(p.id, p)
    if (!p.archived) {
      activeProducts.push(p)
    }
  }

  const supplierById = new Map<string, SupplierRecord>()
  for (const s of dataset.suppliers) {
    supplierById.set(s.id, s)
  }

  const userById = new Map<string, UserRecord>()
  if (Array.isArray(dataset.users)) {
    for (const u of dataset.users) {
      userById.set(u.id, u)
    }
  }

  // 3. Identify reversed purchase & exit documents
  const reversedPurchaseIds = new Set<string>()
  for (const p of dataset.purchases) {
    if (p.reversed_of) {
      reversedPurchaseIds.add(p.reversed_of)
    }
  }

  const reversedExitIds = new Set<string>()
  for (const x of dataset.exits) {
    if (x.reversed_of) {
      reversedExitIds.add(x.reversed_of)
    }
  }

  const validPurchaseHeaders: PurchaseRecord[] = []
  const validPurchaseById = new Map<string, PurchaseRecord>()
  for (const p of dataset.purchases) {
    if (!isDocumentReversedOrReversal(p, reversedPurchaseIds)) {
      validPurchaseHeaders.push(p)
      validPurchaseById.set(p.id, p)
    }
  }

  const validExitHeaders: ExitRecord[] = []
  const validExitById = new Map<string, ExitRecord>()
  for (const x of dataset.exits) {
    if (!isDocumentReversedOrReversal(x, reversedExitIds)) {
      validExitHeaders.push(x)
      validExitById.set(x.id, x)
    }
  }

  // Group lines by valid parent document
  const linesByPurchaseId = new Map<string, PurchaseLineRecord[]>()
  for (const pl of dataset.purchaseLines) {
    if (!validPurchaseById.has(pl.purchase)) continue
    const list = linesByPurchaseId.get(pl.purchase) ?? []
    list.push(pl)
    linesByPurchaseId.set(pl.purchase, list)
  }

  const linesByExitId = new Map<string, ExitLineRecord[]>()
  for (const xl of dataset.exitLines) {
    if (!validExitById.has(xl.exit)) continue
    const list = linesByExitId.get(xl.exit) ?? []
    list.push(xl)
    linesByExitId.set(xl.exit, list)
  }

  // Helper to get line unit cost for exits/losses:
  // Per Stage 10 Step 2d: for imported movements, value of an exit/loss = qty * product's CURRENT average price.
  // For new operational movements created in the app, use frozen unit_cost_snapshot if present.
  const resolveExitLineUnitCost = (line: ExitLineRecord): number => {
    const isImportedMovement = Boolean(
      line.import_batch_id || line.source_row_id
    )
    const st = stockMap.get(line.product)
    if (isImportedMovement) {
      return st?.rawAveragePrice ?? st?.averagePrice ?? 0
    }
    if (
      line.unit_cost_snapshot !== null &&
      line.unit_cost_snapshot !== undefined &&
      !Number.isNaN(Number(line.unit_cost_snapshot))
    ) {
      return Number(line.unit_cost_snapshot)
    }
    return st?.rawAveragePrice ?? st?.averagePrice ?? 0
  }

  // ==========================================================================
  // KPI 1 & STOCK AGGREGATES (Active products)
  // ==========================================================================
  let rawTotalStockVal = 0
  let totalStockVal = 0
  let missingPriceCount = 0
  let alertCount = 0
  let watchCount = 0
  let okCount = 0
  let undefinedMinCount = 0

  const restockCandidates: PriorityRestockItem[] = []
  const missingMinCandidates: PriorityMissingMinItem[] = []
  const missingPriceCandidates: PriorityMissingPriceItem[] = []

  const categoryAggMap = new Map<
    string,
    { stockValue: number; productsCount: number; totalQty: number }
  >()
  const statusAggMap = new Map<
    StockStatusLabel,
    { count: number; stockValue: number }
  >([
    ['Alerte', { count: 0, stockValue: 0 }],
    ['À surveiller', { count: 0, stockValue: 0 }],
    ['OK', { count: 0, stockValue: 0 }],
    ['À définir', { count: 0, stockValue: 0 }],
  ])

  for (const prod of activeProducts) {
    const st = stockMap.get(prod.id)
    if (!st) continue

    if (st.rawAveragePrice !== null) {
      rawTotalStockVal += st.stock * st.rawAveragePrice
    } else if (st.stockValue !== null) {
      rawTotalStockVal += st.stockValue
    }
    if (st.priceMissing) {
      missingPriceCount++
      missingPriceCandidates.push({
        productId: prod.id,
        ref: prod.ref,
        name: prod.name,
        category: prod.category || 'Non catégorisé',
        unit: prod.unit,
        stock: st.stock,
      })
    }

    const statusEntry = statusAggMap.get(st.status)
    if (statusEntry) {
      statusEntry.count++
      if (st.stockValue !== null) {
        statusEntry.stockValue = roundCurrency(
          statusEntry.stockValue + st.stockValue
        )
      }
    }

    switch (st.status) {
      case 'Alerte': {
        alertCount++
        const minVal = prod.min_stock ?? 0
        const deficit = roundQty(Math.max(0, minVal - st.stock))
        restockCandidates.push({
          productId: prod.id,
          ref: prod.ref,
          name: prod.name,
          category: prod.category || 'Non catégorisé',
          unit: prod.unit,
          stock: st.stock,
          minStock: minVal,
          deficit,
          averagePrice: priceHidden ? null : st.averagePrice,
        })
        break
      }
      case 'À surveiller':
        watchCount++
        break
      case 'OK':
        okCount++
        break
      case 'À définir':
        undefinedMinCount++
        missingMinCandidates.push({
          productId: prod.id,
          ref: prod.ref,
          name: prod.name,
          category: prod.category || 'Non catégorisé',
          unit: prod.unit,
          stock: st.stock,
        })
        break
    }

    const catName = prod.category?.trim() || 'Sans catégorie'
    const catAgg = categoryAggMap.get(catName) ?? {
      stockValue: 0,
      productsCount: 0,
      totalQty: 0,
    }
    catAgg.productsCount++
    catAgg.totalQty = roundQty(catAgg.totalQty + Math.max(0, st.stock))
    if (st.stockValue !== null) {
      catAgg.stockValue = roundCurrency(catAgg.stockValue + st.stockValue)
    }
    categoryAggMap.set(catName, catAgg)
  }

  totalStockVal = roundCurrency(rawTotalStockVal)

  restockCandidates.sort((a, b) => {
    const ratioA = a.minStock > 0 ? a.deficit / a.minStock : a.deficit
    const ratioB = b.minStock > 0 ? b.deficit / b.minStock : b.deficit
    if (ratioB !== ratioA) return ratioB - ratioA
    return b.deficit - a.deficit
  })

  // ==========================================================================
  // KPI 2, KPI 3 & PURCHASE ANALYTICS
  // ==========================================================================
  let periodPurchasesAmount = 0
  let periodPurchasesDocsCount = 0
  let periodPurchasesLinesCount = 0

  let prevPurchasesAmount = 0
  let prevPurchasesDocsCount = 0

  let unpaidTotalAmount = 0
  let unpaidInvoicesCount = 0
  const unpaidCandidates: PriorityUnpaidInvoiceItem[] = []

  const supplierPeriodAgg = new Map<
    string,
    { supplierName: string; amount: number; documentsCount: number }
  >()

  const purchaseDayAgg = new Map<string, { amount: number; count: number }>()
  const purchaseWeekAgg = new Map<string, { amount: number; count: number }>()
  const purchaseMonthAgg = new Map<string, { amount: number; count: number }>()
  const allMonthPurchaseAgg = new Map<
    string,
    { amount: number; count: number }
  >()

  for (const p of validPurchaseHeaders) {
    const pDay = p.date.trim().slice(0, 10)
    const lines = linesByPurchaseId.get(p.id) ?? []
    let docAmount = 0
    for (const l of lines) {
      const lineAmt =
        l.amount !== undefined && l.amount !== null && !Number.isNaN(l.amount)
          ? Number(l.amount)
          : roundCurrency(Number(l.qty || 0) * Number(l.unit_price || 0))
      docAmount = roundCurrency(docAmount + lineAmt)
    }

    // Monthly spending (all valid purchases indexed by YYYY-MM)
    const mKey = pDay.slice(0, 7)
    const mEntry = allMonthPurchaseAgg.get(mKey) ?? { amount: 0, count: 0 }
    mEntry.amount = roundCurrency(mEntry.amount + docAmount)
    mEntry.count++
    allMonthPurchaseAgg.set(mKey, mEntry)

    // Unpaid invoices (all periods)
    if (p.payment_status === 'unpaid') {
      unpaidInvoicesCount++
      unpaidTotalAmount = roundCurrency(unpaidTotalAmount + docAmount)
      const supName =
        supplierById.get(p.supplier)?.name ?? (p.supplier || 'Fournisseur')
      unpaidCandidates.push({
        purchaseId: p.id,
        invoiceNo: p.invoice_no || 'Sans N°',
        date: pDay,
        supplierId: p.supplier,
        supplierName: supName,
        amount: priceHidden ? null : docAmount,
        daysOverdue: diffDaysRaw(pDay, range.referenceDate),
      })
    }

    // Current period purchases
    if (pDay >= range.from && pDay <= range.to) {
      periodPurchasesDocsCount++
      periodPurchasesLinesCount += lines.length
      periodPurchasesAmount = roundCurrency(periodPurchasesAmount + docAmount)

      const supName =
        supplierById.get(p.supplier)?.name ?? (p.supplier || 'Fournisseur')
      const sAgg = supplierPeriodAgg.get(p.supplier) ?? {
        supplierName: supName,
        amount: 0,
        documentsCount: 0,
      }
      sAgg.amount = roundCurrency(sAgg.amount + docAmount)
      sAgg.documentsCount++
      supplierPeriodAgg.set(p.supplier, sAgg)

      const dAgg = purchaseDayAgg.get(pDay) ?? { amount: 0, count: 0 }
      dAgg.amount = roundCurrency(dAgg.amount + docAmount)
      dAgg.count++
      purchaseDayAgg.set(pDay, dAgg)

      const wKey = startOfWeekMondayISO(pDay)
      const wAgg = purchaseWeekAgg.get(wKey) ?? { amount: 0, count: 0 }
      wAgg.amount = roundCurrency(wAgg.amount + docAmount)
      wAgg.count++
      purchaseWeekAgg.set(wKey, wAgg)

      const pmAgg = purchaseMonthAgg.get(mKey) ?? { amount: 0, count: 0 }
      pmAgg.amount = roundCurrency(pmAgg.amount + docAmount)
      pmAgg.count++
      purchaseMonthAgg.set(mKey, pmAgg)
    }

    // Previous equivalent period purchases
    if (pDay >= range.previousFrom && pDay <= range.previousTo) {
      prevPurchasesDocsCount++
      prevPurchasesAmount = roundCurrency(prevPurchasesAmount + docAmount)
    }
  }

  unpaidCandidates.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return (b.amount ?? 0) - (a.amount ?? 0)
  })

  // ==========================================================================
  // KPI 5, KPI 6 & EXIT / LOSS ANALYTICS
  // ==========================================================================
  let rawPeriodLossesValue = 0
  let periodLossesValue = 0
  let periodWastedQty = 0
  let periodLossEventsCount = 0

  let prevLossesValue = 0
  let prevLossEventsCount = 0

  let rawPeriodExitsValue = 0
  let periodExitsValue = 0
  let periodConsumedQty = 0
  let periodExitsDocsCount = 0

  let prevExitsValue = 0
  let prevExitsDocsCount = 0

  const productConsumptionAgg = new Map<
    string,
    { qtyConsumed: number; consumedValue: number }
  >()
  const lossDayAgg = new Map<
    string,
    { wastedValue: number; wastedQty: number }
  >()
  const lossWeekAgg = new Map<
    string,
    { wastedValue: number; wastedQty: number }
  >()
  const lossMonthAgg = new Map<
    string,
    { wastedValue: number; wastedQty: number }
  >()

  for (const x of validExitHeaders) {
    const xDay = x.date.trim().slice(0, 10)
    const lines = linesByExitId.get(x.id) ?? []

    if (xDay >= range.from && xDay <= range.to) {
      periodExitsDocsCount++
      for (const l of lines) {
        const unitCost = resolveExitLineUnitCost(l)
        const consumedQty = Number(l.qty_consumed || 0)
        const wastedQty = Number(l.qty_wasted || 0)
        const rawCVal = consumedQty * unitCost
        const rawWVal = wastedQty * unitCost
        const cVal = roundCurrency(rawCVal)
        const wVal = roundCurrency(rawWVal)

        if (consumedQty > 0) {
          periodConsumedQty = roundQty(periodConsumedQty + consumedQty)
          rawPeriodExitsValue += rawCVal

          const cAgg = productConsumptionAgg.get(l.product) ?? {
            qtyConsumed: 0,
            consumedValue: 0,
          }
          cAgg.qtyConsumed = roundQty(cAgg.qtyConsumed + consumedQty)
          cAgg.consumedValue = roundCurrency(cAgg.consumedValue + cVal)
          productConsumptionAgg.set(l.product, cAgg)
        }

        if (wastedQty > 0) {
          periodLossEventsCount++
          periodWastedQty = roundQty(periodWastedQty + wastedQty)
          rawPeriodLossesValue += rawWVal

          const ld = lossDayAgg.get(xDay) ?? { wastedValue: 0, wastedQty: 0 }
          ld.wastedValue = roundCurrency(ld.wastedValue + wVal)
          ld.wastedQty = roundQty(ld.wastedQty + wastedQty)
          lossDayAgg.set(xDay, ld)

          const wKey = startOfWeekMondayISO(xDay)
          const lw = lossWeekAgg.get(wKey) ?? { wastedValue: 0, wastedQty: 0 }
          lw.wastedValue = roundCurrency(lw.wastedValue + wVal)
          lw.wastedQty = roundQty(lw.wastedQty + wastedQty)
          lossWeekAgg.set(wKey, lw)

          const mKey = xDay.slice(0, 7)
          const lm = lossMonthAgg.get(mKey) ?? { wastedValue: 0, wastedQty: 0 }
          lm.wastedValue = roundCurrency(lm.wastedValue + wVal)
          lm.wastedQty = roundQty(lm.wastedQty + wastedQty)
          lossMonthAgg.set(mKey, lm)
        }
      }
    }

    if (xDay >= range.previousFrom && xDay <= range.previousTo) {
      prevExitsDocsCount++
      for (const l of lines) {
        const unitCost = resolveExitLineUnitCost(l)
        const consumedQty = Number(l.qty_consumed || 0)
        const wastedQty = Number(l.qty_wasted || 0)
        if (consumedQty > 0) {
          prevExitsValue = roundCurrency(prevExitsValue + consumedQty * unitCost)
        }
        if (wastedQty > 0) {
          prevLossEventsCount++
          prevLossesValue = roundCurrency(prevLossesValue + wastedQty * unitCost)
        }
      }
    }
  }

  periodExitsValue = roundCurrency(rawPeriodExitsValue)
  periodLossesValue = roundCurrency(rawPeriodLossesValue)

  // ==========================================================================
  // INVENTORY VARIANCES (Priority panel & Chart 8)
  // ==========================================================================
  const confirmedSessions = dataset.inventorySessions
    .filter((s) => s.status === 'confirmed')
    .slice()
    .sort((a, b) => {
      const dA = a.date.slice(0, 10)
      const dB = b.date.slice(0, 10)
      if (dB !== dA) return dB.localeCompare(dA)
      return (b.confirmed_at || b.created_at || '').localeCompare(
        a.confirmed_at || a.created_at || ''
      )
    })

  const linesBySessionId = new Map<string, InventoryLineRecord[]>()
  for (const il of dataset.inventoryLines) {
    const list = linesBySessionId.get(il.session) ?? []
    list.push(il)
    linesBySessionId.set(il.session, list)
  }

  const latestConfirmedSession = confirmedSessions[0] ?? null
  const varianceCandidates: PriorityInventoryVarianceItem[] = []

  if (latestConfirmedSession) {
    const sessLines = linesBySessionId.get(latestConfirmedSession.id) ?? []
    for (const il of sessLines) {
      const diff = Number(il.diff || 0)
      if (diff === 0) continue
      const theo = Number(il.theoretical || 0)
      const prod = productById.get(il.product)
      const st = stockMap.get(il.product)
      const valDiff =
        il.value_diff !== null && il.value_diff !== undefined
          ? Number(il.value_diff)
          : st?.averagePrice !== null && st?.averagePrice !== undefined
            ? roundCurrency(diff * st.averagePrice)
            : null

      const exceedsPct =
        theo > 0 ? Math.abs(diff) / theo > 0.5 : Math.abs(diff) > 0
      const exceedsVal = valDiff !== null && Math.abs(valDiff) >= 500

      if (exceedsPct || exceedsVal) {
        varianceCandidates.push({
          lineId: il.id,
          sessionId: latestConfirmedSession.id,
          sessionDate: latestConfirmedSession.date.slice(0, 10),
          productId: il.product,
          ref: prod?.ref ?? '—',
          name: prod?.name ?? 'Produit',
          unit: prod?.unit ?? '',
          theoretical: theo,
          counted: Number(il.counted || 0),
          diff,
          valueDiff: priceHidden ? null : valDiff,
          comment: il.comment ?? null,
        })
      }
    }

    varianceCandidates.sort((a, b) => {
      const vA = Math.abs(a.valueDiff ?? a.diff)
      const vB = Math.abs(b.valueDiff ?? b.diff)
      return vB - vA
    })
  }

  // Chart 8: Latest confirmed sessions (up to 8, ordered chronologically for bar chart)
  const inventoryVarianceChartItems: InventoryVarianceSessionPoint[] =
    confirmedSessions
      .slice(0, 8)
      .reverse()
      .map((sess) => {
        const sLines = linesBySessionId.get(sess.id) ?? []
        let shortageVal = 0
        let surplusVal = 0
        let shortageQty = 0
        let surplusQty = 0

        for (const il of sLines) {
          const diff = Number(il.diff || 0)
          const st = stockMap.get(il.product)
          const vDiff =
            il.value_diff !== null && il.value_diff !== undefined
              ? Number(il.value_diff)
              : st?.averagePrice !== null && st?.averagePrice !== undefined
                ? roundCurrency(diff * st.averagePrice)
                : 0

          if (diff < 0) {
            shortageQty = roundQty(shortageQty + Math.abs(diff))
            shortageVal = roundCurrency(shortageVal + Math.abs(vDiff))
          } else if (diff > 0) {
            surplusQty = roundQty(surplusQty + diff)
            surplusVal = roundCurrency(surplusVal + Math.abs(vDiff))
          }
        }

        return {
          sessionId: sess.id,
          date: sess.date.slice(0, 10),
          label: formatDateFR(sess.date.slice(0, 10)),
          scope:
            sess.scope === 'category' && sess.category
              ? sess.category
              : 'Complet',
          shortageValue: priceHidden ? null : shortageVal,
          surplusValue: priceHidden ? null : surplusVal,
          netValueDiff: priceHidden
            ? null
            : roundCurrency(surplusVal - shortageVal),
          shortageQty,
          surplusQty,
          countedProductsCount: sLines.length,
        }
      })

  // ==========================================================================
  // PENDING APPROVALS (Reversals waiting for a manager)
  // ==========================================================================
  const pendingApprovalItems: PriorityPendingApprovalItem[] = []
  if (role === 'admin' || role === 'manager' || role === 'consultation') {
    for (const p of dataset.purchases) {
      if (p.correction_status === 'pending_approval') {
        const supName =
          supplierById.get(p.supplier)?.name ?? (p.supplier || 'Fournisseur')
        pendingApprovalItems.push({
          id: p.id,
          type: 'purchase',
          date: p.date.slice(0, 10),
          label: `Entrée ${p.invoice_no || p.id} (${supName})`,
          requestedBy:
            p.pending_reversal_requested_by_name ||
            userById.get(p.pending_reversal_requested_by || '')?.name ||
            'Opérateur',
          reason: p.pending_reversal_reason || 'Correction demandée',
          mode: p.pending_reversal_mode || 'cancel',
          linkTo: '/entrees-de-stock',
        })
      }
    }
    for (const x of dataset.exits) {
      if (x.correction_status === 'pending_approval') {
        pendingApprovalItems.push({
          id: x.id,
          type: 'exit',
          date: x.date.slice(0, 10),
          label: `Sortie vers ${x.destination || 'Cuisine'}`,
          requestedBy:
            x.pending_reversal_requested_by_name ||
            userById.get(x.pending_reversal_requested_by || '')?.name ||
            'Opérateur',
          reason: x.pending_reversal_reason || 'Correction demandée',
          mode: x.pending_reversal_mode || 'cancel',
          linkTo: '/sorties-de-stock',
        })
      }
    }
    pendingApprovalItems.sort((a, b) => b.date.localeCompare(a.date))
  }

  // ==========================================================================
  // CHART SERIES CONSTRUCTION
  // ==========================================================================

  // Chart 1: Purchases Evolution
  const purchasesByDay: PurchasesEvolutionPoint[] = Array.from(
    purchaseDayAgg.entries()
  )
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, val]) => ({
      bucketKey: d,
      label: formatDateFR(d),
      date: d,
      amount: priceHidden ? null : val.amount,
      count: val.count,
    }))

  const purchasesByWeek: PurchasesEvolutionPoint[] = Array.from(
    purchaseWeekAgg.entries()
  )
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([w, val]) => ({
      bucketKey: w,
      label: `Sem. ${formatDateFR(w)}`,
      date: w,
      amount: priceHidden ? null : val.amount,
      count: val.count,
    }))

  const purchasesByMonth: PurchasesEvolutionPoint[] = Array.from(
    purchaseMonthAgg.entries()
  )
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, val]) => ({
      bucketKey: m,
      label: formatMonthKeyFR(m),
      date: `${m}-01`,
      amount: priceHidden ? null : val.amount,
      count: val.count,
    }))

  // Chart 2: Stock Value by Category
  const stockValueByCategoryItems: CategoryStockValuePoint[] = Array.from(
    categoryAggMap.entries()
  )
    .map(([category, agg]) => ({
      category,
      stockValue: priceHidden ? null : agg.stockValue,
      productsCount: agg.productsCount,
      totalQty: agg.totalQty,
      sharePct:
        priceHidden || totalStockVal <= 0
          ? null
          : roundCurrency((agg.stockValue / totalStockVal) * 100),
    }))
    .sort((a, b) => {
      if (!priceHidden) {
        return (b.stockValue ?? 0) - (a.stockValue ?? 0)
      }
      return b.productsCount - a.productsCount
    })

  // Chart 3: Top 10 Consumed Products (by Quantity and by Value)
  const allConsumedPoints: TopConsumedProductPoint[] = Array.from(
    productConsumptionAgg.entries()
  ).map(([productId, agg]) => {
    const prod = productById.get(productId)
    return {
      productId,
      ref: prod?.ref ?? '—',
      name: prod?.name ?? 'Produit',
      category: prod?.category || 'Non catégorisé',
      unit: prod?.unit ?? '',
      qtyConsumed: agg.qtyConsumed,
      consumedValue: priceHidden ? null : agg.consumedValue,
    }
  })

  const topConsumedByQty = allConsumedPoints
    .slice()
    .sort((a, b) => b.qtyConsumed - a.qtyConsumed)
    .slice(0, 10)

  const topConsumedByValue = priceHidden
    ? []
    : allConsumedPoints
        .slice()
        .sort((a, b) => (b.consumedValue ?? 0) - (a.consumedValue ?? 0))
        .slice(0, 10)

  // Chart 4: Purchases by Supplier (Top 10)
  const purchasesBySupplierItems: SupplierPurchasePoint[] = priceHidden
    ? []
    : Array.from(supplierPeriodAgg.entries())
        .map(([supplierId, agg]) => ({
          supplierId,
          supplierName: agg.supplierName,
          amount: agg.amount,
          documentsCount: agg.documentsCount,
          sharePct:
            periodPurchasesAmount > 0
              ? roundCurrency((agg.amount / periodPurchasesAmount) * 100)
              : 0,
        }))
        .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
        .slice(0, 10)

  // Chart 5: Stock Status Distribution
  const statusColors: Record<StockStatusLabel, string> = {
    Alerte: '#D72C0D',
    'À surveiller': '#B98900',
    OK: '#008060',
    'À définir': '#6D7175',
  }
  const totalActiveCount = activeProducts.length
  const stockStatusDistributionItems: StockStatusDistributionPoint[] = (
    ['Alerte', 'À surveiller', 'OK', 'À définir'] as StockStatusLabel[]
  ).map((status) => {
    const entry = statusAggMap.get(status) ?? { count: 0, stockValue: 0 }
    return {
      status,
      count: entry.count,
      sharePct:
        totalActiveCount > 0
          ? roundCurrency((entry.count / totalActiveCount) * 100)
          : 0,
      stockValue: priceHidden ? null : entry.stockValue,
      color: statusColors[status],
    }
  })

  // Chart 6: Losses Evolution
  const lossesByDay: LossesEvolutionPoint[] = Array.from(lossDayAgg.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, val]) => ({
      bucketKey: d,
      label: formatDateFR(d),
      date: d,
      wastedValue: priceHidden ? null : val.wastedValue,
      wastedQty: val.wastedQty,
    }))

  const lossesByWeek: LossesEvolutionPoint[] = Array.from(lossWeekAgg.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([w, val]) => ({
      bucketKey: w,
      label: `Sem. ${formatDateFR(w)}`,
      date: w,
      wastedValue: priceHidden ? null : val.wastedValue,
      wastedQty: val.wastedQty,
    }))

  const lossesByMonth: LossesEvolutionPoint[] = Array.from(
    lossMonthAgg.entries()
  )
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, val]) => ({
      bucketKey: m,
      label: formatMonthKeyFR(m),
      date: `${m}-01`,
      wastedValue: priceHidden ? null : val.wastedValue,
      wastedQty: val.wastedQty,
    }))

  // Chart 7: Monthly Spending (Last 12 Months ending at range.to month)
  const monthlySpendingItems: MonthlySpendingPoint[] = []
  let hasAny12MonthPurchase = false
  if (!priceHidden) {
    const anchorDate = parseIsoDayUTC(range.to)
    for (let offset = 11; offset >= 0; offset--) {
      const dt = new Date(
        Date.UTC(
          anchorDate.getUTCFullYear(),
          anchorDate.getUTCMonth() - offset,
          1
        )
      )
      const mKey = formatIsoDayUTC(dt).slice(0, 7)
      const agg = allMonthPurchaseAgg.get(mKey)
      if (agg && agg.count > 0) {
        hasAny12MonthPurchase = true
      }
      monthlySpendingItems.push({
        monthKey: mKey,
        label: formatMonthKeyFR(mKey),
        amount: agg ? agg.amount : 0,
        documentsCount: agg ? agg.count : 0,
      })
    }
  }

  // ==========================================================================
  // RECENT ACTIVITY FEED (Last 10 movements: entry, exit, inventory, reversal)
  // ==========================================================================
  const activityFeed: RecentActivityItem[] = []

  // Purchases & Purchase Reversals
  if (!priceHidden) {
    for (const p of dataset.purchases) {
      const isRev = Boolean(p.reversed_of)
      const supName =
        supplierById.get(p.supplier)?.name ?? (p.supplier || 'Fournisseur')
      const lines = dataset.purchaseLines.filter((l) => l.purchase === p.id)
      let docAmt = 0
      for (const l of lines) {
        docAmt = roundCurrency(
          docAmt + Number(l.qty || 0) * Number(l.unit_price || 0)
        )
      }
      const userName =
        p.recorded_by_name ||
        userById.get(p.recorded_by)?.name ||
        (p.recorded_by ? p.recorded_by : 'Économat')

      activityFeed.push({
        id: `act-pur-${p.id}`,
        type: isRev ? 'reversal' : 'entry',
        date: p.date.slice(0, 10),
        timestamp: p.created_at || p.date,
        title: isRev
          ? `Contre-passation entrée ${p.invoice_no || ''}`.trim()
          : `Entrée de stock ${p.invoice_no ? `(${p.invoice_no})` : ''}`.trim(),
        subtitle: `${supName} • ${lines.length} ligne${lines.length > 1 ? 's' : ''}`,
        userName,
        amountOrQtyLabel: `${new Intl.NumberFormat('fr-MA', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(Math.abs(docAmt))} DH`,
        linkTo: '/entrees-de-stock',
        docId: p.id,
      })
    }
  }

  // Exits & Exit Reversals
  for (const x of dataset.exits) {
    const isRev = Boolean(x.reversed_of)
    const lines = dataset.exitLines.filter((l) => l.exit === x.id)
    let totalQty = 0
    let totalVal = 0
    for (const l of lines) {
      const q = Number(l.qty_consumed || 0) + Number(l.qty_wasted || 0)
      totalQty = roundQty(totalQty + Math.abs(q))
      const uCost = resolveExitLineUnitCost(l)
      totalVal = roundCurrency(totalVal + Math.abs(q) * uCost)
    }
    const userName =
      x.recorded_by_name ||
      userById.get(x.recorded_by)?.name ||
      (x.recorded_by ? x.recorded_by : 'Cuisine / Économat')

    activityFeed.push({
      id: `act-ext-${x.id}`,
      type: isRev ? 'reversal' : 'exit',
      date: x.date.slice(0, 10),
      timestamp: x.created_at || x.date,
      title: isRev
        ? `Contre-passation sortie (${x.destination || 'Cuisine'})`
        : `Sortie vers ${x.destination || 'Cuisine'}`,
      subtitle: `${lines.length} article${lines.length > 1 ? 's' : ''}`,
      userName,
      amountOrQtyLabel: priceHidden
        ? `${lines.length} réf.`
        : `${new Intl.NumberFormat('fr-MA', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(totalVal)} DH`,
      linkTo: '/sorties-de-stock',
      docId: x.id,
    })
  }

  // Inventories (Confirmed or Reversed)
  if (!priceHidden) {
    for (const s of dataset.inventorySessions) {
      if (s.status !== 'confirmed' && s.status !== 'reversed') continue
      const isRev = s.status === 'reversed'
      const sLines = linesBySessionId.get(s.id) ?? []
      const userName =
        s.confirmed_by_name ||
        userById.get(s.confirmed_by || '')?.name ||
        s.confirmed_by ||
        'Manager'

      activityFeed.push({
        id: `act-inv-${s.id}`,
        type: isRev ? 'reversal' : 'inventory',
        date: s.date.slice(0, 10),
        timestamp: s.reversed_at || s.confirmed_at || s.created_at || s.date,
        title: isRev
          ? `Inventaire contre-passé (${formatDateFR(s.date.slice(0, 10))})`
          : `Inventaire confirmé (${s.scope === 'category' && s.category ? s.category : 'Complet'})`,
        subtitle: `${sLines.length} produit${sLines.length > 1 ? 's' : ''} compté${sLines.length > 1 ? 's' : ''}`,
        userName,
        amountOrQtyLabel: `${sLines.length} réf.`,
        linkTo: '/inventaires',
        docId: s.id,
      })
    }
  }

  activityFeed.sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date)
    return b.timestamp.localeCompare(a.timestamp)
  })

  const recentActivity = activityFeed.slice(0, 10)

  // ==========================================================================
  // ASSEMBLE FINAL RESULT
  // ==========================================================================
  const purchasesTrend = priceHidden
    ? null
    : computePeriodTrend(
        periodPurchasesAmount,
        prevPurchasesAmount,
        prevPurchasesDocsCount > 0,
        range.previousLabel
      )

  const lossesTrend = priceHidden
    ? null
    : computePeriodTrend(
        periodLossesValue,
        prevLossesValue,
        prevLossEventsCount > 0,
        range.previousLabel
      )

  const exitsTrend = priceHidden
    ? null
    : computePeriodTrend(
        periodExitsValue,
        prevExitsValue,
        prevExitsDocsCount > 0,
        range.previousLabel
      )

  const result: DashboardAnalyticsResult = {
    generatedAt: new Date().toISOString(),
    role,
    priceHidden,
    vatConvention,
    databaseEmpty,
    range,
    kpis: {
      vatConvention,
      stockValue: {
        value: priceHidden
          ? null
          : activeProducts.length > 0
            ? roundCurrency(totalStockVal)
            : 0,
        activeProductsCount: activeProducts.length,
        missingPriceCount: priceHidden ? 0 : missingPriceCount,
        hasData: activeProducts.length > 0,
        periodLabel: `Au ${formatDateFR(range.referenceDate)}`,
      },
      periodPurchases: {
        value: priceHidden ? null : roundCurrency(periodPurchasesAmount),
        documentsCount: periodPurchasesDocsCount,
        linesCount: periodPurchasesLinesCount,
        hasData:
          validPurchaseHeaders.length > 0 &&
          (periodPurchasesDocsCount > 0 || prevPurchasesDocsCount > 0),
        periodLabel: range.shortPeriodLabel,
        trend: purchasesTrend,
      },
      unpaidInvoices: {
        totalAmount: priceHidden ? null : roundCurrency(unpaidTotalAmount),
        invoicesCount: priceHidden ? 0 : unpaidInvoicesCount,
        hasData: validPurchaseHeaders.length > 0,
        periodLabel: 'Toutes périodes',
      },
      alertProducts: {
        alertCount,
        watchCount,
        okCount,
        undefinedMinCount,
        activeProductsCount: activeProducts.length,
        hasData: activeProducts.length > 0,
        periodLabel: 'Temps réel',
      },
      periodLosses: {
        value: priceHidden ? null : roundCurrency(periodLossesValue),
        totalWastedQty: roundQty(periodWastedQty),
        eventsCount: periodLossEventsCount,
        hasData:
          validExitHeaders.length > 0 &&
          (periodLossEventsCount > 0 ||
            periodExitsDocsCount > 0 ||
            prevLossEventsCount > 0),
        periodLabel: range.shortPeriodLabel,
        trend: lossesTrend,
      },
      periodExits: {
        value: priceHidden ? null : roundCurrency(periodExitsValue),
        totalConsumedQty: roundQty(periodConsumedQty),
        documentsCount: periodExitsDocsCount,
        hasData:
          validExitHeaders.length > 0 &&
          (periodExitsDocsCount > 0 || prevExitsDocsCount > 0),
        periodLabel: range.shortPeriodLabel,
        trend: exitsTrend,
      },
    },
    priorityActions: {
      restockAlerts: {
        totalCount: alertCount,
        items: restockCandidates.slice(0, 5),
      },
      missingMinStock: {
        totalCount: undefinedMinCount,
        items: missingMinCandidates.slice(0, 5),
      },
      oldestUnpaidInvoices: {
        totalCount: priceHidden ? 0 : unpaidInvoicesCount,
        totalAmount: priceHidden ? null : roundCurrency(unpaidTotalAmount),
        items: priceHidden ? [] : unpaidCandidates.slice(0, 5),
      },
      inventoryVariancesToVerify: {
        sessionId: latestConfirmedSession?.id ?? null,
        sessionDate: latestConfirmedSession
          ? latestConfirmedSession.date.slice(0, 10)
          : null,
        totalCount: varianceCandidates.length,
        items: varianceCandidates.slice(0, 5),
      },
      missingPriceProducts: {
        totalCount: priceHidden ? 0 : missingPriceCount,
        items: priceHidden ? [] : missingPriceCandidates.slice(0, 5),
      },
      pendingApprovals: {
        totalCount: pendingApprovalItems.length,
        items: pendingApprovalItems.slice(0, 5),
      },
    },
    charts: {
      purchasesEvolution: {
        hasData: !priceHidden && purchasesByDay.length > 0,
        byDay: purchasesByDay,
        byWeek: purchasesByWeek,
        byMonth: purchasesByMonth,
      },
      stockValueByCategory: {
        hasData:
          activeProducts.length > 0 &&
          (priceHidden || totalStockVal > 0 || stockValueByCategoryItems.length > 0),
        items: stockValueByCategoryItems,
      },
      topConsumedProducts: {
        hasData: topConsumedByQty.length > 0,
        byQuantity: topConsumedByQty,
        byValue: topConsumedByValue,
      },
      purchasesBySupplier: {
        hasData: !priceHidden && purchasesBySupplierItems.length > 0,
        items: purchasesBySupplierItems,
      },
      stockStatusDistribution: {
        hasData: activeProducts.length > 0,
        totalActiveProducts: activeProducts.length,
        items: stockStatusDistributionItems,
      },
      lossesEvolution: {
        hasData: lossesByDay.length > 0,
        byDay: lossesByDay,
        byWeek: lossesByWeek,
        byMonth: lossesByMonth,
      },
      monthlySpending12Months: {
        hasData: !priceHidden && hasAny12MonthPurchase,
        items: monthlySpendingItems,
      },
      inventoryVariancesBySession: {
        hasData:
          !priceHidden &&
          inventoryVarianceChartItems.some(
            (i) => (i.shortageValue ?? 0) > 0 || (i.surplusValue ?? 0) > 0
          ),
        items: inventoryVarianceChartItems,
      },
    },
    recentActivity,
  }

  analyticsCache.set(cacheKey, result)
  return result
}

// ============================================================================
// STAGE 8 – PAYMENTS, REPORTS, REPLENISHMENT, PERTES & UNIFIED MOVEMENTS
// ============================================================================

export type AgingBucketKey = '0-30' | '31-60' | '61-90' | '90+'

export interface InvoiceComputedRow {
  id: string
  date: string
  invoiceNo: string
  supplierId: string
  supplierName: string
  totalAmount: number | null
  amountPaid: number | null
  remainingAmount: number | null
  paymentStatus: 'paid' | 'unpaid' | 'partial'
  paymentDate: string | null
  paymentMethod: string | null
  paymentReference: string | null
  daysSincePurchase: number
  agingBucket: AgingBucketKey | null
  linesCount: number
  createdBy: string
  createdByName: string
  notes: string
}

export interface SupplierOutstandingBalanceRow {
  supplierId: string
  supplierName: string
  unpaidInvoicesCount: number
  totalInvoiced: number | null
  totalPaid: number | null
  outstandingBalance: number | null
  overdueOver30DaysAmount: number | null
  oldestUnpaidDate: string | null
  maxDaysSincePurchase: number
  invoices: InvoiceComputedRow[]
}

export interface AgingBucketSummary {
  bucket: AgingBucketKey
  label: string
  count: number
  amount: number | null
  sharePct: number | null
}

export interface InvoicesAndAgingReportResult {
  priceHidden: boolean
  partialPaymentsEnabled: boolean
  referenceDate: string
  summary: {
    totalUnpaidAmount: number | null
    unpaidInvoicesCount: number
    unpaidOver30DaysAmount: number | null
    unpaidOver30DaysCount: number
    paidInPeriodAmount: number | null
    paidInPeriodCount: number
    totalInvoicedInPeriod: number | null
  }
  agingBuckets: AgingBucketSummary[]
  invoices: InvoiceComputedRow[]
  supplierBalances: SupplierOutstandingBalanceRow[]
}

export function computeInvoicesAndAgingReport(
  dataset: RawAnalyticsDataset,
  options?: {
    from?: string | null
    to?: string | null
    supplierId?: string | null
    paymentStatus?: 'all' | 'paid' | 'unpaid' | 'partial'
    minAmount?: number | null
    maxAmount?: number | null
    search?: string | null
    referenceDate?: string | null
    role?: UserRole
  }
): InvoicesAndAgingReportResult {
  const role: UserRole = options?.role ?? 'admin'
  const priceHidden = role === 'cuisine'
  const refDate = (
    options?.referenceDate?.trim() || new Date().toISOString().slice(0, 10)
  ).slice(0, 10)

  let partialPaymentsEnabled = false
  if (Array.isArray(dataset.settings)) {
    const partialSetting = dataset.settings.find(
      (s) => s.key === 'partial_payments_enabled'
    )
    if (partialSetting?.value === true || partialSetting?.value === 'true') {
      partialPaymentsEnabled = true
    }
  }

  const supplierById = new Map<string, SupplierRecord>()
  for (const s of dataset.suppliers) {
    supplierById.set(s.id, s)
  }

  const userById = new Map<string, UserRecord>()
  if (Array.isArray(dataset.users)) {
    for (const u of dataset.users) {
      userById.set(u.id, u)
    }
  }

  // Exclude reversed / reversal documents from all invoice & payment totals
  const reversedPurchaseIds = new Set<string>()
  for (const p of dataset.purchases) {
    if (p.reversed_of) {
      reversedPurchaseIds.add(p.reversed_of)
    }
  }

  const linesCountByPurchaseId = new Map<string, number>()
  const computedTotalByPurchaseId = new Map<string, number>()
  for (const line of dataset.purchaseLines) {
    linesCountByPurchaseId.set(
      line.purchase,
      (linesCountByPurchaseId.get(line.purchase) ?? 0) + 1
    )
    const lineAmt =
      typeof line.amount === 'number' && !Number.isNaN(line.amount)
        ? line.amount
        : Number(line.qty || 0) * Number(line.unit_price || 0)
    computedTotalByPurchaseId.set(
      line.purchase,
      roundCurrency((computedTotalByPurchaseId.get(line.purchase) ?? 0) + lineAmt)
    )
  }

  const fromFilter = options?.from?.trim().slice(0, 10) || null
  const toFilter = options?.to?.trim().slice(0, 10) || null
  const supplierFilter =
    options?.supplierId && options.supplierId !== 'all'
      ? options.supplierId
      : null
  const statusFilter =
    options?.paymentStatus && options.paymentStatus !== 'all'
      ? options.paymentStatus
      : null
  const minAmt =
    typeof options?.minAmount === 'number' && !Number.isNaN(options.minAmount)
      ? options.minAmount
      : null
  const maxAmt =
    typeof options?.maxAmount === 'number' && !Number.isNaN(options.maxAmount)
      ? options.maxAmount
      : null
  const searchNorm = (options?.search ?? '').trim().toLowerCase()

  let totalUnpaidAmount = 0
  let unpaidInvoicesCount = 0
  let unpaidOver30DaysAmount = 0
  let unpaidOver30DaysCount = 0
  let paidInPeriodAmount = 0
  let paidInPeriodCount = 0
  let totalInvoicedInPeriod = 0

  const bucketMap = new Map<AgingBucketKey, { count: number; amount: number }>([
    ['0-30', { count: 0, amount: 0 }],
    ['31-60', { count: 0, amount: 0 }],
    ['61-90', { count: 0, amount: 0 }],
    ['90+', { count: 0, amount: 0 }],
  ])

  const allValidRows: InvoiceComputedRow[] = []

  for (const p of dataset.purchases) {
    if (isDocumentReversedOrReversal(p, reversedPurchaseIds)) continue
    const pDate = (p.date ?? '').trim().slice(0, 10)
    const totalAmt = roundCurrency(computedTotalByPurchaseId.get(p.id) ?? 0)
    const rawStatus = p.payment_status ?? 'unpaid'
    const effectiveStatus: 'paid' | 'unpaid' | 'partial' =
      rawStatus === 'paid'
        ? 'paid'
        : rawStatus === 'partial' && partialPaymentsEnabled
          ? 'partial'
          : typeof p.amount_paid === 'number' &&
              p.amount_paid > 0 &&
              p.amount_paid < totalAmt &&
              partialPaymentsEnabled
            ? 'partial'
            : 'unpaid'

    const amountPaid =
      effectiveStatus === 'paid'
        ? totalAmt
        : effectiveStatus === 'partial'
          ? roundCurrency(Math.min(totalAmt, Math.max(0, Number(p.amount_paid ?? 0))))
          : 0
    const remainingAmount = roundCurrency(Math.max(0, totalAmt - amountPaid))

    const daysSincePurchase = pDate ? diffDaysRaw(pDate, refDate) : 0
    let agingBucket: AgingBucketKey | null = null
    if (effectiveStatus !== 'paid' && remainingAmount > 0) {
      if (daysSincePurchase <= 30) agingBucket = '0-30'
      else if (daysSincePurchase <= 60) agingBucket = '31-60'
      else if (daysSincePurchase <= 90) agingBucket = '61-90'
      else agingBucket = '90+'
    }

    const supplierName = supplierById.get(p.supplier)?.name ?? 'Fournisseur inconnu'
    const invoiceNo = p.invoice_no?.trim() || 'Sans n°'
    const createdByUser = p.recorded_by ? userById.get(p.recorded_by) : undefined
    const createdByName =
      p.recorded_by_name || createdByUser?.name || p.recorded_by || 'Système'

    const row: InvoiceComputedRow = {
      id: p.id,
      date: pDate,
      invoiceNo,
      supplierId: p.supplier,
      supplierName,
      totalAmount: priceHidden ? null : totalAmt,
      amountPaid: priceHidden ? null : amountPaid,
      remainingAmount: priceHidden ? null : remainingAmount,
      paymentStatus: effectiveStatus,
      paymentDate: p.payment_date ? p.payment_date.slice(0, 10) : null,
      paymentMethod: p.payment_method ?? null,
      paymentReference: p.payment_reference ?? null,
      daysSincePurchase,
      agingBucket,
      linesCount: linesCountByPurchaseId.get(p.id) ?? 0,
      createdBy: p.recorded_by ?? '',
      createdByName,
      notes: p.notes ?? '',
    }

    // Apply supplier / search / min / max filters before summary or keep period logic consistent
    if (supplierFilter && row.supplierId !== supplierFilter) continue
    if (searchNorm) {
      const hay = `${row.invoiceNo} ${row.supplierName} ${row.paymentReference ?? ''}`.toLowerCase()
      if (!hay.includes(searchNorm)) continue
    }
    if (minAmt !== null && totalAmt < minAmt) continue
    if (maxAmt !== null && totalAmt > maxAmt) continue

    // Check date range filter for period-based metrics and table filtering
    const inPeriod =
      (!fromFilter || pDate >= fromFilter) && (!toFilter || pDate <= toFilter)

    const paymentDateStr = (p.payment_date ?? pDate).trim().slice(0, 10)
    const paidDateInPeriod =
      (!fromFilter || paymentDateStr >= fromFilter) &&
      (!toFilter || paymentDateStr <= toFilter)

    if (inPeriod) {
      totalInvoicedInPeriod = roundCurrency(totalInvoicedInPeriod + totalAmt)
    }

    if (
      (effectiveStatus === 'paid' || effectiveStatus === 'partial') &&
      amountPaid > 0 &&
      paidDateInPeriod
    ) {
      paidInPeriodAmount = roundCurrency(paidInPeriodAmount + amountPaid)
      paidInPeriodCount += 1
    }

    // Unpaid / aging metrics: if date range filter is set, filter by purchase date in range
    if (!inPeriod) continue

    if (effectiveStatus !== 'paid' && remainingAmount > 0) {
      totalUnpaidAmount = roundCurrency(totalUnpaidAmount + remainingAmount)
      unpaidInvoicesCount += 1
      if (daysSincePurchase > 30) {
        unpaidOver30DaysAmount = roundCurrency(
          unpaidOver30DaysAmount + remainingAmount
        )
        unpaidOver30DaysCount += 1
      }
      if (agingBucket) {
        const b = bucketMap.get(agingBucket)!
        b.count += 1
        b.amount = roundCurrency(b.amount + remainingAmount)
      }
    }

    if (statusFilter && row.paymentStatus !== statusFilter) continue
    allValidRows.push(row)
  }

  allValidRows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

  // Group by supplier
  const supplierGroupMap = new Map<
    string,
    {
      supplierId: string
      supplierName: string
      unpaidInvoicesCount: number
      totalInvoiced: number
      totalPaid: number
      outstandingBalance: number
      overdueOver30DaysAmount: number
      oldestUnpaidDate: string | null
      maxDaysSincePurchase: number
      invoices: InvoiceComputedRow[]
    }
  >()

  for (const row of allValidRows) {
    const rawTotal = row.totalAmount ?? 0
    const rawPaid = row.amountPaid ?? 0
    const rawRem = row.remainingAmount ?? 0
    const existing = supplierGroupMap.get(row.supplierId) ?? {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      unpaidInvoicesCount: 0,
      totalInvoiced: 0,
      totalPaid: 0,
      outstandingBalance: 0,
      overdueOver30DaysAmount: 0,
      oldestUnpaidDate: null,
      maxDaysSincePurchase: 0,
      invoices: [],
    }
    existing.totalInvoiced = roundCurrency(existing.totalInvoiced + rawTotal)
    existing.totalPaid = roundCurrency(existing.totalPaid + rawPaid)
    existing.outstandingBalance = roundCurrency(
      existing.outstandingBalance + rawRem
    )
    if (row.paymentStatus !== 'paid' && rawRem > 0) {
      existing.unpaidInvoicesCount += 1
      if (row.daysSincePurchase > 30) {
        existing.overdueOver30DaysAmount = roundCurrency(
          existing.overdueOver30DaysAmount + rawRem
        )
      }
      if (!existing.oldestUnpaidDate || row.date < existing.oldestUnpaidDate) {
        existing.oldestUnpaidDate = row.date
      }
      if (row.daysSincePurchase > existing.maxDaysSincePurchase) {
        existing.maxDaysSincePurchase = row.daysSincePurchase
      }
    }
    existing.invoices.push(row)
    supplierGroupMap.set(row.supplierId, existing)
  }

  const supplierBalances: SupplierOutstandingBalanceRow[] = Array.from(
    supplierGroupMap.values()
  )
    .map((g) => ({
      supplierId: g.supplierId,
      supplierName: g.supplierName,
      unpaidInvoicesCount: g.unpaidInvoicesCount,
      totalInvoiced: priceHidden ? null : g.totalInvoiced,
      totalPaid: priceHidden ? null : g.totalPaid,
      outstandingBalance: priceHidden ? null : g.outstandingBalance,
      overdueOver30DaysAmount: priceHidden ? null : g.overdueOver30DaysAmount,
      oldestUnpaidDate: g.oldestUnpaidDate,
      maxDaysSincePurchase: g.maxDaysSincePurchase,
      invoices: g.invoices,
    }))
    .sort(
      (a, b) =>
        (b.outstandingBalance ?? 0) - (a.outstandingBalance ?? 0) ||
        a.supplierName.localeCompare(b.supplierName, 'fr')
    )

  const bucketLabels: Record<AgingBucketKey, string> = {
    '0-30': '0 à 30 jours (courant)',
    '31-60': '31 à 60 jours',
    '61-90': '61 à 90 jours',
    '90+': 'Plus de 90 jours (critique)',
  }

  const agingBuckets: AgingBucketSummary[] = (
    ['0-30', '31-60', '61-90', '90+'] as AgingBucketKey[]
  ).map((key) => {
    const item = bucketMap.get(key)!
    return {
      bucket: key,
      label: bucketLabels[key],
      count: item.count,
      amount: priceHidden ? null : item.amount,
      sharePct:
        priceHidden || totalUnpaidAmount <= 0
          ? null
          : roundCurrency((item.amount / totalUnpaidAmount) * 100),
    }
  })

  return {
    priceHidden,
    partialPaymentsEnabled,
    referenceDate: refDate,
    summary: {
      totalUnpaidAmount: priceHidden ? null : totalUnpaidAmount,
      unpaidInvoicesCount,
      unpaidOver30DaysAmount: priceHidden ? null : unpaidOver30DaysAmount,
      unpaidOver30DaysCount,
      paidInPeriodAmount: priceHidden ? null : paidInPeriodAmount,
      paidInPeriodCount,
      totalInvoicedInPeriod: priceHidden ? null : totalInvoicedInPeriod,
    },
    agingBuckets,
    invoices: allValidRows,
    supplierBalances,
  }
}

export interface LossLineComputedRow {
  lineId: string
  exitId: string
  date: string
  productId: string
  productRef: string
  productName: string
  category: string
  unit: string
  wastedQty: number
  unitPrice: number | null
  lossValue: number | null
  destination: string
  reason: string
  createdBy: string
  createdByName: string
}

export interface LossesReportResult {
  priceHidden: boolean
  summary: {
    totalLossValue: number | null
    totalConsumedValue: number | null
    lossRatePct: number | null
    linesCount: number
    totalWastedQty: number
    mostLostProductByValue: {
      productId: string
      name: string
      value: number | null
      qty: number
      unit: string
    } | null
    mostLostProductByQty: {
      productId: string
      name: string
      value: number | null
      qty: number
      unit: string
    } | null
  }
  lines: LossLineComputedRow[]
  charts: {
    evolutionByDay: LossesEvolutionPoint[]
    evolutionByWeek: LossesEvolutionPoint[]
    evolutionByMonth: LossesEvolutionPoint[]
    byProduct: Array<{
      productId: string
      ref: string
      name: string
      unit: string
      wastedQty: number
      lossValue: number | null
    }>
    byReason: Array<{
      reason: string
      count: number
      wastedQty: number
      lossValue: number | null
      sharePct: number | null
    }>
    byDestination: Array<{
      destination: string
      count: number
      wastedQty: number
      lossValue: number | null
      sharePct: number | null
    }>
  }
}

export function computeLossesReport(
  dataset: RawAnalyticsDataset,
  options?: {
    from?: string | null
    to?: string | null
    productId?: string | null
    category?: string | null
    destination?: string | null
    reason?: string | null
    role?: UserRole
  }
): LossesReportResult {
  const role: UserRole = options?.role ?? 'admin'
  const priceHidden = role === 'cuisine'

  const stockMap = computeAllProductsStock({
    products: dataset.products,
    purchases: dataset.purchases,
    purchaseLines: dataset.purchaseLines,
    exits: dataset.exits,
    exitLines: dataset.exitLines,
    inventorySessions: dataset.inventorySessions,
    inventoryLines: dataset.inventoryLines,
  })

  const productById = new Map<string, ProductRecord>()
  for (const p of dataset.products) {
    productById.set(p.id, p)
  }

  const userById = new Map<string, UserRecord>()
  if (Array.isArray(dataset.users)) {
    for (const u of dataset.users) {
      userById.set(u.id, u)
    }
  }

  const reversedExitIds = new Set<string>()
  for (const x of dataset.exits) {
    if (x.reversed_of) {
      reversedExitIds.add(x.reversed_of)
    }
  }

  const validExitById = new Map<string, ExitRecord>()
  for (const x of dataset.exits) {
    if (!isDocumentReversedOrReversal(x, reversedExitIds)) {
      validExitById.set(x.id, x)
    }
  }

  const fromFilter = options?.from?.trim().slice(0, 10) || null
  const toFilter = options?.to?.trim().slice(0, 10) || null
  const productFilter =
    options?.productId && options.productId !== 'all' ? options.productId : null
  const categoryFilter =
    options?.category && options.category !== 'all' ? options.category : null
  const destFilter =
    options?.destination && options.destination !== 'all'
      ? options.destination
      : null
  const reasonFilter =
    options?.reason && options.reason !== 'all' ? options.reason : null

  let totalLossValue = 0
  let totalConsumedValue = 0
  let totalWastedQty = 0
  const lines: LossLineComputedRow[] = []

  const dayMap = new Map<string, { value: number; qty: number }>()
  const weekMap = new Map<string, { value: number; qty: number }>()
  const monthMap = new Map<string, { value: number; qty: number }>()
  const productAgg = new Map<
    string,
    { productId: string; ref: string; name: string; unit: string; qty: number; value: number }
  >()
  const reasonAgg = new Map<
    string,
    { reason: string; count: number; qty: number; value: number }
  >()
  const destAgg = new Map<
    string,
    { destination: string; count: number; qty: number; value: number }
  >()

  for (const line of dataset.exitLines) {
    const header = validExitById.get(line.exit)
    if (!header) continue
    const xDate = (header.date ?? '').trim().slice(0, 10)
    if (fromFilter && xDate < fromFilter) continue
    if (toFilter && xDate > toFilter) continue

    const prod = productById.get(line.product)
    const prodCategory = prod?.category?.trim() || 'Sans catégorie'
    if (productFilter && line.product !== productFilter) continue
    if (categoryFilter && prodCategory !== categoryFilter) continue

    const dest = header.destination?.trim() || 'Non spécifiée'
    if (destFilter && dest !== destFilter) continue

    const stockRes = stockMap.get(line.product)
    const unitCost = stockRes?.averagePrice ?? 0
    const consumedQty = Number(line.qty_consumed ?? 0)
    const wastedQty = Number(line.qty_wasted ?? 0)

    if (consumedQty > 0) {
      totalConsumedValue = roundCurrency(
        totalConsumedValue + consumedQty * unitCost
      )
    }

    if (wastedQty <= 0) continue

    const reason =
      line.loss_reason?.trim() || header.notes?.trim() || 'Non renseigné'
    if (reasonFilter && reason !== reasonFilter) continue

    const lossVal = roundCurrency(wastedQty * unitCost)
    totalLossValue = roundCurrency(totalLossValue + lossVal)
    totalWastedQty = roundQty(totalWastedQty + wastedQty)

    const userObj = header.recorded_by
      ? userById.get(header.recorded_by)
      : undefined
    const createdByName =
      header.recorded_by_name ||
      userObj?.name ||
      header.recorded_by ||
      'Système'

    lines.push({
      lineId: line.id,
      exitId: header.id,
      date: xDate,
      productId: line.product,
      productRef: prod?.ref || '—',
      productName: prod?.name || 'Produit inconnu',
      category: prodCategory,
      unit: prod?.unit || 'u',
      wastedQty: roundQty(wastedQty),
      unitPrice: priceHidden
        ? null
        : stockRes?.averagePrice !== null && stockRes?.averagePrice !== undefined
          ? roundCurrency(stockRes.averagePrice)
          : null,
      lossValue: priceHidden ? null : lossVal,
      destination: dest,
      reason,
      createdBy: header.recorded_by ?? '',
      createdByName,
    })

    // Evolution buckets
    const dEntry = dayMap.get(xDate) ?? { value: 0, qty: 0 }
    dEntry.value = roundCurrency(dEntry.value + lossVal)
    dEntry.qty = roundQty(dEntry.qty + wastedQty)
    dayMap.set(xDate, dEntry)

    const wKey = startOfWeekMondayISO(xDate)
    const wEntry = weekMap.get(wKey) ?? { value: 0, qty: 0 }
    wEntry.value = roundCurrency(wEntry.value + lossVal)
    wEntry.qty = roundQty(wEntry.qty + wastedQty)
    weekMap.set(wKey, wEntry)

    const mKey = xDate.slice(0, 7)
    const mEntry = monthMap.get(mKey) ?? { value: 0, qty: 0 }
    mEntry.value = roundCurrency(mEntry.value + lossVal)
    mEntry.qty = roundQty(mEntry.qty + wastedQty)
    monthMap.set(mKey, mEntry)

    // Product agg
    const pAgg = productAgg.get(line.product) ?? {
      productId: line.product,
      ref: prod?.ref || '—',
      name: prod?.name || 'Produit inconnu',
      unit: prod?.unit || 'u',
      qty: 0,
      value: 0,
    }
    pAgg.qty = roundQty(pAgg.qty + wastedQty)
    pAgg.value = roundCurrency(pAgg.value + lossVal)
    productAgg.set(line.product, pAgg)

    // Reason agg
    const rAgg = reasonAgg.get(reason) ?? {
      reason,
      count: 0,
      qty: 0,
      value: 0,
    }
    rAgg.count += 1
    rAgg.qty = roundQty(rAgg.qty + wastedQty)
    rAgg.value = roundCurrency(rAgg.value + lossVal)
    reasonAgg.set(reason, rAgg)

    // Destination agg
    const dstAgg = destAgg.get(dest) ?? {
      destination: dest,
      count: 0,
      qty: 0,
      value: 0,
    }
    dstAgg.count += 1
    dstAgg.qty = roundQty(dstAgg.qty + wastedQty)
    dstAgg.value = roundCurrency(dstAgg.value + lossVal)
    destAgg.set(dest, dstAgg)
  }

  lines.sort((a, b) => b.date.localeCompare(a.date) || b.lineId.localeCompare(a.lineId))

  const byProductAll = Array.from(productAgg.values())
  const sortedByValue = [...byProductAll].sort(
    (a, b) => b.value - a.value || b.qty - a.qty
  )
  const sortedByQty = [...byProductAll].sort(
    (a, b) => b.qty - a.qty || b.value - a.value
  )

  const topByVal = sortedByValue[0] ?? null
  const topByQty = sortedByQty[0] ?? null

  const lossRatePct =
    priceHidden || totalConsumedValue <= 0
      ? null
      : roundCurrency((totalLossValue / totalConsumedValue) * 100)

  const evolutionByDay: LossesEvolutionPoint[] = Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      bucketKey: date,
      label: formatDateFR(date).slice(0, 5),
      date,
      wastedValue: priceHidden ? null : v.value,
      wastedQty: v.qty,
    }))

  const evolutionByWeek: LossesEvolutionPoint[] = Array.from(weekMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([wDate, v]) => ({
      bucketKey: wDate,
      label: `Sem. ${formatDateFR(wDate).slice(0, 5)}`,
      date: wDate,
      wastedValue: priceHidden ? null : v.value,
      wastedQty: v.qty,
    }))

  const evolutionByMonth: LossesEvolutionPoint[] = Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mKey, v]) => ({
      bucketKey: mKey,
      label: formatMonthKeyFR(mKey),
      date: `${mKey}-01`,
      wastedValue: priceHidden ? null : v.value,
      wastedQty: v.qty,
    }))

  return {
    priceHidden,
    summary: {
      totalLossValue: priceHidden ? null : totalLossValue,
      totalConsumedValue: priceHidden ? null : totalConsumedValue,
      lossRatePct,
      linesCount: lines.length,
      totalWastedQty,
      mostLostProductByValue: topByVal
        ? {
            productId: topByVal.productId,
            name: topByVal.name,
            value: priceHidden ? null : topByVal.value,
            qty: topByVal.qty,
            unit: topByVal.unit,
          }
        : null,
      mostLostProductByQty: topByQty
        ? {
            productId: topByQty.productId,
            name: topByQty.name,
            value: priceHidden ? null : topByQty.value,
            qty: topByQty.qty,
            unit: topByQty.unit,
          }
        : null,
    },
    lines,
    charts: {
      evolutionByDay,
      evolutionByWeek,
      evolutionByMonth,
      byProduct: (priceHidden ? sortedByQty : sortedByValue)
        .slice(0, 10)
        .map((p) => ({
          productId: p.productId,
          ref: p.ref,
          name: p.name,
          unit: p.unit,
          wastedQty: p.qty,
          lossValue: priceHidden ? null : p.value,
        })),
      byReason: Array.from(reasonAgg.values())
        .sort((a, b) => (priceHidden ? b.qty - a.qty : b.value - a.value))
        .map((r) => ({
          reason: r.reason,
          count: r.count,
          wastedQty: r.qty,
          lossValue: priceHidden ? null : r.value,
          sharePct:
            priceHidden || totalLossValue <= 0
              ? totalWastedQty > 0
                ? roundCurrency((r.qty / totalWastedQty) * 100)
                : null
              : roundCurrency((r.value / totalLossValue) * 100),
        })),
      byDestination: Array.from(destAgg.values())
        .sort((a, b) => (priceHidden ? b.qty - a.qty : b.value - a.value))
        .map((d) => ({
          destination: d.destination,
          count: d.count,
          wastedQty: d.qty,
          lossValue: priceHidden ? null : d.value,
          sharePct:
            priceHidden || totalLossValue <= 0
              ? totalWastedQty > 0
                ? roundCurrency((d.qty / totalWastedQty) * 100)
                : null
              : roundCurrency((d.value / totalLossValue) * 100),
        })),
    },
  }
}

export interface ReplenishmentSuggestionRow {
  productId: string
  ref: string
  name: string
  category: string
  unit: string
  location: string
  currentStock: number
  minStock: number
  status: StockStatusLabel
  multiplier: number
  suggestedQty: number
  lastSupplierId: string | null
  lastSupplierName: string | null
  lastUnitPrice: number | null
  averagePrice: number | null
  effectiveUnitPrice: number | null
  estimatedCost: number | null
}

export interface UndefinedMinProductRow {
  productId: string
  ref: string
  name: string
  category: string
  unit: string
  location: string
  currentStock: number
  lastSupplierName: string | null
}

export interface ReplenishmentComputedResult {
  priceHidden: boolean
  defaultMultiplier: number
  alertCount: number
  watchCount: number
  undefinedMinCount: number
  totalEstimatedCost: number | null
  suggestions: ReplenishmentSuggestionRow[]
  undefinedMinProducts: UndefinedMinProductRow[]
}

export function computeReplenishmentSuggestions(
  dataset: RawAnalyticsDataset,
  options?: {
    includeWatch?: boolean
    multiplierOverride?: number | null
    lineMultipliers?: Record<string, number>
    lineQuantities?: Record<string, number>
    lineSuppliers?: Record<string, string>
    categoryFilter?: string | null
    supplierFilter?: string | null
    search?: string | null
    role?: UserRole
  }
): ReplenishmentComputedResult {
  const role: UserRole = options?.role ?? 'admin'
  const priceHidden = role === 'cuisine'
  const includeWatch = Boolean(options?.includeWatch)

  let defaultMultiplier = 2
  if (Array.isArray(dataset.settings)) {
    const multSetting = dataset.settings.find(
      (s) => s.key === 'replenishment_multiplier'
    )
    const parsed = Number(multSetting?.value)
    if (!Number.isNaN(parsed) && parsed > 0) {
      defaultMultiplier = parsed
    }
  }
  if (
    typeof options?.multiplierOverride === 'number' &&
    !Number.isNaN(options.multiplierOverride) &&
    options.multiplierOverride > 0
  ) {
    defaultMultiplier = options.multiplierOverride
  }

  const stockMap = computeAllProductsStock({
    products: dataset.products,
    purchases: dataset.purchases,
    purchaseLines: dataset.purchaseLines,
    exits: dataset.exits,
    exitLines: dataset.exitLines,
    inventorySessions: dataset.inventorySessions,
    inventoryLines: dataset.inventoryLines,
  })

  const supplierById = new Map<string, SupplierRecord>()
  for (const s of dataset.suppliers) {
    supplierById.set(s.id, s)
  }

  // Identify latest purchase per product for last supplier & last unit price
  const reversedPurchaseIds = new Set<string>()
  for (const p of dataset.purchases) {
    if (p.reversed_of) reversedPurchaseIds.add(p.reversed_of)
  }
  const validPurchaseById = new Map<string, PurchaseRecord>()
  for (const p of dataset.purchases) {
    if (!isDocumentReversedOrReversal(p, reversedPurchaseIds)) {
      validPurchaseById.set(p.id, p)
    }
  }

  const lastPurchaseByProduct = new Map<
    string,
    { date: string; supplierId: string; unitPrice: number; lineId: string }
  >()
  for (const line of dataset.purchaseLines) {
    const header = validPurchaseById.get(line.purchase)
    if (!header) continue
    const pDate = (header.date ?? '').trim().slice(0, 10)
    const prev = lastPurchaseByProduct.get(line.product)
    if (
      !prev ||
      pDate > prev.date ||
      (pDate === prev.date && line.id > prev.lineId)
    ) {
      lastPurchaseByProduct.set(line.product, {
        date: pDate,
        supplierId: header.supplier,
        unitPrice: Number(line.unit_price ?? 0),
        lineId: line.id,
      })
    }
  }

  let alertCount = 0
  let watchCount = 0
  let undefinedMinCount = 0
  let totalEstimatedCost = 0

  const suggestions: ReplenishmentSuggestionRow[] = []
  const undefinedMinProducts: UndefinedMinProductRow[] = []

  const catFilter =
    options?.categoryFilter && options.categoryFilter !== 'all'
      ? options.categoryFilter
      : null
  const supFilter =
    options?.supplierFilter && options.supplierFilter !== 'all'
      ? options.supplierFilter
      : null
  const searchNorm = (options?.search ?? '').trim().toLowerCase()

  for (const prod of dataset.products) {
    if (prod.archived) continue
    const sRes = stockMap.get(prod.id)
    if (!sRes) continue

    const lastPur = lastPurchaseByProduct.get(prod.id)
    const defaultSupId = lastPur?.supplierId ?? null
    const chosenSupId = options?.lineSuppliers?.[prod.id] ?? defaultSupId
    const chosenSupName = chosenSupId
      ? (supplierById.get(chosenSupId)?.name ?? null)
      : null

    if (sRes.status === 'Alerte') alertCount += 1
    else if (sRes.status === 'À surveiller') watchCount += 1
    else if (sRes.status === 'À définir') {
      undefinedMinCount += 1
      undefinedMinProducts.push({
        productId: prod.id,
        ref: prod.ref || '—',
        name: prod.name,
        category: prod.category?.trim() || 'Sans catégorie',
        unit: prod.unit || 'u',
        location: prod.location?.trim() || 'Non défini',
        currentStock: sRes.stock,
        lastSupplierName: chosenSupName,
      })
      continue
    }

    const eligible =
      sRes.status === 'Alerte' || (includeWatch && sRes.status === 'À surveiller')
    if (!eligible) continue

    const prodCat = prod.category?.trim() || 'Sans catégorie'
    if (catFilter && prodCat !== catFilter) continue
    if (supFilter && chosenSupId !== supFilter) continue
    if (searchNorm) {
      const hay = `${prod.ref} ${prod.name} ${prodCat} ${chosenSupName ?? ''}`.toLowerCase()
      if (!hay.includes(searchNorm)) continue
    }

    const minStock = Number(prod.min_stock ?? 0)
    const lineMult =
      options?.lineMultipliers?.[prod.id] !== undefined
        ? Number(options.lineMultipliers[prod.id])
        : defaultMultiplier

    // Formula: suggested = max(0, min * multiplier - current)
    const formulaSuggested = roundQty(
      Math.max(0, minStock * lineMult - sRes.stock)
    )
    const suggestedQty =
      options?.lineQuantities?.[prod.id] !== undefined
        ? roundQty(Math.max(0, Number(options.lineQuantities[prod.id])))
        : formulaSuggested

    const lastUnitPrice =
      lastPur && lastPur.unitPrice > 0 ? roundCurrency(lastPur.unitPrice) : null
    const averagePrice =
      sRes.averagePrice !== null ? roundCurrency(sRes.averagePrice) : null
    const effectiveUnitPrice = lastUnitPrice ?? averagePrice

    const estimatedCost =
      effectiveUnitPrice !== null
        ? roundCurrency(suggestedQty * effectiveUnitPrice)
        : null

    if (estimatedCost !== null) {
      totalEstimatedCost = roundCurrency(totalEstimatedCost + estimatedCost)
    }

    suggestions.push({
      productId: prod.id,
      ref: prod.ref || '—',
      name: prod.name,
      category: prodCat,
      unit: prod.unit || 'u',
      location: prod.location?.trim() || 'Non défini',
      currentStock: sRes.stock,
      minStock,
      status: sRes.status,
      multiplier: lineMult,
      suggestedQty,
      lastSupplierId: chosenSupId,
      lastSupplierName: chosenSupName,
      lastUnitPrice: priceHidden ? null : lastUnitPrice,
      averagePrice: priceHidden ? null : averagePrice,
      effectiveUnitPrice: priceHidden ? null : effectiveUnitPrice,
      estimatedCost: priceHidden ? null : estimatedCost,
    })
  }

  suggestions.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'Alerte' ? -1 : 1
    return b.suggestedQty - a.suggestedQty || a.name.localeCompare(b.name, 'fr')
  })

  undefinedMinProducts.sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  return {
    priceHidden,
    defaultMultiplier,
    alertCount,
    watchCount,
    undefinedMinCount,
    totalEstimatedCost: priceHidden ? null : totalEstimatedCost,
    suggestions,
    undefinedMinProducts,
  }
}

export interface StockValuationProductRow {
  productId: string
  ref: string
  name: string
  category: string
  unit: string
  location: string
  stock: number
  minStock: number
  status: StockStatusLabel
  averagePrice: number | null
  stockValue: number | null
  missingPrice: boolean
}

export interface StockValuationAsOfResult {
  asOfDate: string
  priceHidden: boolean
  totalStockValue: number | null
  totalProductsCount: number
  missingPriceCount: number
  byProduct: StockValuationProductRow[]
  byCategory: CategoryStockValuePoint[]
}

export function computeStockValuationAsOfDate(
  dataset: RawAnalyticsDataset,
  options?: {
    asOfDate?: string | null
    category?: string | null
    onlyMissingPrice?: boolean
    role?: UserRole
  }
): StockValuationAsOfResult {
  const role: UserRole = options?.role ?? 'admin'
  const priceHidden = role === 'cuisine'
  const asOfDate = (
    options?.asOfDate?.trim() || new Date().toISOString().slice(0, 10)
  ).slice(0, 10)

  const stockMap = computeAllProductsStock({
    products: dataset.products,
    purchases: dataset.purchases,
    purchaseLines: dataset.purchaseLines,
    exits: dataset.exits,
    exitLines: dataset.exitLines,
    inventorySessions: dataset.inventorySessions,
    inventoryLines: dataset.inventoryLines,
    asOfDate,
  })

  const catFilter =
    options?.category && options.category !== 'all' ? options.category : null

  let totalStockValue = 0
  let missingPriceCount = 0
  const byProduct: StockValuationProductRow[] = []
  const catMap = new Map<
    string,
    { category: string; value: number; count: number; qty: number }
  >()

  for (const prod of dataset.products) {
    if (prod.archived) continue
    const prodCat = prod.category?.trim() || 'Sans catégorie'
    if (catFilter && prodCat !== catFilter) continue

    const sRes = stockMap.get(prod.id)
    if (!sRes) continue

    const isMissingPrice = sRes.averagePrice === null
    if (options?.onlyMissingPrice && !isMissingPrice) continue

    if (isMissingPrice) missingPriceCount += 1
    const val = sRes.stockValue !== null ? roundCurrency(sRes.stockValue) : 0
    if (sRes.stockValue !== null) {
      totalStockValue = roundCurrency(totalStockValue + val)
    }

    byProduct.push({
      productId: prod.id,
      ref: prod.ref || '—',
      name: prod.name,
      category: prodCat,
      unit: prod.unit || 'u',
      location: prod.location?.trim() || 'Non défini',
      stock: sRes.stock,
      minStock: Number(prod.min_stock ?? 0),
      status: sRes.status,
      averagePrice: priceHidden ? null : sRes.averagePrice,
      stockValue: priceHidden ? null : sRes.stockValue,
      missingPrice: isMissingPrice,
    })

    const cAgg = catMap.get(prodCat) ?? {
      category: prodCat,
      value: 0,
      count: 0,
      qty: 0,
    }
    cAgg.value = roundCurrency(cAgg.value + val)
    cAgg.count += 1
    cAgg.qty = roundQty(cAgg.qty + sRes.stock)
    catMap.set(prodCat, cAgg)
  }

  byProduct.sort(
    (a, b) =>
      (b.stockValue ?? 0) - (a.stockValue ?? 0) ||
      a.name.localeCompare(b.name, 'fr')
  )

  const byCategory: CategoryStockValuePoint[] = Array.from(catMap.values())
    .sort((a, b) => b.value - a.value || b.qty - a.qty)
    .map((c) => ({
      category: c.category,
      stockValue: priceHidden ? null : c.value,
      productsCount: c.count,
      totalQty: c.qty,
      sharePct:
        priceHidden || totalStockValue <= 0
          ? null
          : roundCurrency((c.value / totalStockValue) * 100),
    }))

  return {
    asOfDate,
    priceHidden,
    totalStockValue: priceHidden ? null : totalStockValue,
    totalProductsCount: byProduct.length,
    missingPriceCount,
    byProduct,
    byCategory,
  }
}

export interface UnifiedMovementRow {
  id: string
  date: string
  timestamp: string
  type:
    | 'entry'
    | 'exit'
    | 'loss'
    | 'inventory'
    | 'reversal'
    | 'import'
  typeLabel: string
  productId: string
  productRef: string
  productName: string
  category: string
  unit: string
  qtyDelta: number
  stockAfter: number
  unitPrice: number | null
  valueDelta: number | null
  documentId: string
  documentLabel: string
  linkTo: '/entrees-de-stock' | '/sorties-de-stock' | '/inventaires'
  supplierId: string | null
  supplierName: string | null
  userId: string
  userName: string
  isReversedOrReversal: boolean
  reversedOfId: string | null
}

export function computeUnifiedMovementTimeline(
  dataset: RawAnalyticsDataset,
  options?: {
    from?: string | null
    to?: string | null
    type?: 'all' | 'entry' | 'exit' | 'loss' | 'inventory' | 'reversal' | 'import'
    productId?: string | null
    category?: string | null
    supplierId?: string | null
    userId?: string | null
    documentSearch?: string | null
    role?: UserRole
  }
): UnifiedMovementRow[] {
  const role: UserRole = options?.role ?? 'admin'
  const priceHidden = role === 'cuisine'

  const stockMap = computeAllProductsStock({
    products: dataset.products,
    purchases: dataset.purchases,
    purchaseLines: dataset.purchaseLines,
    exits: dataset.exits,
    exitLines: dataset.exitLines,
    inventorySessions: dataset.inventorySessions,
    inventoryLines: dataset.inventoryLines,
  })

  const productById = new Map<string, ProductRecord>()
  for (const p of dataset.products) {
    productById.set(p.id, p)
  }

  const supplierById = new Map<string, SupplierRecord>()
  for (const s of dataset.suppliers) {
    supplierById.set(s.id, s)
  }

  const userById = new Map<string, UserRecord>()
  if (Array.isArray(dataset.users)) {
    for (const u of dataset.users) {
      userById.set(u.id, u)
    }
  }

  const purchaseById = new Map<string, PurchaseRecord>()
  const reversedPurchaseIds = new Set<string>()
  for (const p of dataset.purchases) {
    purchaseById.set(p.id, p)
    if (p.reversed_of) reversedPurchaseIds.add(p.reversed_of)
  }

  const exitById = new Map<string, ExitRecord>()
  const reversedExitIds = new Set<string>()
  for (const x of dataset.exits) {
    exitById.set(x.id, x)
    if (x.reversed_of) reversedExitIds.add(x.reversed_of)
  }

  const sessionById = new Map<string, InventorySessionRecord>()
  for (const s of dataset.inventorySessions) {
    sessionById.set(s.id, s)
  }

  interface RawEvent {
    id: string
    date: string
    timestamp: string
    sortOrder: number
    type: UnifiedMovementRow['type']
    typeLabel: string
    productId: string
    qtyDelta: number
    countedReset: number | null
    unitPrice: number | null
    valueDelta: number | null
    documentId: string
    documentLabel: string
    linkTo: UnifiedMovementRow['linkTo']
    supplierId: string | null
    supplierName: string | null
    userId: string
    userName: string
    isReversedOrReversal: boolean
    reversedOfId: string | null
  }

  const rawEvents: RawEvent[] = []

  // 1. Purchase lines
  for (const line of dataset.purchaseLines) {
    const header = purchaseById.get(line.purchase)
    if (!header) continue
    const pDate = (header.date ?? '').trim().slice(0, 10)
    const isReversal = Boolean(header.reversed_of)
    const isReversed = isDocumentReversedOrReversal(header, reversedPurchaseIds)
    const isImported = Boolean(
      header.notes?.toLowerCase().includes('import excel')
    )
    const type: UnifiedMovementRow['type'] = isReversal
      ? 'reversal'
      : isImported
        ? 'import'
        : 'entry'
    const typeLabel = isReversal
      ? 'Annulation / Correction'
      : isImported
        ? 'Import entrée'
        : 'Entrée de stock'
    const supName = supplierById.get(header.supplier)?.name ?? 'Fournisseur'
    const userObj = header.recorded_by
      ? userById.get(header.recorded_by)
      : undefined
    const userName =
      header.recorded_by_name ||
      userObj?.name ||
      header.recorded_by ||
      'Système'
    const qty = roundQty(Number(line.qty ?? 0))
    const uPrice = roundCurrency(Number(line.unit_price ?? 0))
    const val = roundCurrency(qty * uPrice)

    rawEvents.push({
      id: `pur-${line.id}`,
      date: pDate,
      timestamp: header.created_at || `${pDate}T09:00:00Z`,
      sortOrder: 1,
      type,
      typeLabel,
      productId: line.product,
      qtyDelta: qty,
      countedReset: null,
      unitPrice: priceHidden ? null : uPrice,
      valueDelta: priceHidden ? null : val,
      documentId: header.id,
      documentLabel: header.invoice_no?.trim()
        ? `Facture ${header.invoice_no}`
        : `BL / Entrée ${header.id.slice(0, 6)}`,
      linkTo: '/entrees-de-stock',
      supplierId: header.supplier,
      supplierName: supName,
      userId: header.recorded_by ?? '',
      userName,
      isReversedOrReversal: isReversed,
      reversedOfId: header.reversed_of ?? null,
    })
  }

  // 2. Exit lines (consumed and wasted as distinct movement entries when present)
  for (const line of dataset.exitLines) {
    const header = exitById.get(line.exit)
    if (!header) continue
    const xDate = (header.date ?? '').trim().slice(0, 10)
    const isReversal = Boolean(header.reversed_of)
    const isReversed = isDocumentReversedOrReversal(header, reversedExitIds)
    const userObj = header.recorded_by
      ? userById.get(header.recorded_by)
      : undefined
    const userName =
      header.recorded_by_name ||
      userObj?.name ||
      header.recorded_by ||
      'Système'
    const sRes = stockMap.get(line.product)
    const avgPrice = sRes?.averagePrice ?? null
    const dest = header.destination?.trim() || 'Cuisine'

    const consumed = Number(line.qty_consumed ?? 0)
    const wasted = Number(line.qty_wasted ?? 0)

    if (consumed !== 0) {
      const qtyDelta = roundQty(-consumed)
      const val =
        avgPrice !== null ? roundCurrency(qtyDelta * avgPrice) : null
      rawEvents.push({
        id: `ext-c-${line.id}`,
        date: xDate,
        timestamp: header.created_at || `${xDate}T14:00:00Z`,
        sortOrder: 2,
        type: isReversal ? 'reversal' : 'exit',
        typeLabel: isReversal
          ? 'Annulation sortie'
          : `Sortie (${dest})`,
        productId: line.product,
        qtyDelta,
        countedReset: null,
        unitPrice: priceHidden ? null : avgPrice,
        valueDelta: priceHidden ? null : val,
        documentId: header.id,
        documentLabel: `Sortie ${dest} (${formatDateFR(xDate)})`,
        linkTo: '/sorties-de-stock',
        supplierId: null,
        supplierName: null,
        userId: header.recorded_by ?? '',
        userName,
        isReversedOrReversal: isReversed,
        reversedOfId: header.reversed_of ?? null,
      })
    }

    if (wasted !== 0) {
      const qtyDelta = roundQty(-wasted)
      const val =
        avgPrice !== null ? roundCurrency(qtyDelta * avgPrice) : null
      const reason = line.loss_reason?.trim() || 'Perte'
      rawEvents.push({
        id: `ext-w-${line.id}`,
        date: xDate,
        timestamp: header.created_at || `${xDate}T15:00:00Z`,
        sortOrder: 3,
        type: isReversal ? 'reversal' : 'loss',
        typeLabel: isReversal
          ? 'Annulation perte'
          : `Perte (${reason})`,
        productId: line.product,
        qtyDelta,
        countedReset: null,
        unitPrice: priceHidden ? null : avgPrice,
        valueDelta: priceHidden ? null : val,
        documentId: header.id,
        documentLabel: `Perte ${dest} (${reason})`,
        linkTo: '/sorties-de-stock',
        supplierId: null,
        supplierName: null,
        userId: header.recorded_by ?? '',
        userName,
        isReversedOrReversal: isReversed,
        reversedOfId: header.reversed_of ?? null,
      })
    }
  }

  // 3. Confirmed inventory lines
  for (const line of dataset.inventoryLines) {
    const session = sessionById.get(line.session)
    if (!session || session.status !== 'confirmed') continue
    const sDate = (session.date ?? '').trim().slice(0, 10)
    const userObj = session.confirmed_by
      ? userById.get(session.confirmed_by)
      : session.created_by
        ? userById.get(session.created_by)
        : undefined
    const userName =
      session.confirmed_by_name ||
      session.created_by_name ||
      userObj?.name ||
      session.confirmed_by ||
      session.created_by ||
      'Système'
    const diff = roundQty(Number(line.diff ?? 0))
    const valDiff =
      line.value_diff !== null && line.value_diff !== undefined
        ? roundCurrency(Number(line.value_diff))
        : null
    const sRes = stockMap.get(line.product)

    rawEvents.push({
      id: `inv-${line.id}`,
      date: sDate,
      timestamp: session.confirmed_at || session.created_at || `${sDate}T23:59:00Z`,
      sortOrder: 4,
      type: 'inventory',
      typeLabel: 'Inventaire validé',
      productId: line.product,
      qtyDelta: diff,
      countedReset: roundQty(Number(line.counted ?? 0)),
      unitPrice: priceHidden ? null : (sRes?.averagePrice ?? null),
      valueDelta: priceHidden ? null : valDiff,
      documentId: session.id,
      documentLabel: `Inventaire ${session.scope || 'Complet'} (${formatDateFR(sDate)})`,
      linkTo: '/inventaires',
      supplierId: null,
      supplierName: null,
      userId: session.confirmed_by || session.created_by || '',
      userName,
      isReversedOrReversal: false,
      reversedOfId: null,
    })
  }

  // Sort chronologically ascending per product to compute exact running Stock après
  rawEvents.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.sortOrder - b.sortOrder ||
      a.timestamp.localeCompare(b.timestamp) ||
      a.id.localeCompare(b.id)
  )

  const runningStockByProduct = new Map<string, number>()
  for (const p of dataset.products) {
    runningStockByProduct.set(p.id, roundQty(Number(p.initial_stock ?? 0)))
  }

  const enrichedRows: UnifiedMovementRow[] = []

  for (const ev of rawEvents) {
    const prod = productById.get(ev.productId)
    const currentRun =
      runningStockByProduct.get(ev.productId) ??
      roundQty(Number(prod?.initial_stock ?? 0))

    const nextStock =
      ev.countedReset !== null
        ? ev.countedReset
        : roundQty(currentRun + ev.qtyDelta)
    runningStockByProduct.set(ev.productId, nextStock)

    enrichedRows.push({
      id: ev.id,
      date: ev.date,
      timestamp: ev.timestamp,
      type: ev.type,
      typeLabel: ev.typeLabel,
      productId: ev.productId,
      productRef: prod?.ref || '—',
      productName: prod?.name || 'Produit inconnu',
      category: prod?.category?.trim() || 'Sans catégorie',
      unit: prod?.unit || 'u',
      qtyDelta: ev.qtyDelta,
      stockAfter: nextStock,
      unitPrice: ev.unitPrice,
      valueDelta: ev.valueDelta,
      documentId: ev.documentId,
      documentLabel: ev.documentLabel,
      linkTo: ev.linkTo,
      supplierId: ev.supplierId,
      supplierName: ev.supplierName,
      userId: ev.userId,
      userName: ev.userName,
      isReversedOrReversal: ev.isReversedOrReversal,
      reversedOfId: ev.reversedOfId,
    })
  }

  // Apply filters and sort newest first
  const fromFilter = options?.from?.trim().slice(0, 10) || null
  const toFilter = options?.to?.trim().slice(0, 10) || null
  const typeFilter =
    options?.type && options.type !== 'all' ? options.type : null
  const prodFilter =
    options?.productId && options.productId !== 'all' ? options.productId : null
  const catFilter =
    options?.category && options.category !== 'all' ? options.category : null
  const supFilter =
    options?.supplierId && options.supplierId !== 'all'
      ? options.supplierId
      : null
  const userFilter =
    options?.userId && options.userId !== 'all' ? options.userId : null
  const docSearch = (options?.documentSearch ?? '').trim().toLowerCase()

  return enrichedRows
    .filter((row) => {
      if (fromFilter && row.date < fromFilter) return false
      if (toFilter && row.date > toFilter) return false
      if (typeFilter && row.type !== typeFilter) return false
      if (prodFilter && row.productId !== prodFilter) return false
      if (catFilter && row.category !== catFilter) return false
      if (supFilter && row.supplierId !== supFilter) return false
      if (userFilter && row.userId !== userFilter) return false
      if (docSearch) {
        const hay =
          `${row.documentLabel} ${row.productName} ${row.productRef} ${row.supplierName ?? ''} ${row.userName}`.toLowerCase()
        if (!hay.includes(docSearch)) return false
      }
      return true
    })
    .reverse()
}

