import { beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { invalidateDashboardAnalyticsCache } from '@/data/analytics'
import { MemoryDataRepository } from '@/data/memory-adapter'
import {
  executeWorkbookImport,
  parseAndValidateWorkbook,
} from '@/lib/excel-import-engine'
import {
  clearStockCache,
  computeAllProductsStock,
  roundCurrency,
} from '@/lib/stock-engine'
import { useAuthStore } from '@/stores/auth-store'

describe('STAGE 7 — Tableau de bord & Analytics Aggregation (src/data/analytics.ts)', () => {
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

  it('1. Dashboard totals equal the exact sum of source records for a fixed fixture (stock value, purchases of period, unpaid total, loss value, exit value, alert count)', async () => {
    const sup1 = await repo.createSupplier({
      name: 'Atlas Viandes',
      contact: 'Youssef',
      phone: '0522112233',
      email: 'atlas@monarq.ma',
      payment_terms: '30 jours',
      notes: '',
    })
    const sup2 = await repo.createSupplier({
      name: 'Casablanca Marée',
      contact: 'Karim',
      phone: '0522445566',
      email: 'maree@monarq.ma',
      payment_terms: 'Comptant',
      notes: '',
    })

    // Product 1: initial 10, min 15 -> after +5 entry, -4 consumed, -1 wasted => stock = 10 <= min 15 (Alerte!)
    // Price: 5 * 200 DH = 1000 DH => PMP = 200 DH => Stock value = 10 * 200 = 2000 DH
    const p1 = await repo.createProduct({
      ref: 'P001',
      name: 'Filet de Boeuf',
      category: 'Viandes',
      unit: 'kg',
      initial_stock: 10,
      min_stock: 15,
      location: 'Chambre froide',
      archived: false,
    })

    // Product 2: initial 20, min 5 -> after +10 entry, -3 consumed, -2 wasted => stock = 25 > 7.5 (OK!)
    // Price: 10 * 80 DH = 800 DH => PMP = 80 DH => Stock value = 25 * 80 = 2000 DH
    const p2 = await repo.createProduct({
      ref: 'P002',
      name: 'Saumon Frais',
      category: 'Poissons',
      unit: 'kg',
      initial_stock: 20,
      min_stock: 5,
      location: 'Chambre froide',
      archived: false,
    })

    // Product 3: initial 5, min 10 -> no purchases => stock = 5 <= 10 (Alerte!), priceMissing = true
    await repo.createProduct({
      ref: 'P003',
      name: 'Sel de Guérande',
      category: 'Épicerie',
      unit: 'kg',
      initial_stock: 5,
      min_stock: 10,
      location: 'Réserve',
      archived: false,
    })

    // Purchase 1 (in current period Oct 2026, PAID): 5 kg P001 @ 200 DH = 1000 DH
    await repo.createPurchaseDocument({
      date: '2026-10-10',
      supplier: sup1.id,
      invoice_no: 'BL-1001',
      payment_status: 'paid',
      payment_date: '2026-10-10',
      lines: [{ product: p1.id, qty: 5, unit_price: 200 }],
    })

    // Purchase 2 (in current period Oct 2026, UNPAID): 10 kg P002 @ 80 DH = 800 DH
    await repo.createPurchaseDocument({
      date: '2026-10-12',
      supplier: sup2.id,
      invoice_no: 'FA-1002',
      payment_status: 'unpaid',
      lines: [{ product: p2.id, qty: 10, unit_price: 80 }],
    })

    // Purchase 3 (in previous period Sept 2026, UNPAID): 2 kg P001 @ 200 DH = 400 DH
    // Wait: let's keep P001 stock exact by accounting for this purchase:
    // If P001 also had +2 in Sept 2026, P001 stock = 10 + 2 + 5 - 4 - 1 = 12 <= 15 (still Alerte!)
    // And P001 Stock Value = 12 * 200 = 2400 DH!
    await repo.createPurchaseDocument({
      date: '2026-09-15',
      supplier: sup1.id,
      invoice_no: 'FA-0901',
      payment_status: 'unpaid',
      lines: [{ product: p1.id, qty: 2, unit_price: 200 }],
    })

    // Exit 1 (in current period Oct 2026):
    // P001: 4 consumed (@ 200 = 800 DH), 1 wasted (@ 200 = 200 DH)
    // P002: 3 consumed (@ 80 = 240 DH), 2 wasted (@ 80 = 160 DH)
    await repo.createExitDocument({
      date: '2026-10-18',
      destination: 'Cuisine Chaude',
      lines: [
        {
          product: p1.id,
          qty_consumed: 4,
          qty_wasted: 1,
          loss_reason: 'Parure',
        },
        {
          product: p2.id,
          qty_consumed: 3,
          qty_wasted: 2,
          loss_reason: 'DLC dépassée',
        },
      ],
    })

    const dashboard = await repo.getDashboardAnalytics({
      preset: 'this_month',
      referenceDate: '2026-10-28',
    })

    // Independent verification from source records:
    // 1. Stock value: P001 (12 * 200 = 2400) + P002 (25 * 80 = 2000) + P003 (null) = 4400 DH
    expect(dashboard.kpis.stockValue.value).toBe(4400)
    expect(dashboard.kpis.stockValue.missingPriceCount).toBe(1) // P003

    // 2. Purchases of period (Oct 2026): BL-1001 (1000) + FA-1002 (800) = 1800 DH
    expect(dashboard.kpis.periodPurchases.value).toBe(1800)
    expect(dashboard.kpis.periodPurchases.documentsCount).toBe(2)

    // 3. Unpaid invoices (all periods): FA-1002 (800) + FA-0901 (400) = 1200 DH across 2 invoices
    expect(dashboard.kpis.unpaidInvoices.totalAmount).toBe(1200)
    expect(dashboard.kpis.unpaidInvoices.invoicesCount).toBe(2)

    // 4. Alert products count: P001 (12 <= 15) and P003 (5 <= 10) => 2 products in Alerte, P002 is OK (1)
    expect(dashboard.kpis.alertProducts.alertCount).toBe(2)
    expect(dashboard.kpis.alertProducts.okCount).toBe(1)

    // 5. Loss value of period (Oct 2026): P001 (1 * 200 = 200) + P002 (2 * 80 = 160) = 360 DH
    expect(dashboard.kpis.periodLosses.value).toBe(360)
    expect(dashboard.kpis.periodLosses.totalWastedQty).toBe(3)

    // 6. Exit (consumed) value of period (Oct 2026): P001 (4 * 200 = 800) + P002 (3 * 80 = 240) = 1040 DH
    expect(dashboard.kpis.periodExits.value).toBe(1040)
    expect(dashboard.kpis.periodExits.totalConsumedQty).toBe(7)
  })

  it('2. Date-range filter changes all period widgets consistently', async () => {
    const sup = await repo.createSupplier({
      name: 'Fournisseur Test',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const prod = await repo.createProduct({
      ref: 'P100',
      name: 'Huile Olive',
      category: 'Épicerie',
      unit: 'L',
      initial_stock: 50,
      min_stock: 10,
      location: 'Réserve',
      archived: false,
    })

    // Purchase on 2026-09-10 (Last month): 10 L @ 50 = 500 DH
    await repo.createPurchaseDocument({
      date: '2026-09-10',
      supplier: sup.id,
      invoice_no: 'SEPT-01',
      payment_status: 'paid',
      payment_date: '2026-09-10',
      lines: [{ product: prod.id, qty: 10, unit_price: 50 }],
    })

    // Purchase on 2026-10-05 (This month, outside last 7 days): 20 L @ 50 = 1000 DH
    await repo.createPurchaseDocument({
      date: '2026-10-05',
      supplier: sup.id,
      invoice_no: 'OCT-01',
      payment_status: 'paid',
      payment_date: '2026-10-05',
      lines: [{ product: prod.id, qty: 20, unit_price: 50 }],
    })

    // Purchase on 2026-10-28 (Today): 6 L @ 50 = 300 DH
    await repo.createPurchaseDocument({
      date: '2026-10-28',
      supplier: sup.id,
      invoice_no: 'OCT-TODAY',
      payment_status: 'paid',
      payment_date: '2026-10-28',
      lines: [{ product: prod.id, qty: 6, unit_price: 50 }],
    })

    // Exit on 2026-09-12: 4 consumed (200 DH), 1 wasted (50 DH)
    await repo.createExitDocument({
      date: '2026-09-12',
      destination: 'Cuisine',
      lines: [{ product: prod.id, qty_consumed: 4, qty_wasted: 1, loss_reason: 'Casse' }],
    })

    // Exit on 2026-10-28: 2 consumed (100 DH), 0 wasted
    await repo.createExitDocument({
      date: '2026-10-28',
      destination: 'Cuisine',
      lines: [{ product: prod.id, qty_consumed: 2, qty_wasted: 0 }],
    })

    // A) Today (2026-10-28): only 300 DH purchase, 100 DH exit, 0 DH loss
    const todayDash = await repo.getDashboardAnalytics({
      preset: 'today',
      referenceDate: '2026-10-28',
    })
    expect(todayDash.kpis.periodPurchases.value).toBe(300)
    expect(todayDash.kpis.periodExits.value).toBe(100)
    expect(todayDash.kpis.periodLosses.value).toBe(0)
    expect(todayDash.charts.topConsumedProducts.byQuantity[0]?.qtyConsumed).toBe(2)

    // B) This month (Oct 2026): 1000 + 300 = 1300 DH purchases, 100 DH exit, 0 DH loss
    const thisMonthDash = await repo.getDashboardAnalytics({
      preset: 'this_month',
      referenceDate: '2026-10-28',
    })
    expect(thisMonthDash.kpis.periodPurchases.value).toBe(1300)
    expect(thisMonthDash.kpis.periodExits.value).toBe(100)
    expect(thisMonthDash.kpis.periodLosses.value).toBe(0)
    expect(thisMonthDash.charts.purchasesBySupplier.items[0]?.amount).toBe(1300)

    // C) Last month (Sept 2026): 500 DH purchases, 200 DH exit, 50 DH loss
    const lastMonthDash = await repo.getDashboardAnalytics({
      preset: 'last_month',
      referenceDate: '2026-10-28',
    })
    expect(lastMonthDash.kpis.periodPurchases.value).toBe(500)
    expect(lastMonthDash.kpis.periodExits.value).toBe(200)
    expect(lastMonthDash.kpis.periodLosses.value).toBe(50)
    expect(lastMonthDash.charts.topConsumedProducts.byQuantity[0]?.qtyConsumed).toBe(4)

    // D) Non-period KPI (stockValue) remains identical across all ranges (50 + 10 + 20 + 6 - 5 - 2 = 79 * 50 = 3950 DH)
    expect(todayDash.kpis.stockValue.value).toBe(3950)
    expect(thisMonthDash.kpis.stockValue.value).toBe(3950)
    expect(lastMonthDash.kpis.stockValue.value).toBe(3950)
  })

  it('3. Reversed documents (and their reversals) do not appear in any dashboard totals or charts', async () => {
    const sup = await repo.createSupplier({
      name: 'Fournisseur Alpha',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const prod = await repo.createProduct({
      ref: 'P200',
      name: 'Beurre Doux',
      category: 'Crèmerie',
      unit: 'kg',
      initial_stock: 10,
      min_stock: 5,
      location: 'Frigo',
      archived: false,
    })

    // Valid purchase: 10 kg @ 100 DH = 1000 DH (unpaid)
    await repo.createPurchaseDocument({
      date: '2026-10-10',
      supplier: sup.id,
      invoice_no: 'BL-VALID',
      payment_status: 'unpaid',
      lines: [{ product: prod.id, qty: 10, unit_price: 100 }],
    })

    // Purchase to be reversed: 50 kg @ 100 DH = 5000 DH (unpaid)
    const { header: reversedPurchase } = await repo.createPurchaseDocument({
      date: '2026-10-12',
      supplier: sup.id,
      invoice_no: 'BL-ERR',
      payment_status: 'unpaid',
      lines: [{ product: prod.id, qty: 50, unit_price: 100 }],
    })
    await repo.reversePurchaseDocument(
      reversedPurchase.id,
      'Erreur de saisie quantité'
    )

    // Valid exit: 3 kg consumed (300 DH), 1 kg wasted (100 DH)
    await repo.createExitDocument({
      date: '2026-10-15',
      destination: 'Pâtisserie',
      lines: [
        {
          product: prod.id,
          qty_consumed: 3,
          qty_wasted: 1,
          loss_reason: 'Périmé',
        },
      ],
    })

    // Exit to be reversed: 8 kg consumed (800 DH), 2 kg wasted (200 DH)
    const { header: reversedExit } = await repo.createExitDocument({
      date: '2026-10-16',
      destination: 'Pâtisserie',
      lines: [
        {
          product: prod.id,
          qty_consumed: 8,
          qty_wasted: 2,
          loss_reason: 'Erreur',
        },
      ],
    })
    await repo.reverseExitDocument(reversedExit.id, 'Sortie en double')

    const dash = await repo.getDashboardAnalytics({
      preset: 'this_month',
      referenceDate: '2026-10-28',
    })

    // Reversed 5000 DH purchase and its -5000 DH reversal must be excluded:
    expect(dash.kpis.periodPurchases.value).toBe(1000)
    expect(dash.kpis.periodPurchases.documentsCount).toBe(1)
    expect(dash.kpis.unpaidInvoices.totalAmount).toBe(1000)
    expect(dash.kpis.unpaidInvoices.invoicesCount).toBe(1)

    // Reversed exit must be excluded:
    expect(dash.kpis.periodExits.value).toBe(300)
    expect(dash.kpis.periodLosses.value).toBe(100)
    expect(dash.kpis.stockValue.value).toBe(1600) // (10 + 10 - 3 - 1) * 100 = 1600 DH
  })

  it('4. Trend is hidden when the previous equivalent period has no data, and shown when comparable data exists', async () => {
    const sup = await repo.createSupplier({
      name: 'Fournisseur Trend',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const prod = await repo.createProduct({
      ref: 'P300',
      name: 'Farine T45',
      category: 'Épicerie',
      unit: 'kg',
      initial_stock: 20,
      min_stock: 5,
      location: 'Réserve',
      archived: false,
    })

    // Only current period purchase (2026-10-28), NO purchase in previous period
    await repo.createPurchaseDocument({
      date: '2026-10-28',
      supplier: sup.id,
      invoice_no: 'BL-NOW',
      payment_status: 'paid',
      payment_date: '2026-10-28',
      lines: [{ product: prod.id, qty: 10, unit_price: 15 }],
    })

    const dashNoPrev = await repo.getDashboardAnalytics({
      preset: 'today',
      referenceDate: '2026-10-28',
    })
    expect(dashNoPrev.kpis.periodPurchases.value).toBe(150)
    // Trend MUST be null because yesterday (2026-10-27) had no purchases
    expect(dashNoPrev.kpis.periodPurchases.trend).toBeNull()

    // Now add a purchase on the previous day (2026-10-27): 100 DH
    await repo.createPurchaseDocument({
      date: '2026-10-27',
      supplier: sup.id,
      invoice_no: 'BL-YESTERDAY',
      payment_status: 'paid',
      payment_date: '2026-10-27',
      lines: [{ product: prod.id, qty: 10, unit_price: 10 }],
    })

    const dashWithPrev = await repo.getDashboardAnalytics({
      preset: 'today',
      referenceDate: '2026-10-28',
    })
    expect(dashWithPrev.kpis.periodPurchases.trend).not.toBeNull()
    expect(dashWithPrev.kpis.periodPurchases.trend?.previousValue).toBe(100)
    expect(dashWithPrev.kpis.periodPurchases.trend?.percentChange).toBe(50) // (150 - 100) / 100 = +50%
    expect(dashWithPrev.kpis.periodPurchases.trend?.direction).toBe('up')
  })

  it('5. Cuisine API / repository responses contain NO price or value fields', async () => {
    const sup = await repo.createSupplier({
      name: 'Fournisseur Secret',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const prod = await repo.createProduct({
      ref: 'P400',
      name: 'Crevettes Royales',
      category: 'Poissons',
      unit: 'kg',
      initial_stock: 2,
      min_stock: 10,
      location: 'Frigo',
      archived: false,
    })

    await repo.createPurchaseDocument({
      date: '2026-10-10',
      supplier: sup.id,
      invoice_no: 'BL-SEC',
      payment_status: 'unpaid',
      lines: [{ product: prod.id, qty: 5, unit_price: 180 }],
    })

    await repo.createExitDocument({
      date: '2026-10-12',
      destination: 'Cuisine',
      lines: [{ product: prod.id, qty_consumed: 3, qty_wasted: 1, loss_reason: 'Test' }],
    })

    // Create a cuisine user and log in as cuisine
    await repo.createUser({
      email: 'chef@monarq.ma',
      name: 'Chef Cuisine',
      role: 'cuisine',
      password: 'password123',
    })
    await repo.login('chef@monarq.ma', 'password123')

    // Even if caller passes role: 'admin' in options, repository enforces actor's 'cuisine' role!
    const cuisineDash = await repo.getDashboardAnalytics({
      preset: 'this_month',
      referenceDate: '2026-10-28',
      role: 'admin',
    })

    expect(cuisineDash.role).toBe('cuisine')
    expect(cuisineDash.priceHidden).toBe(true)

    // Verify all KPI financial values are null
    expect(cuisineDash.kpis.stockValue.value).toBeNull()
    expect(cuisineDash.kpis.periodPurchases.value).toBeNull()
    expect(cuisineDash.kpis.unpaidInvoices.totalAmount).toBeNull()
    expect(cuisineDash.kpis.periodLosses.value).toBeNull()
    expect(cuisineDash.kpis.periodExits.value).toBeNull()

    // Verify alert count and consumed quantities ARE available for cuisine
    expect(cuisineDash.kpis.alertProducts.alertCount).toBe(1) // stock = 2 + 5 - 3 - 1 = 3 <= 10
    expect(cuisineDash.kpis.periodExits.totalConsumedQty).toBe(3)
    expect(cuisineDash.kpis.periodLosses.totalWastedQty).toBe(1)

    // Verify priority actions & charts contain no prices or values
    expect(cuisineDash.priorityActions.restockAlerts.items[0]?.averagePrice).toBeNull()
    expect(cuisineDash.priorityActions.oldestUnpaidInvoices.items).toHaveLength(0)
    expect(cuisineDash.priorityActions.oldestUnpaidInvoices.totalAmount).toBeNull()
    expect(cuisineDash.charts.stockValueByCategory.items[0]?.stockValue).toBeNull()
    expect(cuisineDash.charts.topConsumedProducts.byQuantity[0]?.consumedValue).toBeNull()
    expect(cuisineDash.charts.topConsumedProducts.byValue).toHaveLength(0)
    expect(cuisineDash.charts.purchasesBySupplier.items).toHaveLength(0)
    expect(cuisineDash.charts.monthlySpending12Months.items).toHaveLength(0)
    expect(
      cuisineDash.recentActivity.every(
        (act) => !act.amountOrQtyLabel?.includes('DH')
      )
    ).toBe(true)
  })

  it('6. With an empty database every widget reports hasData = false / empty state and zero errors', async () => {
    const emptyDash = await repo.getDashboardAnalytics({
      preset: 'this_month',
      referenceDate: '2026-10-28',
    })

    expect(emptyDash.databaseEmpty).toBe(true)
    expect(emptyDash.kpis.stockValue.hasData).toBe(false)
    expect(emptyDash.kpis.periodPurchases.hasData).toBe(false)
    expect(emptyDash.kpis.unpaidInvoices.hasData).toBe(false)
    expect(emptyDash.kpis.alertProducts.hasData).toBe(false)
    expect(emptyDash.kpis.periodLosses.hasData).toBe(false)
    expect(emptyDash.kpis.periodExits.hasData).toBe(false)

    expect(emptyDash.charts.purchasesEvolution.hasData).toBe(false)
    expect(emptyDash.charts.stockValueByCategory.hasData).toBe(false)
    expect(emptyDash.charts.topConsumedProducts.hasData).toBe(false)
    expect(emptyDash.charts.purchasesBySupplier.hasData).toBe(false)
    expect(emptyDash.charts.stockStatusDistribution.hasData).toBe(false)
    expect(emptyDash.charts.lossesEvolution.hasData).toBe(false)
    expect(emptyDash.charts.monthlySpending12Months.hasData).toBe(false)
    expect(emptyDash.charts.inventoryVariancesBySession.hasData).toBe(false)
    expect(emptyDash.recentActivity).toHaveLength(0)
  })

  it('7. Workbook import reconciliation: Dashboard KPIs match independent calculation from imported Excel workbook', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
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
        ['P001', 'Entrecôte Boeuf', 'Viandes', 'kg', 10, 8, '', 'Chambre froide'],
        ['P002', 'Huile Friture', 'Épicerie', 'L', 20, 15, '', 'Réserve'],
        ['P003', 'Poivre Noir', 'Épices', 'kg', 3, 5, '', 'Réserve'],
      ]),
      'Base Produits'
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Fournisseur', 'Contact', 'Téléphone', 'Email', 'Conditions paiement', 'Notes'],
        ['Boucherie Royale', 'Hassan', '0600112233', '', '30 jours', ''],
        ['Dislog Maroc', 'Amine', '0600445566', '', 'Comptant', ''],
      ]),
      'fournisseur'
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
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
        ['10/10/2026', 'P001', 'Entrecôte Boeuf', 5, 160, 800, 'OUI', 'Boucherie Royale', '10/10/2026'],
        ['15/10/2026', 'P002', 'Huile Friture', 10, 25, 250, 'NON', 'Dislog Maroc', ''],
      ]),
      'Entrées Stock'
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [
          'Date',
          'Référence',
          'Produit',
          'Quantité sortie',
          'Pertes',
          'Prix U',
          'G',
          'H',
          'Destination',
        ],
        ['18/10/2026', 'P001', 'Entrecôte Boeuf', 8, 1, '', '', '', 'Cuisine'],
        ['20/10/2026', 'P002', 'Huile Friture', 12, 2, '', '', '', 'Cuisine'],
      ]),
      'Sorties Stock'
    )

    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const preview = parseAndValidateWorkbook(out, 'MONARQ_ECONOMAT_TEST.xlsx')
    await executeWorkbookImport(
      preview,
      {
        vatConvention: 'TTC',
        vatConfirmed: true,
        categoryMapping: preview.defaultCategoryMapping,
        supplierChoices: preview.defaultSupplierChoices,
        duplicateDecisions: preview.defaultDuplicateDecisions,
        updateExistingProducts: false,
        updateExistingSuppliers: false,
        fallbackInventoryDate: '2026-10-20',
      },
      repo,
      { dryRun: false }
    )

    const dash = await repo.getDashboardAnalytics({
      preset: 'this_month',
      referenceDate: '2026-10-28',
    })

    // Independent computation directly from repository collections
    const [products, purchases, exits, inventories] = await Promise.all([
      repo.listProducts(),
      repo.listPurchases(),
      repo.listExits(),
      repo.listInventories(),
    ])
    const independentStockMap = computeAllProductsStock({
      products,
      purchases: purchases.headers,
      purchaseLines: purchases.lines,
      exits: exits.headers,
      exitLines: exits.lines,
      inventorySessions: inventories.sessions,
      inventoryLines: inventories.lines,
    })

    let independentTotalStockValue = 0
    let independentAlerts = 0
    for (const p of products) {
      const st = independentStockMap.get(p.id)!
      if (st.stockValue !== null) {
        independentTotalStockValue = roundCurrency(
          independentTotalStockValue + st.stockValue
        )
      }
      if (st.status === 'Alerte') independentAlerts++
    }

    expect(dash.kpis.stockValue.value).toBe(independentTotalStockValue) // P001 (6*160=960) + P002 (16*25=400) = 1360 DH
    expect(dash.kpis.stockValue.value).toBe(1360)
    expect(dash.kpis.periodPurchases.value).toBe(1050) // 800 + 250
    expect(dash.kpis.unpaidInvoices.totalAmount).toBe(250) // Dislog Maroc
    expect(dash.kpis.alertProducts.alertCount).toBe(independentAlerts) // P001 (6 <= 8) and P003 (3 <= 5) => 2
    expect(dash.kpis.periodLosses.value).toBe(210) // (1 * 160) + (2 * 25) = 210 DH
    expect(dash.kpis.periodExits.value).toBe(1580) // (8 * 160) + (12 * 25) = 1280 + 300 = 1580 DH
  })
})
