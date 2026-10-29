import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FolderCog,
  Lock,
  MoreHorizontal,
  Package,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { repository } from '@/data'
import { invalidateDashboardAnalyticsCache } from '@/data/analytics'
import {
  type ConfirmedInventoryCount,
  type ProductStockResult,
  type StockExitEntry,
  type StockMovementEntry,
  computeProductStock,
  computeSupplierAggregates,
  normalizeProductRef,
  normalizeSearchText,
  suggestNextProductRef,
} from '@/lib/stock-engine'
import type {
  ProductRecord,
  StockStatusLabel,
  VatConvention,
} from '@/data/types'
import { formatMAD, formatQty } from '@/lib/format'
import { canPerformCollectionAction, canSeeFinancialData } from '@/lib/rbac'
import { useAuthStore } from '@/stores/auth-store'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search as GlobalSearchButton } from '@/components/search'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ProductDetailView, StockStatusBadge } from './product-detail'
import {
  type TaxonomyKind,
  TaxonomyManagerDialog,
} from './taxonomy-manager-dialog'

type SortField =
  | 'ref'
  | 'name'
  | 'category'
  | 'unit'
  | 'stock'
  | 'min_stock'
  | 'status'
  | 'averagePrice'
  | 'stockValue'
  | 'location'

type SortDirection = 'asc' | 'desc'

interface ProductFormState {
  ref: string
  name: string
  category: string
  unit: string
  initial_stock: string
  min_stock: string
  location: string
  notes: string
}

const DEFAULT_UNITS = [
  'kg',
  'g',
  'L',
  'cl',
  'ml',
  'unité',
  'pièce',
  'boîte',
  'bouteille',
  'carton',
  'sachet',
  'barquette',
  'botte',
]

function readUrlParam(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const params = new URLSearchParams(window.location.search)
  return params.get(key) ?? fallback
}

export function ProduitsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.auth.user)
  const role = user?.role ?? 'consultation'

  const canCreate = canPerformCollectionAction(role, 'products', 'create')
  const canEdit = canPerformCollectionAction(role, 'products', 'update')
  const canSeePrices = canSeeFinancialData(role)
  const canManageUnitWithMovements = role === 'admin' || role === 'manager'
  const canListSuppliers = canPerformCollectionAction(role, 'suppliers', 'list')
  const canListPurchases = canPerformCollectionAction(role, 'purchases', 'list')
  const canListAudit = canPerformCollectionAction(role, 'audit_log', 'list')

  // URL-synced filters & state
  const [selectedProductId, setSelectedProductId] = useState<string>(() =>
    readUrlParam('productId', '')
  )
  const [searchQuery, setSearchQuery] = useState<string>(() =>
    readUrlParam('q', '')
  )
  const [categoryFilter, setCategoryFilter] = useState<string>(() =>
    readUrlParam('cat', 'all')
  )
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    readUrlParam('status', 'all')
  )
  const [locationFilter, setLocationFilter] = useState<string>(() =>
    readUrlParam('loc', 'all')
  )
  const [supplierFilter, setSupplierFilter] = useState<string>(() =>
    readUrlParam('sup', 'all')
  )
  const [archiveFilter, setArchiveFilter] = useState<string>(() =>
    readUrlParam('arch', 'active')
  )
  const [withoutCategoryOnly, setWithoutCategoryOnly] = useState<boolean>(
    () => readUrlParam('noCat', '0') === '1'
  )
  const [withoutMinStockOnly, setWithoutMinStockOnly] = useState<boolean>(
    () => readUrlParam('noMin', '0') === '1'
  )
  const [sortField, setSortField] = useState<SortField>(
    () => (readUrlParam('sort', 'ref') as SortField) || 'ref'
  )
  const [sortDir, setSortDir] = useState<SortDirection>(
    () => (readUrlParam('dir', 'asc') as SortDirection) || 'asc'
  )
  const [pageSize, setPageSize] = useState<number>(() => {
    const parsed = parseInt(readUrlParam('size', '25'), 10)
    return [25, 50, 100].includes(parsed) ? parsed : 25
  })
  const [currentPage, setCurrentPage] = useState<number>(() => {
    const parsed = parseInt(readUrlParam('page', '1'), 10)
    return parsed > 0 ? parsed : 1
  })

  // Listen to custom event or popstate for global search navigation
  useEffect(() => {
    const syncFromUrl = () => {
      const pid = readUrlParam('productId', '')
      setSelectedProductId(pid)
    }
    window.addEventListener('popstate', syncFromUrl)
    window.addEventListener('monarq:navigate', syncFromUrl)
    return () => {
      window.removeEventListener('popstate', syncFromUrl)
      window.removeEventListener('monarq:navigate', syncFromUrl)
    }
  }, [])

  // Sync filters to URL query string
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams()
    if (selectedProductId) params.set('productId', selectedProductId)
    if (searchQuery) params.set('q', searchQuery)
    if (categoryFilter !== 'all') params.set('cat', categoryFilter)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (locationFilter !== 'all') params.set('loc', locationFilter)
    if (supplierFilter !== 'all') params.set('sup', supplierFilter)
    if (archiveFilter !== 'active') params.set('arch', archiveFilter)
    if (withoutCategoryOnly) params.set('noCat', '1')
    if (withoutMinStockOnly) params.set('noMin', '1')
    if (sortField !== 'ref') params.set('sort', sortField)
    if (sortDir !== 'asc') params.set('dir', sortDir)
    if (pageSize !== 25) params.set('size', String(pageSize))
    if (currentPage > 1) params.set('page', String(currentPage))

    const qs = params.toString()
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    window.history.replaceState(null, '', nextUrl)
  }, [
    selectedProductId,
    searchQuery,
    categoryFilter,
    statusFilter,
    locationFilter,
    supplierFilter,
    archiveFilter,
    withoutCategoryOnly,
    withoutMinStockOnly,
    sortField,
    sortDir,
    pageSize,
    currentPage,
  ])

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState({
    ref: true,
    name: true,
    category: true,
    unit: true,
    stock: true,
    min_stock: true,
    status: true,
    averagePrice: true,
    stockValue: true,
    location: true,
  })

  // Row selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Bulk action modal state
  const [bulkActionOpen, setBulkActionOpen] = useState(false)
  const [bulkActionKind, setBulkActionKind] = useState<
    'category' | 'unit' | 'location' | 'min_stock' | 'archive'
  >('category')
  const [bulkValue, setBulkValue] = useState('')

  // Archive warning dialog for single product with stock > 0
  const [archiveTargetProduct, setArchiveTargetProduct] =
    useState<ProductRecord | null>(null)

  // Taxonomy manager dialog
  const [taxonomyOpen, setTaxonomyOpen] = useState(false)
  const [taxonomyInitialTab, setTaxonomyInitialTab] =
    useState<TaxonomyKind>('categories')

  // Create / Edit Drawer State (preserves unsaved create draft if closed by mistake)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(
    null
  )
  const [createDraft, setCreateDraft] = useState<ProductFormState>({
    ref: '',
    name: '',
    category: '',
    unit: 'kg',
    initial_stock: '0',
    min_stock: '0',
    location: '',
    notes: '',
  })
  const [hasUnsavedCreateDraft, setHasUnsavedCreateDraft] = useState(false)
  const [formState, setFormState] = useState<ProductFormState>(createDraft)
  const [submittedAttempt, setSubmittedAttempt] = useState(false)
  const [quickNewCategory, setQuickNewCategory] = useState('')
  const [showQuickNewCategory, setShowQuickNewCategory] = useState(false)
  const [unitChangeConfirmOpen, setUnitChangeConfirmOpen] = useState(false)

  // Queries via repository
  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => repository.listProducts(),
  })

  const purchasesQuery = useQuery({
    queryKey: ['purchases'],
    queryFn: () => repository.listPurchases(),
    enabled: canListPurchases,
  })

  const exitsQuery = useQuery({
    queryKey: ['exits'],
    queryFn: () => repository.listExits(),
  })

  const inventoriesQuery = useQuery({
    queryKey: ['inventories'],
    queryFn: () => repository.listInventories(),
  })

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => repository.listSuppliers(),
    enabled: canListSuppliers,
  })

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => repository.listSettings(),
  })

  const auditLogsQuery = useQuery({
    queryKey: ['audit_log'],
    queryFn: () => repository.listAuditLogs(),
    enabled: canListAudit,
  })

  const products = useMemo(
    () => productsQuery.data ?? [],
    [productsQuery.data]
  )
  const purchasesData = useMemo(
    () => purchasesQuery.data ?? { headers: [], lines: [] },
    [purchasesQuery.data]
  )
  const exitsData = useMemo(
    () => exitsQuery.data ?? { headers: [], lines: [] },
    [exitsQuery.data]
  )
  const inventoriesData = useMemo(
    () => inventoriesQuery.data ?? { sessions: [], lines: [] },
    [inventoriesQuery.data]
  )
  const suppliers = useMemo(
    () => suppliersQuery.data ?? [],
    [suppliersQuery.data]
  )
  const settings = useMemo(
    () => settingsQuery.data ?? [],
    [settingsQuery.data]
  )
  const auditLogs = useMemo(
    () => auditLogsQuery.data ?? [],
    [auditLogsQuery.data]
  )

  const vatConvention: VatConvention = useMemo(() => {
    const found = settings.find((s) => s.key === 'vat_convention')
    return found?.value === 'HT' ? 'HT' : 'TTC'
  }, [settings])

  const configuredCategories = useMemo(() => {
    const found = settings.find((s) => s.key === 'categories_list')
    const fromSetting = Array.isArray(found?.value)
      ? (found.value as string[])
      : []
    const fromProducts = products
      .map((p) => p.category?.trim())
      .filter((c): c is string => Boolean(c))
    return Array.from(new Set([...fromSetting, ...fromProducts])).sort((a, b) =>
      a.localeCompare(b, 'fr')
    )
  }, [settings, products])

  const configuredUnits = useMemo(() => {
    const found = settings.find((s) => s.key === 'units_list')
    const fromSetting = Array.isArray(found?.value)
      ? (found.value as string[])
      : []
    const fromProducts = products
      .map((p) => p.unit?.trim())
      .filter((u): u is string => Boolean(u))
    return Array.from(
      new Set([...DEFAULT_UNITS, ...fromSetting, ...fromProducts])
    ).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [settings, products])

  const configuredLocations = useMemo(() => {
    const found = settings.find((s) => s.key === 'locations_list')
    const fromSetting = Array.isArray(found?.value)
      ? (found.value as string[])
      : []
    const fromProducts = products
      .map((p) => p.location?.trim())
      .filter((l): l is string => Boolean(l))
    return Array.from(new Set([...fromSetting, ...fromProducts])).sort((a, b) =>
      a.localeCompare(b, 'fr')
    )
  }, [settings, products])

  // Memoized stock calculation across all products (O(N+M) pre-grouped by productId for instant 1,000+ rows rendering)
  const { stockByProductId, productsWithMovements } = useMemo(() => {
    const purchaseMap = new Map(purchasesData.headers.map((h) => [h.id, h]))
    const exitMap = new Map(exitsData.headers.map((h) => [h.id, h]))
    const sessionMap = new Map(
      inventoriesData.sessions.map((s) => [s.id, s])
    )

    const entriesByProd = new Map<string, StockMovementEntry[]>()
    const exitsByProd = new Map<string, StockExitEntry[]>()
    const countsByProd = new Map<string, ConfirmedInventoryCount[]>()
    const hasMovementsSet = new Set<string>()

    for (const pl of purchasesData.lines) {
      hasMovementsSet.add(pl.product)
      const h = purchaseMap.get(pl.purchase)
      const list = entriesByProd.get(pl.product) ?? []
      list.push({
        id: pl.purchase,
        productId: pl.product,
        date: h?.date ?? pl.created_at,
        qty: pl.qty,
        unitPrice: pl.unit_price,
        amount: pl.amount,
        isReversal: Boolean(h?.reversed_of),
        reversedOfId: h?.reversed_of ?? null,
      })
      entriesByProd.set(pl.product, list)
    }

    for (const xl of exitsData.lines) {
      hasMovementsSet.add(xl.product)
      const h = exitMap.get(xl.exit)
      const list = exitsByProd.get(xl.product) ?? []
      list.push({
        id: xl.exit,
        productId: xl.product,
        date: h?.date ?? xl.created_at,
        qtyConsumed: xl.qty_consumed,
        qtyWasted: xl.qty_wasted,
        isReversal: Boolean(h?.reversed_of),
        reversedOfId: h?.reversed_of ?? null,
      })
      exitsByProd.set(xl.product, list)
    }

    inventoriesData.lines.forEach((il, idx) => {
      hasMovementsSet.add(il.product)
      const s = sessionMap.get(il.session)
      if (!s || s.status !== 'confirmed') return
      const list = countsByProd.get(il.product) ?? []
      list.push({
        id: il.id,
        sessionId: s.id,
        productId: il.product,
        date: s.confirmed_at || s.date,
        counted: il.counted,
        confirmedOrder: il.order_index ?? idx,
      })
      countsByProd.set(il.product, list)
    })

    const map = new Map<string, ProductStockResult>()
    for (const p of products) {
      const res = computeProductStock(
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
      map.set(p.id, res)
    }

    return { stockByProductId: map, productsWithMovements: hasMovementsSet }
  }, [products, purchasesData, exitsData, inventoriesData])

  // Supplier aggregates (for "fournisseur" filter: products ever bought from that supplier)
  const supplierAggregates = useMemo(
    () =>
      computeSupplierAggregates(
        suppliers,
        purchasesData.headers,
        purchasesData.lines
      ),
    [suppliers, purchasesData]
  )

  // Filtered and sorted products
  const filteredProducts = useMemo(() => {
    const cleanQuery = normalizeSearchText(searchQuery)
    const supplierProductSet =
      supplierFilter !== 'all'
        ? supplierAggregates.get(supplierFilter)?.purchasedProductIds
        : null

    const filtered = products.filter((p) => {
      // Archive filter
      if (archiveFilter === 'active' && p.archived) return false
      if (archiveFilter === 'archived' && !p.archived) return false

      // Search by name or ref (case-insensitive, accent-insensitive)
      if (cleanQuery) {
        const hayRef = normalizeSearchText(p.ref)
        const hayName = normalizeSearchText(p.name)
        if (!hayRef.includes(cleanQuery) && !hayName.includes(cleanQuery)) {
          return false
        }
      }

      // Category filter
      if (
        categoryFilter !== 'all' &&
        (p.category || '').trim() !== categoryFilter
      ) {
        return false
      }

      // Location filter
      if (
        locationFilter !== 'all' &&
        (p.location || '').trim() !== locationFilter
      ) {
        return false
      }

      // Supplier filter
      if (supplierProductSet && !supplierProductSet.has(p.id)) {
        return false
      }

      // Quick filters
      if (withoutCategoryOnly && Boolean(p.category?.trim())) {
        return false
      }
      if (withoutMinStockOnly && p.min_stock !== null && p.min_stock > 0) {
        return false
      }

      // Status filter
      const st = stockByProductId.get(p.id)
      if (statusFilter !== 'all' && st?.status !== statusFilter) {
        return false
      }

      return true
    })

    const statusPriority: Record<StockStatusLabel, number> = {
      Alerte: 1,
      'À surveiller': 2,
      OK: 3,
      'À définir': 4,
    }

    filtered.sort((a, b) => {
      const stA = stockByProductId.get(a.id)
      const stB = stockByProductId.get(b.id)
      let cmp = 0

      switch (sortField) {
        case 'ref':
          cmp = a.ref.localeCompare(b.ref, 'fr', { numeric: true })
          break
        case 'name':
          cmp = a.name.localeCompare(b.name, 'fr')
          break
        case 'category':
          cmp = (a.category || '').localeCompare(b.category || '', 'fr')
          break
        case 'unit':
          cmp = (a.unit || '').localeCompare(b.unit || '', 'fr')
          break
        case 'stock':
          cmp = (stA?.stock ?? 0) - (stB?.stock ?? 0)
          break
        case 'min_stock':
          cmp = (a.min_stock ?? -1) - (b.min_stock ?? -1)
          break
        case 'status':
          cmp =
            statusPriority[stA?.status ?? 'À définir'] -
            statusPriority[stB?.status ?? 'À définir']
          break
        case 'averagePrice':
          cmp = (stA?.averagePrice ?? -1) - (stB?.averagePrice ?? -1)
          break
        case 'stockValue':
          cmp = (stA?.stockValue ?? -1) - (stB?.stockValue ?? -1)
          break
        case 'location':
          cmp = (a.location || '').localeCompare(b.location || '', 'fr')
          break
      }

      return sortDir === 'asc' ? cmp : -cmp
    })

    return filtered
  }, [
    products,
    searchQuery,
    categoryFilter,
    statusFilter,
    locationFilter,
    supplierFilter,
    archiveFilter,
    withoutCategoryOnly,
    withoutMinStockOnly,
    sortField,
    sortDir,
    stockByProductId,
    supplierAggregates,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedProducts = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredProducts.slice(start, start + pageSize)
  }, [filteredProducts, safePage, pageSize])

  // Suggested reference for new product
  const suggestedNextRef = useMemo(
    () => suggestNextProductRef(products.map((p) => p.ref)),
    [products]
  )

  // Immediate inline reference collision check
  const refCollisionProduct = useMemo(() => {
    const clean = normalizeProductRef(formState.ref)
    if (!clean) return null
    return (
      products.find(
        (p) =>
          p.id !== editingProduct?.id && normalizeProductRef(p.ref) === clean
      ) ?? null
    )
  }, [formState.ref, products, editingProduct])

  const editingProductHasMovements = editingProduct
    ? productsWithMovements.has(editingProduct.id)
    : false

  const openCreateDrawer = () => {
    setEditingProduct(null)
    setSubmittedAttempt(false)
    setShowQuickNewCategory(false)
    if (hasUnsavedCreateDraft && (createDraft.name || createDraft.notes)) {
      setFormState(createDraft)
    } else {
      const fresh: ProductFormState = {
        ref: suggestedNextRef,
        name: '',
        category: configuredCategories[0] ?? '',
        unit: 'kg',
        initial_stock: '0',
        min_stock: '0',
        location: '',
        notes: '',
      }
      setCreateDraft(fresh)
      setFormState(fresh)
    }
    setDrawerOpen(true)
  }

  const openEditDrawer = (product: ProductRecord) => {
    setEditingProduct(product)
    setSubmittedAttempt(false)
    setShowQuickNewCategory(false)
    setFormState({
      ref: product.ref,
      name: product.name,
      category: product.category || '',
      unit: product.unit || 'kg',
      initial_stock: String(product.initial_stock ?? 0),
      min_stock:
        product.min_stock !== null && product.min_stock !== undefined
          ? String(product.min_stock)
          : '0',
      location: product.location || '',
      notes: product.notes || '',
    })
    setDrawerOpen(true)
  }

  const updateFormField = <K extends keyof ProductFormState>(
    field: K,
    val: ProductFormState[K]
  ) => {
    setFormState((prev) => {
      const next = { ...prev, [field]: val }
      if (!editingProduct) {
        setCreateDraft(next)
        setHasUnsavedCreateDraft(true)
      }
      return next
    })
  }

  const saveProductMutation = useMutation({
    mutationFn: async () => {
      const cleanRef = normalizeProductRef(formState.ref)
      const cleanName = formState.name.trim()
      const cleanUnit = formState.unit.trim() || 'kg'
      const initStock = parseFloat(formState.initial_stock) || 0
      const minStockVal = parseFloat(formState.min_stock)
      const minStock =
        !Number.isNaN(minStockVal) && minStockVal > 0 ? minStockVal : null

      if (!cleanRef || !cleanName) {
        throw new Error('La référence et le nom du produit sont obligatoires.')
      }

      if (editingProduct) {
        return await repository.updateProduct(editingProduct.id, {
          ref: cleanRef,
          name: cleanName,
          category: formState.category.trim(),
          unit: cleanUnit,
          initial_stock: initStock,
          min_stock: minStock,
          location: formState.location.trim(),
          notes: formState.notes.trim(),
        })
      } else {
        return await repository.createProduct({
          ref: cleanRef,
          name: cleanName,
          category: formState.category.trim(),
          unit: cleanUnit,
          initial_stock: initStock,
          min_stock: minStock,
          location: formState.location.trim(),
          notes: formState.notes.trim(),
          archived: false,
        })
      }
    },
    onSuccess: (saved) => {
      invalidateDashboardAnalyticsCache()
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      setUnitChangeConfirmOpen(false)
      setDrawerOpen(false)
      if (!editingProduct) {
        setHasUnsavedCreateDraft(false)
        setCreateDraft({
          ref: '',
          name: '',
          category: '',
          unit: 'kg',
          initial_stock: '0',
          min_stock: '0',
          location: '',
          notes: '',
        })
        toast.success(`Produit « ${saved.name} » (${saved.ref}) créé.`)
      } else {
        toast.success(`Produit « ${saved.name} » (${saved.ref}) mis à jour.`)
      }
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleDrawerSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittedAttempt(true)

    if (
      !formState.ref.trim() ||
      !formState.name.trim() ||
      !formState.unit.trim() ||
      refCollisionProduct
    ) {
      return
    }

    // Check if unit changed on a product with movements
    if (
      editingProduct &&
      editingProductHasMovements &&
      formState.unit.trim() !== editingProduct.unit.trim()
    ) {
      if (!canManageUnitWithMovements) {
        toast.error(
          "Seul un Manager ou Administrateur peut modifier l'unité d'un produit ayant déjà des mouvements."
        )
        return
      }
      setUnitChangeConfirmOpen(true)
      return
    }

    saveProductMutation.mutate()
  }

  const toggleArchiveMutation = useMutation({
    mutationFn: async (product: ProductRecord) => {
      return await repository.updateProduct(product.id, {
        archived: !product.archived,
      })
    },
    onSuccess: (updated) => {
      setArchiveTargetProduct(null)
      invalidateDashboardAnalyticsCache()
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      toast.success(
        updated.archived
          ? `Produit « ${updated.name} » archivé.`
          : `Produit « ${updated.name} » restauré dans la liste active.`
      )
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleRequestArchiveToggle = (product: ProductRecord) => {
    if (!product.archived) {
      const currentStock = stockByProductId.get(product.id)?.stock ?? 0
      if (currentStock > 0) {
        setArchiveTargetProduct(product)
        return
      }
    }
    toggleArchiveMutation.mutate(product)
  }

  const bulkUpdateMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedIds)
      if (ids.length === 0) return 0

      if (bulkActionKind === 'category') {
        return await repository.bulkUpdateProducts(ids, {
          category: bulkValue.trim(),
        })
      }
      if (bulkActionKind === 'unit') {
        return await repository.bulkUpdateProducts(ids, {
          unit: bulkValue.trim(),
        })
      }
      if (bulkActionKind === 'location') {
        return await repository.bulkUpdateProducts(ids, {
          location: bulkValue.trim(),
        })
      }
      if (bulkActionKind === 'min_stock') {
        const val = parseFloat(bulkValue)
        return await repository.bulkUpdateProducts(ids, {
          min_stock: !Number.isNaN(val) && val > 0 ? val : null,
        })
      }
      return await repository.bulkUpdateProducts(ids, {
        archived: true,
      })
    },
    onSuccess: (count) => {
      setBulkActionOpen(false)
      setSelectedIds(new Set())
      invalidateDashboardAnalyticsCache()
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      toast.success(`${count} produit(s) mis à jour avec succès.`)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className='ml-1 inline h-3.5 w-3.5 text-[#6D7175]/60' />
    }
    return sortDir === 'asc' ? (
      <ArrowUp className='ml-1 inline h-3.5 w-3.5 text-[#202223]' />
    ) : (
      <ArrowDown className='ml-1 inline h-3.5 w-3.5 text-[#202223]' />
    )
  }

  const handleExport = (format: 'xlsx' | 'csv') => {
    const rows = filteredProducts.map((p) => {
      const st = stockByProductId.get(p.id)
      const baseRow: Record<string, string | number> = {
        Référence: p.ref,
        Produit: p.name,
        Catégorie: p.category || 'Sans catégorie',
        Unité: p.unit,
        'Stock actuel': st?.stock ?? p.initial_stock,
        'Stock minimum': p.min_stock ?? '',
        Statut: st?.status ?? 'À définir',
      }
      if (canSeePrices) {
        baseRow[`Prix moyen (${vatConvention} MAD)`] =
          st?.averagePrice !== null && st?.averagePrice !== undefined
            ? st.averagePrice
            : 'Prix manquant'
        baseRow[`Valeur du stock (${vatConvention} MAD)`] =
          st?.stockValue !== null && st?.stockValue !== undefined
            ? st.stockValue
            : 'Prix manquant'
      }
      baseRow.Emplacement = p.location || ''
      baseRow.Statut_Fiche = p.archived ? 'Archivé' : 'Actif'
      return baseRow
    })

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Produits')
    const dateStamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') {
      XLSX.writeFile(wb, `MONARQ_Produits_${dateStamp}.csv`, {
        bookType: 'csv',
      })
    } else {
      XLSX.writeFile(wb, `MONARQ_Produits_${dateStamp}.xlsx`)
    }
    toast.success(
      `Export ${format.toUpperCase()} généré (${rows.length} produit(s)).`
    )
  }

  const selectedProductRecord = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId]
  )

  const allOnPageSelected =
    paginatedProducts.length > 0 &&
    paginatedProducts.every((p) => selectedIds.has(p.id))

  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const p of paginatedProducts) {
        if (checked) next.add(p.id)
        else next.delete(p.id)
      }
      return next
    })
  }

  const toggleSelectOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchButton />
        <div className='ms-auto flex items-center space-x-4'>
          <ProfileDropdown />
        </div>
      </Header>

      <Main className='bg-[#F6F6F7]'>
        {selectedProductRecord ? (
          <ProductDetailView
            product={selectedProductRecord}
            purchases={purchasesData.headers}
            purchaseLines={purchasesData.lines}
            exits={exitsData.headers}
            exitLines={exitsData.lines}
            inventorySessions={inventoriesData.sessions}
            inventoryLines={inventoriesData.lines}
            suppliers={suppliers}
            auditLogs={auditLogs}
            vatConvention={vatConvention}
            canEdit={canEdit}
            canSeePrices={canSeePrices}
            onBack={() => setSelectedProductId('')}
            onEdit={(prod) => openEditDrawer(prod)}
            onToggleArchive={(prod) => handleRequestArchiveToggle(prod)}
          />
        ) : (
          <div className='space-y-5'>
            {/* Page Title + Actions */}
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <h1 className='text-xl font-semibold tracking-tight text-[#202223]'>
                  Produits
                </h1>
                <p className='text-xs text-[#6D7175]'>
                  Catalogue des articles, stock théorique en temps réel, seuils
                  d’alerte et valorisation PMP ({vatConvention}).
                </p>
              </div>

              <div className='flex flex-wrap items-center gap-2'>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='outline'
                      size='sm'
                      className='border-[#E1E3E5] bg-white text-[#202223]'
                    >
                      Actions secondaires
                      <ChevronDown className='ml-1.5 h-4 w-4 text-[#6D7175]' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-56'>
                    <DropdownMenuLabel className='text-xs text-[#6D7175]'>
                      Import / Export
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => void navigate({ to: '/import-export' })}
                    >
                      <Upload className='mr-2 h-4 w-4' />
                      Importer (.xlsx / .xlsm)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport('xlsx')}>
                      <FileSpreadsheet className='mr-2 h-4 w-4' />
                      Exporter en Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport('csv')}>
                      <Download className='mr-2 h-4 w-4' />
                      Exporter en CSV (.csv)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className='text-xs text-[#6D7175]'>
                      Référentiels
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => {
                        setTaxonomyInitialTab('categories')
                        setTaxonomyOpen(true)
                      }}
                    >
                      <FolderCog className='mr-2 h-4 w-4' />
                      Gérer les catégories
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setTaxonomyInitialTab('units')
                        setTaxonomyOpen(true)
                      }}
                    >
                      <FolderCog className='mr-2 h-4 w-4' />
                      Gérer les unités
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setTaxonomyInitialTab('locations')
                        setTaxonomyOpen(true)
                      }}
                    >
                      <FolderCog className='mr-2 h-4 w-4' />
                      Gérer les emplacements
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {canCreate && (
                  <Button
                    size='sm'
                    onClick={openCreateDrawer}
                    className='bg-[#008060] text-white hover:bg-[#006e52]'
                  >
                    <Plus className='mr-1.5 h-4 w-4' />
                    Ajouter un produit
                    {hasUnsavedCreateDraft &&
                      (createDraft.name || createDraft.notes) && (
                        <span className='ml-1.5 rounded bg-white/20 px-1.5 py-0.5 text-[10px]'>
                          Brouillon
                        </span>
                      )}
                  </Button>
                )}
              </div>
            </div>

            {/* Filters Card */}
            <div className='space-y-3 rounded-lg border border-[#E1E3E5] bg-white p-4'>
              <div className='flex flex-col gap-3 lg:flex-row lg:items-center'>
                <div className='relative flex-1'>
                  <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6D7175]' />
                  <Input
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setCurrentPage(1)
                    }}
                    placeholder='Rechercher par nom ou référence (ex. P092, huile, farine)...'
                    className='h-9 border-[#E1E3E5] pl-9 text-sm'
                  />
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  {/* Catégorie */}
                  <Select
                    value={categoryFilter}
                    onValueChange={(v) => {
                      setCategoryFilter(v)
                      setCurrentPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 w-40 border-[#E1E3E5] text-xs'>
                      <SelectValue placeholder='Catégorie' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Toutes les catégories</SelectItem>
                      {configuredCategories.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Statut */}
                  <Select
                    value={statusFilter}
                    onValueChange={(v) => {
                      setStatusFilter(v)
                      setCurrentPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 w-36 border-[#E1E3E5] text-xs'>
                      <SelectValue placeholder='Statut stock' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Tous les statuts</SelectItem>
                      <SelectItem value='Alerte'>Alerte</SelectItem>
                      <SelectItem value='À surveiller'>À surveiller</SelectItem>
                      <SelectItem value='OK'>OK</SelectItem>
                      <SelectItem value='À définir'>À définir</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Emplacement */}
                  <Select
                    value={locationFilter}
                    onValueChange={(v) => {
                      setLocationFilter(v)
                      setCurrentPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 w-40 border-[#E1E3E5] text-xs'>
                      <SelectValue placeholder='Emplacement' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Tous emplacements</SelectItem>
                      {configuredLocations.map((loc) => (
                        <SelectItem key={loc} value={loc}>
                          {loc}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Fournisseur */}
                  {canListSuppliers && (
                    <Select
                      value={supplierFilter}
                      onValueChange={(v) => {
                        setSupplierFilter(v)
                        setCurrentPage(1)
                      }}
                    >
                      <SelectTrigger className='h-9 w-44 border-[#E1E3E5] text-xs'>
                        <SelectValue placeholder='Fournisseur' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='all'>
                          Tous les fournisseurs
                        </SelectItem>
                        {suppliers
                          .filter((s) => !s.archived)
                          .map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Actifs / Archivés */}
                  <Select
                    value={archiveFilter}
                    onValueChange={(v) => {
                      setArchiveFilter(v)
                      setCurrentPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 w-32 border-[#E1E3E5] text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='active'>Actifs</SelectItem>
                      <SelectItem value='archived'>Archivés</SelectItem>
                      <SelectItem value='all'>Tous</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Column Visibility */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='outline'
                        size='sm'
                        className='h-9 border-[#E1E3E5] text-xs'
                      >
                        <SlidersHorizontal className='mr-1.5 h-3.5 w-3.5' />
                        Colonnes
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end' className='w-48'>
                      <DropdownMenuLabel className='text-xs'>
                        Colonnes affichées
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.category}
                        onCheckedChange={(v) =>
                          setVisibleColumns((prev) => ({
                            ...prev,
                            category: Boolean(v),
                          }))
                        }
                      >
                        Catégorie
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.unit}
                        onCheckedChange={(v) =>
                          setVisibleColumns((prev) => ({
                            ...prev,
                            unit: Boolean(v),
                          }))
                        }
                      >
                        Unité
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.stock}
                        onCheckedChange={(v) =>
                          setVisibleColumns((prev) => ({
                            ...prev,
                            stock: Boolean(v),
                          }))
                        }
                      >
                        Stock actuel
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.min_stock}
                        onCheckedChange={(v) =>
                          setVisibleColumns((prev) => ({
                            ...prev,
                            min_stock: Boolean(v),
                          }))
                        }
                      >
                        Stock minimum
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.status}
                        onCheckedChange={(v) =>
                          setVisibleColumns((prev) => ({
                            ...prev,
                            status: Boolean(v),
                          }))
                        }
                      >
                        Statut
                      </DropdownMenuCheckboxItem>
                      {canSeePrices && (
                        <>
                          <DropdownMenuCheckboxItem
                            checked={visibleColumns.averagePrice}
                            onCheckedChange={(v) =>
                              setVisibleColumns((prev) => ({
                                ...prev,
                                averagePrice: Boolean(v),
                              }))
                            }
                          >
                            Prix moyen
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={visibleColumns.stockValue}
                            onCheckedChange={(v) =>
                              setVisibleColumns((prev) => ({
                                ...prev,
                                stockValue: Boolean(v),
                              }))
                            }
                          >
                            Valeur du stock
                          </DropdownMenuCheckboxItem>
                        </>
                      )}
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.location}
                        onCheckedChange={(v) =>
                          setVisibleColumns((prev) => ({
                            ...prev,
                            location: Boolean(v),
                          }))
                        }
                      >
                        Emplacement
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Quick checkboxes + Reset */}
              <div className='flex flex-wrap items-center justify-between gap-2 border-t border-[#E1E3E5] pt-2.5 text-xs'>
                <div className='flex flex-wrap items-center gap-4'>
                  <label className='inline-flex cursor-pointer items-center gap-2 text-[#202223]'>
                    <Checkbox
                      checked={withoutCategoryOnly}
                      onCheckedChange={(v) => {
                        setWithoutCategoryOnly(Boolean(v))
                        setCurrentPage(1)
                      }}
                    />
                    Sans catégorie
                  </label>
                  <label className='inline-flex cursor-pointer items-center gap-2 text-[#202223]'>
                    <Checkbox
                      checked={withoutMinStockOnly}
                      onCheckedChange={(v) => {
                        setWithoutMinStockOnly(Boolean(v))
                        setCurrentPage(1)
                      }}
                    />
                    Sans stock minimum
                  </label>
                </div>

                <div className='flex items-center gap-3 text-[#6D7175]'>
                  <span>
                    <strong className='text-[#202223]'>
                      {filteredProducts.length}
                    </strong>{' '}
                    produit{filteredProducts.length > 1 ? 's' : ''} affiché
                    {filteredProducts.length > 1 ? 's' : ''}
                  </span>
                  {(searchQuery ||
                    categoryFilter !== 'all' ||
                    statusFilter !== 'all' ||
                    locationFilter !== 'all' ||
                    supplierFilter !== 'all' ||
                    archiveFilter !== 'active' ||
                    withoutCategoryOnly ||
                    withoutMinStockOnly) && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 px-2 text-xs text-[#008060]'
                      onClick={() => {
                        setSearchQuery('')
                        setCategoryFilter('all')
                        setStatusFilter('all')
                        setLocationFilter('all')
                        setSupplierFilter('all')
                        setArchiveFilter('active')
                        setWithoutCategoryOnly(false)
                        setWithoutMinStockOnly(false)
                        setCurrentPage(1)
                      }}
                    >
                      <RotateCcw className='mr-1 h-3 w-3' />
                      Réinitialiser les filtres
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Bulk Actions Bar */}
            {canEdit && selectedIds.size > 0 && (
              <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#008060]/40 bg-[#E3F1DF]/60 px-4 py-2.5'>
                <div className='text-xs font-medium text-[#202223]'>
                  <strong>{selectedIds.size}</strong> produit(s) sélectionné(s)
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-8 bg-white text-xs'
                    onClick={() => {
                      setBulkActionKind('category')
                      setBulkValue(configuredCategories[0] ?? '')
                      setBulkActionOpen(true)
                    }}
                  >
                    Modifier la catégorie
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-8 bg-white text-xs'
                    onClick={() => {
                      setBulkActionKind('unit')
                      setBulkValue('kg')
                      setBulkActionOpen(true)
                    }}
                  >
                    Modifier l’unité
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-8 bg-white text-xs'
                    onClick={() => {
                      setBulkActionKind('location')
                      setBulkValue(configuredLocations[0] ?? '')
                      setBulkActionOpen(true)
                    }}
                  >
                    Modifier l’emplacement
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-8 bg-white text-xs'
                    onClick={() => {
                      setBulkActionKind('min_stock')
                      setBulkValue('5')
                      setBulkActionOpen(true)
                    }}
                  >
                    Définir le stock minimum
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-8 border-[#D72C0D]/30 bg-white text-xs text-[#D72C0D] hover:bg-red-50'
                    onClick={() => {
                      setBulkActionKind('archive')
                      setBulkValue('true')
                      setBulkActionOpen(true)
                    }}
                  >
                    Archiver la sélection
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-8 text-xs text-[#6D7175]'
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Désélectionner
                  </Button>
                </div>
              </div>
            )}

            {/* Table Card */}
            <div className='overflow-hidden rounded-lg border border-[#E1E3E5] bg-white'>
              {productsQuery.isLoading ? (
                <div className='space-y-3 p-6'>
                  <Skeleton className='h-8 w-full' />
                  <Skeleton className='h-8 w-full' />
                  <Skeleton className='h-8 w-full' />
                  <Skeleton className='h-8 w-full' />
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className='flex flex-col items-center justify-center px-6 py-16 text-center'>
                  <div className='mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F6F6F7]'>
                    <Package className='h-6 w-6 text-[#6D7175]' />
                  </div>
                  <h3 className='text-sm font-semibold text-[#202223]'>
                    Aucun produit trouvé
                  </h3>
                  <p className='mt-1 max-w-md text-xs text-[#6D7175]'>
                    {products.length === 0
                      ? 'La base produits est vide. Ajoutez votre premier produit ou importez votre classeur Excel MONARQ_ECONOMAT.'
                      : 'Aucun produit ne correspond à vos critères de recherche ou de filtrage.'}
                  </p>
                  <div className='mt-4 flex items-center gap-2'>
                    {canCreate && (
                      <Button
                        size='sm'
                        onClick={openCreateDrawer}
                        className='bg-[#008060] text-white hover:bg-[#006e52]'
                      >
                        <Plus className='mr-1.5 h-4 w-4' />
                        Ajouter un produit
                      </Button>
                    )}
                    {products.length === 0 && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => void navigate({ to: '/import-export' })}
                      >
                        <Upload className='mr-1.5 h-4 w-4' />
                        Importer depuis Excel
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className='border-b border-[#E1E3E5] bg-[#F6F6F7] hover:bg-[#F6F6F7]'>
                        {canEdit && (
                          <TableHead className='w-10 px-3'>
                            <Checkbox
                              checked={allOnPageSelected}
                              onCheckedChange={(v) =>
                                toggleSelectAllOnPage(Boolean(v))
                              }
                              aria-label='Tout sélectionner'
                            />
                          </TableHead>
                        )}
                        <TableHead
                          onClick={() => handleSort('ref')}
                          className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                        >
                          Référence {renderSortIcon('ref')}
                        </TableHead>
                        <TableHead
                          onClick={() => handleSort('name')}
                          className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                        >
                          Produit {renderSortIcon('name')}
                        </TableHead>
                        {visibleColumns.category && (
                          <TableHead
                            onClick={() => handleSort('category')}
                            className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                          >
                            Catégorie {renderSortIcon('category')}
                          </TableHead>
                        )}
                        {visibleColumns.unit && (
                          <TableHead
                            onClick={() => handleSort('unit')}
                            className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                          >
                            Unité {renderSortIcon('unit')}
                          </TableHead>
                        )}
                        {visibleColumns.stock && (
                          <TableHead
                            onClick={() => handleSort('stock')}
                            className='cursor-pointer select-none text-right text-xs font-semibold text-[#6D7175]'
                          >
                            Stock actuel {renderSortIcon('stock')}
                          </TableHead>
                        )}
                        {visibleColumns.min_stock && (
                          <TableHead
                            onClick={() => handleSort('min_stock')}
                            className='cursor-pointer select-none text-right text-xs font-semibold text-[#6D7175]'
                          >
                            Stock minimum {renderSortIcon('min_stock')}
                          </TableHead>
                        )}
                        {visibleColumns.status && (
                          <TableHead
                            onClick={() => handleSort('status')}
                            className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                          >
                            Statut {renderSortIcon('status')}
                          </TableHead>
                        )}
                        {canSeePrices && visibleColumns.averagePrice && (
                          <TableHead
                            onClick={() => handleSort('averagePrice')}
                            className='cursor-pointer select-none text-right text-xs font-semibold text-[#6D7175]'
                          >
                            Prix moyen ({vatConvention}){' '}
                            {renderSortIcon('averagePrice')}
                          </TableHead>
                        )}
                        {canSeePrices && visibleColumns.stockValue && (
                          <TableHead
                            onClick={() => handleSort('stockValue')}
                            className='cursor-pointer select-none text-right text-xs font-semibold text-[#6D7175]'
                          >
                            Valeur du stock {renderSortIcon('stockValue')}
                          </TableHead>
                        )}
                        {visibleColumns.location && (
                          <TableHead
                            onClick={() => handleSort('location')}
                            className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                          >
                            Emplacement {renderSortIcon('location')}
                          </TableHead>
                        )}
                        <TableHead className='w-12 text-right text-xs font-semibold text-[#6D7175]'>
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedProducts.map((product) => {
                        const st = stockByProductId.get(product.id)
                        const isSelected = selectedIds.has(product.id)

                        return (
                          <TableRow
                            key={product.id}
                            className='cursor-pointer border-b border-[#E1E3E5] hover:bg-[#F6F6F7]/70'
                            onClick={() => setSelectedProductId(product.id)}
                          >
                            {canEdit && (
                              <TableCell
                                className='px-3'
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(v) =>
                                    toggleSelectOne(product.id, Boolean(v))
                                  }
                                  aria-label={`Sélectionner ${product.name}`}
                                />
                              </TableCell>
                            )}
                            <TableCell className='font-mono text-xs font-medium text-[#202223]'>
                              {product.ref}
                            </TableCell>
                            <TableCell className='text-xs font-medium text-[#202223]'>
                              <div className='flex items-center gap-2'>
                                <span>{product.name}</span>
                                {product.archived && (
                                  <Badge
                                    variant='secondary'
                                    className='bg-neutral-200 text-[10px] text-neutral-700'
                                  >
                                    Archivé
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            {visibleColumns.category && (
                              <TableCell className='text-xs text-[#6D7175]'>
                                {product.category ? (
                                  product.category
                                ) : (
                                  <span className='italic text-[#B98900]'>
                                    Sans catégorie
                                  </span>
                                )}
                              </TableCell>
                            )}
                            {visibleColumns.unit && (
                              <TableCell className='text-xs text-[#6D7175]'>
                                {product.unit}
                              </TableCell>
                            )}
                            {visibleColumns.stock && (
                              <TableCell className='text-right font-mono text-xs font-semibold text-[#202223]'>
                                {formatQty(st?.stock ?? product.initial_stock)}
                              </TableCell>
                            )}
                            {visibleColumns.min_stock && (
                              <TableCell className='text-right font-mono text-xs text-[#6D7175]'>
                                {product.min_stock && product.min_stock > 0
                                  ? formatQty(product.min_stock)
                                  : '—'}
                              </TableCell>
                            )}
                            {visibleColumns.status && (
                              <TableCell>
                                <StockStatusBadge
                                  status={st?.status ?? 'À définir'}
                                />
                              </TableCell>
                            )}
                            {canSeePrices && visibleColumns.averagePrice && (
                              <TableCell className='text-right text-xs text-[#202223]'>
                                {st?.averagePrice !== null &&
                                st?.averagePrice !== undefined ? (
                                  <span className='font-mono'>
                                    {formatMAD(st.averagePrice)}
                                  </span>
                                ) : (
                                  <Badge className='border-transparent bg-[#FFF5EA] text-[11px] font-normal text-[#B98900] hover:bg-[#FFF5EA]'>
                                    Prix manquant
                                  </Badge>
                                )}
                              </TableCell>
                            )}
                            {canSeePrices && visibleColumns.stockValue && (
                              <TableCell className='text-right text-xs font-medium text-[#202223]'>
                                {st?.stockValue !== null &&
                                st?.stockValue !== undefined ? (
                                  <span className='font-mono'>
                                    {formatMAD(st.stockValue)}
                                  </span>
                                ) : (
                                  <Badge className='border-transparent bg-[#FFF5EA] text-[11px] font-normal text-[#B98900] hover:bg-[#FFF5EA]'>
                                    Prix manquant
                                  </Badge>
                                )}
                              </TableCell>
                            )}
                            {visibleColumns.location && (
                              <TableCell className='text-xs text-[#6D7175]'>
                                {product.location || '—'}
                              </TableCell>
                            )}
                            <TableCell
                              className='text-right'
                              onClick={(e) => e.stopPropagation()}
                            >
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-7 w-7 p-0'
                                  >
                                    <MoreHorizontal className='h-4 w-4' />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align='end'>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setSelectedProductId(product.id)
                                    }
                                  >
                                    <Eye className='mr-2 h-4 w-4' />
                                    Voir la fiche détaillée
                                  </DropdownMenuItem>
                                  {canEdit && (
                                    <>
                                      <DropdownMenuItem
                                        onClick={() => openEditDrawer(product)}
                                      >
                                        <Edit3 className='mr-2 h-4 w-4' />
                                        Modifier
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() =>
                                          handleRequestArchiveToggle(product)
                                        }
                                      >
                                        {product.archived ? (
                                          <>
                                            <ArchiveRestore className='mr-2 h-4 w-4 text-[#008060]' />
                                            Restaurer
                                          </>
                                        ) : (
                                          <>
                                            <Archive className='mr-2 h-4 w-4 text-[#6D7175]' />
                                            Archiver
                                          </>
                                        )}
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>

                  {/* Pagination Footer */}
                  <div className='flex flex-col items-center justify-between gap-3 border-t border-[#E1E3E5] bg-[#F6F6F7]/50 px-4 py-3 text-xs text-[#6D7175] sm:flex-row'>
                    <div className='flex items-center gap-2'>
                      <span>Lignes par page :</span>
                      <Select
                        value={String(pageSize)}
                        onValueChange={(v) => {
                          setPageSize(Number(v))
                          setCurrentPage(1)
                        }}
                      >
                        <SelectTrigger className='h-7 w-20 bg-white text-xs'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='25'>25</SelectItem>
                          <SelectItem value='50'>50</SelectItem>
                          <SelectItem value='100'>100</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className='flex items-center gap-3'>
                      <span>
                        Page{' '}
                        <strong className='text-[#202223]'>{safePage}</strong>{' '}
                        sur{' '}
                        <strong className='text-[#202223]'>{totalPages}</strong>
                      </span>
                      <div className='flex items-center gap-1'>
                        <Button
                          variant='outline'
                          size='sm'
                          className='h-7 bg-white px-2.5 text-xs'
                          disabled={safePage <= 1}
                          onClick={() =>
                            setCurrentPage((p) => Math.max(1, p - 1))
                          }
                        >
                          Précédent
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          className='h-7 bg-white px-2.5 text-xs'
                          disabled={safePage >= totalPages}
                          onClick={() =>
                            setCurrentPage((p) => Math.min(totalPages, p + 1))
                          }
                        >
                          Suivant
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Main>

      {/* Create / Edit Product Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className='flex w-full flex-col overflow-y-auto bg-white sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle className='text-base font-semibold text-[#202223]'>
              {editingProduct
                ? `Modifier le produit ${editingProduct.ref}`
                : 'Ajouter un produit'}
            </SheetTitle>
            <SheetDescription className='text-xs text-[#6D7175]'>
              {editingProduct
                ? 'Modifiez les informations de la fiche produit.'
                : 'Le formulaire conserve automatiquement votre saisie en cas de fermeture accidentelle.'}
            </SheetDescription>
          </SheetHeader>

          <form
            onSubmit={handleDrawerSubmit}
            className='mt-4 flex flex-1 flex-col justify-between space-y-5'
          >
            <div className='space-y-4'>
              {!editingProduct && hasUnsavedCreateDraft && (
                <div className='flex items-center justify-between rounded-md border border-[#E1E3E5] bg-[#F6F6F7] px-3 py-2 text-xs'>
                  <span className='text-[#6D7175]'>
                    Brouillon non enregistré restauré.
                  </span>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-6 px-2 text-xs text-[#D72C0D]'
                    onClick={() => {
                      const resetState: ProductFormState = {
                        ref: suggestedNextRef,
                        name: '',
                        category: configuredCategories[0] ?? '',
                        unit: 'kg',
                        initial_stock: '0',
                        min_stock: '0',
                        location: '',
                        notes: '',
                      }
                      setCreateDraft(resetState)
                      setFormState(resetState)
                      setHasUnsavedCreateDraft(false)
                    }}
                  >
                    Réinitialiser
                  </Button>
                </div>
              )}

              {/* Référence */}
              <div className='space-y-1.5'>
                <div className='flex items-center justify-between'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Référence <span className='text-[#D72C0D]'>*</span>
                  </Label>
                  {!editingProduct && (
                    <button
                      type='button'
                      onClick={() => updateFormField('ref', suggestedNextRef)}
                      className='text-[11px] font-medium text-[#008060] hover:underline'
                    >
                      Suggérer : {suggestedNextRef}
                    </button>
                  )}
                </div>
                <Input
                  value={formState.ref}
                  disabled={editingProductHasMovements}
                  onChange={(e) => updateFormField('ref', e.target.value)}
                  placeholder='Ex. P340'
                  className={`font-mono ${
                    (submittedAttempt && !formState.ref.trim()) ||
                    refCollisionProduct
                      ? 'border-[#D72C0D] focus-visible:ring-[#D72C0D]'
                      : ''
                  }`}
                />
                {editingProductHasMovements && (
                  <p className='flex items-center gap-1.5 text-[11px] text-[#6D7175]'>
                    <Lock className='h-3 w-3 shrink-0' />
                    La référence ne peut plus être modifiée car ce produit
                    possède déjà des mouvements enregistrés.
                  </p>
                )}
                {refCollisionProduct && (
                  <p className='text-xs font-medium text-[#D72C0D]'>
                    Cette référence existe déjà ({refCollisionProduct.ref} —{' '}
                    {refCollisionProduct.name}).
                  </p>
                )}
                {submittedAttempt && !formState.ref.trim() && (
                  <p className='text-xs text-[#D72C0D]'>
                    La référence est obligatoire.
                  </p>
                )}
              </div>

              {/* Produit (Nom) */}
              <div className='space-y-1.5'>
                <Label className='text-xs font-medium text-[#202223]'>
                  Désignation du produit{' '}
                  <span className='text-[#D72C0D]'>*</span>
                </Label>
                <Input
                  value={formState.name}
                  onChange={(e) => updateFormField('name', e.target.value)}
                  placeholder='Ex. Huile d’olive vierge extra'
                  className={
                    submittedAttempt && !formState.name.trim()
                      ? 'border-[#D72C0D] focus-visible:ring-[#D72C0D]'
                      : ''
                  }
                />
                {submittedAttempt && !formState.name.trim() && (
                  <p className='text-xs text-[#D72C0D]'>
                    Le nom du produit est obligatoire.
                  </p>
                )}
              </div>

              {/* Catégorie */}
              <div className='space-y-1.5'>
                <div className='flex items-center justify-between'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Catégorie
                  </Label>
                  <button
                    type='button'
                    onClick={() =>
                      setShowQuickNewCategory(!showQuickNewCategory)
                    }
                    className='text-[11px] font-medium text-[#008060] hover:underline'
                  >
                    {showQuickNewCategory
                      ? 'Choisir existante'
                      : '+ Nouvelle catégorie'}
                  </button>
                </div>

                {showQuickNewCategory ? (
                  <div className='flex gap-2'>
                    <Input
                      value={quickNewCategory}
                      onChange={(e) => setQuickNewCategory(e.target.value)}
                      placeholder='Nom de la nouvelle catégorie...'
                    />
                    <Button
                      type='button'
                      size='sm'
                      className='bg-[#008060] text-white'
                      onClick={() => {
                        const clean = quickNewCategory.trim()
                        if (clean) {
                          updateFormField('category', clean)
                          setQuickNewCategory('')
                          setShowQuickNewCategory(false)
                        }
                      }}
                    >
                      Utiliser
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={formState.category || '__none__'}
                    onValueChange={(v) =>
                      updateFormField('category', v === '__none__' ? '' : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder='Sélectionner une catégorie' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__none__'>Sans catégorie</SelectItem>
                      {configuredCategories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                      {formState.category &&
                        !configuredCategories.includes(formState.category) && (
                          <SelectItem value={formState.category}>
                            {formState.category}
                          </SelectItem>
                        )}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Unité */}
              <div className='space-y-1.5'>
                <Label className='text-xs font-medium text-[#202223]'>
                  Unité de mesure <span className='text-[#D72C0D]'>*</span>
                </Label>
                <Select
                  value={formState.unit}
                  disabled={
                    editingProductHasMovements && !canManageUnitWithMovements
                  }
                  onValueChange={(v) => updateFormField('unit', v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Choisir une unité' />
                  </SelectTrigger>
                  <SelectContent>
                    {configuredUnits.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editingProductHasMovements && (
                  <p className='text-[11px] text-[#6D7175]'>
                    {canManageUnitWithMovements
                      ? 'Attention : modifier l’unité d’un produit ayant des mouvements demandera une confirmation.'
                      : 'Seul un Manager ou Administrateur peut modifier l’unité d’un produit ayant des mouvements.'}
                  </p>
                )}
              </div>

              {/* Stock initial & Stock minimum */}
              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Stock initial
                  </Label>
                  <Input
                    type='number'
                    step='any'
                    value={formState.initial_stock}
                    onChange={(e) =>
                      updateFormField('initial_stock', e.target.value)
                    }
                  />
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Stock minimum (seuil)
                  </Label>
                  <Input
                    type='number'
                    step='any'
                    min='0'
                    value={formState.min_stock}
                    onChange={(e) =>
                      updateFormField('min_stock', e.target.value)
                    }
                  />
                </div>
              </div>

              {/* Emplacement */}
              <div className='space-y-1.5'>
                <Label className='text-xs font-medium text-[#202223]'>
                  Emplacement de stockage
                </Label>
                <Input
                  value={formState.location}
                  onChange={(e) => updateFormField('location', e.target.value)}
                  placeholder='Ex. Réserve sèche, Chambre froide +4°C...'
                  list='monarq-locations-datalist'
                />
                <datalist id='monarq-locations-datalist'>
                  {configuredLocations.map((loc) => (
                    <option key={loc} value={loc} />
                  ))}
                </datalist>
              </div>

              {/* Notes */}
              <div className='space-y-1.5'>
                <Label className='text-xs font-medium text-[#202223]'>
                  Notes internes
                </Label>
                <Textarea
                  rows={3}
                  value={formState.notes}
                  onChange={(e) => updateFormField('notes', e.target.value)}
                  placeholder='Conditionnement, allergènes, consignes de réception...'
                />
              </div>
            </div>

            <SheetFooter className='border-t border-[#E1E3E5] pt-4'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setDrawerOpen(false)}
              >
                Fermer
              </Button>
              <Button
                type='submit'
                disabled={
                  saveProductMutation.isPending || Boolean(refCollisionProduct)
                }
                className='bg-[#008060] text-white hover:bg-[#006e52]'
              >
                {editingProduct ? 'Enregistrer' : 'Créer le produit'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Confirmation Dialog for Changing Unit on Product with Movements */}
      <Dialog
        open={unitChangeConfirmOpen}
        onOpenChange={setUnitChangeConfirmOpen}
      >
        <DialogContent className='bg-white sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2 text-base font-semibold text-[#202223]'>
              <AlertTriangle className='h-5 w-5 text-[#B98900]' />
              Confirmer le changement d’unité
            </DialogTitle>
            <DialogDescription className='text-xs text-[#6D7175]'>
              Le produit <strong>{editingProduct?.name}</strong> (
              {editingProduct?.ref}) possède déjà des mouvements d’entrée, de
              sortie ou d’inventaire en{' '}
              <strong>{editingProduct?.unit}</strong>. Voulez-vous vraiment
              changer son unité en <strong>{formState.unit}</strong> ?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setUnitChangeConfirmOpen(false)}
            >
              Annuler
            </Button>
            <Button
              onClick={() => saveProductMutation.mutate()}
              disabled={saveProductMutation.isPending}
              className='bg-[#008060] text-white hover:bg-[#006e52]'
            >
              Confirmer le changement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Archiving Product with Stock > 0 */}
      <Dialog
        open={Boolean(archiveTargetProduct)}
        onOpenChange={(open) => {
          if (!open) setArchiveTargetProduct(null)
        }}
      >
        <DialogContent className='bg-white sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2 text-base font-semibold text-[#202223]'>
              <AlertTriangle className='h-5 w-5 text-[#B98900]' />
              Archiver un produit avec du stock en cours ?
            </DialogTitle>
            <DialogDescription className='text-xs text-[#6D7175]'>
              Le produit <strong>{archiveTargetProduct?.name}</strong> (
              {archiveTargetProduct?.ref}) affiche encore un stock actuel de{' '}
              <strong>
                {archiveTargetProduct
                  ? formatQty(
                      stockByProductId.get(archiveTargetProduct.id)?.stock ?? 0
                    )
                  : 0}{' '}
                {archiveTargetProduct?.unit}
              </strong>
              . L’archivage le masquera des sélecteurs actifs tout en conservant
              l’intégralité de son historique de mouvements.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setArchiveTargetProduct(null)}
            >
              Annuler
            </Button>
            <Button
              onClick={() => {
                if (archiveTargetProduct) {
                  toggleArchiveMutation.mutate(archiveTargetProduct)
                }
              }}
              disabled={toggleArchiveMutation.isPending}
              className='bg-[#D72C0D] text-white hover:bg-[#b8240b]'
            >
              Confirmer l’archivage
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Edit Confirmation Dialog */}
      <Dialog open={bulkActionOpen} onOpenChange={setBulkActionOpen}>
        <DialogContent className='bg-white sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base font-semibold text-[#202223]'>
              Modification groupée ({selectedIds.size} produit
              {selectedIds.size > 1 ? 's' : ''})
            </DialogTitle>
            <DialogDescription className='text-xs text-[#6D7175]'>
              Cette action mettra à jour{' '}
              <strong>
                {selectedIds.size} produit{selectedIds.size > 1 ? 's' : ''}
              </strong>{' '}
              et enregistrera une trace dans le journal d’audit.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-3 py-2'>
            {bulkActionKind === 'category' && (
              <div className='space-y-1.5'>
                <Label className='text-xs'>Nouvelle catégorie</Label>
                <Input
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                  placeholder='Ex. Épicerie'
                  list='bulk-cat-list'
                />
                <datalist id='bulk-cat-list'>
                  {configuredCategories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            )}

            {bulkActionKind === 'unit' && (
              <div className='space-y-1.5'>
                <Label className='text-xs'>Nouvelle unité</Label>
                <Select value={bulkValue} onValueChange={setBulkValue}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {configuredUnits.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {bulkActionKind === 'location' && (
              <div className='space-y-1.5'>
                <Label className='text-xs'>Nouvel emplacement</Label>
                <Input
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                  placeholder='Ex. Réserve centrale'
                  list='bulk-loc-list'
                />
                <datalist id='bulk-loc-list'>
                  {configuredLocations.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </div>
            )}

            {bulkActionKind === 'min_stock' && (
              <div className='space-y-1.5'>
                <Label className='text-xs'>Nouveau stock minimum</Label>
                <Input
                  type='number'
                  step='any'
                  min='0'
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                />
              </div>
            )}

            {bulkActionKind === 'archive' && (
              <div className='rounded-md border border-[#B98900]/40 bg-[#FFF8E6] p-3 text-xs text-[#202223]'>
                Confirmez-vous l’archivage de{' '}
                <strong>{selectedIds.size} produit(s)</strong> ? Leur historique
                restera intact et ils pourront être restaurés à tout moment via
                le filtre « Archivés ».
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setBulkActionOpen(false)}
            >
              Annuler
            </Button>
            <Button
              onClick={() => bulkUpdateMutation.mutate()}
              disabled={bulkUpdateMutation.isPending}
              className='bg-[#008060] text-white hover:bg-[#006e52]'
            >
              Confirmer ({selectedIds.size} produit
              {selectedIds.size > 1 ? 's' : ''})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Taxonomy Manager Dialog */}
      <TaxonomyManagerDialog
        open={taxonomyOpen}
        onOpenChange={setTaxonomyOpen}
        initialTab={taxonomyInitialTab}
        products={products}
        configuredCategories={configuredCategories}
        configuredUnits={configuredUnits}
        configuredLocations={configuredLocations}
        canEdit={canEdit}
      />
    </>
  )
}

export const Produits = ProduitsPage

