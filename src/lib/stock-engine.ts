import type {
  ExitLineRecord,
  ExitRecord,
  InventoryLineRecord,
  InventorySessionRecord,
  PaymentStatus,
  ProductRecord,
  PurchaseLineRecord,
  PurchaseRecord,
  StockRecalculationDiffItem,
  StockRecalculationReport,
  StockStatusLabel,
  SupplierRecord,
  UserRole,
} from '@/data/types'
import { canApproveNegativeStock } from './rbac'

export interface StockMovementEntry {
  id: string
  productId: string
  date: string // ISO date 'YYYY-MM-DD' or full timestamp 'YYYY-MM-DDTHH:mm:ss.sssZ'
  qty: number
  unitPrice?: number | null
  amount?: number | null
  isReversal?: boolean
  isReversed?: boolean
  reversedOfId?: string | null
  orderIndex?: number | null
}

export interface StockExitEntry {
  id: string
  productId: string
  date: string
  qtyConsumed: number
  qtyWasted: number
  isReversal?: boolean
  isReversed?: boolean
  reversedOfId?: string | null
  orderIndex?: number | null
}

export interface ConfirmedInventoryCount {
  id: string
  sessionId: string
  productId: string
  date: string // Inventory session cutoff date ('YYYY-MM-DD' or same-day ISO timestamp)
  counted: number | null | undefined
  status?: 'draft' | 'confirmed' | 'reversed'
  confirmedAt?: string | null
  confirmedOrder?: number // Stable tie-breaker when two sessions share the same date
}

export interface ProductStockInput {
  id: string
  ref: string
  name: string
  initialStock: number
  minStock: number | null | undefined
}

export interface ProductStockResult {
  productId: string
  normalizedRef: string
  stock: number
  baselineType: 'initial' | 'inventory'
  baselineValue: number
  baselineDate: string | null
  entriesAfterBaseline: number
  consumedAfterBaseline: number
  wastedAfterBaseline: number
  totalEntries: number
  totalConsumed: number
  totalWasted: number
  averagePrice: number | null
  stockValue: number | null
  priceMissing: boolean
  status: StockStatusLabel
  formulaExplanationFR: string
}

/**
 * Normalizes text for instant case-insensitive and accent-insensitive search.
 */
export function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Normalizes a product reference: trimmed and uppercase (case-insensitive matching: p092 = P092).
 */
export function normalizeProductRef(ref: string): string {
  return ref.trim().toUpperCase()
}

/**
 * Suggests the next free product reference automatically (e.g. next number after highest Pxxx).
 */
export function suggestNextProductRef(existingRefs: string[]): string {
  const normalizedSet = new Set(existingRefs.map((r) => normalizeProductRef(r)))
  let maxNum = 0
  let padLen = 3
  let prefix = 'P'

  for (const raw of existingRefs) {
    const clean = normalizeProductRef(raw)
    const match = /^([A-Z]+)(\d+)$/.exec(clean)
    if (match) {
      const pfx = match[1]
      const digits = match[2]
      const num = parseInt(digits, 10)
      if (!Number.isNaN(num) && num >= maxNum) {
        maxNum = num
        prefix = pfx
        padLen = Math.max(3, digits.length)
      }
    }
  }

  let candidateNum = maxNum + 1
  while (true) {
    const candidate = `${prefix}${String(candidateNum).padStart(padLen, '0')}`
    if (!normalizedSet.has(candidate)) {
      return candidate
    }
    candidateNum++
  }
}

/**
 * Normalizes a supplier name for case-insensitive comparison.
 */
export function normalizeSupplierName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Rounds a number to 2 decimal places for financial amounts.
 */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Rounds a quantity to up to 4 decimal places to prevent floating-point drift.
 */
export function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

/**
 * Calculates purchase line amount = qty * unit_price.
 */
export function computePurchaseLineAmount(
  qty: number,
  unitPrice: number
): number {
  if (qty < 0 || unitPrice < 0) {
    throw new Error(
      'La quantité et le prix unitaire doivent être positifs ou nuls.'
    )
  }
  return roundCurrency(qty * unitPrice)
}

/**
 * Maps Excel payment strings ("OUI" / "NON") or status codes to canonical status and French label.
 */
export function parsePaymentStatus(raw: string | null | undefined): {
  status: PaymentStatus
  label: 'Payé' | 'Impayé'
} {
  const normalized = (raw ?? '').trim().toUpperCase()
  if (
    normalized === 'OUI' ||
    normalized === 'PAID' ||
    normalized === 'PAYÉ' ||
    normalized === 'PAYE'
  ) {
    return { status: 'paid', label: 'Payé' }
  }
  return { status: 'unpaid', label: 'Impayé' }
}

export function getPaymentStatusLabel(status: PaymentStatus): 'Payé' | 'Impayé' {
  return status === 'paid' ? 'Payé' : 'Impayé'
}

/**
 * Determines stock status from current stock and min_stock:
 * - À définir if no min_stock is set (null, undefined, or <= 0)
 * - Alerte if stock <= min_stock
 * - À surveiller if stock > min_stock and <= 150% of min_stock
 * - OK if stock > 150% of min_stock
 */
export function computeStockStatus(
  stock: number,
  minStock: number | null | undefined
): StockStatusLabel {
  if (minStock === null || minStock === undefined || minStock <= 0) {
    return 'À définir'
  }
  if (stock <= minStock) {
    return 'Alerte'
  }
  if (stock <= minStock * 1.5) {
    return 'À surveiller'
  }
  return 'OK'
}

/**
 * Formats an ISO date string ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss...') to French 'DD/MM/YYYY'.
 */
export function formatDateCutoffFR(rawDate: string | null | undefined): string {
  if (!rawDate) return '—'
  const day = rawDate.trim().slice(0, 10)
  const parts = day.split('-')
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`
  }
  return day
}

/**
 * Resolves the effective cutoff date string for a confirmed inventory session:
 * - If `confirmed_at` is a full timestamp on the SAME calendar day as `session.date`,
 *   returns `confirmed_at` so timestamped same-day movements after the confirmation are included.
 * - Otherwise (e.g. imported day-only session or a session dated `D` that was confirmed on a later day),
 *   returns `session.date` so cutoff comparison is anchored to the inventory count's date `D`.
 */
export function resolveInventorySessionCutoffDate(session: {
  date: string
  confirmed_at?: string | null
}): string {
  const sessionDate = (session.date || '').trim()
  const confirmedAt = (session.confirmed_at || '').trim()
  if (
    confirmedAt.length > 10 &&
    sessionDate.length >= 10 &&
    confirmedAt.slice(0, 10) === sessionDate.slice(0, 10)
  ) {
    return confirmedAt
  }
  return sessionDate || confirmedAt
}

/**
 * Compares movement date against the confirmed inventory baseline date.
 * - Imported Excel rows have day-level dates ('YYYY-MM-DD'): movements strictly after
 *   the inventory date (movementDate > baselineDate) are included after the cutoff.
 *   A movement dated the same day as the count is treated as already included in the count,
 *   matching the Excel workbook's `SUMIFS(..., ">" & DateInventaire)` formula.
 * - Full ISO timestamps ('YYYY-MM-DDTHH:mm:ss...') on the same day are compared chronologically
 *   (with optional stable event order index tie-breaker).
 */
export function isMovementAfterInventoryCutoff(
  movementDate: string,
  inventoryCutoffDate: string,
  movementOrderIndex?: number | null,
  countOrderIndex?: number | null
): boolean {
  const mov = movementDate.trim()
  const cut = inventoryCutoffDate.trim()

  // If both are day-only strings (YYYY-MM-DD, length 10), compare day strings directly
  if (mov.length === 10 && cut.length === 10) {
    return mov > cut
  }

  // If cutoff is day-only (e.g. inventory on '2026-03-15') and movement has timestamp:
  // compare the calendar day prefix against cutoff day
  if (cut.length === 10 && mov.length > 10) {
    const movDay = mov.slice(0, 10)
    return movDay > cut
  }

  // If movement is day-only (e.g. imported movement on '2026-03-15') and cutoff has timestamp:
  // a day-only movement on the same day as the inventory is treated as already included in the count
  if (mov.length === 10 && cut.length > 10) {
    const cutDay = cut.slice(0, 10)
    return mov > cutDay
  }

  const movTime = Date.parse(mov)
  const cutTime = Date.parse(cut)
  if (!Number.isNaN(movTime) && !Number.isNaN(cutTime)) {
    if (movTime !== cutTime) {
      return movTime > cutTime
    }
    if (
      movementOrderIndex !== undefined &&
      movementOrderIndex !== null &&
      countOrderIndex !== undefined &&
      countOrderIndex !== null
    ) {
      return movementOrderIndex > countOrderIndex
    }
    return false
  }

  return mov > cut
}

/**
 * Finds the single LATEST confirmed inventory count for a product.
 * - Never sums multiple inventory counts.
 * - Strictly ignores draft/reversed counts and uncounted lines (counted === null/undefined).
 */
export function getLatestConfirmedCount(
  productId: string,
  confirmedCounts: ConfirmedInventoryCount[]
): (ConfirmedInventoryCount & { counted: number }) | null {
  const productCounts = confirmedCounts.filter(
    (c): c is ConfirmedInventoryCount & { counted: number } =>
      c.productId === productId &&
      (!c.status || c.status === 'confirmed') &&
      c.counted !== null &&
      c.counted !== undefined &&
      !Number.isNaN(Number(c.counted))
  )
  if (productCounts.length === 0) return null

  const sorted = [...productCounts].sort((a, b) => {
    const dayA = a.date.trim().slice(0, 10)
    const dayB = b.date.trim().slice(0, 10)
    if (dayA !== dayB) {
      return dayA > dayB ? -1 : 1
    }
    const dateA = a.date.trim()
    const dateB = b.date.trim()
    if (dateA !== dateB) {
      return dateA > dateB ? -1 : 1
    }
    const confA = (a.confirmedAt ?? '').trim()
    const confB = (b.confirmedAt ?? '').trim()
    if (confA !== confB) {
      return confA > confB ? -1 : 1
    }
    const orderA = a.confirmedOrder ?? 0
    const orderB = b.confirmedOrder ?? 0
    if (orderA !== orderB) {
      return orderB - orderA
    }
    return b.id.localeCompare(a.id)
  })

  return sorted[0] ?? null
}

/**
 * Calculates the Weighted Average Price (PMP) from valid priced purchases.
 * - Only purchases with unitPrice > 0 are included in the weighted average.
 * - Reversed purchases (and their reversal entries) are strictly excluded.
 * - If total valid purchased quantity is <= 0, returns null (flagged "Prix manquant").
 */
export function computeWeightedAveragePrice(
  productId: string,
  entries: StockMovementEntry[]
): number | null {
  const productEntries = entries.filter((e) => e.productId === productId)

  // Identify IDs that have been reversed so we exclude both original and reversal from PMP
  const reversedOriginalIds = new Set(
    productEntries
      .filter((e) => e.reversedOfId)
      .map((e) => e.reversedOfId as string)
  )

  let totalAmount = 0
  let totalQty = 0

  for (const entry of productEntries) {
    if (entry.isReversal || entry.isReversed || entry.reversedOfId) continue
    if (reversedOriginalIds.has(entry.id)) continue

    const unitPrice = entry.unitPrice ?? 0
    if (entry.qty > 0 && unitPrice > 0) {
      const lineAmount =
        entry.amount !== undefined && entry.amount !== null
          ? entry.amount
          : entry.qty * unitPrice
      totalAmount += lineAmount
      totalQty += entry.qty
    }
  }

  if (totalQty <= 0 || totalAmount <= 0) {
    return null
  }

  return roundCurrency(totalAmount / totalQty)
}

/**
 * Computes full stock state for a single product according to MONARQ ÉCONOMAT rules:
 * - Without a confirmed count: stock = initial_stock + entries - consumed - wasted
 * - With a confirmed count: stock = latest_confirmed_count + entries_after - consumed_after - wasted_after
 * - Uses only the LATEST confirmed count per product, never a sum of counts.
 * - Ignores reversed documents (and their reversals) in all totals.
 * - Weighted average price = total valid purchase amount / total purchased quantity (priced purchases only).
 * - Stock value = quantity * average price (or null with priceMissing = true if no cost).
 */
export function computeProductStock(
  product: ProductStockInput,
  entries: StockMovementEntry[],
  exits: StockExitEntry[],
  confirmedCounts: ConfirmedInventoryCount[]
): ProductStockResult {
  const latestCount = getLatestConfirmedCount(product.id, confirmedCounts)

  const productEntries = entries.filter((e) => e.productId === product.id)
  const productExits = exits.filter((x) => x.productId === product.id)

  // Identify reversed original document IDs so both the reversed document and its reversal are excluded in all totals
  const reversedEntryIds = new Set(
    productEntries
      .filter((e) => e.reversedOfId)
      .map((e) => e.reversedOfId as string)
  )
  const reversedExitIds = new Set(
    productExits
      .filter((x) => x.reversedOfId)
      .map((x) => x.reversedOfId as string)
  )

  let entriesAfterBaseline = 0
  let consumedAfterBaseline = 0
  let wastedAfterBaseline = 0

  let totalEntries = 0
  let totalConsumed = 0
  let totalWasted = 0

  for (const entry of productEntries) {
    if (
      entry.isReversal ||
      entry.isReversed ||
      Boolean(entry.reversedOfId) ||
      reversedEntryIds.has(entry.id)
    ) {
      continue
    }
    totalEntries += entry.qty
    const include = latestCount
      ? isMovementAfterInventoryCutoff(
          entry.date,
          latestCount.date,
          entry.orderIndex,
          latestCount.confirmedOrder
        )
      : true
    if (include) {
      entriesAfterBaseline += entry.qty
    }
  }

  for (const exit of productExits) {
    if (
      exit.isReversal ||
      exit.isReversed ||
      Boolean(exit.reversedOfId) ||
      reversedExitIds.has(exit.id)
    ) {
      continue
    }
    totalConsumed += exit.qtyConsumed
    totalWasted += exit.qtyWasted
    const include = latestCount
      ? isMovementAfterInventoryCutoff(
          exit.date,
          latestCount.date,
          exit.orderIndex,
          latestCount.confirmedOrder
        )
      : true
    if (include) {
      consumedAfterBaseline += exit.qtyConsumed
      wastedAfterBaseline += exit.qtyWasted
    }
  }

  entriesAfterBaseline = roundQty(entriesAfterBaseline)
  consumedAfterBaseline = roundQty(consumedAfterBaseline)
  wastedAfterBaseline = roundQty(wastedAfterBaseline)

  totalEntries = roundQty(totalEntries)
  totalConsumed = roundQty(totalConsumed)
  totalWasted = roundQty(totalWasted)

  const baselineType = latestCount ? 'inventory' : 'initial'
  const baselineValue = latestCount
    ? roundQty(latestCount.counted)
    : roundQty(product.initialStock)
  const baselineDate = latestCount ? latestCount.date : null

  const stock = roundQty(
    baselineValue +
      entriesAfterBaseline -
      consumedAfterBaseline -
      wastedAfterBaseline
  )

  const averagePrice = computeWeightedAveragePrice(product.id, entries)
  const priceMissing = averagePrice === null
  const stockValue =
    averagePrice !== null ? roundCurrency(stock * averagePrice) : null

  const status = computeStockStatus(stock, product.minStock)

  const formulaExplanationFR =
    baselineType === 'inventory' && baselineDate
      ? `Dernier inventaire ${formatDateCutoffFR(baselineDate)} : ${baselineValue} + entrées ${entriesAfterBaseline} − sorties ${consumedAfterBaseline} − pertes ${wastedAfterBaseline} = ${stock}`
      : `Stock initial : ${baselineValue} + entrées ${entriesAfterBaseline} − sorties ${consumedAfterBaseline} − pertes ${wastedAfterBaseline} = ${stock}`

  return {
    productId: product.id,
    normalizedRef: normalizeProductRef(product.ref),
    stock,
    baselineType,
    baselineValue,
    baselineDate,
    entriesAfterBaseline,
    consumedAfterBaseline,
    wastedAfterBaseline,
    totalEntries,
    totalConsumed,
    totalWasted,
    averagePrice,
    stockValue,
    priceMissing,
    status,
    formulaExplanationFR,
  }
}

/**
 * Validates whether a proposed stock exit would result in negative stock,
 * and enforces the business rule:
 * "Block negative stock unless the user is manager/admin and confirms with a reason."
 */
export function validateNegativeStockGuard(params: {
  currentStock: number
  requestedDeduction: number
  userRole: UserRole | null | undefined
  negativeStockReason?: string | null
}): {
  allowed: boolean
  projectedStock: number
  requiresManagerOverride: boolean
  errorMessage?: string
} {
  const projectedStock = roundQty(
    params.currentStock - params.requestedDeduction
  )

  if (projectedStock >= 0) {
    return {
      allowed: true,
      projectedStock,
      requiresManagerOverride: false,
    }
  }

  // Projected stock is negative (< 0)
  if (!canApproveNegativeStock(params.userRole)) {
    return {
      allowed: false,
      projectedStock,
      requiresManagerOverride: true,
      errorMessage: `Stock insuffisant (stock actuel : ${params.currentStock}, demandé : ${params.requestedDeduction}). Seul un Manager ou Administrateur peut autoriser un stock négatif avec un motif.`,
    }
  }

  const reason = (params.negativeStockReason ?? '').trim()
  if (!reason) {
    return {
      allowed: false,
      projectedStock,
      requiresManagerOverride: true,
      errorMessage:
        'Un motif obligatoire doit être renseigné pour confirmer un mouvement entraînant un stock négatif.',
    }
  }

  return {
    allowed: true,
    projectedStock,
    requiresManagerOverride: true,
  }
}

export type LedgerMovementKind =
  | 'initial'
  | 'purchase'
  | 'purchase_reversal'
  | 'consumption'
  | 'loss'
  | 'exit_reversal'
  | 'inventory'

export interface ProductLedgerMovement {
  id: string
  date: string
  kind: LedgerMovementKind
  label: string
  referenceDoc: string
  counterparty: string
  qtyDelta: number
  runningStock: number
  unitPrice: number | null
  amount: number | null
  notes: string
}

export interface ProductRecentPurchaseItem {
  lineId: string
  purchaseId: string
  date: string
  supplierId: string
  supplierName: string
  invoiceNo: string
  qty: number
  unitPrice: number
  amount: number
  paymentStatus: PaymentStatus
  isReversal: boolean
}

export interface ProductLossItem {
  lineId: string
  exitId: string
  date: string
  destination: string
  qtyWasted: number
  unitCost: number | null
  estimatedLossValue: number | null
  notes: string
}

export interface ProductInventoryItem {
  lineId: string
  sessionId: string
  date: string
  status: string
  theoretical: number
  counted: number
  diff: number
  valueDiff: number | null
  confirmedBy: string | null
  comment?: string | null
}

export interface ProductMonthlyConsumptionPoint {
  monthKey: string // YYYY-MM
  monthLabel: string // e.g. 03/2026
  consumed: number
  wasted: number
}

export interface ProductPriceHistoryPoint {
  date: string
  dateLabel: string
  unitPrice: number
  supplierName: string
  qty: number
}

export interface ProductDetailLedgerResult {
  stockResult: ProductStockResult
  hasMovements: boolean
  lastPurchase: {
    date: string
    supplierId: string
    supplierName: string
    unitPrice: number
    qty: number
    invoiceNo: string
  } | null
  lastInventory: {
    date: string
    theoretical: number
    counted: number
    diff: number
    valueDiff: number | null
  } | null
  movements: ProductLedgerMovement[]
  recentPurchases: ProductRecentPurchaseItem[]
  losses: ProductLossItem[]
  inventories: ProductInventoryItem[]
  monthlyConsumption: ProductMonthlyConsumptionPoint[]
  priceHistory: ProductPriceHistoryPoint[]
}

/**
 * Computes the complete movement history, running stock, charts, and summary cards
 * for a single product detail page.
 */
export function computeProductDetailLedger(params: {
  product: ProductRecord
  purchases: PurchaseRecord[]
  purchaseLines: PurchaseLineRecord[]
  exits: ExitRecord[]
  exitLines: ExitLineRecord[]
  inventorySessions: InventorySessionRecord[]
  inventoryLines: InventoryLineRecord[]
  suppliers: SupplierRecord[]
}): ProductDetailLedgerResult {
  const {
    product,
    purchases,
    purchaseLines,
    exits,
    exitLines,
    inventorySessions,
    inventoryLines,
    suppliers,
  } = params

  const purchaseMap = new Map(purchases.map((p) => [p.id, p]))
  const exitMap = new Map(exits.map((x) => [x.id, x]))
  const sessionMap = new Map(inventorySessions.map((s) => [s.id, s]))
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]))

  const prodPurchaseLines = purchaseLines.filter(
    (pl) => pl.product === product.id
  )
  const prodExitLines = exitLines.filter((xl) => xl.product === product.id)
  const prodInventoryLines = inventoryLines.filter(
    (il) => il.product === product.id
  )

  const hasMovements =
    prodPurchaseLines.length > 0 ||
    prodExitLines.length > 0 ||
    prodInventoryLines.length > 0

  const stockEntries: StockMovementEntry[] = prodPurchaseLines.map((pl) => {
    const h = purchaseMap.get(pl.purchase)
    return {
      id: pl.purchase,
      productId: pl.product,
      date: h?.date ?? pl.created_at,
      qty: pl.qty,
      unitPrice: pl.unit_price,
      amount: pl.amount,
      isReversal: Boolean(h?.reversed_of),
      isReversed:
        h?.correction_status === 'reversed' ||
        h?.correction_status === 'corrected',
      reversedOfId: h?.reversed_of ?? null,
      orderIndex: pl.order_index ?? h?.order_index ?? null,
    }
  })

  const stockExits: StockExitEntry[] = prodExitLines.map((xl) => {
    const h = exitMap.get(xl.exit)
    return {
      id: xl.exit,
      productId: xl.product,
      date: h?.date ?? xl.created_at,
      qtyConsumed: xl.qty_consumed,
      qtyWasted: xl.qty_wasted,
      isReversal: Boolean(h?.reversed_of),
      isReversed:
        h?.correction_status === 'reversed' ||
        h?.correction_status === 'corrected',
      reversedOfId: h?.reversed_of ?? null,
      orderIndex: xl.order_index ?? h?.order_index ?? null,
    }
  })

  const confirmedCounts: ConfirmedInventoryCount[] = prodInventoryLines
    .map((il, idx): ConfirmedInventoryCount | null => {
      const s = sessionMap.get(il.session)
      if (!s || s.status !== 'confirmed') return null
      if (il.counted === null || il.counted === undefined) return null
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
    .filter((x): x is ConfirmedInventoryCount => x !== null)

  const stockResult = computeProductStock(
    {
      id: product.id,
      ref: product.ref,
      name: product.name,
      initialStock: product.initial_stock,
      minStock: product.min_stock,
    },
    stockEntries,
    stockExits,
    confirmedCounts
  )

  // Recent purchases (newest first)
  const reversedPurchaseIds = new Set(
    purchases.filter((p) => p.reversed_of).map((p) => p.reversed_of as string)
  )

  const recentPurchases: ProductRecentPurchaseItem[] = prodPurchaseLines
    .map((pl) => {
      const h = purchaseMap.get(pl.purchase)
      const sup = h ? supplierMap.get(h.supplier) : undefined
      return {
        lineId: pl.id,
        purchaseId: pl.purchase,
        date: h?.date ?? pl.created_at,
        supplierId: h?.supplier ?? '',
        supplierName: sup?.name ?? 'Fournisseur inconnu',
        invoiceNo: h?.invoice_no || '—',
        qty: pl.qty,
        unitPrice: pl.unit_price,
        amount: pl.amount,
        paymentStatus: h?.payment_status ?? 'unpaid',
        isReversal: Boolean(h?.reversed_of),
        orderIndex: pl.order_index ?? h?.order_index ?? 0,
      }
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? -1 : 1
      return b.orderIndex - a.orderIndex
    })

  // Last valid (non-reversed) purchase
  const validPurchases = recentPurchases.filter(
    (rp) =>
      !rp.isReversal &&
      !reversedPurchaseIds.has(rp.purchaseId) &&
      rp.qty > 0
  )
  const lastPurchase =
    validPurchases.length > 0
      ? {
          date: validPurchases[0].date,
          supplierId: validPurchases[0].supplierId,
          supplierName: validPurchases[0].supplierName,
          unitPrice: validPurchases[0].unitPrice,
          qty: validPurchases[0].qty,
          invoiceNo: validPurchases[0].invoiceNo,
        }
      : null

  // Inventories for this product (newest first, excluding drafts unless confirmed/reversed)
  const inventories: ProductInventoryItem[] = prodInventoryLines
    .filter((il) => {
      const s = sessionMap.get(il.session)
      return s && s.status !== 'draft' && il.counted !== null && il.counted !== undefined
    })
    .map((il) => {
      const s = sessionMap.get(il.session)
      return {
        lineId: il.id,
        sessionId: il.session,
        date: s?.date || s?.confirmed_at || il.created_at,
        status: s?.status ?? 'confirmed',
        theoretical: il.theoretical,
        counted: il.counted,
        diff: il.diff,
        valueDiff:
          il.value_diff !== null && il.value_diff !== undefined
            ? il.value_diff
            : stockResult.averagePrice !== null
              ? roundCurrency(il.diff * stockResult.averagePrice)
              : null,
        confirmedBy: s?.confirmed_by_name || s?.confirmed_by || null,
        comment: il.comment ?? null,
      }
    })
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0))

  const confirmedInventories = inventories.filter(
    (inv) => inv.status === 'confirmed'
  )
  const lastInventory =
    confirmedInventories.length > 0
      ? {
          date: confirmedInventories[0].date,
          theoretical: confirmedInventories[0].theoretical,
          counted: confirmedInventories[0].counted,
          diff: confirmedInventories[0].diff,
          valueDiff: confirmedInventories[0].valueDiff,
        }
      : null

  // Losses (exit lines where qty_wasted !== 0)
  const losses: ProductLossItem[] = prodExitLines
    .filter((xl) => xl.qty_wasted !== 0)
    .map((xl) => {
      const h = exitMap.get(xl.exit)
      const unitCost = xl.unit_cost_snapshot ?? stockResult.averagePrice
      return {
        lineId: xl.id,
        exitId: xl.exit,
        date: h?.date ?? xl.created_at,
        destination: h?.destination ?? 'Cuisine',
        qtyWasted: xl.qty_wasted,
        unitCost,
        estimatedLossValue:
          unitCost !== null ? roundCurrency(xl.qty_wasted * unitCost) : null,
        notes: h?.notes ?? '',
      }
    })
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0))

  // Price history (chronological oldest -> newest for chart)
  const priceHistory: ProductPriceHistoryPoint[] = [...validPurchases]
    .filter((vp) => vp.unitPrice > 0)
    .reverse()
    .map((vp) => {
      const day = vp.date.slice(0, 10)
      const parts = day.split('-')
      const dateLabel =
        parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : day
      return {
        date: vp.date,
        dateLabel,
        unitPrice: vp.unitPrice,
        supplierName: vp.supplierName,
        qty: vp.qty,
      }
    })

  // Monthly consumption chart (group by YYYY-MM)
  const monthlyMap = new Map<
    string,
    { consumed: number; wasted: number }
  >()
  for (const xl of prodExitLines) {
    const h = exitMap.get(xl.exit)
    const dateStr = (h?.date ?? xl.created_at).slice(0, 7) // YYYY-MM
    if (!dateStr || dateStr.length < 7) continue
    const bucket = monthlyMap.get(dateStr) ?? { consumed: 0, wasted: 0 }
    bucket.consumed = roundQty(bucket.consumed + xl.qty_consumed)
    bucket.wasted = roundQty(bucket.wasted + xl.qty_wasted)
    monthlyMap.set(dateStr, bucket)
  }

  const monthlyConsumption: ProductMonthlyConsumptionPoint[] = Array.from(
    monthlyMap.entries()
  )
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([monthKey, vals]) => {
      const [y, m] = monthKey.split('-')
      return {
        monthKey,
        monthLabel: m && y ? `${m}/${y}` : monthKey,
        consumed: vals.consumed,
        wasted: vals.wasted,
      }
    })

  // Build chronological movement ledger with running stock
  interface RawEvent {
    id: string
    date: string
    sortPriority: number // 0 = initial, 1 = purchase, 2 = exit, 3 = inventory (end of day cutoff)
    orderIndex: number
    kind: LedgerMovementKind
    label: string
    referenceDoc: string
    counterparty: string
    qtyDelta: number
    inventoryCounted?: number
    unitPrice: number | null
    amount: number | null
    notes: string
  }

  const rawEvents: RawEvent[] = []

  // Initial stock event
  rawEvents.push({
    id: `init-${product.id}`,
    date: '0000-01-01',
    sortPriority: 0,
    orderIndex: 0,
    kind: 'initial',
    label: 'Stock initial',
    referenceDoc: product.ref,
    counterparty: 'Ouverture',
    qtyDelta: product.initial_stock,
    unitPrice: null,
    amount: null,
    notes: 'Stock de départ de la fiche produit',
  })

  for (const pl of prodPurchaseLines) {
    const h = purchaseMap.get(pl.purchase)
    const sup = h ? supplierMap.get(h.supplier) : undefined
    const isRev = Boolean(h?.reversed_of)
    rawEvents.push({
      id: pl.id,
      date: h?.date ?? pl.created_at,
      sortPriority: 1,
      orderIndex: pl.order_index ?? h?.order_index ?? 0,
      kind: isRev ? 'purchase_reversal' : 'purchase',
      label: isRev ? 'Contre-passation achat' : 'Entrée stock (Achat)',
      referenceDoc: h?.invoice_no || pl.purchase.slice(0, 8),
      counterparty: sup?.name ?? 'Fournisseur',
      qtyDelta: pl.qty,
      unitPrice: pl.unit_price,
      amount: pl.amount,
      notes: h?.notes ?? '',
    })
  }

  for (const xl of prodExitLines) {
    const h = exitMap.get(xl.exit)
    const isRev = Boolean(h?.reversed_of)
    if (xl.qty_consumed !== 0) {
      rawEvents.push({
        id: `${xl.id}-cons`,
        date: h?.date ?? xl.created_at,
        sortPriority: 2,
        orderIndex: xl.order_index ?? h?.order_index ?? 0,
        kind: isRev ? 'exit_reversal' : 'consumption',
        label: isRev ? 'Contre-passation sortie' : 'Sortie consommation',
        referenceDoc: xl.exit.slice(0, 8),
        counterparty: h?.destination ?? 'Cuisine',
        qtyDelta: -xl.qty_consumed,
        unitPrice: xl.unit_cost_snapshot,
        amount:
          xl.unit_cost_snapshot !== null
            ? roundCurrency(Math.abs(xl.qty_consumed) * xl.unit_cost_snapshot)
            : null,
        notes: h?.notes ?? '',
      })
    }
    if (xl.qty_wasted !== 0) {
      rawEvents.push({
        id: `${xl.id}-loss`,
        date: h?.date ?? xl.created_at,
        sortPriority: 2,
        orderIndex: (xl.order_index ?? h?.order_index ?? 0) + 0.5,
        kind: isRev ? 'exit_reversal' : 'loss',
        label: isRev ? 'Contre-passation perte' : 'Perte / Casse',
        referenceDoc: xl.exit.slice(0, 8),
        counterparty: h?.destination ?? 'Cuisine',
        qtyDelta: -xl.qty_wasted,
        unitPrice: xl.unit_cost_snapshot,
        amount:
          xl.unit_cost_snapshot !== null
            ? roundCurrency(Math.abs(xl.qty_wasted) * xl.unit_cost_snapshot)
            : null,
        notes: h?.notes ?? '',
      })
    }
  }

  for (const il of prodInventoryLines) {
    const s = sessionMap.get(il.session)
    if (!s || s.status !== 'confirmed') continue
    rawEvents.push({
      id: il.id,
      date: s.confirmed_at || s.date,
      sortPriority: 3, // Inventory count resets baseline at the end of its cutoff date
      orderIndex: il.order_index ?? 0,
      kind: 'inventory',
      label: 'Comptage inventaire confirmé',
      referenceDoc: s.id.slice(0, 8),
      counterparty: s.confirmed_by || 'Inventaire',
      qtyDelta: il.diff,
      inventoryCounted: il.counted,
      unitPrice: stockResult.averagePrice,
      amount: il.value_diff,
      notes: `Théorique: ${il.theoretical} → Compté: ${il.counted} (Écart: ${il.diff > 0 ? `+${il.diff}` : il.diff})`,
    })
  }

  rawEvents.sort((a, b) => {
    const dayA = a.date.slice(0, 10)
    const dayB = b.date.slice(0, 10)
    if (dayA !== dayB) return dayA < dayB ? -1 : 1
    if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    return a.orderIndex - b.orderIndex
  })

  let running = 0
  const chronologicalMovements: ProductLedgerMovement[] = rawEvents.map((ev) => {
    if (ev.kind === 'initial') {
      running = roundQty(ev.qtyDelta)
      return {
        id: ev.id,
        date: product.created_at,
        kind: ev.kind,
        label: ev.label,
        referenceDoc: ev.referenceDoc,
        counterparty: ev.counterparty,
        qtyDelta: ev.qtyDelta,
        runningStock: running,
        unitPrice: ev.unitPrice,
        amount: ev.amount,
        notes: ev.notes,
      }
    }
    if (ev.kind === 'inventory' && ev.inventoryCounted !== undefined) {
      const delta = roundQty(ev.inventoryCounted - running)
      running = roundQty(ev.inventoryCounted)
      return {
        id: ev.id,
        date: ev.date,
        kind: ev.kind,
        label: ev.label,
        referenceDoc: ev.referenceDoc,
        counterparty: ev.counterparty,
        qtyDelta: delta,
        runningStock: running,
        unitPrice: ev.unitPrice,
        amount: ev.amount,
        notes: ev.notes,
      }
    }
    running = roundQty(running + ev.qtyDelta)
    return {
      id: ev.id,
      date: ev.date,
      kind: ev.kind,
      label: ev.label,
      referenceDoc: ev.referenceDoc,
      counterparty: ev.counterparty,
      qtyDelta: ev.qtyDelta,
      runningStock: running,
      unitPrice: ev.unitPrice,
      amount: ev.amount,
      notes: ev.notes,
    }
  })

  return {
    stockResult,
    hasMovements,
    lastPurchase,
    lastInventory,
    movements: chronologicalMovements.reverse(), // Display newest first while preserving chronological runningStock
    recentPurchases,
    losses,
    inventories,
    monthlyConsumption,
    priceHistory,
  }
}

export interface SupplierSummaryMetrics {
  supplierId: string
  totalPurchases: number
  unpaidBalance: number
  invoicesCount: number
  unpaidInvoicesCount: number
  lastPurchaseDate: string | null
  purchasedProductIds: Set<string>
}

/**
 * Computes aggregates for all suppliers:
 * - Total purchases (all non-reversed purchases)
 * - Unpaid balance (exact sum of unpaid non-reversed purchase amounts)
 * - Number of invoices and last purchase date
 * - Set of product IDs ever purchased from each supplier (used for Produits filter)
 */
export function computeSupplierAggregates(
  suppliers: SupplierRecord[],
  purchases: PurchaseRecord[],
  purchaseLines: PurchaseLineRecord[]
): Map<string, SupplierSummaryMetrics> {
  const result = new Map<string, SupplierSummaryMetrics>()

  for (const s of suppliers) {
    result.set(s.id, {
      supplierId: s.id,
      totalPurchases: 0,
      unpaidBalance: 0,
      invoicesCount: 0,
      unpaidInvoicesCount: 0,
      lastPurchaseDate: null,
      purchasedProductIds: new Set<string>(),
    })
  }

  // Identify reversed purchase headers so we exclude both original and reversal
  const reversedOriginalIds = new Set(
    purchases.filter((p) => p.reversed_of).map((p) => p.reversed_of as string)
  )

  // Group line totals and product IDs by purchase header
  const purchaseTotals = new Map<string, number>()
  const purchaseProducts = new Map<string, string[]>()

  for (const line of purchaseLines) {
    const prevTotal = purchaseTotals.get(line.purchase) ?? 0
    const lineAmount =
      line.amount !== undefined && line.amount !== null
        ? line.amount
        : roundCurrency(line.qty * line.unit_price)
    purchaseTotals.set(line.purchase, roundCurrency(prevTotal + lineAmount))

    const prods = purchaseProducts.get(line.purchase) ?? []
    prods.push(line.product)
    purchaseProducts.set(line.purchase, prods)
  }

  for (const p of purchases) {
    if (p.reversed_of || reversedOriginalIds.has(p.id)) {
      continue
    }

    let metrics = result.get(p.supplier)
    if (!metrics) {
      metrics = {
        supplierId: p.supplier,
        totalPurchases: 0,
        unpaidBalance: 0,
        invoicesCount: 0,
        unpaidInvoicesCount: 0,
        lastPurchaseDate: null,
        purchasedProductIds: new Set<string>(),
      }
      result.set(p.supplier, metrics)
    }

    const docAmount = purchaseTotals.get(p.id) ?? 0
    metrics.totalPurchases = roundCurrency(metrics.totalPurchases + docAmount)
    metrics.invoicesCount += 1

    if (p.payment_status === 'unpaid') {
      metrics.unpaidBalance = roundCurrency(metrics.unpaidBalance + docAmount)
      metrics.unpaidInvoicesCount += 1
    }

    if (
      !metrics.lastPurchaseDate ||
      p.date.trim() > metrics.lastPurchaseDate
    ) {
      metrics.lastPurchaseDate = p.date.trim()
    }

    const prods = purchaseProducts.get(p.id) ?? []
    for (const prodId of prods) {
      metrics.purchasedProductIds.add(prodId)
    }
  }

  return result
}

export interface SupplierPurchaseDocumentItem {
  id: string
  date: string
  invoiceNo: string
  paymentStatus: PaymentStatus
  paymentDate: string | null
  totalAmount: number
  linesCount: number
  notes: string
  isReversed: boolean
  isReversal: boolean
}

export interface SupplierPurchasedProductItem {
  productId: string
  ref: string
  name: string
  category: string
  unit: string
  totalQty: number
  totalAmount: number
  lastPurchaseDate: string
  lastPrice: number
  previousPrice: number | null
  priceVariationPct: number | null
}

export interface SupplierDetailSummary {
  totalAllTime: number
  totalSelectedPeriod: number
  unpaidBalance: number
  invoicesCount: number
  unpaidInvoicesCount: number
  lastPurchaseDate: string | null
  purchaseDocuments: SupplierPurchaseDocumentItem[]
  unpaidDocuments: SupplierPurchaseDocumentItem[]
  purchasedProducts: SupplierPurchasedProductItem[]
}

/**
 * Computes full detail for a single supplier page, including period total,
 * unpaid invoices, and purchased products with last price and price variation.
 */
export function computeSupplierDetail(params: {
  supplierId: string
  purchases: PurchaseRecord[]
  purchaseLines: PurchaseLineRecord[]
  products: ProductRecord[]
  periodStartDate?: string | null // YYYY-MM-DD
  periodEndDate?: string | null // YYYY-MM-DD
}): SupplierDetailSummary {
  const {
    supplierId,
    purchases,
    purchaseLines,
    products,
    periodStartDate,
    periodEndDate,
  } = params

  const reversedOriginalIds = new Set(
    purchases.filter((p) => p.reversed_of).map((p) => p.reversed_of as string)
  )

  const supplierPurchases = purchases.filter((p) => p.supplier === supplierId)
  const supplierPurchaseIds = new Set(supplierPurchases.map((p) => p.id))

  const linesByPurchase = new Map<string, PurchaseLineRecord[]>()
  for (const pl of purchaseLines) {
    if (!supplierPurchaseIds.has(pl.purchase)) continue
    const arr = linesByPurchase.get(pl.purchase) ?? []
    arr.push(pl)
    linesByPurchase.set(pl.purchase, arr)
  }

  let totalAllTime = 0
  let totalSelectedPeriod = 0
  let unpaidBalance = 0
  let invoicesCount = 0
  let unpaidInvoicesCount = 0
  let lastPurchaseDate: string | null = null

  const purchaseDocuments: SupplierPurchaseDocumentItem[] = supplierPurchases
    .map((p) => {
      const lines = linesByPurchase.get(p.id) ?? []
      const docAmount = roundCurrency(
        lines.reduce(
          (sum, l) =>
            sum +
            (l.amount !== undefined && l.amount !== null
              ? l.amount
              : roundCurrency(l.qty * l.unit_price)),
          0
        )
      )
      const isReversal = Boolean(p.reversed_of)
      const isReversed = reversedOriginalIds.has(p.id)

      if (!isReversal && !isReversed) {
        totalAllTime = roundCurrency(totalAllTime + docAmount)
        invoicesCount += 1

        const day = p.date.slice(0, 10)
        const afterStart = !periodStartDate || day >= periodStartDate
        const beforeEnd = !periodEndDate || day <= periodEndDate
        if (afterStart && beforeEnd) {
          totalSelectedPeriod = roundCurrency(totalSelectedPeriod + docAmount)
        }

        if (p.payment_status === 'unpaid') {
          unpaidBalance = roundCurrency(unpaidBalance + docAmount)
          unpaidInvoicesCount += 1
        }

        if (!lastPurchaseDate || p.date > lastPurchaseDate) {
          lastPurchaseDate = p.date
        }
      }

      return {
        id: p.id,
        date: p.date,
        invoiceNo: p.invoice_no || '—',
        paymentStatus: p.payment_status,
        paymentDate: p.payment_date,
        totalAmount: docAmount,
        linesCount: lines.length,
        notes: p.notes ?? '',
        isReversed,
        isReversal,
      }
    })
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0))

  const unpaidDocuments = purchaseDocuments.filter(
    (doc) =>
      !doc.isReversed && !doc.isReversal && doc.paymentStatus === 'unpaid'
  )

  // Compute purchased products with last price and price variation
  const productMap = new Map(products.map((pr) => [pr.id, pr]))
  const purchaseMap = new Map(supplierPurchases.map((p) => [p.id, p]))

  const productPurchasesMap = new Map<
    string,
    Array<{
      date: string
      orderIndex: number
      qty: number
      unitPrice: number
      amount: number
    }>
  >()

  for (const pl of purchaseLines) {
    if (!supplierPurchaseIds.has(pl.purchase)) continue
    const header = purchaseMap.get(pl.purchase)
    if (!header || header.reversed_of || reversedOriginalIds.has(header.id)) {
      continue
    }
    if (pl.qty <= 0) continue

    const list = productPurchasesMap.get(pl.product) ?? []
    list.push({
      date: header.date,
      orderIndex: pl.order_index ?? header.order_index ?? 0,
      qty: pl.qty,
      unitPrice: pl.unit_price,
      amount:
        pl.amount !== undefined && pl.amount !== null
          ? pl.amount
          : roundCurrency(pl.qty * pl.unit_price),
    })
    productPurchasesMap.set(pl.product, list)
  }

  const purchasedProducts: SupplierPurchasedProductItem[] = []

  for (const [productId, entries] of productPurchasesMap.entries()) {
    const prod = productMap.get(productId)
    // Sort newest first
    const sorted = [...entries].sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? -1 : 1
      return b.orderIndex - a.orderIndex
    })

    const totalQty = roundQty(sorted.reduce((s, e) => s + e.qty, 0))
    const totalAmount = roundCurrency(sorted.reduce((s, e) => s + e.amount, 0))
    const pricedEntries = sorted.filter((e) => e.unitPrice > 0)
    const lastPrice = pricedEntries[0]?.unitPrice ?? 0
    const previousPrice =
      pricedEntries.length > 1 ? pricedEntries[1].unitPrice : null
    const priceVariationPct =
      previousPrice !== null && previousPrice > 0
        ? roundCurrency(((lastPrice - previousPrice) / previousPrice) * 100)
        : null

    purchasedProducts.push({
      productId,
      ref: prod?.ref ?? '—',
      name: prod?.name ?? 'Produit inconnu',
      category: prod?.category || 'Sans catégorie',
      unit: prod?.unit ?? 'u',
      totalQty,
      totalAmount,
      lastPurchaseDate: sorted[0].date,
      lastPrice,
      previousPrice,
      priceVariationPct,
    })
  }

  purchasedProducts.sort((a, b) => b.totalAmount - a.totalAmount)

  return {
    totalAllTime,
    totalSelectedPeriod,
    unpaidBalance,
    invoicesCount,
    unpaidInvoicesCount,
    lastPurchaseDate,
    purchaseDocuments,
    unpaidDocuments,
    purchasedProducts,
  }
}

/**
 * Finds existing suppliers whose names are near-duplicates of `candidateName`
 * (e.g. "Boxy" vs "BOXY", "Boxy SARL", or edit distance <= 2) so the UI can warn
 * the user and offer to merge duplicates.
 */
export function findNearDuplicateSuppliers(
  candidateName: string,
  suppliers: SupplierRecord[],
  excludeSupplierId?: string
): SupplierRecord[] {
  const cleanCandidate = normalizeSearchText(candidateName).replace(
    /[^a-z0-9]/g,
    ''
  )
  if (cleanCandidate.length < 2) return []

  return suppliers.filter((s) => {
    if (s.archived) return false
    if (excludeSupplierId && s.id === excludeSupplierId) return false
    const cleanExisting = normalizeSearchText(s.name).replace(/[^a-z0-9]/g, '')
    if (!cleanExisting) return false
    if (cleanExisting === cleanCandidate) return true
    if (
      cleanCandidate.length >= 3 &&
      cleanExisting.length >= 3 &&
      (cleanExisting.includes(cleanCandidate) ||
        cleanCandidate.includes(cleanExisting))
    ) {
      return true
    }
    return false
  })
}

/**
 * Checks whether a purchase line unit price differs by more than 30% from the
 * product's weighted average price (warns, does not block).
 */
export function checkPriceDeviationWarning(
  unitPrice: number,
  averagePrice: number | null | undefined
): {
  hasWarning: boolean
  deviationPct: number | null
} {
  if (
    averagePrice === null ||
    averagePrice === undefined ||
    averagePrice <= 0 ||
    unitPrice <= 0
  ) {
    return { hasWarning: false, deviationPct: null }
  }
  const diffRatio = (unitPrice - averagePrice) / averagePrice
  const deviationPct = roundCurrency(diffRatio * 100)
  return {
    hasWarning: Math.abs(diffRatio) > 0.3,
    deviationPct,
  }
}

/**
 * Finds non-reversed existing purchase documents that have the same date (YYYY-MM-DD),
 * same supplier, and same total amount (within 0.01 MAD) to warn against accidental double entry.
 */
export function findSimilarPurchaseDocuments(
  candidate: {
    date: string
    supplierId: string
    totalAmount: number
  },
  existingPurchases: PurchaseRecord[],
  existingLines: PurchaseLineRecord[]
): PurchaseRecord[] {
  const candidateDay = candidate.date.trim().slice(0, 10)
  if (!candidateDay || !candidate.supplierId || candidate.totalAmount <= 0) {
    return []
  }

  const reversedOriginals = new Set(
    existingPurchases
      .filter((p) => p.reversed_of)
      .map((p) => p.reversed_of as string)
  )

  const totalsByPurchase = new Map<string, number>()
  for (const l of existingLines) {
    const prev = totalsByPurchase.get(l.purchase) ?? 0
    const amt =
      l.amount !== undefined && l.amount !== null
        ? l.amount
        : roundCurrency(l.qty * l.unit_price)
    totalsByPurchase.set(l.purchase, roundCurrency(prev + amt))
  }

  return existingPurchases.filter((p) => {
    if (p.reversed_of || reversedOriginals.has(p.id)) return false
    if (p.correction_status === 'reversed' || p.correction_status === 'corrected') {
      return false
    }
    if (p.supplier !== candidate.supplierId) return false
    if (p.date.trim().slice(0, 10) !== candidateDay) return false
    const total = totalsByPurchase.get(p.id) ?? 0
    return Math.abs(total - candidate.totalAmount) <= 0.01
  })
}

/**
 * Checks whether a document dated `docDate` falls on or before a confirmed inventory count
 * for any of its `productIds`. Reversing a movement before a confirmed inventory cutoff
 * requires a warning and manager/admin approval.
 */
export function checkDocumentBeforeInventoryCutoff(
  docDate: string,
  productIds: string[],
  confirmedCounts: ConfirmedInventoryCount[]
): {
  isBeforeCutoff: boolean
  latestCutoffDate: string | null
} {
  let latestCutoffDate: string | null = null
  let isBeforeCutoff = false

  for (const pid of productIds) {
    const latest = getLatestConfirmedCount(pid, confirmedCounts)
    if (!latest) continue
    if (!isMovementAfterInventoryCutoff(docDate, latest.date)) {
      isBeforeCutoff = true
      if (!latestCutoffDate || latest.date > latestCutoffDate) {
        latestCutoffDate = latest.date
      }
    }
  }

  return { isBeforeCutoff, latestCutoffDate }
}

/**
 * Recomputes stock state ONLY for the specified `targetProductIds` (not the entire database),
 * and updates the in-memory stock cache for those products.
 */
const stockCacheMap = new Map<string, ProductStockResult>()

export function getStockCacheSnapshot(): Map<string, ProductStockResult> {
  return new Map(stockCacheMap)
}

export function clearStockCache(): void {
  stockCacheMap.clear()
}

export function computeTargetedProductsStock(params: {
  targetProductIds: string[]
  products: ProductRecord[]
  purchases: PurchaseRecord[]
  purchaseLines: PurchaseLineRecord[]
  exits: ExitRecord[]
  exitLines: ExitLineRecord[]
  inventorySessions: InventorySessionRecord[]
  inventoryLines: InventoryLineRecord[]
  asOfDate?: string | null
  excludeSessionId?: string | null
  skipCacheUpdate?: boolean
}): Map<string, ProductStockResult> {
  const targetSet = new Set(params.targetProductIds)
  const result = new Map<string, ProductStockResult>()
  if (targetSet.size === 0) return result

  const asOfDay = params.asOfDate ? params.asOfDate.trim().slice(0, 10) : null

  const purchaseMap = new Map(params.purchases.map((p) => [p.id, p]))
  const exitMap = new Map(params.exits.map((x) => [x.id, x]))
  const sessionMap = new Map(params.inventorySessions.map((s) => [s.id, s]))

  const entriesByProd = new Map<string, StockMovementEntry[]>()
  const exitsByProd = new Map<string, StockExitEntry[]>()
  const countsByProd = new Map<string, ConfirmedInventoryCount[]>()

  for (const pl of params.purchaseLines) {
    if (!targetSet.has(pl.product)) continue
    const h = purchaseMap.get(pl.purchase)
    const movDate = h?.date ?? pl.created_at
    if (asOfDay && movDate.trim().slice(0, 10) > asOfDay) continue

    const arr = entriesByProd.get(pl.product) ?? []
    arr.push({
      id: pl.purchase,
      productId: pl.product,
      date: movDate,
      qty: pl.qty,
      unitPrice: pl.unit_price,
      amount: pl.amount,
      isReversal: Boolean(h?.reversed_of),
      isReversed:
        h?.correction_status === 'reversed' ||
        h?.correction_status === 'corrected',
      reversedOfId: h?.reversed_of ?? null,
      orderIndex: pl.order_index ?? h?.order_index ?? null,
    })
    entriesByProd.set(pl.product, arr)
  }

  for (const xl of params.exitLines) {
    if (!targetSet.has(xl.product)) continue
    const h = exitMap.get(xl.exit)
    const movDate = h?.date ?? xl.created_at
    if (asOfDay && movDate.trim().slice(0, 10) > asOfDay) continue

    const arr = exitsByProd.get(xl.product) ?? []
    arr.push({
      id: xl.exit,
      productId: xl.product,
      date: movDate,
      qtyConsumed: xl.qty_consumed,
      qtyWasted: xl.qty_wasted,
      isReversal: Boolean(h?.reversed_of),
      isReversed:
        h?.correction_status === 'reversed' ||
        h?.correction_status === 'corrected',
      reversedOfId: h?.reversed_of ?? null,
      orderIndex: xl.order_index ?? h?.order_index ?? null,
    })
    exitsByProd.set(xl.product, arr)
  }

  params.inventoryLines.forEach((il, idx) => {
    if (!targetSet.has(il.product)) return
    if (params.excludeSessionId && il.session === params.excludeSessionId) return
    if (il.counted === null || il.counted === undefined) return
    const s = sessionMap.get(il.session)
    if (!s || s.status !== 'confirmed') return
    if (asOfDay && s.date.trim().slice(0, 10) > asOfDay) return

    const arr = countsByProd.get(il.product) ?? []
    arr.push({
      id: il.id,
      sessionId: s.id,
      productId: il.product,
      date: resolveInventorySessionCutoffDate(s),
      counted: il.counted,
      status: s.status,
      confirmedAt: s.confirmed_at ?? s.date,
      confirmedOrder: il.order_index ?? idx,
    })
    countsByProd.set(il.product, arr)
  })

  for (const p of params.products) {
    if (!targetSet.has(p.id)) continue
    const computed = computeProductStock(
      {
        id: p.id,
        ref: p.ref,
        name: p.name,
        initialStock: p.initial_stock,
        minStock: p.min_stock,
      },
      entriesByProd.get(p.id) ?? [],
      exitsByProd.get(p.id) ?? [],
      countsByProd.get(p.id) ?? []
    )
    result.set(p.id, computed)
    if (!params.asOfDate && !params.excludeSessionId && !params.skipCacheUpdate) {
      stockCacheMap.set(p.id, computed)
    }
  }

  return result
}

/**
 * Computes stock for all products (and updates the stock cache).
 */
export function computeAllProductsStock(params: {
  products: ProductRecord[]
  purchases: PurchaseRecord[]
  purchaseLines: PurchaseLineRecord[]
  exits: ExitRecord[]
  exitLines: ExitLineRecord[]
  inventorySessions: InventorySessionRecord[]
  inventoryLines: InventoryLineRecord[]
  asOfDate?: string | null
  excludeSessionId?: string | null
}): Map<string, ProductStockResult> {
  return computeTargetedProductsStock({
    ...params,
    targetProductIds: params.products.map((p) => p.id),
  })
}

/**
 * Rebuilds stock for all products from scratch from movements and confirmed counts,
 * compares against cached values, updates the cache, and returns a diff report.
 */
export function rebuildAndCompareStockCache(params: {
  products: ProductRecord[]
  purchases: PurchaseRecord[]
  purchaseLines: PurchaseLineRecord[]
  exits: ExitRecord[]
  exitLines: ExitLineRecord[]
  inventorySessions: InventorySessionRecord[]
  inventoryLines: InventoryLineRecord[]
}): StockRecalculationReport {
  const previousCache = new Map(stockCacheMap)
  const freshMap = computeTargetedProductsStock({
    ...params,
    targetProductIds: params.products.map((p) => p.id),
    skipCacheUpdate: true,
  })

  const differences: StockRecalculationDiffItem[] = []
  let totalStockValue = 0
  let alertCount = 0
  let watchCount = 0
  let missingPriceCount = 0
  let missingMinCount = 0

  for (const product of params.products) {
    const fresh = freshMap.get(product.id)
    if (!fresh) continue

    const prev = previousCache.get(product.id)
    if (prev) {
      const stockChanged = Math.abs(prev.stock - fresh.stock) > 0.0001
      const priceChanged =
        (prev.averagePrice ?? -1) !== (fresh.averagePrice ?? -1)
      const valChanged = (prev.stockValue ?? -1) !== (fresh.stockValue ?? -1)
      if (stockChanged || priceChanged || valChanged) {
        differences.push({
          productId: product.id,
          ref: product.ref,
          name: product.name,
          previousStock: prev.stock,
          newStock: fresh.stock,
          previousAvgPrice: prev.averagePrice,
          newAvgPrice: fresh.averagePrice,
          previousValue: prev.stockValue,
          newValue: fresh.stockValue,
        })
      }
    }

    stockCacheMap.set(product.id, fresh)

    if (!product.archived) {
      if (fresh.stockValue !== null) {
        totalStockValue = roundCurrency(totalStockValue + fresh.stockValue)
      }
      if (fresh.status === 'Alerte') alertCount++
      if (fresh.status === 'À surveiller') watchCount++
      if (fresh.priceMissing) missingPriceCount++
      if (fresh.status === 'À définir') missingMinCount++
    }
  }

  return {
    recalculatedAt: new Date().toISOString(),
    totalProductsChecked: params.products.length,
    differencesCount: differences.length,
    differences,
    totalStockValue,
    alertCount,
    watchCount,
    missingPriceCount,
    missingMinCount,
  }
}


