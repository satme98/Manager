import { describe, expect, it } from 'vitest'
import type { CollectionName, UserRole } from '@/data/types'
import {
  canAccessRoute,
  canApproveNegativeStock,
  canPerformCollectionAction,
  canSeeFinancialData,
  IMMUTABLE_COLLECTIONS,
} from './rbac'

const ALL_COLLECTIONS: CollectionName[] = [
  'users',
  'products',
  'suppliers',
  'purchases',
  'purchase_lines',
  'exits',
  'exit_lines',
  'inventory_sessions',
  'inventory_lines',
  'audit_log',
  'settings',
  'import_batches',
]

const ALL_ROLES: UserRole[] = [
  'admin',
  'manager',
  'economat',
  'cuisine',
  'consultation',
]

describe('PocketBase API Rules & RBAC Matrix', () => {
  it('blocks all public/unauthenticated access across every collection and route', () => {
    for (const collection of ALL_COLLECTIONS) {
      expect(canPerformCollectionAction(null, collection, 'list')).toBe(false)
      expect(canPerformCollectionAction(null, collection, 'view')).toBe(false)
      expect(canPerformCollectionAction(null, collection, 'create')).toBe(false)
      expect(canPerformCollectionAction(null, collection, 'update')).toBe(false)
      expect(canPerformCollectionAction(null, collection, 'delete')).toBe(false)
    }
    expect(canAccessRoute(null, '/')).toBe(false)
    expect(canAccessRoute(undefined, '/produits')).toBe(false)
  })

  it('prevents ALL roles (including admin) from deleting purchases, exits, inventory lines or audit logs', () => {
    for (const role of ALL_ROLES) {
      for (const collection of IMMUTABLE_COLLECTIONS) {
        expect(canPerformCollectionAction(role, collection, 'delete')).toBe(
          false
        )
      }
    }
  })

  it('enforces that ONLY admin can list, create, or change users and roles', () => {
    expect(canPerformCollectionAction('admin', 'users', 'list')).toBe(true)
    expect(canPerformCollectionAction('admin', 'users', 'create')).toBe(true)
    expect(canPerformCollectionAction('admin', 'users', 'update')).toBe(true)
    expect(canAccessRoute('admin', '/utilisateurs')).toBe(true)

    for (const role of [
      'manager',
      'economat',
      'cuisine',
      'consultation',
    ] as UserRole[]) {
      expect(canPerformCollectionAction(role, 'users', 'list')).toBe(false)
      expect(canPerformCollectionAction(role, 'users', 'create')).toBe(false)
      expect(canPerformCollectionAction(role, 'users', 'update')).toBe(false)
      expect(canAccessRoute(role, '/utilisateurs')).toBe(false)
    }
  })

  it('enforces manager rules: read all, create/update operations, approve reversals, no user management', () => {
    expect(canPerformCollectionAction('manager', 'products', 'create')).toBe(
      true
    )
    expect(canPerformCollectionAction('manager', 'purchases', 'create')).toBe(
      true
    )
    expect(canPerformCollectionAction('manager', 'purchases', 'reverse')).toBe(
      true
    )
    expect(canPerformCollectionAction('manager', 'exits', 'reverse')).toBe(true)
    expect(canPerformCollectionAction('manager', 'audit_log', 'list')).toBe(
      true
    )
    expect(canPerformCollectionAction('manager', 'users', 'create')).toBe(false)
    expect(canApproveNegativeStock('manager')).toBe(true)
  })

  it('enforces economat rules: create/read products, purchases, exits, inventories, suppliers; no reversals or user management', () => {
    for (const col of [
      'products',
      'suppliers',
      'purchases',
      'purchase_lines',
      'exits',
      'exit_lines',
      'inventory_sessions',
      'inventory_lines',
    ] as CollectionName[]) {
      expect(canPerformCollectionAction('economat', col, 'list')).toBe(true)
      expect(canPerformCollectionAction('economat', col, 'create')).toBe(true)
    }
    expect(canPerformCollectionAction('economat', 'purchases', 'reverse')).toBe(
      false
    )
    expect(canPerformCollectionAction('economat', 'users', 'list')).toBe(false)
    expect(canApproveNegativeStock('economat')).toBe(false)
  })

  it('enforces cuisine rules: read products and stock, create exits only; cannot see prices, suppliers or payments', () => {
    expect(canPerformCollectionAction('cuisine', 'products', 'list')).toBe(true)
    expect(canPerformCollectionAction('cuisine', 'products', 'create')).toBe(
      false
    )
    expect(canPerformCollectionAction('cuisine', 'exits', 'create')).toBe(true)
    expect(canPerformCollectionAction('cuisine', 'exit_lines', 'create')).toBe(
      true
    )

    // Cannot see suppliers, purchases, or payments
    expect(canPerformCollectionAction('cuisine', 'suppliers', 'list')).toBe(
      false
    )
    expect(canPerformCollectionAction('cuisine', 'purchases', 'list')).toBe(
      false
    )
    expect(
      canPerformCollectionAction('cuisine', 'purchase_lines', 'list')
    ).toBe(false)
    expect(canSeeFinancialData('cuisine')).toBe(false)

    // Route restrictions for cuisine
    expect(canAccessRoute('cuisine', '/sorties-de-stock')).toBe(true)
    expect(canAccessRoute('cuisine', '/fournisseurs')).toBe(false)
    expect(canAccessRoute('cuisine', '/factures-paiements')).toBe(false)
    expect(canAccessRoute('cuisine', '/entrees-de-stock')).toBe(false)
  })

  it('enforces consultation rules: read-only everywhere except users', () => {
    for (const col of [
      'products',
      'suppliers',
      'purchases',
      'purchase_lines',
      'exits',
      'exit_lines',
      'inventory_sessions',
      'inventory_lines',
      'audit_log',
      'settings',
      'import_batches',
    ] as CollectionName[]) {
      expect(canPerformCollectionAction('consultation', col, 'list')).toBe(true)
      expect(canPerformCollectionAction('consultation', col, 'view')).toBe(true)
      expect(canPerformCollectionAction('consultation', col, 'create')).toBe(
        false
      )
      expect(canPerformCollectionAction('consultation', col, 'update')).toBe(
        false
      )
      expect(canPerformCollectionAction('consultation', col, 'delete')).toBe(
        false
      )
    }
    expect(canPerformCollectionAction('consultation', 'users', 'list')).toBe(
      false
    )
  })
})
