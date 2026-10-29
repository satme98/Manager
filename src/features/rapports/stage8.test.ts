import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryDataRepository } from '@/data/memory-adapter'
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
import { computeAllProductsStock, roundCurrency } from '@/lib/stock-engine'

async function loadDatasetFromRepo(
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

describe('STAGE 8 – Payments, Reports, Replenishment, Pertes & Movements', () => {
  let repo: MemoryDataRepository

  beforeEach(async () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
    invalidateDashboardAnalyticsCache()
    repo = new MemoryDataRepository()
    await repo.login('admin@monarq.ma', 'admin1234')
  })

  it('1 & 2. Marking an invoice as paid updates supplier balance, dashboard KPI, and unpaid report; reversing payment restores unpaid and logs audit', async () => {
    const sup = await repo.createSupplier({
      name: 'Boucherie Atlas',
      contact: 'Karim',
      phone: '0600112233',
      email: 'atlas@example.com',
      payment_terms: '30 jours',
      notes: '',
    })
    const prod = await repo.createProduct({
      ref: 'VIA-001',
      name: 'Filet de Boeuf',
      category: 'Viandes',
      unit: 'kg',
      initial_stock: 10,
      min_stock: 5,
      location: 'Chambre froide',
      archived: false,
    })

    const inv1 = await repo.createPurchaseDocument({
      date: '2026-03-05',
      supplier: sup.id,
      invoice_no: 'FAC-101',
      payment_status: 'unpaid',
      payment_date: null,
      notes: '',
      lines: [{ product: prod.id, qty: 10, unit_price: 120 }], // 1200 DH
    })
    const inv2 = await repo.createPurchaseDocument({
      date: '2026-03-10',
      supplier: sup.id,
      invoice_no: 'FAC-102',
      payment_status: 'unpaid',
      payment_date: null,
      notes: '',
      lines: [{ product: prod.id, qty: 5, unit_price: 100 }], // 500 DH
    })

    let ds = await loadDatasetFromRepo(repo)
    let invoiceReport = computeInvoicesAndAgingReport(ds, {
      referenceDate: '2026-03-25',
    })
    let dash = computeDashboardAnalytics(ds, {
      preset: 'this_month',
      referenceDate: '2026-03-25',
      forceRefresh: true,
    })

    expect(invoiceReport.summary.totalUnpaidAmount).toBe(1700)
    expect(invoiceReport.summary.unpaidInvoicesCount).toBe(2)
    expect(invoiceReport.supplierBalances[0].outstandingBalance).toBe(1700)
    expect(dash.kpis.unpaidInvoices.totalAmount).toBe(1700)
    expect(dash.kpis.unpaidInvoices.invoicesCount).toBe(2)

    // Mark inv1 (1200 DH) as paid
    await repo.markPurchasePaid(inv1.header.id, '2026-03-20', {
      method: 'Virement bancaire',
      reference: 'VIR-9001',
    })

    ds = await loadDatasetFromRepo(repo)
    invoiceReport = computeInvoicesAndAgingReport(ds, {
      referenceDate: '2026-03-25',
    })
    dash = computeDashboardAnalytics(ds, {
      preset: 'this_month',
      referenceDate: '2026-03-25',
      forceRefresh: true,
    })

    expect(invoiceReport.summary.totalUnpaidAmount).toBe(500)
    expect(invoiceReport.summary.unpaidInvoicesCount).toBe(1)
    expect(invoiceReport.summary.paidInPeriodAmount).toBe(1200)
    expect(invoiceReport.supplierBalances[0].outstandingBalance).toBe(500)
    expect(dash.kpis.unpaidInvoices.totalAmount).toBe(500)
    expect(dash.kpis.unpaidInvoices.invoicesCount).toBe(1)

    // Reverse payment on inv1 with mandatory reason
    await expect(
      repo.reversePurchasePayment(inv1.header.id, '')
    ).rejects.toThrow()

    await repo.reversePurchasePayment(
      inv1.header.id,
      'Erreur de sélection de facture lors du virement'
    )

    ds = await loadDatasetFromRepo(repo)
    invoiceReport = computeInvoicesAndAgingReport(ds, {
      referenceDate: '2026-03-25',
    })
    dash = computeDashboardAnalytics(ds, {
      preset: 'this_month',
      referenceDate: '2026-03-25',
      forceRefresh: true,
    })

    expect(invoiceReport.summary.totalUnpaidAmount).toBe(1700)
    expect(invoiceReport.summary.unpaidInvoicesCount).toBe(2)
    expect(dash.kpis.unpaidInvoices.totalAmount).toBe(1700)

    const allPaymentEvents = await repo.listPaymentEvents()
    const paymentEvents = allPaymentEvents.filter(
      (ev) => ev.purchase_id === inv1.header.id
    )
    expect(paymentEvents.length).toBe(2)
    expect(paymentEvents[0].type).toBe('reversal')
    expect(paymentEvents[0].reversal_reason).toContain('Erreur de sélection')

    const logs = await repo.listAuditLogs()
    const reversalLog = logs.find(
      (l) =>
        l.collection === 'purchases' &&
        l.record_id === inv1.header.id &&
        JSON.stringify(l.details).includes('reverse_payment')
    )
    expect(reversalLog).toBeDefined()
    expect(inv2.header.id).toBeDefined()
  })

  it('3. Aging buckets (0-30, 31-60, 61-90, 90+) match exact days since purchase date', async () => {
    const sup = await repo.createSupplier({
      name: 'Fournisseur Test Aging',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const prod = await repo.createProduct({
      ref: 'PRD-AGE',
      name: 'Huile Olive',
      category: 'Épicerie',
      unit: 'L',
      initial_stock: 0,
      min_stock: 5,
      location: 'Réserve',
      archived: false,
    })

    // Reference date: 2026-05-01
    // 10 days old -> 0-30 (100 DH)
    await repo.createPurchaseDocument({
      date: '2026-04-21',
      supplier: sup.id,
      invoice_no: 'F-10D',
      payment_status: 'unpaid',
      payment_date: null,
      notes: '',
      lines: [{ product: prod.id, qty: 1, unit_price: 100 }],
    })
    // 45 days old -> 31-60 (250 DH)
    await repo.createPurchaseDocument({
      date: '2026-03-17',
      supplier: sup.id,
      invoice_no: 'F-45D',
      payment_status: 'unpaid',
      payment_date: null,
      notes: '',
      lines: [{ product: prod.id, qty: 1, unit_price: 250 }],
    })
    // 75 days old -> 61-90 (400 DH)
    await repo.createPurchaseDocument({
      date: '2026-02-15',
      supplier: sup.id,
      invoice_no: 'F-75D',
      payment_status: 'unpaid',
      payment_date: null,
      notes: '',
      lines: [{ product: prod.id, qty: 1, unit_price: 400 }],
    })
    // 120 days old -> 90+ (800 DH)
    await repo.createPurchaseDocument({
      date: '2026-01-01',
      supplier: sup.id,
      invoice_no: 'F-120D',
      payment_status: 'unpaid',
      payment_date: null,
      notes: '',
      lines: [{ product: prod.id, qty: 1, unit_price: 800 }],
    })

    const ds = await loadDatasetFromRepo(repo)
    const report = computeInvoicesAndAgingReport(ds, {
      referenceDate: '2026-05-01',
    })

    const byBucket = new Map(report.agingBuckets.map((b) => [b.bucket, b]))
    expect(byBucket.get('0-30')?.amount).toBe(100)
    expect(byBucket.get('31-60')?.amount).toBe(250)
    expect(byBucket.get('61-90')?.amount).toBe(400)
    expect(byBucket.get('90+')?.amount).toBe(800)
    expect(report.summary.totalUnpaidAmount).toBe(1550)
    expect(report.summary.unpaidOver30DaysAmount).toBe(1450)
    expect(report.summary.unpaidOver30DaysCount).toBe(3)
  })

  it('4. Replenishment suggestion formula (min * multiplier - current) is exact and never creates purchase orders automatically', async () => {
    const sup = await repo.createSupplier({
      name: 'Céréales Maroc',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    // Product with min_stock = 15, initial_stock = 4 -> Alerte
    const prodAlert = await repo.createProduct({
      ref: 'FAR-001',
      name: 'Farine T45',
      category: 'Épicerie',
      unit: 'kg',
      initial_stock: 4,
      min_stock: 15,
      location: 'Réserve',
      archived: false,
    })
    // Product with no min_stock -> À définir
    await repo.createProduct({
      ref: 'SEL-001',
      name: 'Sel Marin',
      category: 'Épicerie',
      unit: 'kg',
      initial_stock: 10,
      min_stock: null,
      location: 'Réserve',
      archived: false,
    })

    // Purchase 2 kg @ 12 DH so current stock = 4 + 2 = 6 kg, last price = 12 DH
    await repo.createPurchaseDocument({
      date: '2026-03-01',
      supplier: sup.id,
      invoice_no: 'BL-01',
      payment_status: 'paid',
      payment_date: '2026-03-01',
      notes: '',
      lines: [{ product: prodAlert.id, qty: 2, unit_price: 12 }],
    })

    const ds = await loadDatasetFromRepo(repo)
    // Default multiplier = 2 -> suggested = 15 * 2 - 6 = 24 kg; estimated cost = 24 * 12 = 288 DH
    const repDefault = computeReplenishmentSuggestions(ds)
    expect(repDefault.alertCount).toBe(1)
    expect(repDefault.undefinedMinCount).toBe(1)
    expect(repDefault.suggestions[0].currentStock).toBe(6)
    expect(repDefault.suggestions[0].minStock).toBe(15)
    expect(repDefault.suggestions[0].suggestedQty).toBe(24)
    expect(repDefault.suggestions[0].lastUnitPrice).toBe(12)
    expect(repDefault.suggestions[0].estimatedCost).toBe(288)

    // Custom multiplier = 3 -> suggested = 15 * 3 - 6 = 39 kg
    const repCustom = computeReplenishmentSuggestions(ds, {
      multiplierOverride: 3,
    })
    expect(repCustom.suggestions[0].suggestedQty).toBe(39)
    expect(repCustom.suggestions[0].estimatedCost).toBe(468)

    // Verify no purchase documents were created by computing suggestions or saving a draft purchase list
    const purchasesBefore = (await repo.listPurchases()).headers.length
    await repo.saveDraftPurchaseList({
      name: 'Commande test',
      date: '2026-03-20',
      status: 'Prête',
      notes: '',
      created_by: 'admin',
      lines: [
        {
          productId: prodAlert.id,
          ref: prodAlert.ref,
          name: prodAlert.name,
          category: prodAlert.category,
          unit: prodAlert.unit,
          currentStock: 6,
          minStock: 15,
          suggestedQty: 24,
          orderedQty: 24,
          supplierId: sup.id,
          supplierName: sup.name,
          unitPrice: 12,
          estimatedCost: 288,
        },
      ],
    })
    const purchasesAfter = (await repo.listPurchases()).headers.length
    expect(purchasesAfter).toBe(purchasesBefore)
  })

  it('5. Stock valuation at a past date (asOfDate) matches historical stock reconstruction', async () => {
    const sup = await repo.createSupplier({
      name: 'Primeur Sud',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const prod = await repo.createProduct({
      ref: 'CAF-001',
      name: 'Café Grain',
      category: 'Boissons',
      unit: 'kg',
      initial_stock: 5,
      min_stock: 3,
      location: 'Bar',
      archived: false,
    })

    // 2026-03-05: +10 kg @ 80 DH (stock = 15, PMP = 80, value = 1200)
    await repo.createPurchaseDocument({
      date: '2026-03-05',
      supplier: sup.id,
      invoice_no: 'FAC-C1',
      payment_status: 'paid',
      payment_date: '2026-03-05',
      notes: '',
      lines: [{ product: prod.id, qty: 10, unit_price: 80 }],
    })

    // 2026-03-15: -4 kg exit (stock = 11, PMP = 80, value = 880)
    await repo.createExitDocument({
      date: '2026-03-15',
      destination: 'Bar',
      notes: '',
      lines: [{ product: prod.id, qty_consumed: 4, qty_wasted: 0 }],
    })

    // 2026-03-25: +10 kg @ 100 DH (stock = 21, PMP = (800+1000)/20 = 90, value = 1890)
    await repo.createPurchaseDocument({
      date: '2026-03-25',
      supplier: sup.id,
      invoice_no: 'FAC-C2',
      payment_status: 'paid',
      payment_date: '2026-03-25',
      notes: '',
      lines: [{ product: prod.id, qty: 10, unit_price: 100 }],
    })

    const ds = await loadDatasetFromRepo(repo)

    const valMarch10 = computeStockValuationAsOfDate(ds, {
      asOfDate: '2026-03-10',
    })
    expect(valMarch10.byProduct[0].stock).toBe(15)
    expect(valMarch10.byProduct[0].averagePrice).toBe(80)
    expect(valMarch10.totalStockValue).toBe(1200)

    const valMarch20 = computeStockValuationAsOfDate(ds, {
      asOfDate: '2026-03-20',
    })
    expect(valMarch20.byProduct[0].stock).toBe(11)
    expect(valMarch20.byProduct[0].averagePrice).toBe(80)
    expect(valMarch20.totalStockValue).toBe(880)

    const valMarch30 = computeStockValuationAsOfDate(ds, {
      asOfDate: '2026-03-30',
    })
    expect(valMarch30.byProduct[0].stock).toBe(21)
    expect(valMarch30.byProduct[0].averagePrice).toBe(90)
    expect(valMarch30.totalStockValue).toBe(1890)
  })

  it('6, 7 & 8. Report totals reconcile 100% with Dashboard KPIs & independent calculation; cuisine role hides all prices; filtered views match totals', async () => {
    const sup1 = await repo.createSupplier({
      name: 'Fournisseur A',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const sup2 = await repo.createSupplier({
      name: 'Fournisseur B',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })

    const p1 = await repo.createProduct({
      ref: 'P-01',
      name: 'Saumon Frais',
      category: 'Poissons',
      unit: 'kg',
      initial_stock: 2,
      min_stock: 5,
      location: 'Frigo',
      archived: false,
    })
    const p2 = await repo.createProduct({
      ref: 'P-02',
      name: 'Riz Basmati',
      category: 'Épicerie',
      unit: 'kg',
      initial_stock: 20,
      min_stock: 10,
      location: 'Réserve',
      archived: false,
    })

    // Purchases in March 2026
    await repo.createPurchaseDocument({
      date: '2026-03-04',
      supplier: sup1.id,
      invoice_no: 'FA-01',
      payment_status: 'unpaid',
      payment_date: null,
      notes: '',
      lines: [{ product: p1.id, qty: 10, unit_price: 150 }], // 1500 DH
    })
    await repo.createPurchaseDocument({
      date: '2026-03-12',
      supplier: sup2.id,
      invoice_no: 'FB-01',
      payment_status: 'paid',
      payment_date: '2026-03-12',
      notes: '',
      lines: [{ product: p2.id, qty: 30, unit_price: 20 }], // 600 DH
    })

    // Exit with consumption & loss in March 2026
    await repo.createExitDocument({
      date: '2026-03-18',
      destination: 'Cuisine chaude',
      notes: '',
      lines: [
        {
          product: p1.id,
          qty_consumed: 5,
          qty_wasted: 2,
          loss_reason: 'Altération',
        },
        {
          product: p2.id,
          qty_consumed: 10,
          qty_wasted: 0,
        },
      ],
    })

    const ds = await loadDatasetFromRepo(repo)

    // Independent computation via stock-engine
    const stockMap = computeAllProductsStock({
      products: ds.products,
      purchases: ds.purchases,
      purchaseLines: ds.purchaseLines,
      exits: ds.exits,
      exitLines: ds.exitLines,
      inventorySessions: ds.inventorySessions,
      inventoryLines: ds.inventoryLines,
    })
    const independentStockVal = roundCurrency(
      Array.from(stockMap.values()).reduce(
        (acc, s) => acc + (s.stockValue ?? 0),
        0
      )
    )

    const dash = computeDashboardAnalytics(ds, {
      preset: 'this_month',
      referenceDate: '2026-03-25',
      role: 'admin',
      forceRefresh: true,
    })
    const valReport = computeStockValuationAsOfDate(ds, {
      asOfDate: '2026-03-25',
      role: 'admin',
    })
    const invReport = computeInvoicesAndAgingReport(ds, {
      from: '2026-03-01',
      to: '2026-03-31',
      referenceDate: '2026-03-25',
      role: 'admin',
    })
    const lossReport = computeLossesReport(ds, {
      from: '2026-03-01',
      to: '2026-03-31',
      role: 'admin',
    })
    const reapproReport = computeReplenishmentSuggestions(ds, {
      role: 'admin',
    })
    const movements = computeUnifiedMovementTimeline(ds, {
      role: 'admin',
    })

    // Reconciliation assertions: Report totals === Dashboard totals === Independent calculation
    expect(valReport.totalStockValue).toBe(independentStockVal)
    expect(dash.kpis.stockValue.value).toBe(independentStockVal)

    expect(invReport.summary.totalInvoicedInPeriod).toBe(2100)
    expect(dash.kpis.periodPurchases.value).toBe(2100)

    expect(invReport.summary.totalUnpaidAmount).toBe(1500)
    expect(dash.kpis.unpaidInvoices.totalAmount).toBe(1500)

    expect(lossReport.summary.totalLossValue).toBe(300) // 2 kg saumon * 150 DH
    expect(dash.kpis.periodLosses.value).toBe(300)

    expect(reapproReport.alertCount).toBe(dash.kpis.alertProducts.alertCount)

    // Verify running Stock après on unified movement timeline matches current stock
    const latestP1Movement = movements.find((m) => m.productId === p1.id)
    expect(latestP1Movement?.stockAfter).toBe(stockMap.get(p1.id)?.stock)

    // Filtered report check: filtering by supplier sup1 returns only sup1's 1500 DH invoice
    const filteredSup1 = computeInvoicesAndAgingReport(ds, {
      supplierId: sup1.id,
      referenceDate: '2026-03-25',
      role: 'admin',
    })
    expect(filteredSup1.invoices.length).toBe(1)
    expect(filteredSup1.summary.totalUnpaidAmount).toBe(1500)

    // 7. Cuisine role masking check across all Stage 8 modules
    const cuisineVal = computeStockValuationAsOfDate(ds, { role: 'cuisine' })
    const cuisineInv = computeInvoicesAndAgingReport(ds, { role: 'cuisine' })
    const cuisineLoss = computeLossesReport(ds, { role: 'cuisine' })
    const cuisineReappro = computeReplenishmentSuggestions(ds, {
      role: 'cuisine',
    })
    const cuisineMov = computeUnifiedMovementTimeline(ds, { role: 'cuisine' })

    expect(cuisineVal.totalStockValue).toBeNull()
    expect(cuisineVal.byProduct.every((p) => p.stockValue === null)).toBe(true)
    expect(cuisineInv.summary.totalUnpaidAmount).toBeNull()
    expect(cuisineLoss.summary.totalLossValue).toBeNull()
    expect(cuisineLoss.summary.totalWastedQty).toBe(2) // Cuisine still sees quantities
    expect(cuisineReappro.totalEstimatedCost).toBeNull()
    expect(
      cuisineReappro.suggestions.every(
        (s) => s.lastUnitPrice === null && s.estimatedCost === null
      )
    ).toBe(true)
    expect(cuisineMov.every((m) => m.valueDelta === null)).toBe(true)
  })
})
