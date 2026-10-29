import { describe, expect, it } from 'vitest'
import {
  computeProductStock,
  computePurchaseLineAmount,
  computeStockStatus,
  computeWeightedAveragePrice,
  getLatestConfirmedCount,
  normalizeProductRef,
  parsePaymentStatus,
  validateNegativeStockGuard,
} from './stock-engine'

describe('Stock Engine (Business Rules)', () => {
  it('normalizes product references case-insensitively and trims whitespace (p092 = P092)', () => {
    expect(normalizeProductRef(' p092 ')).toBe('P092')
    expect(normalizeProductRef('P092')).toBe('P092')
    expect(normalizeProductRef('   p092\t')).toBe(normalizeProductRef('P092'))
  })

  it('calculates stock without a confirmed inventory count: initial + entries - consumed - wasted', () => {
    const product = {
      id: 'prod-1',
      ref: 'p001',
      name: 'Huile d’olive Vierge',
      initialStock: 10,
      minStock: 5,
    }

    const entries = [
      { id: 'e1', productId: 'prod-1', date: '2026-01-10', qty: 20, unitPrice: 80 },
      { id: 'e2', productId: 'prod-1', date: '2026-01-15', qty: 10, unitPrice: 95 },
    ]

    const exits = [
      { id: 'x1', productId: 'prod-1', date: '2026-01-12', qtyConsumed: 8, qtyWasted: 1 },
      { id: 'x2', productId: 'prod-1', date: '2026-01-18', qtyConsumed: 6, qtyWasted: 0.5 },
    ]

    const result = computeProductStock(product, entries, exits, [])

    // 10 + (20 + 10) - (8 + 6) - (1 + 0.5) = 24.5
    expect(result.baselineType).toBe('initial')
    expect(result.baselineValue).toBe(10)
    expect(result.entriesAfterBaseline).toBe(30)
    expect(result.consumedAfterBaseline).toBe(14)
    expect(result.wastedAfterBaseline).toBe(1.5)
    expect(result.stock).toBe(24.5)
  })

  it('calculates stock with a confirmed inventory count using only movements AFTER cutoff', () => {
    const product = {
      id: 'prod-2',
      ref: 'P092',
      name: 'Farine T45',
      initialStock: 50,
      minStock: 20,
    }

    const entries = [
      // Before or on cutoff date (2026-02-01) -> ignored after baseline
      { id: 'e1', productId: 'prod-2', date: '2026-01-20', qty: 100, unitPrice: 10 },
      { id: 'e2', productId: 'prod-2', date: '2026-02-01', qty: 25, unitPrice: 10 },
      // Strictly after cutoff date -> included
      { id: 'e3', productId: 'prod-2', date: '2026-02-05', qty: 40, unitPrice: 12 },
    ]

    const exits = [
      // On or before cutoff -> ignored
      { id: 'x1', productId: 'prod-2', date: '2026-01-25', qtyConsumed: 60, qtyWasted: 2 },
      { id: 'x2', productId: 'prod-2', date: '2026-02-01', qtyConsumed: 10, qtyWasted: 0 },
      // Strictly after cutoff -> included
      { id: 'x3', productId: 'prod-2', date: '2026-02-06', qtyConsumed: 15, qtyWasted: 3 },
    ]

    const confirmedCounts = [
      {
        id: 'inv-line-1',
        sessionId: 'sess-1',
        productId: 'prod-2',
        date: '2026-02-01',
        counted: 80,
      },
    ]

    const result = computeProductStock(product, entries, exits, confirmedCounts)

    // Baseline = 80 (from 2026-02-01 count), + 40 (entry on Feb 05) - 15 (consumed Feb 06) - 3 (wasted Feb 06) = 102
    expect(result.baselineType).toBe('inventory')
    expect(result.baselineValue).toBe(80)
    expect(result.baselineDate).toBe('2026-02-01')
    expect(result.entriesAfterBaseline).toBe(40)
    expect(result.consumedAfterBaseline).toBe(15)
    expect(result.wastedAfterBaseline).toBe(3)
    expect(result.stock).toBe(102)
  })

  it('uses ONLY the latest confirmed inventory count per product, never a sum of counts', () => {
    const product = {
      id: 'prod-3',
      ref: 'P050',
      name: 'Beurre Doux',
      initialStock: 15,
      minStock: 10,
    }

    const confirmedCounts = [
      {
        id: 'inv-jan',
        sessionId: 'sess-jan',
        productId: 'prod-3',
        date: '2026-01-31',
        counted: 30,
        confirmedOrder: 1,
      },
      {
        id: 'inv-feb',
        sessionId: 'sess-feb',
        productId: 'prod-3',
        date: '2026-02-28',
        counted: 18,
        confirmedOrder: 2,
      },
      {
        id: 'inv-mar',
        sessionId: 'sess-mar',
        productId: 'prod-3',
        date: '2026-03-31',
        counted: 22,
        confirmedOrder: 3,
      },
    ]

    const latest = getLatestConfirmedCount('prod-3', confirmedCounts)
    expect(latest?.id).toBe('inv-mar')
    expect(latest?.counted).toBe(22)

    const entries = [
      { id: 'e-feb', productId: 'prod-3', date: '2026-02-15', qty: 50, unitPrice: 90 },
      { id: 'e-apr', productId: 'prod-3', date: '2026-04-02', qty: 10, unitPrice: 90 },
    ]
    const exits = [
      { id: 'x-apr', productId: 'prod-3', date: '2026-04-03', qtyConsumed: 4, qtyWasted: 1 },
    ]

    const result = computeProductStock(product, entries, exits, confirmedCounts)
    // Must start from 22 (NOT 30+18+22=70), then +10 -4 -1 = 27
    expect(result.baselineValue).toBe(22)
    expect(result.stock).toBe(27)
  })

  it('computes weighted average price (PMP) from valid priced purchases and flags missing price', () => {
    const entries = [
      // 10 units @ 50 DH = 500 DH
      { id: 'p1', productId: 'prod-a', date: '2026-01-01', qty: 10, unitPrice: 50 },
      // 30 units @ 70 DH = 2100 DH
      { id: 'p2', productId: 'prod-a', date: '2026-01-10', qty: 30, unitPrice: 70 },
      // Unpriced bonus/sample line (unitPrice: 0) -> excluded from PMP
      { id: 'p3', productId: 'prod-a', date: '2026-01-12', qty: 5, unitPrice: 0 },
    ]

    // Total valid amount = 2600 DH, total valid qty = 40 -> PMP = 65.00 DH
    const avgPrice = computeWeightedAveragePrice('prod-a', entries)
    expect(avgPrice).toBe(65)

    // Product with no priced purchases -> null and priceMissing: true
    const noCostProduct = {
      id: 'prod-no-cost',
      ref: 'P999',
      name: 'Article sans prix',
      initialStock: 12,
      minStock: 5,
    }
    const noCostResult = computeProductStock(noCostProduct, [], [], [])
    expect(noCostResult.averagePrice).toBeNull()
    expect(noCostResult.stockValue).toBeNull()
    expect(noCostResult.priceMissing).toBe(true)
  })

  it('evaluates stock status thresholds: Alerte (<= min), À surveiller (<= 150% min), OK (> 150% min), À définir', () => {
    // minStock = 10 -> 150% of min = 15
    expect(computeStockStatus(0, 10)).toBe('Alerte')
    expect(computeStockStatus(10, 10)).toBe('Alerte')
    expect(computeStockStatus(10.5, 10)).toBe('À surveiller')
    expect(computeStockStatus(15, 10)).toBe('À surveiller')
    expect(computeStockStatus(15.01, 10)).toBe('OK')
    expect(computeStockStatus(40, 10)).toBe('OK')

    // Missing minStock -> À définir
    expect(computeStockStatus(10, null)).toBe('À définir')
    expect(computeStockStatus(10, undefined)).toBe('À définir')
    expect(computeStockStatus(10, 0)).toBe('À définir')
  })

  it('maps payment statuses OUI -> Payé and NON -> Impayé and calculates line amount', () => {
    expect(parsePaymentStatus('OUI')).toEqual({ status: 'paid', label: 'Payé' })
    expect(parsePaymentStatus('oui ')).toEqual({ status: 'paid', label: 'Payé' })
    expect(parsePaymentStatus('NON')).toEqual({
      status: 'unpaid',
      label: 'Impayé',
    })
    expect(parsePaymentStatus('')).toEqual({
      status: 'unpaid',
      label: 'Impayé',
    })

    expect(computePurchaseLineAmount(12.5, 18.4)).toBe(230)
  })

  it('blocks negative stock for non-managers and requires a reason for manager/admin', () => {
    // Sufficient stock -> allowed for everyone
    expect(
      validateNegativeStockGuard({
        currentStock: 10,
        requestedDeduction: 6,
        userRole: 'cuisine',
      }).allowed
    ).toBe(true)

    // Negative stock -> blocked for cuisine & economat even with reason
    const cuisineGuard = validateNegativeStockGuard({
      currentStock: 4,
      requestedDeduction: 6,
      userRole: 'cuisine',
      negativeStockReason: 'Urgence service soir',
    })
    expect(cuisineGuard.allowed).toBe(false)
    expect(cuisineGuard.projectedStock).toBe(-2)

    const economatGuard = validateNegativeStockGuard({
      currentStock: 4,
      requestedDeduction: 6,
      userRole: 'economat',
      negativeStockReason: 'Livraison non encore saisie',
    })
    expect(economatGuard.allowed).toBe(false)

    // Manager without reason -> blocked
    const managerNoReason = validateNegativeStockGuard({
      currentStock: 4,
      requestedDeduction: 6,
      userRole: 'manager',
      negativeStockReason: '   ',
    })
    expect(managerNoReason.allowed).toBe(false)

    // Manager with reason -> allowed
    const managerWithReason = validateNegativeStockGuard({
      currentStock: 4,
      requestedDeduction: 6,
      userRole: 'manager',
      negativeStockReason: 'BL fournisseur reçu mais en attente de saisie',
    })
    expect(managerWithReason.allowed).toBe(true)
    expect(managerWithReason.projectedStock).toBe(-2)
  })
})
