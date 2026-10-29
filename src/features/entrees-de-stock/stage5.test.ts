import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryDataRepository } from '@/data/memory-adapter'
import {
  computeSupplierAggregates,
  computeTargetedProductsStock,
  normalizeProductRef,
} from '@/lib/stock-engine'

describe('STAGE 5 — Entrées de stock, Sorties de stock & Contre-passations', () => {
  let repo: MemoryDataRepository

  beforeEach(async () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
    repo = new MemoryDataRepository()
    await repo.login('admin@monarq.ma', 'admin1234')
  })

  it('1. Purchase with 3 lines updates stock, weighted average price, and supplier balance correctly', async () => {
    const supplier = await repo.createSupplier({
      name: 'Fournisseur Atlas',
      contact: 'Youssef',
      phone: '0522001122',
      email: 'contact@atlas.ma',
      payment_terms: '30 jours',
      notes: '',
    })

    const p1 = await repo.createProduct({
      ref: 'P001',
      name: 'Filet de Boeuf',
      category: 'Viandes & Volailles',
      unit: 'kg',
      initial_stock: 2,
      min_stock: 5,
      location: 'Chambre froide',
      archived: false,
    })
    const p2 = await repo.createProduct({
      ref: 'P002',
      name: 'Beurre Doux',
      category: 'Crémerie & Fromages',
      unit: 'kg',
      initial_stock: 0,
      min_stock: 3,
      location: 'Chambre froide',
      archived: false,
    })
    const p3 = await repo.createProduct({
      ref: 'P003',
      name: 'Huile d’Olive Extra',
      category: 'Épicerie Sèche',
      unit: 'L',
      initial_stock: 5,
      min_stock: 2,
      location: 'Réserve',
      archived: false,
    })

    // First purchase (paid) to establish initial price on P001
    await repo.createPurchaseDocument({
      date: '2026-04-01',
      supplier: supplier.id,
      invoice_no: 'FAC-100',
      payment_status: 'paid',
      payment_date: '2026-04-01',
      lines: [{ product: p1.id, qty: 10, unit_price: 120 }], // 1 200 DH
    })

    // Second purchase with 3 lines (unpaid)
    const purchase3Lines = await repo.createPurchaseDocument({
      date: '2026-04-05',
      supplier: supplier.id,
      invoice_no: 'FAC-101',
      payment_status: 'unpaid',
      lines: [
        { product: p1.id, qty: 10, unit_price: 140 }, // 1 400 DH -> P001 avg = (1200+1400)/20 = 130 DH
        { product: p2.id, qty: 5, unit_price: 80 }, // 400 DH -> P002 avg = 80 DH
        { product: p3.id, qty: 4, unit_price: 65 }, // 260 DH -> P003 avg = 65 DH
      ],
    })

    expect(purchase3Lines.lines).toHaveLength(3)

    const { headers: purchaseHeaders, lines: purchaseLines } =
      await repo.listPurchases()
    const products = await repo.listProducts()
    const suppliers = await repo.listSuppliers()

    const stockMap = computeTargetedProductsStock({
      targetProductIds: [p1.id, p2.id, p3.id],
      products,
      purchases: purchaseHeaders,
      purchaseLines,
      exits: [],
      exitLines: [],
      inventorySessions: [],
      inventoryLines: [],
    })

    // Verify P001 stock (initial 2 + 10 + 10 = 22) and weighted average price (130 DH)
    const p1Stock = stockMap.get(p1.id)!
    expect(p1Stock.stock).toBe(22)
    expect(p1Stock.averagePrice).toBe(130)
    expect(p1Stock.stockValue).toBe(2860)

    // Verify P002 stock (0 + 5 = 5) and average price (80 DH)
    const p2Stock = stockMap.get(p2.id)!
    expect(p2Stock.stock).toBe(5)
    expect(p2Stock.averagePrice).toBe(80)

    // Verify supplier balance: totalPurchases = 1200 + 2060 = 3260, unpaidBalance = 2060
    const supplierAgg = computeSupplierAggregates(
      suppliers,
      purchaseHeaders,
      purchaseLines
    ).get(supplier.id)

    expect(supplierAgg?.totalPurchases).toBe(3260)
    expect(supplierAgg?.unpaidBalance).toBe(2060)

    // Mark FAC-101 as paid and verify unpaid balance drops to 0
    await repo.markPurchasePaid(purchase3Lines.header.id, '2026-04-10')
    const updatedPurchases = await repo.listPurchases()
    const updatedAgg = computeSupplierAggregates(
      suppliers,
      updatedPurchases.headers,
      updatedPurchases.lines
    ).get(supplier.id)

    expect(updatedAgg?.unpaidBalance).toBe(0)
  })

  it('2. Exit with loss uses the correct weighted average cost snapshot (unit_cost_snapshot)', async () => {
    const supplier = await repo.createSupplier({
      name: 'Fournisseur Marée',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const saumon = await repo.createProduct({
      ref: 'P092',
      name: 'Saumon Frais',
      category: 'Poissons & Fruits de mer',
      unit: 'kg',
      initial_stock: 0,
      min_stock: 2,
      location: 'Frigo Poisson',
      archived: false,
    })

    // Purchase 10 kg @ 180 DH and 10 kg @ 220 DH => PMP = 200 DH/kg
    await repo.createPurchaseDocument({
      date: '2026-04-01',
      supplier: supplier.id,
      invoice_no: 'BL-S1',
      payment_status: 'paid',
      lines: [
        { product: saumon.id, qty: 10, unit_price: 180 },
        { product: saumon.id, qty: 10, unit_price: 220 },
      ],
    })

    // Exit with 3 kg consumed and 1.5 kg wasted (with loss reason)
    const exitDoc = await repo.createExitDocument({
      date: '2026-04-02',
      destination: 'Cuisine',
      lines: [
        {
          product: saumon.id,
          qty_consumed: 3,
          qty_wasted: 1.5,
          loss_reason: 'Péremption / DLC dépassée',
        },
      ],
    })

    expect(exitDoc.lines).toHaveLength(1)
    expect(exitDoc.lines[0].unit_cost_snapshot).toBe(200)
    expect(exitDoc.lines[0].loss_reason).toBe('Péremption / DLC dépassée')

    // Even if a later purchase changes the PMP, the historical exit snapshot stays frozen at 200 DH
    await repo.createPurchaseDocument({
      date: '2026-04-03',
      supplier: supplier.id,
      invoice_no: 'BL-S2',
      payment_status: 'paid',
      lines: [{ product: saumon.id, qty: 20, unit_price: 260 }],
    })

    const savedExits = await repo.listExits()
    expect(savedExits.lines[0].unit_cost_snapshot).toBe(200)
  })

  it('3. Negative stock is blocked for economat and cuisine, and allowed for manager only with mandatory reason', async () => {
    const prod = await repo.createProduct({
      ref: 'P010',
      name: 'Crème Liquide 35%',
      category: 'Crémerie & Fromages',
      unit: 'L',
      initial_stock: 5,
      min_stock: 2,
      location: 'Frigo',
      archived: false,
    })

    // Create users for economat, cuisine, and manager
    await repo.createUser({
      email: 'economat@monarq.ma',
      name: 'Karim Économat',
      role: 'economat',
      password: 'password123',
    })
    await repo.createUser({
      email: 'cuisine@monarq.ma',
      name: 'Chef Cuisine',
      role: 'cuisine',
      password: 'password123',
    })
    await repo.createUser({
      email: 'manager@monarq.ma',
      name: 'Nadia Manager',
      role: 'manager',
      password: 'password123',
    })

    // Switch to economat -> blocked from taking 6 L when only 5 L available
    await repo.login('economat@monarq.ma', 'password123')
    await expect(
      repo.createExitDocument({
        date: '2026-04-05',
        destination: 'Cuisine',
        lines: [{ product: prod.id, qty_consumed: 6, qty_wasted: 0 }],
      })
    ).rejects.toThrow(/Stock insuffisant/i)

    // Switch to cuisine -> also blocked
    await repo.login('cuisine@monarq.ma', 'password123')
    await expect(
      repo.createExitDocument({
        date: '2026-04-05',
        destination: 'Cuisine',
        lines: [{ product: prod.id, qty_consumed: 4, qty_wasted: 2 }],
      })
    ).rejects.toThrow(/Stock insuffisant/i)

    // Switch to manager -> blocked if reason is missing
    await repo.login('manager@monarq.ma', 'password123')
    await expect(
      repo.createExitDocument({
        date: '2026-04-05',
        destination: 'Cuisine',
        lines: [{ product: prod.id, qty_consumed: 6, qty_wasted: 0 }],
      })
    ).rejects.toThrow(/motif obligatoire/i)

    // Allowed for manager when mandatory reason is provided
    const overrideExit = await repo.createExitDocument({
      date: '2026-04-05',
      destination: 'Cuisine',
      negative_stock_reason: 'Livraison du matin non encore saisie',
      lines: [{ product: prod.id, qty_consumed: 6, qty_wasted: 0 }],
    })

    expect(overrideExit.header.negative_stock_reason).toBe(
      'Livraison du matin non encore saisie'
    )

    // Verify audit log recorded the negative stock reason
    const logs = await repo.listAuditLogs()
    const exitAudit = logs.find(
      (l) => l.collection === 'exits' && l.record_id === overrideExit.header.id
    )
    expect(exitAudit?.details?.negative_stock_reason).toBe(
      'Livraison du matin non encore saisie'
    )
  })

  it('4. Reversal removes the effect on stock and totals while keeping the original document visible', async () => {
    const supplier = await repo.createSupplier({
      name: 'Fournisseur Sud',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const prod = await repo.createProduct({
      ref: 'P050',
      name: 'Farine T45',
      category: 'Épicerie Sèche',
      unit: 'kg',
      initial_stock: 10,
      min_stock: 5,
      location: 'Réserve',
      archived: false,
    })

    const purchase = await repo.createPurchaseDocument({
      date: '2026-04-05',
      supplier: supplier.id,
      invoice_no: 'FAC-500',
      payment_status: 'unpaid',
      lines: [{ product: prod.id, qty: 20, unit_price: 10 }],
    })

    // Reverse the purchase
    const reversal = await repo.reversePurchaseDocument(
      purchase.header.id,
      'Erreur de saisie quantité'
    )
    expect(reversal.header.reversed_of).toBe(purchase.header.id)
    expect(reversal.lines[0].qty).toBe(-20)
    expect(reversal.lines[0].amount).toBe(-200)

    // Both original and reversal remain visible in listPurchases()
    const allPurchases = await repo.listPurchases()
    expect(allPurchases.headers).toHaveLength(2)
    const originalDoc = allPurchases.headers.find(
      (p) => p.id === purchase.header.id
    )
    expect(originalDoc?.correction_status).toBe('reversed')

    // Recompute stock -> back to initial 10 kg
    const products = await repo.listProducts()
    const stockMap = computeTargetedProductsStock({
      targetProductIds: [prod.id],
      products,
      purchases: allPurchases.headers,
      purchaseLines: allPurchases.lines,
      exits: [],
      exitLines: [],
      inventorySessions: [],
      inventoryLines: [],
    })
    expect(stockMap.get(prod.id)?.stock).toBe(10)

    // Supplier net total purchased & unpaid balance -> 0
    const suppliers = await repo.listSuppliers()
    const supplierAgg = computeSupplierAggregates(
      suppliers,
      allPurchases.headers,
      allPurchases.lines
    ).get(supplier.id)
    expect(supplierAgg?.totalPurchases).toBe(0)
    expect(supplierAgg?.unpaidBalance).toBe(0)
  })

  it('5. Two simultaneous exits on the same product cannot both succeed beyond available stock', async () => {
    const prod = await repo.createProduct({
      ref: 'P077',
      name: 'Entrecôte Maturée',
      category: 'Viandes & Volailles',
      unit: 'kg',
      initial_stock: 5,
      min_stock: 2,
      location: 'Frigo',
      archived: false,
    })

    await repo.createUser({
      email: 'economat2@monarq.ma',
      name: 'Économat',
      role: 'economat',
      password: 'password123',
    })
    await repo.login('economat2@monarq.ma', 'password123')

    // Launch two concurrent exit requests of 4 kg each on a product with 5 kg stock
    const results = await Promise.allSettled([
      repo.createExitDocument({
        date: '2026-04-06',
        destination: 'Cuisine',
        lines: [{ product: prod.id, qty_consumed: 4, qty_wasted: 0 }],
      }),
      repo.createExitDocument({
        date: '2026-04-06',
        destination: 'Bar',
        lines: [{ product: prod.id, qty_consumed: 4, qty_wasted: 0 }],
      }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
  })

  it('6. Role "cuisine" cannot read prices through the API while server still stores cost snapshot', async () => {
    const supplier = await repo.createSupplier({
      name: 'Fournisseur Pro',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    const prod = await repo.createProduct({
      ref: 'P088',
      name: 'Crevettes Royales',
      category: 'Poissons & Fruits de mer',
      unit: 'kg',
      initial_stock: 0,
      min_stock: 2,
      location: 'Congélateur',
      archived: false,
    })

    await repo.createPurchaseDocument({
      date: '2026-04-01',
      supplier: supplier.id,
      invoice_no: 'FAC-88',
      payment_status: 'paid',
      lines: [{ product: prod.id, qty: 10, unit_price: 150 }],
    })

    await repo.createUser({
      email: 'cuisine.staff@monarq.ma',
      name: 'Cuisine Staff',
      role: 'cuisine',
      password: 'password123',
    })

    // Login as cuisine
    await repo.login('cuisine.staff@monarq.ma', 'password123')

    // Cuisine is blocked from listing purchases or suppliers
    await expect(repo.listPurchases()).rejects.toThrow(/Accès refusé/i)
    await expect(repo.listSuppliers()).rejects.toThrow(/Accès refusé/i)

    // Cuisine creates an exit: response masks unit_cost_snapshot as null
    const createdByCuisine = await repo.createExitDocument({
      date: '2026-04-02',
      destination: 'Cuisine',
      lines: [{ product: prod.id, qty_consumed: 2, qty_wasted: 0 }],
    })
    expect(createdByCuisine.lines[0].unit_cost_snapshot).toBeNull()

    const listedByCuisine = await repo.listExits()
    expect(listedByCuisine.lines[0].unit_cost_snapshot).toBeNull()

    // Switch back to admin: verify the server DID compute and store unit_cost_snapshot = 150 DH in the database
    await repo.login('admin@monarq.ma', 'admin1234')
    const listedByAdmin = await repo.listExits()
    expect(listedByAdmin.lines[0].unit_cost_snapshot).toBe(150)
  })

  it('7. Case-insensitive reference selection matches p092 = P092', async () => {
    const created = await repo.createProduct({
      ref: ' p092 ',
      name: 'Thon Rouge',
      category: 'Poissons & Fruits de mer',
      unit: 'kg',
      initial_stock: 4,
      min_stock: 1,
      location: 'Frigo',
      archived: false,
    })
    expect(created.ref).toBe('P092')

    const products = await repo.listProducts()
    const userTypedQuery = '  p092 '
    const matched = products.find(
      (p) => normalizeProductRef(p.ref) === normalizeProductRef(userTypedQuery)
    )
    expect(matched?.id).toBe(created.id)
    expect(matched?.name).toBe('Thon Rouge')
  })
})
