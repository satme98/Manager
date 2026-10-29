import type { CollectionName, UserRole } from '@/data/types'

export type CrudOperation =
  | 'list'
  | 'view'
  | 'create'
  | 'update'
  | 'delete'
  | 'reverse'

export const ALL_ROLES: UserRole[] = [
  'admin',
  'manager',
  'economat',
  'cuisine',
  'consultation',
]

export const ROLE_LABELS_FR: Record<UserRole, string> = {
  admin: 'Administrateur',
  manager: 'Manager',
  economat: 'Économat',
  cuisine: 'Cuisine',
  consultation: 'Consultation',
}

export const ROLE_LABELS = ROLE_LABELS_FR

export const ROLE_DESCRIPTIONS_FR: Record<UserRole, string> = {
  admin:
    'Accès complet : gestion des utilisateurs, paramètres, opérations, inventaires et contre-passations.',
  manager:
    'Lecture complète, opérations, validation des inventaires, autorisation de stock négatif et contre-passations. Sans gestion des utilisateurs.',
  economat:
    'Création et lecture des produits, fournisseurs, entrées, sorties et inventaires. Sans gestion des utilisateurs.',
  cuisine:
    'Lecture des produits et des quantités en stock, saisie des sorties uniquement. Aucun accès aux prix, fournisseurs ou paiements.',
  consultation:
    'Accès en lecture seule sur les données opérationnelles. Aucune création, modification ni gestion des utilisateurs.',
}

export const ROLE_DESCRIPTIONS = ROLE_DESCRIPTIONS_FR

/**
 * Immutable collections where direct deletion is strictly prohibited for ALL roles,
 * including admin. Corrections must be recorded as reversal entries.
 */
export const IMMUTABLE_COLLECTIONS: ReadonlySet<CollectionName> = new Set([
  'purchases',
  'purchase_lines',
  'exits',
  'exit_lines',
  'inventory_sessions',
  'inventory_lines',
  'audit_log',
])

/**
 * Evaluates whether a given user role is permitted to perform an operation on a collection.
 * Mirrors the exact PocketBase API rules defined in pb_migrations/ and pb_hooks/.
 */
export function canPerformCollectionAction(
  role: UserRole | null | undefined,
  collection: CollectionName,
  operation: CrudOperation
): boolean {
  // Rule: Everyone must be logged in. No public access.
  if (!role) return false

  // Rule: Nobody can delete purchases, exits, inventory lines or audit logs.
  if (operation === 'delete' && IMMUTABLE_COLLECTIONS.has(collection)) {
    return false
  }

  // Rule: Audit log is append-only via server hooks; nobody can manually update or delete it.
  if (collection === 'audit_log') {
    if (operation === 'update' || operation === 'delete') return false
    if (operation === 'list' || operation === 'view') {
      return role === 'admin' || role === 'manager' || role === 'consultation'
    }
    return false
  }

  // Rule: Only admin can create or change users and roles.
  if (collection === 'users') {
    if (operation === 'list' || operation === 'view') {
      return role === 'admin'
    }
    return role === 'admin'
  }

  // Reversal operations on purchases / exits allow admin, manager, and economat (economat requests approval unless same-day own doc).
  // Reversal on import_batches requires admin or manager.
  if (operation === 'reverse') {
    if (collection === 'purchases' || collection === 'exits') {
      return role === 'admin' || role === 'manager' || role === 'economat'
    }
    if (
      collection === 'import_batches' ||
      collection === 'inventory_sessions'
    ) {
      return role === 'admin' || role === 'manager'
    }
    return false
  }

  // Only admin and manager can create or update import_batches
  if (
    collection === 'import_batches' &&
    (operation === 'create' || operation === 'update')
  ) {
    return role === 'admin' || role === 'manager'
  }

  switch (role) {
    case 'admin':
      // Admin has full access (except deleting immutable movements handled above).
      return true

    case 'manager':
      // Manager: read all, create/update operations, approve reversals, no user management.
      if (operation === 'delete') {
        // Manager cannot delete records
        return false
      }
      return true

    case 'economat':
      // Economat: create/read products, purchases, exits, inventories, suppliers.
      if (operation === 'list' || operation === 'view') {
        return [
          'products',
          'suppliers',
          'purchases',
          'purchase_lines',
          'exits',
          'exit_lines',
          'inventory_sessions',
          'inventory_lines',
          'settings',
          'import_batches',
        ].includes(collection)
      }
      if (operation === 'create' || operation === 'update') {
        return [
          'products',
          'suppliers',
          'purchases',
          'purchase_lines',
          'exits',
          'exit_lines',
          'inventory_sessions',
          'inventory_lines',
        ].includes(collection)
      }
      return false

    case 'cuisine':
      // Cuisine: read products and stock, create exits only. Cannot see prices, suppliers or payments.
      if (
        collection === 'suppliers' ||
        collection === 'purchases' ||
        collection === 'purchase_lines' ||
        collection === 'import_batches'
      ) {
        return false
      }
      if (operation === 'list' || operation === 'view') {
        return [
          'products',
          'exits',
          'exit_lines',
          'inventory_sessions',
          'inventory_lines',
          'settings',
        ].includes(collection)
      }
      if (operation === 'create') {
        return collection === 'exits' || collection === 'exit_lines'
      }
      return false

    case 'consultation':
      // Consultation: read-only everywhere except hidden/admin-only fields.
      if (operation === 'list' || operation === 'view') {
        return (collection as string) !== 'users'
      }
      return false

    default:
      return false
  }
}

export function canSeeFinancialData(role: UserRole | null | undefined): boolean {
  if (!role) return false
  return role !== 'cuisine'
}

export function canApproveNegativeStock(
  role: UserRole | null | undefined
): boolean {
  return role === 'admin' || role === 'manager'
}

export function canConfirmInventory(
  role: UserRole | null | undefined,
  allowEconomatConfirm = false
): boolean {
  if (role === 'admin' || role === 'manager') return true
  if (role === 'economat' && allowEconomatConfirm) return true
  return false
}

export function canRunExcelImport(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'manager'
}

export function canReverseOrApprove(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'manager'
}

export function isReadOnlyRole(role: UserRole | null | undefined): boolean {
  return !role || role === 'consultation'
}

/**
 * Route guard matrix determining which sidebar routes a role can view/access.
 */
export function canAccessRoute(
  role: UserRole | null | undefined,
  routePath: string
): boolean {
  if (!role) return false
  const cleanPath = routePath.split('?')[0] || '/'

  // Admin-only routes
  if (cleanPath.startsWith('/utilisateurs')) {
    return role === 'admin'
  }

  // Cuisine restrictions: cannot see prices, suppliers, purchases, invoices, replenishment, reports, or system settings
  if (role === 'cuisine') {
    const cuisineAllowed = [
      '/',
      '/produits',
      '/etat-des-stocks',
      '/sorties-de-stock',
      '/pertes-gaspillage',
    ]
    return cuisineAllowed.includes(cleanPath)
  }

  // Only roles admin and manager can import or run Excel parity & cleanup
  if (
    cleanPath.startsWith('/import-export') ||
    cleanPath.startsWith('/controle-excel') ||
    cleanPath.startsWith('/a-corriger')
  ) {
    return (
      role === 'admin' ||
      role === 'manager' ||
      (cleanPath.startsWith('/controle-excel') && role === 'consultation')
    )
  }

  if (cleanPath.startsWith('/parametres')) {
    return role === 'admin' || role === 'manager' || role === 'consultation'
  }

  return true
}
