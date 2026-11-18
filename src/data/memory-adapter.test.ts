import { beforeEach, describe, expect, it } from 'vitest'
import { runExcelParityCheck } from '@/lib/excel-parity-engine'
import { clearStockCache } from '@/lib/stock-engine'
import { useAuthStore } from '@/stores/auth-store'
import { invalidateDashboardAnalyticsCache } from './analytics'
import { MemoryDataRepository } from './memory-adapter'

describe('MemoryDataRepository (Stage 2 Data Layer & RBAC Verification)', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
    clearStockCache()
    invalidateDashboardAnalyticsCache()
    useAuthStore.getState().auth.reset()
  })

  it('starts completely empty (0 operational records) apart from one admin user', async () => {
    const repo = new MemoryDataRepository()
    await repo.login('admin@monarq.ma', 'admin1234')

    const [products, suppliers, purchases, exits, inventories, users] =
      await Promise.all([
        repo.listProducts(),
        repo.listSuppliers(),
        repo.listPurchases(),
        repo.listExits(),
        repo.listInventories(),
        repo.listUsers(),
      ])

    expect(products).toHaveLength(0)
    expect(suppliers).toHaveLength(0)
    expect(purchases.headers).toHaveLength(0)
    expect(purchases.lines).toHaveLength(0)
    expect(exits.headers).toHaveLength(0)
    expect(exits.lines).toHaveLength(0)
    expect(inventories.sessions).toHaveLength(0)
    expect(inventories.lines).toHaveLength(0)
    expect(users).toHaveLength(1)
    expect(users[0]?.role).toBe('admin')
  })

  it('enforces RBAC on user management, cuisine price masking, negative stock, and writes audit_log on every mutation', async () => {
    const repo = new MemoryDataRepository()
    await repo.login('admin@monarq.ma', 'admin1234')

    // Admin creates a product and a supplier
    const product = await repo.createProduct({
      ref: ' b-100 ',
      name: 'Filet de bœuf',
      category: 'Viandes',
      unit: 'kg',
      initial_stock: 5,
      min_stock: 2,
      location: 'Chambre froide 1',
      archived: false,
    })
    expect(product.ref).toBe('B-100')

    // Admin creates a cuisine user and a manager user
    const cuisineUser = await repo.createUser({
      email: 'chef@monarq.ma',
      name: 'Chef Cuisine',
      role: 'cuisine',
      password: 'password123',
    })
    await repo.createUser({
      email: 'manager@monarq.ma',
      name: 'Manager Restaurant',
      role: 'manager',
      password: 'password123',
    })

    // Switch to cuisine user
    await repo.login('chef@monarq.ma', 'password123')

    // Cuisine cannot list suppliers or purchases or create users
    await expect(repo.listSuppliers()).rejects.toThrow()
    await expect(repo.listPurchases()).rejects.toThrow()
    await expect(
      repo.createUser({
        email: 'test@monarq.ma',
        name: 'Test',
        role: 'consultation',
        password: 'password123',
      })
    ).rejects.toThrow()

    // Cuisine blocks negative stock (stock = 5, trying to exit 8)
    await expect(
      repo.createExitDocument({
        date: '2025-05-10',
        destination: 'Cuisine chaude',
        lines: [{ product: product.id, qty_consumed: 8, qty_wasted: 0 }],
      })
    ).rejects.toThrow(/Stock insuffisant/i)

    // Cuisine can create a valid exit (qty = 2 <= 5), and unit_cost_snapshot is masked (null) for cuisine
    const exitDoc = await repo.createExitDocument({
      date: '2025-05-10',
      destination: 'Cuisine chaude',
      lines: [{ product: product.id, qty_consumed: 2, qty_wasted: 0 }],
    })
    expect(exitDoc.lines[0]?.unit_cost_snapshot).toBeNull()

    // Switch to Manager: cannot manage users, but can authorize negative stock with a reason
    await repo.login('manager@monarq.ma', 'password123')
    await expect(
      repo.updateUserRole(cuisineUser.id, 'economat')
    ).rejects.toThrow()

    // Manager without reason is blocked on negative stock
    await expect(
      repo.createExitDocument({
        date: '2025-05-11',
        destination: 'Banquet',
        lines: [{ product: product.id, qty_consumed: 10, qty_wasted: 0 }],
      })
    ).rejects.toThrow(/motif obligatoire/i)

    // Manager with reason succeeds
    const managerExit = await repo.createExitDocument({
      date: '2025-05-11',
      destination: 'Banquet',
      negative_stock_reason: 'Livraison fournisseur reçue mais facture en attente',
      lines: [{ product: product.id, qty_consumed: 10, qty_wasted: 0 }],
    })
    expect(managerExit.header.negative_stock_reason).toContain('Livraison')

    // Verify audit logs were recorded for every mutation
    const logs = await repo.listAuditLogs()
    expect(logs.length).toBeGreaterThanOrEqual(5)
  })

  it('seeds permanent MONARQ dataset with 345 products, 33 suppliers, 247 purchases, 143 exits, 119 inventory lines, 5 users, and passes Excel parity check', async () => {
    const repo = new MemoryDataRepository({ seedWithPermanentDataset: true })
    await repo.login('admin@monarq.ma', 'admin1234')

    const [products, suppliers, purchases, exits, inventories, users] =
      await Promise.all([
        repo.listProducts(),
        repo.listSuppliers(),
        repo.listPurchases(),
        repo.listExits(),
        repo.listInventories(),
        repo.listUsers(),
      ])

    expect(products).toHaveLength(345)
    expect(suppliers).toHaveLength(33)
    expect(purchases.headers).toHaveLength(247)
    expect(purchases.lines).toHaveLength(247)
    expect(exits.headers).toHaveLength(143)
    expect(exits.lines).toHaveLength(143)
    expect(inventories.sessions).toHaveLength(2)
    expect(inventories.lines).toHaveLength(119)
    expect(users).toHaveLength(5)

    const parity = await runExcelParityCheck(repo)
    expect(parity.isParityOk).toBe(true)
    expect(parity.matchedProductsCount).toBe(345)
    expect(parity.strictDiffProductsCount).toBe(0)

    // Verify smart default reference date returns October 2026 period analytics when no referenceDate is passed
    const dash = await repo.getDashboardAnalytics({ preset: 'this_month' })
    expect(dash.databaseEmpty).toBe(false)
    expect(dash.kpis.periodPurchases.value).toBeCloseTo(95989.05, 2)
    expect(dash.kpis.unpaidInvoices.totalAmount).toBeCloseTo(26938.55, 2)
    expect(dash.kpis.stockValue.value).toBeCloseTo(79352.45, 2)
  })
})
