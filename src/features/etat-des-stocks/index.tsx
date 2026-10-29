import { Fragment, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calculator,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  Columns3,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  Package,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  TrendingDown,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import { invalidateDashboardAnalyticsCache } from '@/data/analytics'
import type {
  ProductRecord,
  StockRecalculationReport,
  StockStatusLabel,
  VatConvention,
} from '@/data/types'
import {
  formatDateFR as formatDateDDMMYYYY,
  formatMAD,
  formatQuantity as formatNumberFR,
} from '@/lib/formatters'
import { canPerformCollectionAction, canSeeFinancialData } from '@/lib/rbac'
import {
  computeAllProductsStock,
  getStockCacheSnapshot,
  normalizeSearchText,
  type ProductStockResult,
} from '@/lib/stock-engine'
import { useAuthStore } from '@/stores/auth-store'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search as GlobalSearch } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type SortField =
  | 'ref'
  | 'name'
  | 'category'
  | 'unit'
  | 'initial_stock'
  | 'entries'
  | 'consumed'
  | 'wasted'
  | 'last_inventory'
  | 'stock'
  | 'min_stock'
  | 'status'
  | 'average_price'
  | 'stock_value'

type SortDirection = 'asc' | 'desc'

interface EnrichedStockRow {
  product: ProductRecord
  stockResult: ProductStockResult
}

const STATUS_PRIORITY: Record<StockStatusLabel, number> = {
  Alerte: 1,
  'À surveiller': 2,
  'À définir': 3,
  OK: 4,
}

export function StockStatusBadge({ status }: { status: StockStatusLabel }) {
  switch (status) {
    case 'Alerte':
      return (
        <Badge
          variant='outline'
          className='border-red-300 bg-red-50 text-red-700 font-medium'
        >
          Alerte
        </Badge>
      )
    case 'À surveiller':
      return (
        <Badge
          variant='outline'
          className='border-amber-300 bg-amber-50 text-amber-800 font-medium'
        >
          À surveiller
        </Badge>
      )
    case 'OK':
      return (
        <Badge
          variant='outline'
          className='border-emerald-300 bg-emerald-50 text-emerald-700 font-medium'
        >
          OK
        </Badge>
      )
    default:
      return (
        <Badge
          variant='outline'
          className='border-slate-300 bg-slate-100 text-slate-600 font-medium'
        >
          À définir
        </Badge>
      )
  }
}

export function EtatDesStocks() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.auth.user)
  const role = user?.role ?? 'consultation'

  const showFinancials = canSeeFinancialData(role)
  const canEditProduct = canPerformCollectionAction(role, 'products', 'update')
  const canCreateInventory = canPerformCollectionAction(
    role,
    'inventory_sessions',
    'create'
  )
  const canRecalculateStock = role === 'admin' || role === 'manager'

  // Filters (initialized from URL query parameters when navigated from Dashboard)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all'
    return new URLSearchParams(window.location.search).get('category') || 'all'
  })
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all'
    return new URLSearchParams(window.location.search).get('status') || 'all'
  })
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [onlyMissingPrice, setOnlyMissingPrice] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('priceMissing') === 'true'
  })
  const [onlyMissingMin, setOnlyMissingMin] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('missingMin') === 'true'
  })
  const [onlyNegativeStock, setOnlyNegativeStock] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      setCategoryFilter(params.get('category') || 'all')
      setStatusFilter(params.get('status') || 'all')
      setOnlyMissingPrice(params.get('priceMissing') === 'true')
      setOnlyMissingMin(params.get('missingMin') === 'true')
    }
    window.addEventListener('popstate', syncFromUrl)
    window.addEventListener('monarq:navigate', syncFromUrl)
    return () => {
      window.removeEventListener('popstate', syncFromUrl)
      window.removeEventListener('monarq:navigate', syncFromUrl)
    }
  }, [])

  // Sort & Pagination
  const [sortField, setSortField] = useState<SortField>('ref')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(25)

  // Expanded rows
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  // Quick inline min_stock editing
  const [editingMinProductId, setEditingMinProductId] = useState<string | null>(
    null
  )
  const [editingMinValue, setEditingMinValue] = useState<string>('')
  const [savingMin, setSavingMin] = useState(false)

  // Recalculation report modal
  const [recalculating, setRecalculating] = useState(false)
  const [recalcReport, setRecalcReport] =
    useState<StockRecalculationReport | null>(null)
  const [recalcDialogOpen, setRecalcDialogOpen] = useState(false)

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState({
    category: true,
    unit: true,
    initial_stock: true,
    entries: true,
    consumed: true,
    wasted: true,
    last_inventory: true,
    min_stock: true,
    status: true,
    average_price: true,
    stock_value: true,
  })

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => repository.listProducts(),
  })

  const purchasesQuery = useQuery({
    queryKey: ['purchases'],
    queryFn: () => repository.listPurchases(),
    enabled: showFinancials,
  })

  const exitsQuery = useQuery({
    queryKey: ['exits'],
    queryFn: () => repository.listExits(),
  })

  const inventoriesQuery = useQuery({
    queryKey: ['inventories'],
    queryFn: () => repository.listInventories(),
  })

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => repository.listSettings(),
  })

  const loading =
    productsQuery.isLoading ||
    exitsQuery.isLoading ||
    inventoriesQuery.isLoading ||
    (showFinancials && purchasesQuery.isLoading)

  const vatConvention: VatConvention = useMemo(() => {
    const vatSetting = (settingsQuery.data ?? []).find(
      (s) => s.key === 'vat_convention'
    )
    return vatSetting?.value === 'HT' ? 'HT' : 'TTC'
  }, [settingsQuery.data])

  const activeProducts = useMemo(
    () => (productsQuery.data ?? []).filter((p) => !p.archived),
    [productsQuery.data]
  )

  const stockMap = useMemo(() => {
    if (showFinancials) {
      return computeAllProductsStock({
        products: activeProducts,
        purchases: purchasesQuery.data?.headers ?? [],
        purchaseLines: purchasesQuery.data?.lines ?? [],
        exits: exitsQuery.data?.headers ?? [],
        exitLines: exitsQuery.data?.lines ?? [],
        inventorySessions: inventoriesQuery.data?.sessions ?? [],
        inventoryLines: inventoriesQuery.data?.lines ?? [],
      })
    }

    const cached = getStockCacheSnapshot()
    const maskedMap = new Map<string, ProductStockResult>()
    for (const p of activeProducts) {
      const st = cached.get(p.id)
      if (st) {
        maskedMap.set(p.id, {
          ...st,
          averagePrice: null,
          stockValue: null,
        })
      }
    }
    return maskedMap
  }, [
    showFinancials,
    activeProducts,
    purchasesQuery.data,
    exitsQuery.data,
    inventoriesQuery.data,
  ])

  const enrichedRows: EnrichedStockRow[] = useMemo(() => {
    return activeProducts
      .map((product) => {
        const stockResult = stockMap.get(product.id)
        if (!stockResult) return null
        return { product, stockResult }
      })
      .filter((r): r is EnrichedStockRow => r !== null)
  }, [activeProducts, stockMap])

  // Summary KPIs across all active products
  const summaryStats = useMemo(() => {
    let totalStockValue = 0
    let alertCount = 0
    let watchCount = 0
    let missingPriceCount = 0
    let missingMinCount = 0
    let negativeStockCount = 0

    for (const { stockResult } of enrichedRows) {
      if (stockResult.stockValue !== null) {
        totalStockValue += stockResult.stockValue
      }
      if (stockResult.status === 'Alerte') alertCount++
      if (stockResult.status === 'À surveiller') watchCount++
      if (stockResult.priceMissing) missingPriceCount++
      if (stockResult.status === 'À définir') missingMinCount++
      if (stockResult.stock < 0) negativeStockCount++
    }

    return {
      totalStockValue,
      alertCount,
      watchCount,
      missingPriceCount,
      missingMinCount,
      negativeStockCount,
    }
  }, [enrichedRows])

  // Unique categories and locations for filter dropdowns
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const { product } of enrichedRows) {
      if (product.category?.trim()) set.add(product.category.trim())
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [enrichedRows])

  const locations = useMemo(() => {
    const set = new Set<string>()
    for (const { product } of enrichedRows) {
      if (product.location?.trim()) set.add(product.location.trim())
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [enrichedRows])

  // Filtered and sorted rows
  const filteredRows = useMemo(() => {
    const normSearch = normalizeSearchText(searchQuery)

    const filtered = enrichedRows.filter(({ product, stockResult }) => {
      if (normSearch) {
        const hay = `${normalizeSearchText(product.ref)} ${normalizeSearchText(product.name)}`
        if (!hay.includes(normSearch)) return false
      }
      if (categoryFilter !== 'all') {
        if (categoryFilter === '__none__') {
          if (product.category?.trim()) return false
        } else if ((product.category ?? '').trim() !== categoryFilter) {
          return false
        }
      }
      if (statusFilter !== 'all' && stockResult.status !== statusFilter) {
        return false
      }
      if (locationFilter !== 'all') {
        if (locationFilter === '__none__') {
          if (product.location?.trim()) return false
        } else if ((product.location ?? '').trim() !== locationFilter) {
          return false
        }
      }
      if (onlyMissingPrice && !stockResult.priceMissing) return false
      if (onlyMissingMin && stockResult.status !== 'À définir') return false
      if (onlyNegativeStock && stockResult.stock >= 0) return false

      return true
    })

    filtered.sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1
      switch (sortField) {
        case 'ref':
          return (
            a.stockResult.normalizedRef.localeCompare(
              b.stockResult.normalizedRef,
              'fr',
              { numeric: true }
            ) * mul
          )
        case 'name':
          return a.product.name.localeCompare(b.product.name, 'fr') * mul
        case 'category':
          return (
            (a.product.category || '').localeCompare(
              b.product.category || '',
              'fr'
            ) * mul
          )
        case 'unit':
          return (
            (a.product.unit || '').localeCompare(b.product.unit || '', 'fr') *
            mul
          )
        case 'initial_stock':
          return (a.product.initial_stock - b.product.initial_stock) * mul
        case 'entries':
          return (
            (a.stockResult.entriesAfterBaseline -
              b.stockResult.entriesAfterBaseline) *
            mul
          )
        case 'consumed':
          return (
            (a.stockResult.consumedAfterBaseline -
              b.stockResult.consumedAfterBaseline) *
            mul
          )
        case 'wasted':
          return (
            (a.stockResult.wastedAfterBaseline -
              b.stockResult.wastedAfterBaseline) *
            mul
          )
        case 'last_inventory': {
          const da = a.stockResult.baselineDate ?? ''
          const db = b.stockResult.baselineDate ?? ''
          return da.localeCompare(db) * mul
        }
        case 'stock':
          return (a.stockResult.stock - b.stockResult.stock) * mul
        case 'min_stock':
          return (
            ((a.product.min_stock ?? -1) - (b.product.min_stock ?? -1)) * mul
          )
        case 'status':
          return (
            (STATUS_PRIORITY[a.stockResult.status] -
              STATUS_PRIORITY[b.stockResult.status]) *
            mul
          )
        case 'average_price':
          return (
            ((a.stockResult.averagePrice ?? -1) -
              (b.stockResult.averagePrice ?? -1)) *
            mul
          )
        case 'stock_value':
          return (
            ((a.stockResult.stockValue ?? -1) -
              (b.stockResult.stockValue ?? -1)) *
            mul
          )
        default:
          return 0
      }
    })

    return filtered
  }, [
    enrichedRows,
    searchQuery,
    categoryFilter,
    statusFilter,
    locationFilter,
    onlyMissingPrice,
    onlyMissingMin,
    onlyNegativeStock,
    sortField,
    sortDir,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredRows.slice(start, start + pageSize)
  }, [filteredRows, safePage, pageSize])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className='ml-1 inline h-3.5 w-3.5 text-slate-400' />
    }
    return sortDir === 'asc' ? (
      <ArrowUp className='ml-1 inline h-3.5 w-3.5 text-slate-900' />
    ) : (
      <ArrowDown className='ml-1 inline h-3.5 w-3.5 text-slate-900' />
    )
  }

  const toggleRowExpanded = (productId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })
  }

  const resetFilters = () => {
    setSearchQuery('')
    setCategoryFilter('all')
    setStatusFilter('all')
    setLocationFilter('all')
    setOnlyMissingPrice(false)
    setOnlyMissingMin(false)
    setOnlyNegativeStock(false)
    setPage(1)
  }

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    categoryFilter !== 'all' ||
    statusFilter !== 'all' ||
    locationFilter !== 'all' ||
    onlyMissingPrice ||
    onlyMissingMin ||
    onlyNegativeStock

  const openProductDetail = (productId: string) => {
    void navigate({
      to: '/produits',
      search: { productId } as never,
    })
  }

  // Quick inline save of min_stock
  const handleStartEditMin = (product: ProductRecord) => {
    setEditingMinProductId(product.id)
    setEditingMinValue(
      product.min_stock !== null && product.min_stock !== undefined
        ? String(product.min_stock)
        : ''
    )
  }

  const handleSaveInlineMinStock = async (product: ProductRecord) => {
    const trimmed = editingMinValue.trim()
    const num = trimmed === '' ? null : Number(trimmed.replace(',', '.'))
    if (num !== null && (Number.isNaN(num) || num < 0)) {
      toast.error('Le stock minimum doit être un nombre positif ou nul.')
      return
    }

    setSavingMin(true)
    try {
      await repository.updateProduct(product.id, { min_stock: num })
      invalidateDashboardAnalyticsCache()
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      toast.success(
        `Stock minimum mis à jour pour « ${product.name} » (${num !== null ? `${formatNumberFR(num)} ${product.unit}` : 'Non défini'}).`
      )
      setEditingMinProductId(null)
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Impossible de mettre à jour le stock minimum.'
      )
    } finally {
      setSavingMin(false)
    }
  }

  // Full stock recalculation (admin/manager)
  const handleRecalculateStock = async () => {
    setRecalculating(true)
    try {
      const report = await repository.recalculateAllStock()
      setRecalcReport(report)
      setRecalcDialogOpen(true)
      invalidateDashboardAnalyticsCache()
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      if (report.differencesCount === 0) {
        toast.success(
          `Stock recalculé pour ${report.totalProductsChecked} produits : aucun écart détecté.`
        )
      } else {
        toast.warning(
          `Recalcul terminé : ${report.differencesCount} différence(s) corrigée(s).`
        )
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Erreur lors du recalcul complet du stock.'
      )
    } finally {
      setRecalculating(false)
    }
  }

  // Export to Excel / CSV
  const handleExport = (format: 'xlsx' | 'csv') => {
    if (filteredRows.length === 0) {
      toast.error('Aucune ligne à exporter.')
      return
    }

    const rowsData = filteredRows.map(({ product, stockResult }) => {
      const base: Record<string, string | number> = {
        Référence: product.ref,
        Produit: product.name,
        Catégorie: product.category || 'Sans catégorie',
        Unité: product.unit,
        Emplacement: product.location || '—',
        'Stock initial': product.initial_stock,
        'Entrées (après réf.)': stockResult.entriesAfterBaseline,
        'Sorties (après réf.)': stockResult.consumedAfterBaseline,
        'Pertes (après réf.)': stockResult.wastedAfterBaseline,
        'Dernier inventaire (date)': stockResult.baselineDate
          ? formatDateDDMMYYYY(stockResult.baselineDate)
          : 'Aucun',
        'Dernier inventaire (compté)':
          stockResult.baselineType === 'inventory'
            ? stockResult.baselineValue
            : '—',
        'Stock actuel': stockResult.stock,
        'Stock minimum':
          product.min_stock !== null && product.min_stock !== undefined
            ? product.min_stock
            : 'À définir',
        Statut: stockResult.status,
      }

      if (showFinancials) {
        base[`Prix moyen (${vatConvention})`] =
          stockResult.averagePrice !== null
            ? stockResult.averagePrice
            : 'Prix manquant'
        base['Valeur du stock (DH)'] =
          stockResult.stockValue !== null
            ? stockResult.stockValue
            : 'Prix manquant'
      }

      base['Formule de calcul'] = stockResult.formulaExplanationFR
      return base
    })

    const ws = XLSX.utils.json_to_sheet(rowsData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'État des stocks')
    const dateStamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') {
      XLSX.writeFile(wb, `MONARQ_Etat_Des_Stocks_${dateStamp}.csv`, {
        bookType: 'csv',
      })
    } else {
      XLSX.writeFile(wb, `MONARQ_Etat_Des_Stocks_${dateStamp}.xlsx`)
    }
    toast.success(
      `Export ${format.toUpperCase()} généré (${filteredRows.length} produits).`
    )
  }

  return (
    <>
      <Header fixed>
        <div className='hidden items-center gap-2 text-xs text-muted-foreground md:flex'>
          <span className='font-medium uppercase tracking-wider'>
            Opérations
          </span>
          <span aria-hidden='true'>/</span>
          <span className='font-medium text-foreground'>État des stocks</span>
        </div>
        <div className='ms-auto flex items-center gap-2'>
          <GlobalSearch />
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main id='content' className='space-y-4'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <h1 className='text-xl font-semibold tracking-tight text-foreground'>
              État des stocks
            </h1>
            <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
              Calcul en temps réel par le moteur de stock : dernier inventaire
              confirmé (ou stock initial) + entrées − sorties − pertes.
            </p>
          </div>

          <div className='flex flex-wrap items-center gap-2 print:hidden'>
            {canRecalculateStock && (
              <Button
                variant='outline'
                size='sm'
                onClick={() => void handleRecalculateStock()}
                disabled={recalculating}
                className='bg-white'
              >
                <RefreshCw
                  className={`mr-1.5 h-4 w-4 ${recalculating ? 'animate-spin' : ''}`}
                />
                Recalculer le stock
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='sm' className='bg-white'>
                  <Download className='mr-1.5 h-4 w-4' />
                  Exporter
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuLabel>Format d’export</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={false}
                  onCheckedChange={() => handleExport('xlsx')}
                >
                  <FileSpreadsheet className='mr-2 h-4 w-4 text-emerald-600' />
                  Excel (.xlsx)
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={false}
                  onCheckedChange={() => handleExport('csv')}
                >
                  <Download className='mr-2 h-4 w-4 text-slate-600' />
                  CSV (.csv)
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant='outline'
              size='sm'
              onClick={() => window.print()}
              className='bg-white'
            >
              <Printer className='mr-1.5 h-4 w-4' />
              Imprimer
            </Button>

            {canCreateInventory && (
              <Button asChild size='sm'>
                <Link to='/inventaires'>
                  <ClipboardCheck className='mr-1.5 h-4 w-4' />
                  Nouvel inventaire
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Print header */}
        <div className='hidden print:block print:mb-4 print:border-b print:pb-3'>
          <h1 className='text-xl font-bold'>
            MONARQ ÉCONOMAT — État des stocks au{' '}
            {formatDateDDMMYYYY(new Date().toISOString())}
          </h1>
          <p className='text-xs text-slate-600'>
            {filteredRows.length} produit(s) affiché(s)
          </p>
        </div>

        {/* Summary KPI cards */}
        <div
          className={`grid gap-3 sm:grid-cols-2 ${
            showFinancials ? 'lg:grid-cols-5' : 'lg:grid-cols-3'
          }`}
        >
          {showFinancials && (
            <Card className='border-slate-200 bg-white shadow-none'>
              <CardHeader className='pb-1 pt-4 px-4'>
                <CardTitle className='text-xs font-medium uppercase tracking-wider text-slate-500'>
                  Valeur totale du stock ({vatConvention})
                </CardTitle>
              </CardHeader>
              <CardContent className='px-4 pb-4'>
                {loading ? (
                  <Skeleton className='h-7 w-32' />
                ) : (
                  <div className='text-xl font-bold text-slate-900 tabular-nums'>
                    {formatMAD(summaryStats.totalStockValue)}
                  </div>
                )}
                <p className='mt-0.5 text-xs text-slate-500'>
                  Sur {enrichedRows.length} produits actifs
                </p>
              </CardContent>
            </Card>
          )}

          <Card
            className={`cursor-pointer border-slate-200 bg-white shadow-none transition-colors hover:border-red-300 ${
              statusFilter === 'Alerte'
                ? 'ring-2 ring-red-500/30 border-red-400'
                : ''
            }`}
            onClick={() => {
              setStatusFilter((prev) => (prev === 'Alerte' ? 'all' : 'Alerte'))
              setPage(1)
            }}
          >
            <CardHeader className='flex flex-row items-center justify-between pb-1 pt-4 px-4'>
              <CardTitle className='text-xs font-medium uppercase tracking-wider text-slate-500'>
                Produits en alerte
              </CardTitle>
              <AlertTriangle className='h-4 w-4 text-red-600' />
            </CardHeader>
            <CardContent className='px-4 pb-4'>
              {loading ? (
                <Skeleton className='h-7 w-16' />
              ) : (
                <div className='text-xl font-bold text-red-700 tabular-nums'>
                  {summaryStats.alertCount}
                </div>
              )}
              <p className='mt-0.5 text-xs text-slate-500'>
                Stock actuel ≤ stock minimum
              </p>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer border-slate-200 bg-white shadow-none transition-colors hover:border-amber-300 ${
              statusFilter === 'À surveiller'
                ? 'ring-2 ring-amber-500/30 border-amber-400'
                : ''
            }`}
            onClick={() => {
              setStatusFilter((prev) =>
                prev === 'À surveiller' ? 'all' : 'À surveiller'
              )
              setPage(1)
            }}
          >
            <CardHeader className='flex flex-row items-center justify-between pb-1 pt-4 px-4'>
              <CardTitle className='text-xs font-medium uppercase tracking-wider text-slate-500'>
                À surveiller
              </CardTitle>
              <TrendingDown className='h-4 w-4 text-amber-600' />
            </CardHeader>
            <CardContent className='px-4 pb-4'>
              {loading ? (
                <Skeleton className='h-7 w-16' />
              ) : (
                <div className='text-xl font-bold text-amber-700 tabular-nums'>
                  {summaryStats.watchCount}
                </div>
              )}
              <p className='mt-0.5 text-xs text-slate-500'>
                Entre 100 % et 150 % du minimum
              </p>
            </CardContent>
          </Card>

          {showFinancials && (
            <Card
              className={`cursor-pointer border-slate-200 bg-white shadow-none transition-colors hover:border-amber-300 ${
                onlyMissingPrice
                  ? 'ring-2 ring-amber-500/30 border-amber-400'
                  : ''
              }`}
              onClick={() => {
                setOnlyMissingPrice((prev) => !prev)
                setPage(1)
              }}
            >
              <CardHeader className='flex flex-row items-center justify-between pb-1 pt-4 px-4'>
                <CardTitle className='text-xs font-medium uppercase tracking-wider text-slate-500'>
                  Prix manquants
                </CardTitle>
                <ShieldAlert className='h-4 w-4 text-amber-600' />
              </CardHeader>
              <CardContent className='px-4 pb-4'>
                {loading ? (
                  <Skeleton className='h-7 w-16' />
                ) : (
                  <div className='text-xl font-bold text-slate-900 tabular-nums'>
                    {summaryStats.missingPriceCount}
                  </div>
                )}
                <p className='mt-0.5 text-xs text-slate-500'>
                  Aucun achat valorisé (PMP)
                </p>
              </CardContent>
            </Card>
          )}

          <Card
            className={`cursor-pointer border-slate-200 bg-white shadow-none transition-colors hover:border-slate-400 ${
              onlyMissingMin ? 'ring-2 ring-slate-500/30 border-slate-400' : ''
            }`}
            onClick={() => {
              setOnlyMissingMin((prev) => !prev)
              setPage(1)
            }}
          >
            <CardHeader className='flex flex-row items-center justify-between pb-1 pt-4 px-4'>
              <CardTitle className='text-xs font-medium uppercase tracking-wider text-slate-500'>
                Produits sans minimum
              </CardTitle>
              <Package className='h-4 w-4 text-slate-500' />
            </CardHeader>
            <CardContent className='px-4 pb-4'>
              {loading ? (
                <Skeleton className='h-7 w-16' />
              ) : (
                <div className='text-xl font-bold text-slate-800 tabular-nums'>
                  {summaryStats.missingMinCount}
                </div>
              )}
              <p className='mt-0.5 text-xs text-slate-500'>
                Seuil « À définir »
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters & Search Bar */}
        <Card className='border-slate-200 bg-white shadow-none print:hidden'>
          <CardContent className='p-4 space-y-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <div className='relative flex-1 min-w-[220px]'>
                <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-slate-400' />
                <Input
                  placeholder='Rechercher par référence ou nom de produit...'
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setPage(1)
                  }}
                  className='pl-9 h-9 bg-white'
                />
                {searchQuery && (
                  <button
                    type='button'
                    onClick={() => {
                      setSearchQuery('')
                      setPage(1)
                    }}
                    className='absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600'
                  >
                    <X className='h-4 w-4' />
                  </button>
                )}
              </div>

              <Select
                value={categoryFilter}
                onValueChange={(v) => {
                  setCategoryFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className='h-9 w-[180px] bg-white'>
                  <SelectValue placeholder='Catégorie' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>Toutes les catégories</SelectItem>
                  <SelectItem value='__none__'>Sans catégorie</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className='h-9 w-[160px] bg-white'>
                  <SelectValue placeholder='Statut' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>Tous les statuts</SelectItem>
                  <SelectItem value='Alerte'>Alerte</SelectItem>
                  <SelectItem value='À surveiller'>À surveiller</SelectItem>
                  <SelectItem value='OK'>OK</SelectItem>
                  <SelectItem value='À définir'>À définir</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={locationFilter}
                onValueChange={(v) => {
                  setLocationFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className='h-9 w-[170px] bg-white'>
                  <SelectValue placeholder='Emplacement' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>Tous emplacements</SelectItem>
                  <SelectItem value='__none__'>Sans emplacement</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc} value={loc}>
                      {loc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='outline' size='sm' className='h-9 bg-white'>
                    <Columns3 className='mr-1.5 h-4 w-4' />
                    Colonnes
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-52'>
                  <DropdownMenuLabel>Colonnes visibles</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.category}
                    onCheckedChange={(v) =>
                      setVisibleColumns((p) => ({ ...p, category: Boolean(v) }))
                    }
                  >
                    Catégorie
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.unit}
                    onCheckedChange={(v) =>
                      setVisibleColumns((p) => ({ ...p, unit: Boolean(v) }))
                    }
                  >
                    Unité
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.initial_stock}
                    onCheckedChange={(v) =>
                      setVisibleColumns((p) => ({
                        ...p,
                        initial_stock: Boolean(v),
                      }))
                    }
                  >
                    Stock initial
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.entries}
                    onCheckedChange={(v) =>
                      setVisibleColumns((p) => ({ ...p, entries: Boolean(v) }))
                    }
                  >
                    Entrées
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.consumed}
                    onCheckedChange={(v) =>
                      setVisibleColumns((p) => ({ ...p, consumed: Boolean(v) }))
                    }
                  >
                    Sorties
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.wasted}
                    onCheckedChange={(v) =>
                      setVisibleColumns((p) => ({ ...p, wasted: Boolean(v) }))
                    }
                  >
                    Pertes
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.last_inventory}
                    onCheckedChange={(v) =>
                      setVisibleColumns((p) => ({
                        ...p,
                        last_inventory: Boolean(v),
                      }))
                    }
                  >
                    Dernier inventaire
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.min_stock}
                    onCheckedChange={(v) =>
                      setVisibleColumns((p) => ({
                        ...p,
                        min_stock: Boolean(v),
                      }))
                    }
                  >
                    Stock minimum
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={visibleColumns.status}
                    onCheckedChange={(v) =>
                      setVisibleColumns((p) => ({ ...p, status: Boolean(v) }))
                    }
                  >
                    Statut
                  </DropdownMenuCheckboxItem>
                  {showFinancials && (
                    <>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.average_price}
                        onCheckedChange={(v) =>
                          setVisibleColumns((p) => ({
                            ...p,
                            average_price: Boolean(v),
                          }))
                        }
                      >
                        Prix moyen
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.stock_value}
                        onCheckedChange={(v) =>
                          setVisibleColumns((p) => ({
                            ...p,
                            stock_value: Boolean(v),
                          }))
                        }
                      >
                        Valeur du stock
                      </DropdownMenuCheckboxItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Quick toggle filter chips */}
            <div className='flex flex-wrap items-center justify-between gap-2 pt-1'>
              <div className='flex flex-wrap items-center gap-1.5'>
                {showFinancials && (
                  <Button
                    type='button'
                    variant={onlyMissingPrice ? 'default' : 'outline'}
                    size='sm'
                    className='h-7 text-xs'
                    onClick={() => {
                      setOnlyMissingPrice((p) => !p)
                      setPage(1)
                    }}
                  >
                    Prix manquant ({summaryStats.missingPriceCount})
                  </Button>
                )}
                <Button
                  type='button'
                  variant={onlyMissingMin ? 'default' : 'outline'}
                  size='sm'
                  className='h-7 text-xs'
                  onClick={() => {
                    setOnlyMissingMin((p) => !p)
                    setPage(1)
                  }}
                >
                  Sans minimum ({summaryStats.missingMinCount})
                </Button>
                <Button
                  type='button'
                  variant={onlyNegativeStock ? 'default' : 'outline'}
                  size='sm'
                  className='h-7 text-xs'
                  onClick={() => {
                    setOnlyNegativeStock((p) => !p)
                    setPage(1)
                  }}
                >
                  Stock négatif ({summaryStats.negativeStockCount})
                </Button>

                {hasActiveFilters && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={resetFilters}
                    className='h-7 text-xs text-slate-600'
                  >
                    <RotateCcw className='mr-1 h-3 w-3' />
                    Réinitialiser les filtres
                  </Button>
                )}
              </div>

              <div className='text-xs text-slate-500'>
                {filteredRows.length} produit(s) sur {enrichedRows.length}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Stock Table */}
        <Card className='border-slate-200 bg-white shadow-none overflow-hidden'>
          <CardContent className='p-0'>
            {loading ? (
              <div className='p-6 space-y-3'>
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className='h-10 w-full' />
                ))}
              </div>
            ) : filteredRows.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-14 px-4 text-center'>
                <Package className='h-10 w-10 text-slate-300 mb-2' />
                <h3 className='text-sm font-semibold text-slate-900'>
                  {enrichedRows.length === 0
                    ? 'Aucun produit enregistré dans la base'
                    : 'Aucun produit ne correspond aux filtres sélectionnés'}
                </h3>
                <p className='mt-1 max-w-md text-xs text-slate-500'>
                  {enrichedRows.length === 0
                    ? 'Importez votre fichier Excel MONARQ_ECONOMAT ou créez vos premiers produits pour visualiser l’état des stocks.'
                    : 'Modifiez votre recherche ou réinitialisez les filtres actifs.'}
                </p>
                {hasActiveFilters && (
                  <Button
                    variant='outline'
                    size='sm'
                    className='mt-4'
                    onClick={resetFilters}
                  >
                    Réinitialiser les filtres
                  </Button>
                )}
              </div>
            ) : (
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader className='bg-slate-50/80'>
                    <TableRow>
                      <TableHead className='w-8 px-2 print:hidden' />
                      <TableHead
                        className='cursor-pointer select-none whitespace-nowrap text-xs font-semibold'
                        onClick={() => toggleSort('ref')}
                      >
                        Référence {renderSortIcon('ref')}
                      </TableHead>
                      <TableHead
                        className='cursor-pointer select-none text-xs font-semibold'
                        onClick={() => toggleSort('name')}
                      >
                        Produit {renderSortIcon('name')}
                      </TableHead>
                      {visibleColumns.category && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-xs font-semibold'
                          onClick={() => toggleSort('category')}
                        >
                          Catégorie {renderSortIcon('category')}
                        </TableHead>
                      )}
                      {visibleColumns.unit && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-xs font-semibold'
                          onClick={() => toggleSort('unit')}
                        >
                          Unité {renderSortIcon('unit')}
                        </TableHead>
                      )}
                      {visibleColumns.initial_stock && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-right text-xs font-semibold'
                          onClick={() => toggleSort('initial_stock')}
                        >
                          Stock initial {renderSortIcon('initial_stock')}
                        </TableHead>
                      )}
                      {visibleColumns.entries && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-right text-xs font-semibold'
                          onClick={() => toggleSort('entries')}
                        >
                          Entrées {renderSortIcon('entries')}
                        </TableHead>
                      )}
                      {visibleColumns.consumed && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-right text-xs font-semibold'
                          onClick={() => toggleSort('consumed')}
                        >
                          Sorties {renderSortIcon('consumed')}
                        </TableHead>
                      )}
                      {visibleColumns.wasted && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-right text-xs font-semibold'
                          onClick={() => toggleSort('wasted')}
                        >
                          Pertes {renderSortIcon('wasted')}
                        </TableHead>
                      )}
                      {visibleColumns.last_inventory && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-xs font-semibold'
                          onClick={() => toggleSort('last_inventory')}
                        >
                          Dernier inventaire {renderSortIcon('last_inventory')}
                        </TableHead>
                      )}
                      <TableHead
                        className='cursor-pointer select-none whitespace-nowrap text-right text-xs font-semibold'
                        onClick={() => toggleSort('stock')}
                      >
                        Stock actuel {renderSortIcon('stock')}
                      </TableHead>
                      {visibleColumns.min_stock && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-right text-xs font-semibold'
                          onClick={() => toggleSort('min_stock')}
                        >
                          Stock minimum {renderSortIcon('min_stock')}
                        </TableHead>
                      )}
                      {visibleColumns.status && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-xs font-semibold'
                          onClick={() => toggleSort('status')}
                        >
                          Statut {renderSortIcon('status')}
                        </TableHead>
                      )}
                      {showFinancials && visibleColumns.average_price && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-right text-xs font-semibold'
                          onClick={() => toggleSort('average_price')}
                        >
                          Prix moyen ({vatConvention}){' '}
                          {renderSortIcon('average_price')}
                        </TableHead>
                      )}
                      {showFinancials && visibleColumns.stock_value && (
                        <TableHead
                          className='cursor-pointer select-none whitespace-nowrap text-right text-xs font-semibold'
                          onClick={() => toggleSort('stock_value')}
                        >
                          Valeur du stock {renderSortIcon('stock_value')}
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRows.map(({ product, stockResult }) => {
                      const isExpanded = expandedIds.has(product.id)
                      const isEditingMin = editingMinProductId === product.id

                      return (
                        <Fragment key={product.id}>
                          <TableRow className='group hover:bg-slate-50/80'>
                            <TableCell className='px-2 py-2 print:hidden'>
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon'
                                className='h-6 w-6'
                                onClick={() => toggleRowExpanded(product.id)}
                                title='Afficher le détail du calcul'
                              >
                                {isExpanded ? (
                                  <ChevronUp className='h-4 w-4 text-slate-600' />
                                ) : (
                                  <ChevronDown className='h-4 w-4 text-slate-400' />
                                )}
                              </Button>
                            </TableCell>

                            <TableCell className='py-2 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap'>
                              <button
                                type='button'
                                onClick={() => openProductDetail(product.id)}
                                className='hover:underline hover:text-slate-900'
                              >
                                {product.ref}
                              </button>
                            </TableCell>

                            <TableCell className='py-2 text-sm font-medium text-slate-900'>
                              <div className='flex items-center gap-1.5'>
                                <button
                                  type='button'
                                  onClick={() => openProductDetail(product.id)}
                                  className='hover:underline text-left'
                                >
                                  {product.name}
                                </button>
                                {product.location && (
                                  <span className='text-[11px] text-slate-400'>
                                    ({product.location})
                                  </span>
                                )}
                              </div>
                            </TableCell>

                            {visibleColumns.category && (
                              <TableCell className='py-2 text-xs text-slate-600 whitespace-nowrap'>
                                {product.category || (
                                  <span className='italic text-slate-400'>
                                    Sans catégorie
                                  </span>
                                )}
                              </TableCell>
                            )}

                            {visibleColumns.unit && (
                              <TableCell className='py-2 text-xs text-slate-600 whitespace-nowrap'>
                                {product.unit}
                              </TableCell>
                            )}

                            {visibleColumns.initial_stock && (
                              <TableCell className='py-2 text-right font-mono text-xs tabular-nums text-slate-600'>
                                {formatNumberFR(product.initial_stock)}
                              </TableCell>
                            )}

                            {visibleColumns.entries && (
                              <TableCell className='py-2 text-right font-mono text-xs tabular-nums text-emerald-700'>
                                +{formatNumberFR(stockResult.entriesAfterBaseline)}
                              </TableCell>
                            )}

                            {visibleColumns.consumed && (
                              <TableCell className='py-2 text-right font-mono text-xs tabular-nums text-slate-700'>
                                −
                                {formatNumberFR(
                                  stockResult.consumedAfterBaseline
                                )}
                              </TableCell>
                            )}

                            {visibleColumns.wasted && (
                              <TableCell className='py-2 text-right font-mono text-xs tabular-nums text-amber-700'>
                                −{formatNumberFR(stockResult.wastedAfterBaseline)}
                              </TableCell>
                            )}

                            {visibleColumns.last_inventory && (
                              <TableCell className='py-2 text-xs whitespace-nowrap'>
                                {stockResult.baselineType === 'inventory' &&
                                stockResult.baselineDate ? (
                                  <div className='flex items-center gap-1.5'>
                                    <span className='font-medium text-slate-800'>
                                      {formatDateDDMMYYYY(
                                        stockResult.baselineDate
                                      )}
                                    </span>
                                    <Badge
                                      variant='secondary'
                                      className='text-[11px] font-mono px-1.5 py-0'
                                    >
                                      {formatNumberFR(stockResult.baselineValue)}{' '}
                                      {product.unit}
                                    </Badge>
                                  </div>
                                ) : (
                                  <span className='text-slate-400'>—</span>
                                )}
                              </TableCell>
                            )}

                            <TableCell
                              className={`py-2 text-right font-mono text-sm font-bold tabular-nums whitespace-nowrap ${
                                stockResult.stock < 0
                                  ? 'text-red-700'
                                  : 'text-slate-900'
                              }`}
                            >
                              {formatNumberFR(stockResult.stock)} {product.unit}
                            </TableCell>

                            {visibleColumns.min_stock && (
                              <TableCell className='py-2 text-right text-xs whitespace-nowrap'>
                                {isEditingMin ? (
                                  <div className='flex items-center justify-end gap-1 print:hidden'>
                                    <Input
                                      type='number'
                                      min='0'
                                      step='any'
                                      value={editingMinValue}
                                      onChange={(e) =>
                                        setEditingMinValue(e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          void handleSaveInlineMinStock(product)
                                        } else if (e.key === 'Escape') {
                                          setEditingMinProductId(null)
                                        }
                                      }}
                                      className='h-7 w-20 text-right font-mono text-xs px-1.5'
                                      autoFocus
                                    />
                                    <Button
                                      type='button'
                                      size='icon'
                                      variant='ghost'
                                      className='h-6 w-6 text-emerald-700'
                                      disabled={savingMin}
                                      onClick={() =>
                                        void handleSaveInlineMinStock(product)
                                      }
                                    >
                                      <Check className='h-3.5 w-3.5' />
                                    </Button>
                                    <Button
                                      type='button'
                                      size='icon'
                                      variant='ghost'
                                      className='h-6 w-6 text-slate-400'
                                      onClick={() =>
                                        setEditingMinProductId(null)
                                      }
                                    >
                                      <X className='h-3.5 w-3.5' />
                                    </Button>
                                  </div>
                                ) : product.min_stock !== null &&
                                  product.min_stock !== undefined &&
                                  product.min_stock > 0 ? (
                                  <div className='inline-flex items-center justify-end gap-1'>
                                    <span className='font-mono tabular-nums text-slate-700'>
                                      {formatNumberFR(product.min_stock)}
                                    </span>
                                    {canEditProduct && (
                                      <button
                                        type='button'
                                        onClick={() =>
                                          handleStartEditMin(product)
                                        }
                                        className='opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 print:hidden'
                                        title='Modifier le stock minimum'
                                      >
                                        <Pencil className='h-3 w-3' />
                                      </button>
                                    )}
                                  </div>
                                ) : canEditProduct ? (
                                  <Button
                                    type='button'
                                    variant='ghost'
                                    size='sm'
                                    className='h-6 px-2 text-[11px] text-amber-700 hover:bg-amber-50 print:hidden'
                                    onClick={() => handleStartEditMin(product)}
                                  >
                                    <Pencil className='mr-1 h-3 w-3' />
                                    Définir min.
                                  </Button>
                                ) : (
                                  <span className='text-slate-400'>—</span>
                                )}
                              </TableCell>
                            )}

                            {visibleColumns.status && (
                              <TableCell className='py-2 whitespace-nowrap'>
                                <StockStatusBadge status={stockResult.status} />
                              </TableCell>
                            )}

                            {showFinancials && visibleColumns.average_price && (
                              <TableCell className='py-2 text-right font-mono text-xs tabular-nums whitespace-nowrap'>
                                {stockResult.priceMissing ||
                                stockResult.averagePrice === null ? (
                                  <Badge
                                    variant='outline'
                                    className='border-amber-300 bg-amber-50 text-amber-800 text-[11px] font-normal'
                                  >
                                    Prix manquant
                                  </Badge>
                                ) : (
                                  formatMAD(stockResult.averagePrice)
                                )}
                              </TableCell>
                            )}

                            {showFinancials && visibleColumns.stock_value && (
                              <TableCell className='py-2 text-right font-mono text-xs font-semibold tabular-nums whitespace-nowrap'>
                                {stockResult.priceMissing ||
                                stockResult.stockValue === null ? (
                                  <Badge
                                    variant='outline'
                                    className='border-amber-300 bg-amber-50 text-amber-800 text-[11px] font-normal'
                                  >
                                    Prix manquant
                                  </Badge>
                                ) : (
                                  formatMAD(stockResult.stockValue)
                                )}
                              </TableCell>
                            )}
                          </TableRow>

                          {/* Expanded Calculation Formula Row */}
                          {isExpanded && (
                            <TableRow className='bg-slate-50/90'>
                              <TableCell colSpan={15} className='px-6 py-3'>
                                <div className='flex flex-wrap items-center justify-between gap-4 text-xs'>
                                  <div className='space-y-1'>
                                    <div className='flex items-center gap-2 font-semibold text-slate-900'>
                                      <Calculator className='h-4 w-4 text-slate-600' />
                                      <span>
                                        Détail du calcul (Moteur de stock) :
                                      </span>
                                    </div>
                                    <p className='font-mono text-sm text-slate-800 bg-white border border-slate-200 rounded px-3 py-1.5 inline-block'>
                                      {stockResult.formulaExplanationFR}
                                    </p>
                                    <div className='flex flex-wrap items-center gap-4 pt-1 text-slate-500'>
                                      <span>
                                        Cumul historique total — Entrées :{' '}
                                        <strong className='text-slate-700'>
                                          {formatNumberFR(
                                            stockResult.totalEntries
                                          )}{' '}
                                          {product.unit}
                                        </strong>
                                      </span>
                                      <span>
                                        Sorties conso. :{' '}
                                        <strong className='text-slate-700'>
                                          {formatNumberFR(
                                            stockResult.totalConsumed
                                          )}{' '}
                                          {product.unit}
                                        </strong>
                                      </span>
                                      <span>
                                        Pertes :{' '}
                                        <strong className='text-slate-700'>
                                          {formatNumberFR(
                                            stockResult.totalWasted
                                          )}{' '}
                                          {product.unit}
                                        </strong>
                                      </span>
                                    </div>
                                  </div>

                                  <div className='flex items-center gap-2 print:hidden'>
                                    <Button
                                      type='button'
                                      variant='outline'
                                      size='sm'
                                      className='h-8 bg-white text-xs'
                                      onClick={() =>
                                        openProductDetail(product.id)
                                      }
                                    >
                                      <Eye className='mr-1.5 h-3.5 w-3.5' />
                                      Ouvrir la fiche produit
                                      <ExternalLink className='ml-1 h-3 w-3' />
                                    </Button>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination Footer */}
            {!loading && filteredRows.length > 0 && (
              <div className='flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 print:hidden'>
                <div className='flex items-center gap-2 text-xs text-slate-600'>
                  <span>Lignes par page :</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v))
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className='h-8 w-[72px] bg-white text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='25'>25</SelectItem>
                      <SelectItem value='50'>50</SelectItem>
                      <SelectItem value='100'>100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className='flex items-center gap-2 text-xs text-slate-600'>
                  <span>
                    Page {safePage} sur {totalPages}
                  </span>
                  <Button
                    variant='outline'
                    size='icon'
                    className='h-8 w-8 bg-white'
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className='h-4 w-4' />
                  </Button>
                  <Button
                    variant='outline'
                    size='icon'
                    className='h-8 w-8 bg-white'
                    disabled={safePage >= totalPages}
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                  >
                    <ChevronRight className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stock Recalculation Comparison Dialog */}
        <Dialog open={recalcDialogOpen} onOpenChange={setRecalcDialogOpen}>
          <DialogContent className='max-w-xl'>
            <DialogHeader>
              <DialogTitle>Rapport de recalcul complet du stock</DialogTitle>
              <DialogDescription>
                Vérification intégrale de tous les produits à partir des
                mouvements et du dernier inventaire confirmé.
              </DialogDescription>
            </DialogHeader>

            {recalcReport && (
              <div className='space-y-4 text-sm'>
                <div className='grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3'>
                  <div>
                    <span className='text-xs text-slate-500'>
                      Produits vérifiés
                    </span>
                    <p className='text-base font-bold text-slate-900'>
                      {recalcReport.totalProductsChecked}
                    </p>
                  </div>
                  <div>
                    <span className='text-xs text-slate-500'>
                      Écarts de cache détectés
                    </span>
                    <p
                      className={`text-base font-bold ${
                        recalcReport.differencesCount === 0
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {recalcReport.differencesCount}
                    </p>
                  </div>
                  {showFinancials && (
                    <div>
                      <span className='text-xs text-slate-500'>
                        Valeur totale recalculée
                      </span>
                      <p className='text-base font-bold text-slate-900'>
                        {formatMAD(recalcReport.totalStockValue)}
                      </p>
                    </div>
                  )}
                  <div>
                    <span className='text-xs text-slate-500'>
                      Produits en alerte
                    </span>
                    <p className='text-base font-bold text-red-700'>
                      {recalcReport.alertCount}
                    </p>
                  </div>
                </div>

                {recalcReport.differencesCount === 0 ? (
                  <div className='rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800'>
                    Toutes les valeurs en cache correspondaient exactement au
                    recalcul complet depuis l’historique des mouvements.
                  </div>
                ) : (
                  <div className='max-h-60 overflow-y-auto rounded border border-slate-200'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='text-xs'>Produit</TableHead>
                          <TableHead className='text-right text-xs'>
                            Cache précédent
                          </TableHead>
                          <TableHead className='text-right text-xs'>
                            Recalculé
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recalcReport.differences.map((d) => (
                          <TableRow key={d.productId}>
                            <TableCell className='text-xs font-medium'>
                              {d.ref} — {d.name}
                            </TableCell>
                            <TableCell className='text-right font-mono text-xs'>
                              {formatNumberFR(d.previousStock)}
                            </TableCell>
                            <TableCell className='text-right font-mono text-xs font-bold'>
                              {formatNumberFR(d.newStock)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button onClick={() => setRecalcDialogOpen(false)}>Fermer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}

export const EtatDesStocksPage = EtatDesStocks
