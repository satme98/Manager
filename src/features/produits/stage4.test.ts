import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryDataRepository } from '@/data/memory-adapter'
import { canPerformCollectionAction, canSeeFinancialData } from '@/lib/rbac'
import {
  computeProductDetailLedger,
  computeSupplierAggregates,
  computeSupplierDetail,
  findNearDuplicateSuppliers,
  suggestNextProductRef,
} from '@/lib/stock-engine'

describe('STAGE 4 – Produits & Fournisseurs', () => {
  let repo: MemoryDataRepository

  beforeEach(async () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
    repo = new MemoryDataRepository()
    await repo.login('admin@monarq.ma', 'admin1234')
  })

  it('1. Blocks duplicate product references case-insensitively (p092 vs P092) and suggests next free reference', async () => {
    const p1 = await repo.createProduct({
      ref: 'p092',
      name: 'Huile de tournesol 5L',
      category: 'Épicerie',
      unit: 'L',
      initial_stock: 10,
      min_stock: 5,
      location: 'Réserve sèche',
      archived: false,
    })
    expect(p1.ref).toBe('P092')

    await expect(
      repo.createProduct({
        ref: '  P092 ',
        name: 'Doublon Huile',
        category: 'Épicerie',
        unit: 'L',
        initial_stock: 0,
        min_stock: null,
        location: '',
        archived: false,
      })
    ).rejects.toThrow(/existe déjà/i)

    const suggested = suggestNextProductRef(['P001', 'P092', 'P339'])
    expect(suggested).toBe('P340')
  })

  it('2. Blocks changing ref once a product has movements and restricts unit change to manager/admin', async () => {
    const prod = await repo.createProduct({
      ref: 'P100',
      name: 'Farine T45',
      category: 'Épicerie',
      unit: 'kg',
      initial_stock: 20,
      min_stock: 5,
      location: 'Réserve',
      archived: false,
    })

    const sup = await repo.createSupplier({
      name: 'Moulin Atlas',
      contact: 'Youssef',
      phone: '0600000000',
      email: '',
      payment_terms: '30j',
      notes: '',
    })

    await repo.createPurchaseDocument({
      date: '2026-03-10',
      supplier: sup.id,
      invoice_no: 'BL-100',
      payment_status: 'paid',
      lines: [{ product: prod.id, qty: 25, unit_price: 8 }],
    })

    // Ref change must be blocked now that the product has movements
    await expect(repo.updateProduct(prod.id, { ref: 'P101' })).rejects.toThrow(
      /Impossible de modifier la référence/i
    )

    // Create an economat user and verify unit change is blocked for economat when product has movements
    await repo.createUser({
      email: 'economat@monarq.ma',
      name: 'Agent Économat',
      role: 'economat',
      password: 'password123',
    })
    await repo.login('economat@monarq.ma', 'password123')

    await expect(
      repo.updateProduct(prod.id, { unit: 'sac' })
    ).rejects.toThrow(/Seul un Manager ou Administrateur/i)

    // Admin can update unit even when movements exist
    await repo.login('admin@monarq.ma', 'admin1234')
    const updated = await repo.updateProduct(prod.id, { unit: 'sac' })
    expect(updated.unit).toBe('sac')
  })

  it('3. Archiving a product preserves movement history and hides it from active selectors', async () => {
    const prod = await repo.createProduct({
      ref: 'P200',
      name: 'Beurre doux 82%',
      category: 'Crèmerie',
      unit: 'kg',
      initial_stock: 5,
      min_stock: 3,
      location: 'Chambre froide',
      archived: false,
    })

    const sup = await repo.createSupplier({
      name: 'Centrale Laitière',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })

    await repo.createPurchaseDocument({
      date: '2026-03-12',
      supplier: sup.id,
      invoice_no: 'FAC-200',
      payment_status: 'paid',
      lines: [{ product: prod.id, qty: 10, unit_price: 95 }],
    })

    // Archive product
    const archivedProd = await repo.updateProduct(prod.id, { archived: true })
    expect(archivedProd.archived).toBe(true)

    const allProducts = await repo.listProducts()
    const activeSelectorProducts = allProducts.filter((p) => !p.archived)
    expect(activeSelectorProducts.some((p) => p.id === prod.id)).toBe(false)

    // Verify movement history and running stock are 100% preserved
    const purchases = await repo.listPurchases()
    const exits = await repo.listExits()
    const inventories = await repo.listInventories()
    const suppliers = await repo.listSuppliers()

    const ledger = computeProductDetailLedger({
      product: archivedProd,
      purchases: purchases.headers,
      purchaseLines: purchases.lines,
      exits: exits.headers,
      exitLines: exits.lines,
      inventorySessions: inventories.sessions,
      inventoryLines: inventories.lines,
      suppliers,
    })

    expect(ledger.stockResult.stock).toBe(15) // 5 initial + 10 purchased
    expect(ledger.stockResult.averagePrice).toBe(95)
    expect(ledger.movements.length).toBe(2) // Initial + Purchase
  })

  it('4. Category merge moves all products to target category and writes audit_log', async () => {
    await repo.createProduct({
      ref: 'P301',
      name: 'Tomate concassée',
      category: 'Conserves',
      unit: 'boîte',
      initial_stock: 12,
      min_stock: 6,
      location: 'Réserve',
      archived: false,
    })
    await repo.createProduct({
      ref: 'P302',
      name: 'Thon entier à l’huile',
      category: 'Conserves',
      unit: 'boîte',
      initial_stock: 8,
      min_stock: 4,
      location: 'Réserve',
      archived: false,
    })

    const movedCount = await repo.renameOrMergeCategory('Conserves', 'Épicerie')
    expect(movedCount).toBe(2)

    const productsAfter = await repo.listProducts()
    expect(productsAfter.every((p) => p.category === 'Épicerie')).toBe(true)

    const logs = await repo.listAuditLogs()
    const mergeLog = logs.find(
      (l) => l.details.operation === 'category_merge_or_rename'
    )
    expect(mergeLog).toBeDefined()
    expect(mergeLog?.details.from_category).toBe('Conserves')
    expect(mergeLog?.details.to_category).toBe('Épicerie')
    expect(mergeLog?.details.moved_products_count).toBe(2)
  })

  it('5. Supplier outstanding balance equals sum of unpaid purchase amounts and supplier merge moves purchases + writes audit_log', async () => {
    const sup1 = await repo.createSupplier({
      name: 'Boxy',
      contact: 'Ali',
      phone: '0611111111',
      email: 'ali@boxy.ma',
      payment_terms: '30 jours',
      notes: '',
    })

    const sup2 = await repo.createSupplier({
      name: 'BOXY Distribution',
      contact: 'Ali',
      phone: '0611111111',
      email: '',
      payment_terms: '30 jours',
      notes: '',
    })

    // Detect near-duplicate
    const nearDups = findNearDuplicateSuppliers('Boxy', [sup1, sup2], sup1.id)
    expect(nearDups.map((d) => d.id)).toContain(sup2.id)

    const prod = await repo.createProduct({
      ref: 'P400',
      name: 'Filet de boeuf',
      category: 'Viandes',
      unit: 'kg',
      initial_stock: 0,
      min_stock: 5,
      location: 'Chambre froide',
      archived: false,
    })

    // 1 paid purchase (10 * 120 = 1200 MAD)
    await repo.createPurchaseDocument({
      date: '2026-03-01',
      supplier: sup1.id,
      invoice_no: 'F-01',
      payment_status: 'paid',
      payment_date: '2026-03-01',
      lines: [{ product: prod.id, qty: 10, unit_price: 120 }],
    })

    // 1 unpaid purchase on sup1 (5 * 130 = 650 MAD)
    await repo.createPurchaseDocument({
      date: '2026-03-05',
      supplier: sup1.id,
      invoice_no: 'F-02',
      payment_status: 'unpaid',
      lines: [{ product: prod.id, qty: 5, unit_price: 130 }],
    })

    // 1 unpaid purchase on sup2 (2 * 140 = 280 MAD)
    await repo.createPurchaseDocument({
      date: '2026-03-08',
      supplier: sup2.id,
      invoice_no: 'F-03',
      payment_status: 'unpaid',
      lines: [{ product: prod.id, qty: 2, unit_price: 140 }],
    })

    const purchasesBefore = await repo.listPurchases()
    const suppliersBefore = await repo.listSuppliers()
    const aggsBefore = computeSupplierAggregates(
      suppliersBefore,
      purchasesBefore.headers,
      purchasesBefore.lines
    )

    expect(aggsBefore.get(sup1.id)?.totalPurchases).toBe(1850) // 1200 + 650
    expect(aggsBefore.get(sup1.id)?.unpaidBalance).toBe(650)
    expect(aggsBefore.get(sup2.id)?.unpaidBalance).toBe(280)

    // Merge sup2 into sup1
    const mergeRes = await repo.mergeSuppliers(sup2.id, sup1.id)
    expect(mergeRes.movedPurchasesCount).toBe(1)

    const purchasesAfter = await repo.listPurchases()
    const suppliersAfter = await repo.listSuppliers()
    const prodList = await repo.listProducts()

    const sup2After = suppliersAfter.find((s) => s.id === sup2.id)
    expect(sup2After?.archived).toBe(true)

    const detailSup1 = computeSupplierDetail({
      supplierId: sup1.id,
      purchases: purchasesAfter.headers,
      purchaseLines: purchasesAfter.lines,
      products: prodList,
    })

    // Total purchases on sup1 now = 1200 + 650 + 280 = 2130 MAD
    expect(detailSup1.totalAllTime).toBe(2130)
    // Unpaid balance on sup1 now = 650 + 280 = 930 MAD
    expect(detailSup1.unpaidBalance).toBe(930)
    // Price variation on P400: lastPrice 140 vs previousPrice 130 => +7.69%
    expect(detailSup1.purchasedProducts[0]?.lastPrice).toBe(140)
    expect(detailSup1.purchasedProducts[0]?.previousPrice).toBe(130)
    expect(detailSup1.purchasedProducts[0]?.priceVariationPct).toBe(7.69)

    const logs = await repo.listAuditLogs()
    expect(
      logs.some((l) => l.details.operation === 'supplier_merge')
    ).toBe(true)
  })

  it('6. Enforces RBAC so cuisine role cannot see prices in product list or detail and cannot access suppliers', async () => {
    await repo.createUser({
      email: 'chef@monarq.ma',
      name: 'Chef Cuisine',
      role: 'cuisine',
      password: 'password123',
    })

    // Check RBAC flags used by Produits list and detail
    expect(canSeeFinancialData('cuisine')).toBe(false)
    expect(canSeeFinancialData('economat')).toBe(true)
    expect(canSeeFinancialData('manager')).toBe(true)
    expect(canSeeFinancialData('admin')).toBe(true)
    expect(canPerformCollectionAction('cuisine', 'suppliers', 'list')).toBe(
      false
    )
    expect(canPerformCollectionAction('cuisine', 'purchases', 'list')).toBe(
      false
    )

    // Login as cuisine and verify repository blocks suppliers & purchases
    await repo.login('chef@monarq.ma', 'password123')
    await expect(repo.listSuppliers()).rejects.toThrow(/Accès refusé/i)
    await expect(repo.listPurchases()).rejects.toThrow(/Accès refusé/i)
  })
})
