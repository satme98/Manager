import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryDataRepository } from '@/data/memory-adapter'
import { canAccessRoute } from '@/lib/rbac'
import {
  clearStockCache,
  computeAllProductsStock,
  computeProductStock,
  computeStockStatus,
  computeWeightedAveragePrice,
} from '@/lib/stock-engine'
import { useAuthStore } from '@/stores/auth-store'

describe('Stage 6 — Stock Engine & Physical Inventories (9 Fixed Test Scenarios)', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
    clearStockCache()
    useAuthStore.getState().auth.reset()
  })

  it('Scenario 1 — No count: initial 10 + entries 5 − consumed 3 − wasted 1 = 11', () => {
    const product = {
      id: 'prod-s1',
      ref: 'P101',
      name: 'Riz Basmati 5kg',
      initialStock: 10,
      minStock: 4,
    }

    const entries = [
      {
        id: 'ent-1',
        productId: 'prod-s1',
        date: '2026-03-05',
        qty: 5,
        unitPrice: 90,
      },
    ]

    const exits = [
      {
        id: 'ext-1',
        productId: 'prod-s1',
        date: '2026-03-08',
        qtyConsumed: 3,
        qtyWasted: 1,
      },
    ]

    const res = computeProductStock(product, entries, exits, [])

    expect(res.baselineType).toBe('initial')
    expect(res.baselineValue).toBe(10)
    expect(res.entriesAfterBaseline).toBe(5)
    expect(res.consumedAfterBaseline).toBe(3)
    expect(res.wastedAfterBaseline).toBe(1)
    expect(res.stock).toBe(11)
    expect(res.formulaExplanationFR).toContain(
      'Stock initial : 10 + entrées 5 − sorties 3 − pertes 1 = 11'
    )
  })

  it('Scenario 2 — With count: count 20 on day D, entries 4 and exits 6 after D -> 18; movements before D are ignored', () => {
    const dayD = '2026-04-10'
    const product = {
      id: 'prod-s2',
      ref: 'P102',
      name: 'Beurre Gastronomique',
      initialStock: 50,
      minStock: 10,
    }

    const entries = [
      // Before D -> ignored after baseline
      {
        id: 'ent-before',
        productId: 'prod-s2',
        date: '2026-04-02',
        qty: 30,
        unitPrice: 80,
      },
      // After D -> included (+4)
      {
        id: 'ent-after',
        productId: 'prod-s2',
        date: '2026-04-12',
        qty: 4,
        unitPrice: 80,
      },
    ]

    const exits = [
      // Before D -> ignored after baseline
      {
        id: 'ext-before',
        productId: 'prod-s2',
        date: '2026-04-05',
        qtyConsumed: 25,
        qtyWasted: 2,
      },
      // After D -> included (-5 consumed -1 wasted = -6 exits)
      {
        id: 'ext-after',
        productId: 'prod-s2',
        date: '2026-04-14',
        qtyConsumed: 5,
        qtyWasted: 1,
      },
    ]

    const confirmedCounts = [
      {
        id: 'cnt-d',
        sessionId: 'sess-d',
        productId: 'prod-s2',
        date: dayD,
        counted: 20,
        status: 'confirmed' as const,
      },
    ]

    const res = computeProductStock(product, entries, exits, confirmedCounts)

    expect(res.baselineType).toBe('inventory')
    expect(res.baselineDate).toBe(dayD)
    expect(res.baselineValue).toBe(20)
    expect(res.entriesAfterBaseline).toBe(4)
    expect(res.consumedAfterBaseline + res.wastedAfterBaseline).toBe(6)
    expect(res.stock).toBe(18)
    expect(res.formulaExplanationFR).toContain(
      'Dernier inventaire 10/04/2026 : 20 + entrées 4 − sorties 5 − pertes 1 = 18'
    )
  })

  it('Scenario 3 — Two counts for one product: only the latest confirmed one is used (never a sum of counts)', () => {
    const product = {
      id: 'prod-s3',
      ref: 'P103',
      name: 'Filet de Bœuf',
      initialStock: 15,
      minStock: 5,
    }

    const confirmedCounts = [
      {
        id: 'cnt-1',
        sessionId: 'sess-1',
        productId: 'prod-s3',
        date: '2026-03-31',
        counted: 12,
        status: 'confirmed' as const,
      },
      {
        id: 'cnt-2',
        sessionId: 'sess-2',
        productId: 'prod-s3',
        date: '2026-04-30',
        counted: 25,
        status: 'confirmed' as const,
      },
    ]

    const entries = [
      // Between count 1 and count 2 -> ignored because count 2 is latest
      {
        id: 'ent-mid',
        productId: 'prod-s3',
        date: '2026-04-15',
        qty: 10,
        unitPrice: 180,
      },
      // After count 2 -> included
      {
        id: 'ent-post',
        productId: 'prod-s3',
        date: '2026-05-02',
        qty: 3,
        unitPrice: 180,
      },
    ]

    const exits = [
      {
        id: 'ext-post',
        productId: 'prod-s3',
        date: '2026-05-03',
        qtyConsumed: 2,
        qtyWasted: 0,
      },
    ]

    const res = computeProductStock(product, entries, exits, confirmedCounts)

    // Latest count is 25 (NOT 12 + 25 = 37). 25 + 3 - 2 = 26.
    expect(res.baselineValue).toBe(25)
    expect(res.baselineDate).toBe('2026-04-30')
    expect(res.stock).toBe(26)
  })

  it('Scenario 4 — Same-day cutoff rule for imported data: movement dated on day D is treated as already included in count on day D', () => {
    const dayD = '2026-03-15'
    const product = {
      id: 'prod-s4',
      ref: 'P104',
      name: 'Crème Liquide 35%',
      initialStock: 10,
      minStock: 5,
    }

    const entries = [
      // Same day as count (2026-03-15) -> treated as already included in the count on day D
      {
        id: 'ent-same-day',
        productId: 'prod-s4',
        date: '2026-03-15',
        qty: 12,
        unitPrice: 40,
      },
      // Next day (2026-03-16) -> strictly after D, so included
      {
        id: 'ent-next-day',
        productId: 'prod-s4',
        date: '2026-03-16',
        qty: 6,
        unitPrice: 40,
      },
    ]

    const exits = [
      // Same day as count (2026-03-15) -> treated as already included in the count on day D
      {
        id: 'ext-same-day',
        productId: 'prod-s4',
        date: '2026-03-15',
        qtyConsumed: 9,
        qtyWasted: 1,
      },
      // Next day (2026-03-16) -> strictly after D, so included
      {
        id: 'ext-next-day',
        productId: 'prod-s4',
        date: '2026-03-16',
        qtyConsumed: 2,
        qtyWasted: 0,
      },
    ]

    const confirmedCounts = [
      {
        id: 'cnt-s4',
        sessionId: 'sess-s4',
        productId: 'prod-s4',
        date: dayD,
        counted: 30,
        status: 'confirmed' as const,
      },
    ]

    const res = computeProductStock(product, entries, exits, confirmedCounts)

    // Same-day movements (ent-same-day=12, ext-same-day=10) are ignored after baseline;
    // only 2026-03-16 movements (+6 - 2) apply on top of 30 => 34.
    expect(res.entriesAfterBaseline).toBe(6)
    expect(res.consumedAfterBaseline).toBe(2)
    expect(res.wastedAfterBaseline).toBe(0)
    expect(res.stock).toBe(34)
  })

  it('Scenario 5 — Reversed documents (and their reversals) are excluded from stock and totals', () => {
    const product = {
      id: 'prod-s5',
      ref: 'P105',
      name: 'Saumon Fumé',
      initialStock: 10,
      minStock: 5,
    }

    const entries = [
      // Valid purchase: +8 @ 200 DH
      {
        id: 'pur-valid',
        productId: 'prod-s5',
        date: '2026-04-01',
        qty: 8,
        unitPrice: 200,
      },
      // Reversed purchase original: +20 @ 500 DH (mistake)
      {
        id: 'pur-mistake',
        productId: 'prod-s5',
        date: '2026-04-02',
        qty: 20,
        unitPrice: 500,
        isReversed: true,
      },
      // Reversal entry of pur-mistake: -20 @ 500 DH
      {
        id: 'pur-mistake-rev',
        productId: 'prod-s5',
        date: '2026-04-02',
        qty: -20,
        unitPrice: 500,
        isReversal: true,
        reversedOfId: 'pur-mistake',
      },
    ]

    const exits = [
      // Valid exit: -3 consumed
      {
        id: 'ext-valid',
        productId: 'prod-s5',
        date: '2026-04-03',
        qtyConsumed: 3,
        qtyWasted: 0,
      },
      // Reversed exit original: -7 consumed
      {
        id: 'ext-mistake',
        productId: 'prod-s5',
        date: '2026-04-04',
        qtyConsumed: 7,
        qtyWasted: 2,
        isReversed: true,
      },
      // Reversal of ext-mistake
      {
        id: 'ext-mistake-rev',
        productId: 'prod-s5',
        date: '2026-04-04',
        qtyConsumed: -7,
        qtyWasted: -2,
        isReversal: true,
        reversedOfId: 'ext-mistake',
      },
    ]

    const res = computeProductStock(product, entries, exits, [])

    // Only valid movements count: initial 10 + 8 - 3 = 15.
    // Total entries = 8 (NOT 28 or 8-20), Total consumed = 3, Average price = 200 DH.
    expect(res.entriesAfterBaseline).toBe(8)
    expect(res.totalEntries).toBe(8)
    expect(res.consumedAfterBaseline).toBe(3)
    expect(res.totalConsumed).toBe(3)
    expect(res.wastedAfterBaseline).toBe(0)
    expect(res.stock).toBe(15)
    expect(res.averagePrice).toBe(200)
    expect(res.stockValue).toBe(3000)
  })

  it('Scenario 6 — Weighted average price with mixed priced and unpriced purchases, and "Prix manquant" flag when no cost exists', () => {
    const entries = [
      // 10 units @ 40 DH = 400 DH
      {
        id: 'p1',
        productId: 'prod-s6',
        date: '2026-04-01',
        qty: 10,
        unitPrice: 40,
      },
      // 10 units @ 60 DH = 600 DH
      {
        id: 'p2',
        productId: 'prod-s6',
        date: '2026-04-05',
        qty: 10,
        unitPrice: 60,
      },
      // 5 units unpriced (0 DH) -> included in stock quantity (+5), excluded from PMP denominator
      {
        id: 'p3',
        productId: 'prod-s6',
        date: '2026-04-06',
        qty: 5,
        unitPrice: 0,
      },
    ]

    const avg = computeWeightedAveragePrice('prod-s6', entries)
    // (400 + 600) / (10 + 10) = 1000 / 20 = 50 DH
    expect(avg).toBe(50)

    const prodWithCost = {
      id: 'prod-s6',
      ref: 'P106',
      name: 'Huile Tournesol',
      initialStock: 0,
      minStock: 5,
    }
    const resWithCost = computeProductStock(prodWithCost, entries, [], [])
    expect(resWithCost.stock).toBe(25) // 10 + 10 + 5
    expect(resWithCost.averagePrice).toBe(50)
    expect(resWithCost.stockValue).toBe(1250) // 25 * 50
    expect(resWithCost.priceMissing).toBe(false)

    // Product with no priced purchase -> priceMissing: true, averagePrice: null, stockValue: null
    const prodNoCost = {
      id: 'prod-s6-nocost',
      ref: 'P107',
      name: 'Épice Maison',
      initialStock: 8,
      minStock: 2,
    }
    const resNoCost = computeProductStock(
      prodNoCost,
      [
        {
          id: 'p-free',
          productId: 'prod-s6-nocost',
          date: '2026-04-01',
          qty: 2,
          unitPrice: 0,
        },
      ],
      [],
      []
    )
    expect(resNoCost.stock).toBe(10)
    expect(resNoCost.priceMissing).toBe(true)
    expect(resNoCost.averagePrice).toBeNull()
    expect(resNoCost.stockValue).toBeNull()
  })

  it('Scenario 7 — Status thresholds at min, between min and 150% of min, at 150% of min, above 150% of min, and no min', () => {
    const min = 10 // 150% of min = 15
    expect(computeStockStatus(10, min)).toBe('Alerte') // Exactly at min -> Alerte
    expect(computeStockStatus(12, min)).toBe('À surveiller') // Between min and 150% of min -> À surveiller
    expect(computeStockStatus(15, min)).toBe('À surveiller') // Exactly at 150% of min -> À surveiller
    expect(computeStockStatus(15.01, min)).toBe('OK') // Above 150% of min -> OK
    expect(computeStockStatus(10, null)).toBe('À définir') // No min -> À définir
    expect(computeStockStatus(10, 0)).toBe('À définir') // Zero min -> À définir
  })

  it('Scenario 8 — Confirming an inventory session updates stock for counted products without changing uncounted products', async () => {
    const repo = new MemoryDataRepository()
    await repo.login('admin@monarq.ma', 'admin1234')

    const pCounted = await repo.createProduct({
      ref: 'P201',
      name: 'Mozzarella Fior di Latte',
      category: 'Crèmerie',
      unit: 'kg',
      initial_stock: 10,
      min_stock: 4,
      location: 'Chambre froide',
      archived: false,
    })

    const pUncounted = await repo.createProduct({
      ref: 'P202',
      name: 'Parmigiano Reggiano',
      category: 'Crèmerie',
      unit: 'kg',
      initial_stock: 15,
      min_stock: 5,
      location: 'Chambre froide',
      archived: false,
    })

    const { session: draftSession } = await repo.createInventoryDraftSession({
      date: '2026-04-20',
      scope: 'full',
      notes: 'Inventaire mensuel',
    })

    // Confirm the inventory session with ONLY pCounted counted (22 kg) and pUncounted left uncounted (null)
    const { session: confirmedSession, lines: confirmedLines } =
      await repo.confirmInventorySession(draftSession.id, [
        { product: pCounted.id, counted: 22, comment: 'Compté en réserve' },
        { product: pUncounted.id, counted: null },
      ])

    expect(confirmedSession.status).toBe('confirmed')
    expect(confirmedSession.confirmed_by).toBeTruthy()
    expect(confirmedSession.confirmed_at).toBeTruthy()
    // Only the counted product line is saved in the confirmed session
    expect(confirmedLines).toHaveLength(1)
    expect(confirmedLines[0].product).toBe(pCounted.id)
    expect(confirmedLines[0].counted).toBe(22)

    // Verify no fake purchase or exit movements were created (no double counting)
    const purchases = await repo.listPurchases()
    const exits = await repo.listExits()
    expect(purchases.lines).toHaveLength(0)
    expect(exits.lines).toHaveLength(0)

    // pCounted becomes 22, while pUncounted remains untouched at 15
    const invBundle = await repo.listInventories()
    const stockMap = computeAllProductsStock({
      products: [pCounted, pUncounted],
      purchases: purchases.headers,
      purchaseLines: purchases.lines,
      exits: exits.headers,
      exitLines: exits.lines,
      inventorySessions: invBundle.sessions,
      inventoryLines: invBundle.lines,
    })

    expect(stockMap.get(pCounted.id)?.stock).toBe(22)
    expect(stockMap.get(pCounted.id)?.baselineType).toBe('inventory')
    expect(stockMap.get(pUncounted.id)?.stock).toBe(15)
    expect(stockMap.get(pUncounted.id)?.baselineType).toBe('initial')
  })

  it('Scenario 9 — Draft inventory sessions do not affect stock', async () => {
    const repo = new MemoryDataRepository()
    await repo.login('admin@monarq.ma', 'admin1234')

    const pDraft = await repo.createProduct({
      ref: 'P203',
      name: 'Crème Fraîche 35%',
      category: 'Crèmerie',
      unit: 'L',
      initial_stock: 10,
      min_stock: 4,
      location: 'Chambre froide',
      archived: false,
    })

    const { session: draftSession } = await repo.createInventoryDraftSession({
      date: '2026-04-20',
      scope: 'full',
      notes: 'Inventaire test brouillon',
    })

    await repo.saveInventoryDraftLines(draftSession.id, [
      { product: pDraft.id, counted: 30, comment: 'Comptage brouillon non confirmé' },
    ])

    const invBundle = await repo.listInventories()
    const stockMap = computeAllProductsStock({
      products: [pDraft],
      purchases: [],
      purchaseLines: [],
      exits: [],
      exitLines: [],
      inventorySessions: invBundle.sessions,
      inventoryLines: invBundle.lines,
    })

    // Still initial_stock = 10, draft count of 30 is completely ignored
    expect(stockMap.get(pDraft.id)?.stock).toBe(10)
    expect(stockMap.get(pDraft.id)?.baselineType).toBe('initial')

    // Verify RBAC rules for /inventaires
    expect(canAccessRoute('cuisine', '/inventaires')).toBe(false)
    expect(canAccessRoute('consultation', '/inventaires')).toBe(true)
    expect(canAccessRoute('economat', '/inventaires')).toBe(true)
  })
})
