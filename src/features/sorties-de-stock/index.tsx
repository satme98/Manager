import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpFromLine,
  Check,
  Edit3,
  FileSpreadsheet,
  History,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import type {
  AuditLogRecord,
  ExitLineRecord,
  ExitRecord,
  ProductRecord,
  StockStatusLabel,
  VatConvention,
} from '@/data/types'
import {
  type ConfirmedInventoryCount,
  checkDocumentBeforeInventoryCutoff,
  computeTargetedProductsStock,
  normalizeProductRef,
  normalizeSearchText,
  roundCurrency,
  roundQty,
} from '@/lib/stock-engine'
import { formatDateFR, formatDateTimeFR, formatMAD, formatQty } from '@/lib/format'
import { canPerformCollectionAction, canSeeFinancialData } from '@/lib/rbac'
import { useAuthStore } from '@/stores/auth-store'
import { ConfigDrawer } from '@/components/config-drawer'
import { EmptyState } from '@/components/empty-state'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search as GlobalSearchButton } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Textarea } from '@/components/ui/textarea'

const EXIT_DRAFT_STORAGE_KEY = 'monarq_exit_entry_draft_v1'

const DEFAULT_LOSS_REASONS = [
  'Péremption / DLC dépassée',
  'Casse / Chute accidentelle',
  'Erreur de préparation',
  'Cuisson / Produit altéré',
  'Qualité non conforme',
  'Autre motif',
]

interface DraftExitLine {
  key: string
  productId: string
  productQuery: string
  qtyConsumed: string
  qtyWasted: string
  lossReason: string
}

interface DraftExitForm {
  date: string
  destination: string
  notes: string
  lines: DraftExitLine[]
  correctedFromId?: string
}

interface EnrichedExitDocument extends ExitRecord {
  lines: ExitLineRecord[]
  productsCount: number
  consumedValue: number
  wastedValue: number
  hasMissingPrice: boolean
  hasLosses: boolean
  isReversal: boolean
  isReversed: boolean
  reversedByDoc?: ExitRecord
  isPendingApproval: boolean
}

type SortField =
  | 'date'
  | 'destination'
  | 'products_count'
  | 'consumed_value'
  | 'wasted_value'
  | 'recorded_by'
type SortDir = 'asc' | 'desc'

function createBlankExitLine(): DraftExitLine {
  return {
    key: `exit_line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    productId: '',
    productQuery: '',
    qtyConsumed: '',
    qtyWasted: '0',
    lossReason: '',
  }
}

function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function createFreshExitDraft(defaultDest = 'Cuisine'): DraftExitForm {
  return {
    date: getTodayIsoDate(),
    destination: defaultDest,
    notes: '',
    lines: [createBlankExitLine()],
  }
}

function loadSavedExitDraft(): DraftExitForm {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createFreshExitDraft()
  }
  try {
    const raw = window.localStorage.getItem(EXIT_DRAFT_STORAGE_KEY)
    if (!raw) return createFreshExitDraft()
    const parsed = JSON.parse(raw) as Partial<DraftExitForm>
    if (!parsed || typeof parsed !== 'object') return createFreshExitDraft()
    return {
      date: parsed.date || getTodayIsoDate(),
      destination: parsed.destination || 'Cuisine',
      notes: parsed.notes || '',
      lines:
        Array.isArray(parsed.lines) && parsed.lines.length > 0
          ? parsed.lines
          : [createBlankExitLine()],
      correctedFromId: parsed.correctedFromId,
    }
  } catch {
    return createFreshExitDraft()
  }
}

function StockBadge({
  stock,
  unit,
  status,
}: {
  stock: number
  unit: string
  status: StockStatusLabel
}) {
  const styles: Record<StockStatusLabel, string> = {
    Alerte: 'border-[#D82C0D]/30 bg-[#FFF4F4] text-[#D82C0D]',
    'À surveiller': 'border-[#B98900]/30 bg-[#FFF8E6] text-[#B98900]',
    OK: 'border-[#008060]/30 bg-[#E3F1DF] text-[#008060]',
    'À définir': 'border-[#8C9196]/40 bg-[#F1F2F3] text-[#6D7175]',
  }
  return (
    <Badge
      variant='outline'
      className={`font-mono text-xs font-semibold ${styles[status]}`}
    >
      {formatQty(stock)} {unit} ({status})
    </Badge>
  )
}

export function SortiesDeStock() {
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()
  const role = auth.user?.role

  const canCreate = canPerformCollectionAction(role, 'exits', 'create')
  const canReverse = canPerformCollectionAction(role, 'exits', 'reverse')
  const canSeePrices = canSeeFinancialData(role)
  const canListPurchases = canPerformCollectionAction(role, 'purchases', 'list')
  const canListAudit = canPerformCollectionAction(role, 'audit_log', 'list')
  const isManagerOrAdmin = role === 'admin' || role === 'manager'

  const [viewMode, setViewMode] = useState<'list' | 'new' | 'detail'>(() => {
    if (typeof window === 'undefined') return 'list'
    const params = new URLSearchParams(window.location.search)
    if (params.get('mode') === 'new') return 'new'
    if (params.get('doc')) return 'detail'
    return 'list'
  })
  const [selectedDocId, setSelectedDocId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('doc')
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const checkParams = () => {
      const params = new URLSearchParams(window.location.search)
      if (params.get('mode') === 'new') {
        setViewMode('new')
      } else if (params.get('doc')) {
        setSelectedDocId(params.get('doc'))
        setViewMode('detail')
      }
    }
    window.addEventListener('popstate', checkParams)
    return () => window.removeEventListener('popstate', checkParams)
  }, [])

  // List filters (initialized from URL query parameters when navigated from Dashboard)
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('from') || ''
  })
  const [dateTo, setDateTo] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('to') || ''
  })
  const [destinationFilter, setDestinationFilter] = useState('all')
  const [productFilter, setProductFilter] = useState('all')
  const [withLossesFilter, setWithLossesFilter] = useState<
    'all' | 'with_losses' | 'reversed_only' | 'pending_approval'
  >(() => {
    if (typeof window === 'undefined') return 'all'
    const f = new URLSearchParams(window.location.search).get('filter')
    if (f === 'with_losses' || f === 'reversed_only' || f === 'pending_approval') {
      return f
    }
    return 'all'
  })
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [pageSize, setPageSize] = useState<number>(25)
  const [page, setPage] = useState<number>(1)

  // New Exit Form state
  const [draft, setDraft] = useState<DraftExitForm>(loadSavedExitDraft)
  const [submittedAttempt, setSubmittedAttempt] = useState(false)
  const [openProductDropdownRowKey, setOpenProductDropdownRowKey] = useState<
    string | null
  >(null)

  // Inline new destination modal
  const [newDestDialogOpen, setNewDestDialogOpen] = useState(false)
  const [newDestName, setNewDestName] = useState('')
  const [customDestinations, setCustomDestinations] = useState<string[]>([])

  // Quick Multi-Product Add ("Ajouter plusieurs produits") modal
  const [quickBatchModalOpen, setQuickBatchModalOpen] = useState(false)
  const [quickBatchText, setQuickBatchText] = useState('')

  // Confirmation before saving dialog
  const [confirmSaveDialogOpen, setConfirmSaveDialogOpen] = useState(false)
  const [negativeStockConfirmed, setNegativeStockConfirmed] = useState(false)
  const [negativeStockReason, setNegativeStockReason] = useState('')

  // Reversal / Correction dialog
  const [reversalDialogOpen, setReversalDialogOpen] = useState(false)
  const [reversalMode, setReversalMode] = useState<'cancel' | 'correct'>(
    'cancel'
  )
  const [reversalReason, setReversalReason] = useState('')
  const [approveCutoffOverride, setApproveCutoffOverride] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return
    try {
      window.localStorage.setItem(
        EXIT_DRAFT_STORAGE_KEY,
        JSON.stringify(draft)
      )
    } catch {
      // Ignore quota errors
    }
  }, [draft])

  // Queries
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['products'],
    queryFn: () => repository.listProducts(),
  })

  const { data: exitsBundle, isLoading: loadingExits } = useQuery({
    queryKey: ['exits'],
    queryFn: () => repository.listExits(),
  })

  const { data: purchasesBundle } = useQuery({
    queryKey: ['purchases'],
    queryFn: () => repository.listPurchases(),
    enabled: canListPurchases,
  })

  const { data: inventoriesBundle } = useQuery({
    queryKey: ['inventories'],
    queryFn: () => repository.listInventories(),
  })

  const { data: settingsRecords = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => repository.listSettings(),
  })

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['audit_log'],
    queryFn: () => repository.listAuditLogs(),
    enabled: canListAudit,
  })

  const exitHeaders = useMemo(() => exitsBundle?.headers ?? [], [exitsBundle])
  const exitLines = useMemo(() => exitsBundle?.lines ?? [], [exitsBundle])
  const purchaseHeaders = useMemo(
    () => purchasesBundle?.headers ?? [],
    [purchasesBundle]
  )
  const purchaseLines = useMemo(
    () => purchasesBundle?.lines ?? [],
    [purchasesBundle]
  )
  const inventorySessions = useMemo(
    () => inventoriesBundle?.sessions ?? [],
    [inventoriesBundle]
  )
  const inventoryLines = useMemo(
    () => inventoriesBundle?.lines ?? [],
    [inventoriesBundle]
  )

  const vatConvention: VatConvention = useMemo(() => {
    const found = settingsRecords.find((s) => s.key === 'vat_convention')
    return found?.value === 'HT' ? 'HT' : 'TTC'
  }, [settingsRecords])

  const destinationsList = useMemo(() => {
    const found = settingsRecords.find((s) => s.key === 'destinations_list')
    const base = Array.isArray(found?.value)
      ? (found.value as string[])
      : ['Cuisine', 'Bar', 'Pâtisserie', 'Salle', 'Personnel']
    const set = new Set<string>([...base, ...customDestinations])
    for (const ex of exitHeaders) {
      if (ex.destination) set.add(ex.destination)
    }
    return Array.from(set)
  }, [settingsRecords, customDestinations, exitHeaders])

  const productById = useMemo(() => {
    const map = new Map<string, ProductRecord>()
    for (const p of products) map.set(p.id, p)
    return map
  }, [products])

  const activeProducts = useMemo(
    () => products.filter((p) => !p.archived),
    [products]
  )

  const allConfirmedCountsFlat = useMemo(() => {
    const sessionMap = new Map(inventorySessions.map((s) => [s.id, s]))
    const list: ConfirmedInventoryCount[] = []
    inventoryLines.forEach((il, idx) => {
      const s = sessionMap.get(il.session)
      if (!s || s.status !== 'confirmed') return
      list.push({
        id: il.id,
        sessionId: s.id,
        productId: il.product,
        date: s.confirmed_at || s.date,
        counted: il.counted,
        confirmedOrder: il.order_index ?? idx,
      })
    })
    return list
  }, [inventorySessions, inventoryLines])

  const stockByProductId = useMemo(() => {
    return computeTargetedProductsStock({
      targetProductIds: products.map((p) => p.id),
      products,
      purchases: purchaseHeaders,
      purchaseLines,
      exits: exitHeaders,
      exitLines,
      inventorySessions,
      inventoryLines,
    })
  }, [
    products,
    purchaseHeaders,
    purchaseLines,
    exitHeaders,
    exitLines,
    inventorySessions,
    inventoryLines,
  ])

  const linesByExitId = useMemo(() => {
    const map = new Map<string, ExitLineRecord[]>()
    for (const l of exitLines) {
      const list = map.get(l.exit) ?? []
      list.push(l)
      map.set(l.exit, list)
    }
    return map
  }, [exitLines])

  const reversalByOriginalId = useMemo(() => {
    const map = new Map<string, ExitRecord>()
    for (const ex of exitHeaders) {
      if (ex.reversed_of) {
        map.set(ex.reversed_of, ex)
      }
    }
    return map
  }, [exitHeaders])

  const enrichedExits: EnrichedExitDocument[] = useMemo(() => {
    return exitHeaders.map((ex: ExitRecord) => {
      const lines = linesByExitId.get(ex.id) ?? []
      let consumedValue = 0
      let wastedValue = 0
      let hasMissingPrice = false
      let totalWastedQty = 0

      for (const l of lines) {
        totalWastedQty += Number(l.qty_wasted || 0)
        if (l.unit_cost_snapshot !== null && l.unit_cost_snapshot !== undefined) {
          consumedValue += roundCurrency(l.qty_consumed * l.unit_cost_snapshot)
          wastedValue += roundCurrency(l.qty_wasted * l.unit_cost_snapshot)
        } else {
          hasMissingPrice = true
        }
      }

      const isReversal = Boolean(ex.reversed_of)
      const reversedByDoc = reversalByOriginalId.get(ex.id)
      const isReversed =
        Boolean(reversedByDoc) ||
        ex.correction_status === 'reversed' ||
        ex.correction_status === 'corrected'
      const isPendingApproval = ex.correction_status === 'pending_approval'

      return {
        ...ex,
        lines,
        productsCount: lines.length,
        consumedValue: roundCurrency(consumedValue),
        wastedValue: roundCurrency(wastedValue),
        hasMissingPrice,
        hasLosses: Math.abs(totalWastedQty) > 0,
        isReversal,
        isReversed,
        reversedByDoc,
        isPendingApproval,
      }
    })
  }, [exitHeaders, linesByExitId, reversalByOriginalId])

  const filteredExits = useMemo(() => {
    const normSearch = normalizeSearchText(searchQuery)

    const filtered = enrichedExits.filter((doc: EnrichedExitDocument) => {
      const docDay = doc.date.slice(0, 10)
      if (dateFrom && docDay < dateFrom) return false
      if (dateTo && docDay > dateTo) return false

      if (
        destinationFilter !== 'all' &&
        doc.destination !== destinationFilter
      ) {
        return false
      }

      if (productFilter !== 'all') {
        const hasProd = doc.lines.some(
          (l: ExitLineRecord) => l.product === productFilter
        )
        if (!hasProd) return false
      }

      if (withLossesFilter === 'with_losses') {
        if (!doc.hasLosses) return false
      } else if (withLossesFilter === 'reversed_only') {
        if (!doc.isReversal && !doc.isReversed) return false
      } else if (withLossesFilter === 'pending_approval') {
        if (!doc.isPendingApproval) return false
      }

      if (normSearch) {
        const destMatch = normalizeSearchText(doc.destination).includes(
          normSearch
        )
        const notesMatch = normalizeSearchText(doc.notes || '').includes(
          normSearch
        )
        const prodMatch = doc.lines.some((l: ExitLineRecord) => {
          const prod = productById.get(l.product)
          if (!prod) return false
          return (
            normalizeSearchText(prod.ref).includes(normSearch) ||
            normalizeSearchText(prod.name).includes(normSearch)
          )
        })
        if (!destMatch && !notesMatch && !prodMatch) return false
      }

      return true
    })

    filtered.sort((a: EnrichedExitDocument, b: EnrichedExitDocument) => {
      let cmp = 0
      switch (sortField) {
        case 'date':
          cmp = a.date.localeCompare(b.date)
          break
        case 'destination':
          cmp = a.destination.localeCompare(b.destination)
          break
        case 'products_count':
          cmp = a.productsCount - b.productsCount
          break
        case 'consumed_value':
          cmp = a.consumedValue - b.consumedValue
          break
        case 'wasted_value':
          cmp = a.wastedValue - b.wastedValue
          break
        case 'recorded_by':
          cmp = (a.recorded_by_name || '').localeCompare(
            b.recorded_by_name || ''
          )
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return filtered
  }, [
    enrichedExits,
    searchQuery,
    dateFrom,
    dateTo,
    destinationFilter,
    productFilter,
    withLossesFilter,
    sortField,
    sortDir,
    productById,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredExits.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginatedExits = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredExits.slice(start, start + pageSize)
  }, [filteredExits, safePage, pageSize])

  const selectedDocument = useMemo(() => {
    if (!selectedDocId) return null
    return (
      enrichedExits.find((d: EnrichedExitDocument) => d.id === selectedDocId) ??
      null
    )
  }, [enrichedExits, selectedDocId])

  const selectedDocAuditLogs = useMemo(() => {
    if (!selectedDocId) return []
    return auditLogs.filter(
      (log: AuditLogRecord) =>
        log.record_id === selectedDocId ||
        (log.details &&
          (log.details.reversed_of === selectedDocId ||
            log.details.original_id === selectedDocId))
    )
  }, [auditLogs, selectedDocId])

  const selectedDocCutoffDate = useMemo(() => {
    if (!selectedDocument) return null
    const productIds = selectedDocument.lines.map(
      (l: ExitLineRecord) => l.product
    )
    const check = checkDocumentBeforeInventoryCutoff(
      selectedDocument.date,
      productIds,
      allConfirmedCountsFlat
    )
    return check.isBeforeCutoff ? check.latestCutoffDate : null
  }, [selectedDocument, allConfirmedCountsFlat])

  const validDraftLines = useMemo(() => {
    return draft.lines.filter((l) => {
      const c = Number(l.qtyConsumed || 0)
      const w = Number(l.qtyWasted || 0)
      return l.productId && c >= 0 && w >= 0 && c + w > 0
    })
  }, [draft.lines])

  const requestedDeductionByProductId = useMemo(() => {
    const map = new Map<string, number>()
    for (const line of draft.lines) {
      if (!line.productId) continue
      const c = Math.max(0, Number(line.qtyConsumed || 0))
      const w = Math.max(0, Number(line.qtyWasted || 0))
      if (!Number.isFinite(c) || !Number.isFinite(w)) continue
      map.set(line.productId, roundQty((map.get(line.productId) ?? 0) + c + w))
    }
    return map
  }, [draft.lines])

  const insufficientStockItems = useMemo(() => {
    const list: Array<{
      productId: string
      product: ProductRecord
      available: number
      requested: number
      after: number
    }> = []
    for (const [productId, requested] of requestedDeductionByProductId.entries()) {
      if (requested <= 0) continue
      const prod = productById.get(productId)
      if (!prod) continue
      const available =
        stockByProductId.get(productId)?.stock ?? prod.initial_stock
      const after = roundQty(available - requested)
      if (after < 0) {
        list.push({
          productId,
          product: prod,
          available,
          requested,
          after,
        })
      }
    }
    return list
  }, [requestedDeductionByProductId, productById, stockByProductId])

  const hasInsufficientStock = insufficientStockItems.length > 0

  const draftFinancialSummary = useMemo(() => {
    let totalConsumedVal = 0
    let totalWastedVal = 0
    let missingPriceProductsCount = 0

    for (const line of draft.lines) {
      if (!line.productId) continue
      const c = Math.max(0, Number(line.qtyConsumed || 0))
      const w = Math.max(0, Number(line.qtyWasted || 0))
      if (c + w <= 0) continue

      const avgPrice = stockByProductId.get(line.productId)?.averagePrice ?? null
      if (avgPrice === null) {
        missingPriceProductsCount += 1
      } else {
        totalConsumedVal += roundCurrency(c * avgPrice)
        totalWastedVal += roundCurrency(w * avgPrice)
      }
    }

    return {
      totalConsumedVal: roundCurrency(totalConsumedVal),
      totalWastedVal: roundCurrency(totalWastedVal),
      missingPriceProductsCount,
    }
  }, [draft.lines, stockByProductId])

  const selectProductForLine = (lineKey: string, product: ProductRecord) => {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((l) =>
        l.key === lineKey
          ? {
              ...l,
              productId: product.id,
              productQuery: `${product.ref} — ${product.name}`,
            }
          : l
      ),
    }))
    setOpenProductDropdownRowKey(null)
  }

  const handleProductQueryChange = (lineKey: string, value: string) => {
    const cleanRef = normalizeProductRef(value)
    const exactMatch = activeProducts.find(
      (p) => normalizeProductRef(p.ref) === cleanRef
    )
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => {
        if (l.key !== lineKey) return l
        if (exactMatch) {
          return {
            ...l,
            productId: exactMatch.id,
            productQuery: value,
          }
        }
        return {
          ...l,
          productId: '',
          productQuery: value,
        }
      }),
    }))
    setOpenProductDropdownRowKey(lineKey)
  }

  const productRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const consumedRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const wastedRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const addLineAndFocus = () => {
    const newLine = createBlankExitLine()
    setDraft((prev) => ({
      ...prev,
      lines: [...prev.lines, newLine],
    }))
    setTimeout(() => {
      productRefs.current[newLine.key]?.focus()
    }, 30)
  }

  const handleApplyQuickBatch = () => {
    const rawLines = quickBatchText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (rawLines.length === 0) {
      toast.error('Veuillez saisir au moins une ligne (ex: P092 5).')
      return
    }

    const addedLines: DraftExitLine[] = []
    const notFoundRefs: string[] = []

    for (const raw of rawLines) {
      const parts = raw.split(/[\s,;:\t]+/).filter(Boolean)
      if (parts.length === 0) continue
      const refCandidate = normalizeProductRef(parts[0])
      const consumedQty =
        parts.length >= 2 ? Number(parts[1].replace(',', '.')) : 1
      const wastedQty =
        parts.length >= 3 ? Number(parts[2].replace(',', '.')) : 0

      const matchedProduct = activeProducts.find(
        (p) => normalizeProductRef(p.ref) === refCandidate
      )
      if (!matchedProduct) {
        notFoundRefs.push(parts[0])
        continue
      }

      addedLines.push({
        key: `exit_line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        productId: matchedProduct.id,
        productQuery: `${matchedProduct.ref} — ${matchedProduct.name}`,
        qtyConsumed: String(
          Number.isFinite(consumedQty) && consumedQty >= 0 ? consumedQty : 1
        ),
        qtyWasted: String(
          Number.isFinite(wastedQty) && wastedQty >= 0 ? wastedQty : 0
        ),
        lossReason: '',
      })
    }

    if (addedLines.length > 0) {
      setDraft((prev) => {
        const nonEmptyExisting = prev.lines.filter(
          (l) => l.productId || l.productQuery.trim()
        )
        return {
          ...prev,
          lines: [...nonEmptyExisting, ...addedLines],
        }
      })
      setQuickBatchModalOpen(false)
      setQuickBatchText('')
      toast.success(`${addedLines.length} produit(s) ajouté(s) au bon de sortie.`)
    }

    if (notFoundRefs.length > 0) {
      toast.warning(
        `Référence(s) introuvable(s) ou archivée(s) : ${notFoundRefs.join(', ')}`
      )
    }
  }

  const handleInitiateSave = () => {
    setSubmittedAttempt(true)
    if (!draft.date || !draft.destination.trim()) {
      toast.error('Veuillez renseigner la date et la destination.')
      return
    }
    if (validDraftLines.length === 0) {
      toast.error(
        'Veuillez ajouter au moins un produit avec une quantité consommée ou perdue positive.'
      )
      return
    }
    if (hasInsufficientStock && !isManagerOrAdmin) {
      toast.error(
        'Stock insuffisant sur un ou plusieurs produits. Votre rôle ne permet pas de valider un stock négatif.'
      )
      return
    }
    setNegativeStockConfirmed(false)
    setNegativeStockReason('')
    setConfirmSaveDialogOpen(true)
  }

  const createExitMutation = useMutation({
    mutationFn: async () => {
      if (hasInsufficientStock) {
        if (!isManagerOrAdmin) {
          throw new Error(
            'Stock insuffisant : seul un Manager ou Administrateur peut forcer un stock négatif.'
          )
        }
        if (!negativeStockConfirmed || !negativeStockReason.trim()) {
          throw new Error(
            'Veuillez cocher la confirmation et saisir un motif obligatoire pour le stock négatif.'
          )
        }
      }

      return repository.createExitDocument({
        date: draft.date,
        destination: draft.destination.trim(),
        notes: draft.notes.trim(),
        negative_stock_reason: hasInsufficientStock
          ? negativeStockReason.trim()
          : undefined,
        lines: validDraftLines.map((l) => ({
          product: l.productId,
          qty_consumed: Number(l.qtyConsumed || 0),
          qty_wasted: Number(l.qtyWasted || 0),
          loss_reason: l.lossReason.trim() || undefined,
        })),
      })
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['exits'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      setConfirmSaveDialogOpen(false)
      const fresh = createFreshExitDraft(draft.destination)
      setDraft(fresh)
      setSubmittedAttempt(false)
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(EXIT_DRAFT_STORAGE_KEY)
      }
      setSelectedDocId(created.header.id)
      setViewMode('list')
      toast.success('Bon de sortie enregistré et stock mis à jour.', {
        action: {
          label: 'Voir la sortie',
          onClick: () => {
            setSelectedDocId(created.header.id)
            setViewMode('detail')
          },
        },
      })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const reverseExitMutation = useMutation({
    mutationFn: async ({
      exitId,
      reason,
      mode,
      approveCutoff,
    }: {
      exitId: string
      reason: string
      mode: 'cancel' | 'correct'
      approveCutoff: boolean
    }) => {
      const original = enrichedExits.find(
        (d: EnrichedExitDocument) => d.id === exitId
      )
      const reversalResult = await repository.reverseExitDocument(
        exitId,
        reason,
        { mode, approveCutoff, approveBeforeInventoryCutoff: approveCutoff }
      )
      return { reversalResult, original, mode }
    },
    onSuccess: ({ reversalResult, original, mode }) => {
      queryClient.invalidateQueries({ queryKey: ['exits'] })
      queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      setReversalDialogOpen(false)
      setReversalReason('')
      setApproveCutoffOverride(false)

      if (reversalResult.status === 'pending_approval') {
        toast.info(
          "Demande de contre-passation enregistrée (« En attente d'approbation » par un Manager ou Administrateur)."
        )
        return
      }

      if (mode === 'correct' && original) {
        const prefilledLines: DraftExitLine[] = original.lines.map(
          (l: ExitLineRecord) => {
            const prod = productById.get(l.product)
            return {
              key: `exit_line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              productId: l.product,
              productQuery: prod ? `${prod.ref} — ${prod.name}` : l.product,
              qtyConsumed: String(Math.abs(l.qty_consumed)),
              qtyWasted: String(Math.abs(l.qty_wasted)),
              lossReason: l.loss_reason || '',
            }
          }
        )
        setDraft({
          date: original.date.slice(0, 10),
          destination: original.destination,
          notes: `Correction de la sortie ${original.id} (${reversalReason.trim()})`,
          lines:
            prefilledLines.length > 0
              ? prefilledLines
              : [createBlankExitLine()],
          correctedFromId: original.id,
        })
        setViewMode('new')
        toast.success(
          'Contre-passation créée. Le nouveau formulaire est pré-rempli avec les quantités d’origine pour correction.'
        )
      } else {
        toast.success(
          'Sortie annulée par contre-passation. Le document original reste visible dans l’historique.'
        )
      }
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className='ml-1 inline size-3.5 text-[#6D7175]/60' />
    }
    return sortDir === 'asc' ? (
      <ArrowUp className='ml-1 inline size-3.5 text-[#202223]' />
    ) : (
      <ArrowDown className='ml-1 inline size-3.5 text-[#202223]' />
    )
  }

  const isLoading = loadingProducts || loadingExits

  return (
    <>
      <Header fixed>
        <div className='hidden items-center gap-2 text-xs text-muted-foreground md:flex'>
          <span className='font-medium uppercase tracking-wider'>
            PRINCIPAL
          </span>
          <span aria-hidden='true'>/</span>
          <button
            type='button'
            onClick={() => setViewMode('list')}
            className='font-medium text-foreground hover:underline'
          >
            Sorties de stock
          </button>
          {viewMode === 'new' && (
            <>
              <span aria-hidden='true'>/</span>
              <span className='font-medium text-[#008060]'>
                Nouvelle sortie
              </span>
            </>
          )}
          {viewMode === 'detail' && selectedDocument && (
            <>
              <span aria-hidden='true'>/</span>
              <span className='font-medium text-foreground'>
                {selectedDocument.destination} (
                {formatDateFR(selectedDocument.date)})
              </span>
            </>
          )}
        </div>
        <div className='ms-auto flex items-center gap-2'>
          <GlobalSearchButton />
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main id='content' className='space-y-4'>
        {/* ==================== VIEW 1: LIST PAGE ==================== */}
        {viewMode === 'list' && (
          <>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <h1 className='text-xl font-semibold tracking-tight text-[#202223]'>
                  Sorties de stock
                </h1>
                <p className='mt-0.5 text-xs text-[#6D7175] sm:text-sm'>
                  Bons de sortie vers la cuisine, le bar et les postes :
                  quantités consommées et pertes constatées.
                </p>
              </div>
              <div className='flex items-center gap-2'>
                {canCreate && (
                  <Button
                    size='sm'
                    className='h-9 gap-1.5 bg-[#008060] text-white hover:bg-[#006e52]'
                    onClick={() => setViewMode('new')}
                  >
                    <Plus className='size-4' />
                    <span>Nouvelle sortie</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Filter Bar */}
            <div className='rounded-lg border border-[#E1E3E5] bg-white p-3 shadow-xs'>
              <div className='grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5'>
                <div className='relative lg:col-span-2'>
                  <Search className='pointer-events-none absolute top-2.5 left-2.5 size-4 text-[#6D7175]' />
                  <Input
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setPage(1)
                    }}
                    placeholder='Rechercher par produit, référence ou destination...'
                    className='h-9 pl-8 text-xs'
                  />
                </div>

                <div>
                  <Select
                    value={destinationFilter}
                    onValueChange={(v) => {
                      setDestinationFilter(v)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='Destination' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>
                        Toutes les destinations
                      </SelectItem>
                      {destinationsList.map((dest) => (
                        <SelectItem key={dest} value={dest}>
                          {dest}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Select
                    value={productFilter}
                    onValueChange={(v) => {
                      setProductFilter(v)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='Filtrer par produit' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Tous les produits</SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.ref} — {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Select
                    value={withLossesFilter}
                    onValueChange={(
                      v:
                        | 'all'
                        | 'with_losses'
                        | 'reversed_only'
                        | 'pending_approval'
                    ) => {
                      setWithLossesFilter(v)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='Filtre pertes / statut' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Toutes les sorties</SelectItem>
                      <SelectItem value='with_losses'>Avec pertes</SelectItem>
                      <SelectItem value='reversed_only'>
                        Corrigées / annulées
                      </SelectItem>
                      <SelectItem value='pending_approval'>
                        En attente d&apos;approbation
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className='mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#E1E3E5] pt-2.5'>
                <div className='flex flex-wrap items-center gap-2 text-xs'>
                  <span className='text-[#6D7175]'>Période :</span>
                  <Input
                    type='date'
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value)
                      setPage(1)
                    }}
                    className='h-8 w-36 text-xs'
                  />
                  <span className='text-[#6D7175]'>au</span>
                  <Input
                    type='date'
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value)
                      setPage(1)
                    }}
                    className='h-8 w-36 text-xs'
                  />
                  {(searchQuery ||
                    dateFrom ||
                    dateTo ||
                    destinationFilter !== 'all' ||
                    productFilter !== 'all' ||
                    withLossesFilter !== 'all') && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-8 text-xs text-[#6D7175]'
                      onClick={() => {
                        setSearchQuery('')
                        setDateFrom('')
                        setDateTo('')
                        setDestinationFilter('all')
                        setProductFilter('all')
                        setWithLossesFilter('all')
                        setPage(1)
                      }}
                    >
                      Réinitialiser les filtres
                    </Button>
                  )}
                </div>

                <div className='text-xs text-[#6D7175]'>
                  <span className='font-semibold text-[#202223]'>
                    {filteredExits.length}
                  </span>{' '}
                  sortie(s) trouvée(s)
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className='space-y-2 rounded-lg border border-[#E1E3E5] bg-white p-4'>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className='h-10 w-full' />
                ))}
              </div>
            ) : exitHeaders.length === 0 ? (
              <EmptyState
                icon={ArrowUpFromLine}
                title='Aucune sortie de stock enregistrée'
                description='Aucune consommation ni perte n’a encore été saisie. Les sorties mettent à jour le stock théorique en temps réel.'
                columnsPreview={
                  canSeePrices
                    ? [
                        'Date (JJ/MM/AAAA)',
                        'Destination',
                        'Nombre de produits',
                        `Valeur consommée (${vatConvention})`,
                        `Valeur des pertes (${vatConvention})`,
                        'Enregistré par',
                      ]
                    : [
                        'Date (JJ/MM/AAAA)',
                        'Destination',
                        'Nombre de produits',
                        'Enregistré par',
                      ]
                }
                primaryAction={
                  canCreate
                    ? {
                        label: 'Nouvelle sortie',
                        onClick: () => setViewMode('new'),
                        icon: Plus,
                      }
                    : undefined
                }
                secondaryAction={
                  canSeePrices
                    ? {
                        label: 'Importer depuis Excel',
                        to: '/import-export',
                        icon: FileSpreadsheet,
                      }
                    : undefined
                }
              />
            ) : (
              <div className='overflow-hidden rounded-lg border border-[#E1E3E5] bg-white shadow-xs'>
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader className='bg-[#F6F6F7]'>
                      <TableRow>
                        <TableHead
                          className='cursor-pointer text-xs font-semibold text-[#202223]'
                          onClick={() => handleSort('date')}
                        >
                          Date {renderSortIcon('date')}
                        </TableHead>
                        <TableHead
                          className='cursor-pointer text-xs font-semibold text-[#202223]'
                          onClick={() => handleSort('destination')}
                        >
                          Destination {renderSortIcon('destination')}
                        </TableHead>
                        <TableHead
                          className='cursor-pointer text-right text-xs font-semibold text-[#202223]'
                          onClick={() => handleSort('products_count')}
                        >
                          Nombre de produits {renderSortIcon('products_count')}
                        </TableHead>
                        {canSeePrices && (
                          <>
                            <TableHead
                              className='cursor-pointer text-right text-xs font-semibold text-[#202223]'
                              onClick={() => handleSort('consumed_value')}
                            >
                              Valeur consommée ({vatConvention}){' '}
                              {renderSortIcon('consumed_value')}
                            </TableHead>
                            <TableHead
                              className='cursor-pointer text-right text-xs font-semibold text-[#202223]'
                              onClick={() => handleSort('wasted_value')}
                            >
                              Valeur des pertes ({vatConvention}){' '}
                              {renderSortIcon('wasted_value')}
                            </TableHead>
                          </>
                        )}
                        <TableHead
                          className='cursor-pointer text-xs font-semibold text-[#202223]'
                          onClick={() => handleSort('recorded_by')}
                        >
                          Enregistré par {renderSortIcon('recorded_by')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedExits.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={canSeePrices ? 6 : 4}
                            className='py-8 text-center text-sm text-[#6D7175]'
                          >
                            Aucune sortie ne correspond aux filtres sélectionnés.
                          </TableCell>
                        </TableRow>
                      ) : (
                        paginatedExits.map((doc: EnrichedExitDocument) => (
                          <TableRow
                            key={doc.id}
                            onClick={() => {
                              setSelectedDocId(doc.id)
                              setViewMode('detail')
                            }}
                            className={`cursor-pointer transition-colors hover:bg-[#F6F6F7] ${
                              doc.isReversal || doc.isReversed
                                ? 'bg-[#FAFBFB] text-[#6D7175]'
                                : ''
                            }`}
                          >
                            <TableCell className='font-mono text-xs whitespace-nowrap'>
                              {formatDateFR(doc.date)}
                            </TableCell>
                            <TableCell className='text-xs font-medium text-[#202223]'>
                              <div className='flex flex-wrap items-center gap-1.5'>
                                <span>{doc.destination}</span>
                                {doc.hasLosses && (
                                  <Badge
                                    variant='outline'
                                    className='border-[#B98900]/40 bg-[#FFF8E6] text-[10px] text-[#B98900]'
                                  >
                                    Avec pertes
                                  </Badge>
                                )}
                                {doc.isReversal && (
                                  <Badge
                                    variant='outline'
                                    className='border-[#D82C0D]/40 bg-[#FFF4F4] text-[10px] text-[#D82C0D]'
                                  >
                                    Contre-passation
                                  </Badge>
                                )}
                                {doc.isReversed && !doc.isReversal && (
                                  <Badge
                                    variant='outline'
                                    className='border-[#8C9196] bg-[#F1F2F3] text-[10px] text-[#6D7175]'
                                  >
                                    Corrigée / Annulée
                                  </Badge>
                                )}
                                {doc.isPendingApproval && (
                                  <Badge
                                    variant='outline'
                                    className='border-[#B98900] bg-[#FFF8E6] text-[10px] text-[#B98900]'
                                  >
                                    En attente d&apos;approbation
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className='text-right font-mono text-xs'>
                              {doc.productsCount}
                            </TableCell>
                            {canSeePrices && (
                              <>
                                <TableCell className='text-right font-mono text-xs font-medium text-[#202223]'>
                                  <div className='flex items-center justify-end gap-1.5'>
                                    <span>{formatMAD(doc.consumedValue)}</span>
                                    {doc.hasMissingPrice && (
                                      <Badge
                                        variant='outline'
                                        className='border-[#B98900]/40 bg-[#FFF8E6] text-[10px] text-[#B98900]'
                                      >
                                        Prix manquant
                                      </Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell
                                  className={`text-right font-mono text-xs font-medium ${
                                    doc.wastedValue > 0
                                      ? 'text-[#D82C0D]'
                                      : 'text-[#6D7175]'
                                  }`}
                                >
                                  {formatMAD(doc.wastedValue)}
                                </TableCell>
                              </>
                            )}
                            <TableCell className='text-xs text-[#6D7175]'>
                              {doc.recorded_by_name || 'Équipe'}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className='flex flex-wrap items-center justify-between gap-2 border-t border-[#E1E3E5] bg-[#FAFBFB] px-4 py-2.5 text-xs text-[#6D7175]'>
                  <div className='flex items-center gap-2'>
                    <span>Lignes par page :</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => {
                        setPageSize(Number(v))
                        setPage(1)
                      }}
                    >
                      <SelectTrigger className='h-7 w-16 text-xs'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='25'>25</SelectItem>
                        <SelectItem value='50'>50</SelectItem>
                        <SelectItem value='100'>100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='flex items-center gap-2'>
                    <span>
                      Page {safePage} sur {totalPages}
                    </span>
                    <Button
                      variant='outline'
                      size='sm'
                      className='h-7 px-2 text-xs'
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Précédent
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      className='h-7 px-2 text-xs'
                      disabled={safePage >= totalPages}
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                    >
                      Suivant
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ==================== VIEW 2: NEW EXIT FORM (KITCHEN / TABLET FAST FORM) ==================== */}
        {viewMode === 'new' && (
          <div className='space-y-4'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div className='flex items-center gap-2.5'>
                <Button
                  variant='outline'
                  size='sm'
                  className='h-9 gap-1.5'
                  onClick={() => setViewMode('list')}
                >
                  <ArrowLeft className='size-4' />
                  <span>Retour aux sorties</span>
                </Button>
                <div>
                  <h1 className='text-lg font-semibold text-[#202223]'>
                    Nouvelle sortie de stock (Consommation & Pertes)
                  </h1>
                  <p className='text-xs text-[#6D7175]'>
                    Saisie rapide adaptée à la cuisine et aux tablettes • Le
                    stock disponible est vérifié en direct.
                  </p>
                </div>
              </div>

              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-9 gap-1.5 border-[#008060]/40 text-xs text-[#008060] hover:bg-[#E3F1DF]/40'
                  onClick={() => setQuickBatchModalOpen(true)}
                >
                  <Zap className='size-4' />
                  <span>Ajouter plusieurs produits</span>
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  className='h-9 text-xs'
                  onClick={() => {
                    setDraft(createFreshExitDraft(draft.destination))
                    setSubmittedAttempt(false)
                    toast.info('Formulaire réinitialisé.')
                  }}
                >
                  Réinitialiser
                </Button>
                <Button
                  size='sm'
                  className='h-9 gap-1.5 bg-[#008060] text-white hover:bg-[#006e52]'
                  disabled={
                    createExitMutation.isPending ||
                    (hasInsufficientStock && !isManagerOrAdmin)
                  }
                  onClick={handleInitiateSave}
                >
                  <Save className='size-4' />
                  <span>Vérifier et enregistrer la sortie</span>
                </Button>
              </div>
            </div>

            {/* Insufficient Stock Red Warning Banner */}
            {hasInsufficientStock && (
              <div className='rounded-lg border border-[#D82C0D] bg-[#FFF4F4] p-3.5 text-xs text-[#D82C0D]'>
                <div className='flex items-start gap-2.5'>
                  <AlertTriangle className='mt-0.5 size-4 shrink-0 text-[#D82C0D]' />
                  <div className='space-y-1'>
                    <p className='font-semibold'>
                      Stock insuffisant détecté sur{' '}
                      {insufficientStockItems.length} produit(s)
                    </p>
                    <ul className='list-disc space-y-0.5 pl-4'>
                      {insufficientStockItems.map((item) => (
                        <li key={item.productId}>
                          <strong>
                            {item.product.ref} — {item.product.name}
                          </strong>{' '}
                          : Stock insuffisant (disponible:{' '}
                          <span className='font-mono font-bold'>
                            {formatQty(item.available)} {item.product.unit}
                          </span>
                          , demandé:{' '}
                          <span className='font-mono font-bold'>
                            {formatQty(item.requested)} {item.product.unit}
                          </span>
                          )
                        </li>
                      ))}
                    </ul>
                    {!isManagerOrAdmin ? (
                      <p className='pt-1 font-semibold'>
                        Enregistrement bloqué : Les rôles Économat et Cuisine ne
                        peuvent pas enregistrer un mouvement rendant le stock
                        négatif. Réduisez la quantité ou contactez un Manager.
                      </p>
                    ) : (
                      <p className='pt-1 font-medium text-[#202223]'>
                        En tant que Manager / Administrateur, vous devrez cocher
                        la confirmation et saisir un motif obligatoire à
                        l&apos;étape de validation.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Header Card */}
            <div className='rounded-lg border border-[#E1E3E5] bg-white p-4 shadow-xs'>
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Date de sortie <span className='text-[#D82C0D]'>*</span>
                  </Label>
                  <Input
                    type='date'
                    value={draft.date}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, date: e.target.value }))
                    }
                    className='h-10 text-xs'
                  />
                </div>

                <div className='space-y-1.5'>
                  <div className='flex items-center justify-between'>
                    <Label className='text-xs font-medium text-[#202223]'>
                      Destination <span className='text-[#D82C0D]'>*</span>
                    </Label>
                    <button
                      type='button'
                      onClick={() => setNewDestDialogOpen(true)}
                      className='text-[11px] font-medium text-[#008060] hover:underline'
                    >
                      + Nouvelle destination
                    </button>
                  </div>
                  <Select
                    value={draft.destination}
                    onValueChange={(v) => {
                      if (v === '__new_dest__') {
                        setNewDestDialogOpen(true)
                        return
                      }
                      setDraft((prev) => ({ ...prev, destination: v }))
                    }}
                  >
                    <SelectTrigger className='h-10 text-xs'>
                      <SelectValue placeholder='Choisir une destination...' />
                    </SelectTrigger>
                    <SelectContent>
                      {destinationsList.map((dest) => (
                        <SelectItem key={dest} value={dest}>
                          {dest}
                        </SelectItem>
                      ))}
                      <SelectItem
                        value='__new_dest__'
                        className='font-medium text-[#008060]'
                      >
                        + Ajouter une destination...
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Enregistré par
                  </Label>
                  <Input
                    value={
                      auth.user?.name || auth.user?.email || 'Utilisateur actif'
                    }
                    disabled
                    className='h-10 bg-[#F6F6F7] text-xs text-[#6D7175]'
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Notes / Service
                  </Label>
                  <Input
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, notes: e.target.value }))
                    }
                    placeholder='Ex: Service du soir, banquet...'
                    className='h-10 text-xs'
                  />
                </div>
              </div>
            </div>

            {/* Lines Card */}
            <div className='rounded-lg border border-[#E1E3E5] bg-white p-4 shadow-xs'>
              <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
                <div>
                  <h2 className='text-sm font-semibold text-[#202223]'>
                    Produits sortis ({draft.lines.length})
                  </h2>
                  <p className='text-xs text-[#6D7175]'>
                    Saisissez la référence (ex: P092 ou p092) ou le nom du
                    produit. Le stock disponible s&apos;affiche immédiatement.
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-9 gap-1.5 text-xs'
                    onClick={addLineAndFocus}
                  >
                    <Plus className='size-4' />
                    <span>Ajouter une ligne</span>
                  </Button>
                </div>
              </div>

              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader className='bg-[#F6F6F7]'>
                    <TableRow>
                      <TableHead className='w-8 text-xs font-semibold text-[#6D7175]'>
                        #
                      </TableHead>
                      <TableHead className='min-w-[250px] text-xs font-semibold text-[#202223]'>
                        Produit (Réf. ou Nom) *
                      </TableHead>
                      <TableHead className='w-20 text-xs font-semibold text-[#202223]'>
                        Unité
                      </TableHead>
                      <TableHead className='w-40 text-xs font-semibold text-[#202223]'>
                        Stock actuel
                      </TableHead>
                      <TableHead className='w-36 text-right text-xs font-semibold text-[#202223]'>
                        Qté consommée
                      </TableHead>
                      <TableHead className='w-36 text-right text-xs font-semibold text-[#202223]'>
                        Qté perdue (gaspillage)
                      </TableHead>
                      <TableHead className='min-w-[170px] text-xs font-semibold text-[#202223]'>
                        Motif de la perte
                      </TableHead>
                      {canSeePrices && (
                        <>
                          <TableHead className='w-32 text-right text-xs font-semibold text-[#202223]'>
                            Valeur consommée
                          </TableHead>
                          <TableHead className='w-32 text-right text-xs font-semibold text-[#202223]'>
                            Valeur perdue
                          </TableHead>
                        </>
                      )}
                      <TableHead className='w-10' />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.lines.map((line, idx) => {
                      const selectedProduct = line.productId
                        ? productById.get(line.productId)
                        : undefined
                      const stockInfo = line.productId
                        ? stockByProductId.get(line.productId)
                        : undefined
                      const availableStock =
                        stockInfo?.stock ?? selectedProduct?.initial_stock ?? 0
                      const avgPrice = stockInfo?.averagePrice ?? null

                      const cQty = Math.max(0, Number(line.qtyConsumed || 0))
                      const wQty = Math.max(0, Number(line.qtyWasted || 0))
                      const totalRequestedForProduct = line.productId
                        ? (requestedDeductionByProductId.get(line.productId) ??
                          0)
                        : 0
                      const isInsufficient =
                        Boolean(selectedProduct) &&
                        totalRequestedForProduct > availableStock

                      const normQuery = normalizeSearchText(line.productQuery)
                      const matchingProducts = activeProducts
                        .filter(
                          (p) =>
                            !normQuery ||
                            normalizeSearchText(p.ref).includes(normQuery) ||
                            normalizeSearchText(p.name).includes(normQuery)
                        )
                        .slice(0, 12)

                      return (
                        <TableRow key={line.key} className='align-top'>
                          <TableCell className='pt-3 font-mono text-xs text-[#6D7175]'>
                            {idx + 1}
                          </TableCell>
                          <TableCell className='relative'>
                            <Input
                              ref={(el) => {
                                productRefs.current[line.key] = el
                              }}
                              value={line.productQuery}
                              onFocus={() =>
                                setOpenProductDropdownRowKey(line.key)
                              }
                              onBlur={() => {
                                setTimeout(() => {
                                  setOpenProductDropdownRowKey((prev) =>
                                    prev === line.key ? null : prev
                                  )
                                }, 180)
                              }}
                              onChange={(e) =>
                                handleProductQueryChange(
                                  line.key,
                                  e.target.value
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  if (!line.productId && matchingProducts[0]) {
                                    selectProductForLine(
                                      line.key,
                                      matchingProducts[0]
                                    )
                                  }
                                  consumedRefs.current[line.key]?.focus()
                                }
                              }}
                              placeholder='Réf (ex: P092) ou nom du produit...'
                              className={`h-9 text-xs ${
                                submittedAttempt && !line.productId
                                  ? 'border-[#D82C0D]'
                                  : ''
                              }`}
                            />

                            {openProductDropdownRowKey === line.key &&
                              matchingProducts.length > 0 && (
                                <div className='absolute right-2 left-2 z-50 mt-1 max-h-56 overflow-y-auto rounded-md border border-[#E1E3E5] bg-white shadow-lg'>
                                  {matchingProducts.map((p) => {
                                    const st = stockByProductId.get(p.id)
                                    return (
                                      <button
                                        key={p.id}
                                        type='button'
                                        onMouseDown={(e) => {
                                          e.preventDefault()
                                          selectProductForLine(line.key, p)
                                          consumedRefs.current[
                                            line.key
                                          ]?.focus()
                                        }}
                                        className='flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#F6F6F7]'
                                      >
                                        <div>
                                          <span className='font-mono font-semibold text-[#202223]'>
                                            {p.ref}
                                          </span>{' '}
                                          <span className='text-[#202223]'>
                                            — {p.name}
                                          </span>
                                        </div>
                                        <span className='font-mono text-[11px] text-[#6D7175]'>
                                          Dispo: {formatQty(st?.stock ?? 0)}{' '}
                                          {p.unit}
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}

                            {isInsufficient && selectedProduct && (
                              <div className='mt-1 font-medium text-[11px] text-[#D82C0D]'>
                                Stock insuffisant (disponible:{' '}
                                {formatQty(availableStock)}{' '}
                                {selectedProduct.unit})
                              </div>
                            )}
                          </TableCell>

                          <TableCell className='pt-3 font-mono text-xs text-[#6D7175]'>
                            {selectedProduct?.unit || '—'}
                          </TableCell>

                          <TableCell className='pt-2.5'>
                            {selectedProduct ? (
                              <StockBadge
                                stock={availableStock}
                                unit={selectedProduct.unit}
                                status={stockInfo?.status ?? 'À définir'}
                              />
                            ) : (
                              <span className='text-xs text-[#6D7175]'>—</span>
                            )}
                          </TableCell>

                          <TableCell>
                            <Input
                              ref={(el) => {
                                consumedRefs.current[line.key] = el
                              }}
                              type='number'
                              step='any'
                              min='0'
                              value={line.qtyConsumed}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  lines: prev.lines.map((l) =>
                                    l.key === line.key
                                      ? { ...l, qtyConsumed: e.target.value }
                                      : l
                                  ),
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  wastedRefs.current[line.key]?.focus()
                                }
                              }}
                              placeholder='0'
                              className={`h-9 text-right font-mono text-xs ${
                                isInsufficient ? 'border-[#D82C0D]' : ''
                              }`}
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              ref={(el) => {
                                wastedRefs.current[line.key] = el
                              }}
                              type='number'
                              step='any'
                              min='0'
                              value={line.qtyWasted}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  lines: prev.lines.map((l) =>
                                    l.key === line.key
                                      ? { ...l, qtyWasted: e.target.value }
                                      : l
                                  ),
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  if (idx === draft.lines.length - 1) {
                                    addLineAndFocus()
                                  } else {
                                    const nextKey = draft.lines[idx + 1]?.key
                                    if (nextKey) {
                                      productRefs.current[nextKey]?.focus()
                                    }
                                  }
                                }
                              }}
                              placeholder='0'
                              className={`h-9 text-right font-mono text-xs ${
                                wQty > 0
                                  ? 'border-[#B98900] bg-[#FFF8E6]/40'
                                  : ''
                              }`}
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              list={`loss-reasons-${line.key}`}
                              value={line.lossReason}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  lines: prev.lines.map((l) =>
                                    l.key === line.key
                                      ? { ...l, lossReason: e.target.value }
                                      : l
                                  ),
                                }))
                              }
                              placeholder={
                                wQty > 0
                                  ? 'Motif de la perte...'
                                  : 'Optionnel'
                              }
                              className='h-9 text-xs'
                            />
                            <datalist id={`loss-reasons-${line.key}`}>
                              {DEFAULT_LOSS_REASONS.map((reason) => (
                                <option key={reason} value={reason} />
                              ))}
                            </datalist>
                          </TableCell>

                          {canSeePrices && (
                            <>
                              <TableCell className='pt-3 text-right font-mono text-xs'>
                                {!selectedProduct ? (
                                  '—'
                                ) : avgPrice === null ? (
                                  <Badge
                                    variant='outline'
                                    className='border-[#B98900]/40 bg-[#FFF8E6] text-[10px] text-[#B98900]'
                                  >
                                    Prix manquant
                                  </Badge>
                                ) : (
                                  formatMAD(roundCurrency(cQty * avgPrice))
                                )}
                              </TableCell>
                              <TableCell className='pt-3 text-right font-mono text-xs'>
                                {!selectedProduct ? (
                                  '—'
                                ) : avgPrice === null ? (
                                  <Badge
                                    variant='outline'
                                    className='border-[#B98900]/40 bg-[#FFF8E6] text-[10px] text-[#B98900]'
                                  >
                                    Prix manquant
                                  </Badge>
                                ) : (
                                  <span
                                    className={
                                      wQty > 0
                                        ? 'font-semibold text-[#D82C0D]'
                                        : 'text-[#6D7175]'
                                    }
                                  >
                                    {formatMAD(roundCurrency(wQty * avgPrice))}
                                  </span>
                                )}
                              </TableCell>
                            </>
                          )}

                          <TableCell className='pt-2 text-right'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='sm'
                              className='size-8 p-0 text-[#6D7175] hover:text-[#D82C0D]'
                              disabled={draft.lines.length <= 1}
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  lines: prev.lines.filter(
                                    (l) => l.key !== line.key
                                  ),
                                }))
                              }
                              aria-label='Supprimer la ligne'
                            >
                              <Trash2 className='size-4' />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {canSeePrices && (
                <div className='mt-4 flex flex-col items-end justify-between gap-3 border-t border-[#E1E3E5] pt-4 sm:flex-row sm:items-center'>
                  <div className='text-xs text-[#6D7175]'>
                    {draftFinancialSummary.missingPriceProductsCount > 0 ? (
                      <span className='font-medium text-[#B98900]'>
                        Note : {draftFinancialSummary.missingPriceProductsCount}{' '}
                        produit(s) avec « Prix manquant » sont exclus du total
                        valorisé (les quantités sont déduites normalement).
                      </span>
                    ) : (
                      <span>
                        Valorisation calculée selon le prix moyen pondéré (PMP)
                        figé au moment de la sortie.
                      </span>
                    )}
                  </div>
                  <div className='flex flex-wrap items-center gap-4 rounded-md bg-[#F6F6F7] px-4 py-2.5 text-xs'>
                    <div>
                      <span className='text-[#6D7175]'>
                        Valeur consommée :{' '}
                      </span>
                      <strong className='font-mono text-sm text-[#202223]'>
                        {formatMAD(draftFinancialSummary.totalConsumedVal)}
                      </strong>
                    </div>
                    <div>
                      <span className='text-[#6D7175]'>
                        Valeur des pertes :{' '}
                      </span>
                      <strong className='font-mono text-sm text-[#D82C0D]'>
                        {formatMAD(draftFinancialSummary.totalWastedVal)}
                      </strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== VIEW 3: EXIT DOCUMENT DETAIL ==================== */}
        {viewMode === 'detail' && selectedDocument && (
          <div className='space-y-4'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div className='flex items-center gap-2.5'>
                <Button
                  variant='outline'
                  size='sm'
                  className='h-8 gap-1.5'
                  onClick={() => setViewMode('list')}
                >
                  <ArrowLeft className='size-4' />
                  <span>Retour aux sorties</span>
                </Button>
                <div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <h1 className='text-lg font-semibold text-[#202223]'>
                      Bon de sortie — {selectedDocument.destination}
                    </h1>
                    {selectedDocument.isReversal && (
                      <Badge className='bg-[#FFF4F4] text-xs text-[#D82C0D]'>
                        Contre-passation
                      </Badge>
                    )}
                    {selectedDocument.isReversed &&
                      !selectedDocument.isReversal && (
                        <Badge className='bg-[#F1F2F3] text-xs text-[#6D7175]'>
                          Corrigée / Annulée
                        </Badge>
                      )}
                    {selectedDocument.isPendingApproval && (
                      <Badge className='bg-[#FFF8E6] text-xs text-[#B98900]'>
                        En attente d&apos;approbation
                      </Badge>
                    )}
                  </div>
                  <p className='text-xs text-[#6D7175]'>
                    Enregistré le {formatDateFR(selectedDocument.date)} par{' '}
                    {selectedDocument.recorded_by_name || 'Équipe'}
                  </p>
                </div>
              </div>

              <div className='flex flex-wrap items-center gap-2'>
                {isManagerOrAdmin && selectedDocument.isPendingApproval && (
                  <Button
                    size='sm'
                    className='h-8 gap-1.5 bg-[#008060] text-xs text-white hover:bg-[#006e52]'
                    onClick={() => {
                      reverseExitMutation.mutate({
                        exitId: selectedDocument.id,
                        reason:
                          selectedDocument.pending_reversal_reason ||
                          'Approbation manager',
                        mode: 'cancel',
                        approveCutoff: true,
                      })
                    }}
                  >
                    <Check className='size-3.5' />
                    <span>Approuver la contre-passation</span>
                  </Button>
                )}

                {canReverse &&
                  !selectedDocument.isReversal &&
                  !selectedDocument.isReversed && (
                    <>
                      <Button
                        variant='outline'
                        size='sm'
                        className='h-8 gap-1.5 text-xs'
                        onClick={() => {
                          setReversalMode('correct')
                          setReversalReason('')
                          setApproveCutoffOverride(false)
                          setReversalDialogOpen(true)
                        }}
                      >
                        <Edit3 className='size-3.5' />
                        <span>Corriger</span>
                      </Button>
                      <Button
                        variant='outline'
                        size='sm'
                        className='h-8 gap-1.5 border-[#D82C0D]/40 text-xs text-[#D82C0D] hover:bg-[#FFF4F4]'
                        onClick={() => {
                          setReversalMode('cancel')
                          setReversalReason('')
                          setApproveCutoffOverride(false)
                          setReversalDialogOpen(true)
                        }}
                      >
                        <RotateCcw className='size-3.5' />
                        <span>Annuler</span>
                      </Button>
                    </>
                  )}
              </div>
            </div>

            {selectedDocument.reversed_of && (
              <div className='flex items-center justify-between rounded-lg border border-[#D82C0D]/30 bg-[#FFF4F4] p-3 text-xs text-[#D82C0D]'>
                <div>
                  Ce document est une écriture de contre-passation annulant la
                  sortie{' '}
                  <strong className='font-mono'>
                    {selectedDocument.reversed_of}
                  </strong>
                  . Motif :{' '}
                  <em>{selectedDocument.reversal_reason || 'Non spécifié'}</em>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  className='h-7 text-xs'
                  onClick={() =>
                    setSelectedDocId(selectedDocument.reversed_of ?? null)
                  }
                >
                  Voir la sortie d&apos;origine
                </Button>
              </div>
            )}

            {selectedDocument.reversedByDoc && (
              <div className='flex items-center justify-between rounded-lg border border-[#8C9196] bg-[#F1F2F3] p-3 text-xs text-[#202223]'>
                <div>
                  Cette sortie a été contre-passée le{' '}
                  {formatDateFR(selectedDocument.reversedByDoc.date)}. Motif :{' '}
                  <em>
                    {selectedDocument.reversal_reason ||
                      selectedDocument.reversedByDoc.reversal_reason ||
                      'Correction / Annulation'}
                  </em>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  className='h-7 text-xs'
                  onClick={() =>
                    setSelectedDocId(selectedDocument.reversedByDoc?.id ?? null)
                  }
                >
                  Voir la contre-passation
                </Button>
              </div>
            )}

            {/* Header Info */}
            <div className='grid grid-cols-1 gap-4 rounded-lg border border-[#E1E3E5] bg-white p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-4'>
              <div>
                <span className='text-xs text-[#6D7175]'>Destination</span>
                <p className='mt-0.5 text-sm font-semibold text-[#202223]'>
                  {selectedDocument.destination}
                </p>
              </div>
              <div>
                <span className='text-xs text-[#6D7175]'>
                  Nombre de produits
                </span>
                <p className='mt-0.5 font-mono text-sm font-semibold text-[#202223]'>
                  {selectedDocument.productsCount}
                </p>
              </div>
              {canSeePrices && (
                <>
                  <div>
                    <span className='text-xs text-[#6D7175]'>
                      Valeur consommée ({vatConvention})
                    </span>
                    <p className='mt-0.5 font-mono text-sm font-bold text-[#202223]'>
                      {formatMAD(selectedDocument.consumedValue)}
                    </p>
                  </div>
                  <div>
                    <span className='text-xs text-[#6D7175]'>
                      Valeur des pertes ({vatConvention})
                    </span>
                    <p className='mt-0.5 font-mono text-sm font-bold text-[#D82C0D]'>
                      {formatMAD(selectedDocument.wastedValue)}
                    </p>
                  </div>
                </>
              )}
              {selectedDocument.notes && (
                <div className='sm:col-span-2 lg:col-span-4'>
                  <span className='text-xs text-[#6D7175]'>Notes</span>
                  <p className='mt-0.5 text-xs text-[#202223]'>
                    {selectedDocument.notes}
                  </p>
                </div>
              )}
            </div>

            {/* Lines Table */}
            <div className='overflow-hidden rounded-lg border border-[#E1E3E5] bg-white shadow-xs'>
              <div className='border-b border-[#E1E3E5] px-4 py-3'>
                <h2 className='text-sm font-semibold text-[#202223]'>
                  Détail des produits sortis ({selectedDocument.productsCount})
                </h2>
              </div>
              <Table>
                <TableHeader className='bg-[#F6F6F7]'>
                  <TableRow>
                    <TableHead className='text-xs font-semibold text-[#202223]'>
                      Référence
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#202223]'>
                      Produit
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#202223]'>
                      Unité
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#202223]'>
                      Qté consommée
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#202223]'>
                      Qté perdue
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#202223]'>
                      Motif de la perte
                    </TableHead>
                    {canSeePrices && (
                      <>
                        <TableHead className='text-right text-xs font-semibold text-[#202223]'>
                          Coût U. figé
                        </TableHead>
                        <TableHead className='text-right text-xs font-semibold text-[#202223]'>
                          Valeur consommée
                        </TableHead>
                        <TableHead className='text-right text-xs font-semibold text-[#202223]'>
                          Valeur perdue
                        </TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedDocument.lines.map((line: ExitLineRecord) => {
                    const prod = productById.get(line.product)
                    const hasCost =
                      line.unit_cost_snapshot !== null &&
                      line.unit_cost_snapshot !== undefined
                    return (
                      <TableRow key={line.id}>
                        <TableCell className='font-mono text-xs font-medium text-[#202223]'>
                          {prod?.ref || line.product}
                        </TableCell>
                        <TableCell className='text-xs text-[#202223]'>
                          {prod?.name || 'Produit'}
                        </TableCell>
                        <TableCell className='font-mono text-xs text-[#6D7175]'>
                          {prod?.unit || '—'}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs font-medium'>
                          {formatQty(line.qty_consumed)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-xs font-medium ${
                            line.qty_wasted > 0 ? 'text-[#D82C0D]' : ''
                          }`}
                        >
                          {formatQty(line.qty_wasted)}
                        </TableCell>
                        <TableCell className='text-xs text-[#6D7175]'>
                          {line.loss_reason || '—'}
                        </TableCell>
                        {canSeePrices && (
                          <>
                            <TableCell className='text-right font-mono text-xs'>
                              {hasCost ? (
                                formatMAD(line.unit_cost_snapshot!)
                              ) : (
                                <Badge
                                  variant='outline'
                                  className='border-[#B98900]/40 bg-[#FFF8E6] text-[10px] text-[#B98900]'
                                >
                                  Prix manquant
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className='text-right font-mono text-xs font-medium'>
                              {hasCost
                                ? formatMAD(
                                    roundCurrency(
                                      line.qty_consumed *
                                        line.unit_cost_snapshot!
                                    )
                                  )
                                : '—'}
                            </TableCell>
                            <TableCell className='text-right font-mono text-xs font-medium text-[#D82C0D]'>
                              {hasCost
                                ? formatMAD(
                                    roundCurrency(
                                      line.qty_wasted *
                                        line.unit_cost_snapshot!
                                    )
                                  )
                                : '—'}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {canListAudit && (
              <div className='rounded-lg border border-[#E1E3E5] bg-white p-4 shadow-xs'>
                <div className='mb-3 flex items-center gap-2'>
                  <History className='size-4 text-[#6D7175]' />
                  <h2 className='text-sm font-semibold text-[#202223]'>
                    Journal d&apos;audit de cette sortie
                  </h2>
                </div>
                {selectedDocAuditLogs.length === 0 ? (
                  <p className='text-xs text-[#6D7175]'>
                    Aucune trace d&apos;audit supplémentaire pour cette sortie.
                  </p>
                ) : (
                  <div className='space-y-2'>
                    {selectedDocAuditLogs.map((log: AuditLogRecord) => (
                      <div
                        key={log.id}
                        className='flex flex-wrap items-center justify-between gap-2 rounded border border-[#E1E3E5] bg-[#FAFBFB] px-3 py-2 text-xs'
                      >
                        <div>
                          <span className='font-semibold text-[#202223]'>
                            {log.action === 'create'
                              ? 'Création de la sortie'
                              : log.action === 'reversal'
                                ? 'Contre-passation'
                                : log.action}
                          </span>{' '}
                          par{' '}
                          <span className='font-medium'>
                            {log.user_email || 'Système'}
                          </span>
                        </div>
                        <span className='font-mono text-[11px] text-[#6D7175]'>
                          {formatDateTimeFR(log.timestamp)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Main>

      {/* Dialog: Quick Multi-Product Add ("Ajouter plusieurs produits") */}
      <Dialog
        open={quickBatchModalOpen}
        onOpenChange={setQuickBatchModalOpen}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              Ajouter plusieurs produits (Saisie rapide)
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Saisissez une ligne par produit au format{' '}
              <code className='rounded bg-[#F6F6F7] px-1 font-mono'>
                RÉFÉRENCE QUANTITÉ_CONSOMMÉE [QUANTITÉ_PERDUE]
              </code>{' '}
              (insensible à la casse : <code className='font-mono'>p092 5</code>{' '}
              ou <code className='font-mono'>P092 5 1</code>).
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2 py-2'>
            <Textarea
              value={quickBatchText}
              onChange={(e) => setQuickBatchText(e.target.value)}
              placeholder={'P092 5\nP001 2\np015 3.5 0.5'}
              rows={6}
              className='font-mono text-xs'
            />
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setQuickBatchModalOpen(false)}
            >
              Annuler
            </Button>
            <Button
              size='sm'
              className='bg-[#008060] text-white hover:bg-[#006e52]'
              onClick={handleApplyQuickBatch}
            >
              Ajouter les produits au bon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Add New Destination Inline */}
      <Dialog open={newDestDialogOpen} onOpenChange={setNewDestDialogOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              Nouvelle destination
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Ajoutez un nouveau poste ou destination de sortie (ex: Terrasse,
              Événement).
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2 py-2'>
            <Label className='text-xs'>Nom de la destination *</Label>
            <Input
              value={newDestName}
              onChange={(e) => setNewDestName(e.target.value)}
              placeholder='Ex: Pâtisserie'
              className='h-9 text-xs'
            />
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setNewDestDialogOpen(false)}
            >
              Annuler
            </Button>
            <Button
              size='sm'
              className='bg-[#008060] text-white hover:bg-[#006e52]'
              disabled={!newDestName.trim()}
              onClick={async () => {
                const clean = newDestName.trim()
                setCustomDestinations((prev) =>
                  prev.includes(clean) ? prev : [...prev, clean]
                )
                setDraft((prev) => ({ ...prev, destination: clean }))
                if (isManagerOrAdmin) {
                  try {
                    await repository.upsertSetting(
                      'destinations_list',
                      Array.from(new Set([...destinationsList, clean]))
                    )
                    queryClient.invalidateQueries({ queryKey: ['settings'] })
                  } catch {
                    // Local state still updated
                  }
                }
                setNewDestName('')
                setNewDestDialogOpen(false)
                toast.success(`Destination "${clean}" sélectionnée.`)
              }}
            >
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Pre-Save Confirmation ("Stock avant -> Stock après") */}
      <Dialog
        open={confirmSaveDialogOpen}
        onOpenChange={setConfirmSaveDialogOpen}
      >
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              Confirmer la sortie de stock ({draft.destination})
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Vérifiez le récapitulatif des quantités et l&apos;impact sur le
              stock théorique avant l&apos;enregistrement définitif.
            </DialogDescription>
          </DialogHeader>

          <div className='max-h-72 overflow-y-auto rounded-md border border-[#E1E3E5]'>
            <Table>
              <TableHeader className='bg-[#F6F6F7]'>
                <TableRow>
                  <TableHead className='text-xs font-semibold'>
                    Produit
                  </TableHead>
                  <TableHead className='text-right text-xs font-semibold'>
                    Consommé
                  </TableHead>
                  <TableHead className='text-right text-xs font-semibold'>
                    Perdu
                  </TableHead>
                  <TableHead className='text-right text-xs font-semibold'>
                    Stock avant → Stock après
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(requestedDeductionByProductId.entries()).map(
                  ([productId, totalDed]) => {
                    if (totalDed <= 0) return null
                    const prod = productById.get(productId)
                    if (!prod) return null
                    const stockBefore =
                      stockByProductId.get(productId)?.stock ??
                      prod.initial_stock
                    const stockAfter = roundQty(stockBefore - totalDed)

                    const prodConsumed = validDraftLines
                      .filter((l) => l.productId === productId)
                      .reduce((s, l) => s + Number(l.qtyConsumed || 0), 0)
                    const prodWasted = validDraftLines
                      .filter((l) => l.productId === productId)
                      .reduce((s, l) => s + Number(l.qtyWasted || 0), 0)

                    return (
                      <TableRow key={productId}>
                        <TableCell className='text-xs font-medium'>
                          <span className='font-mono font-semibold'>
                            {prod.ref}
                          </span>{' '}
                          — {prod.name}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs'>
                          {formatQty(prodConsumed)} {prod.unit}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs text-[#D82C0D]'>
                          {formatQty(prodWasted)} {prod.unit}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs'>
                          <span>
                            {formatQty(stockBefore)} {prod.unit}
                          </span>
                          <ArrowRight className='mx-1.5 inline size-3 text-[#6D7175]' />
                          <strong
                            className={
                              stockAfter < 0
                                ? 'text-[#D82C0D]'
                                : 'text-[#008060]'
                            }
                          >
                            {formatQty(stockAfter)} {prod.unit}
                          </strong>
                        </TableCell>
                      </TableRow>
                    )
                  }
                )}
              </TableBody>
            </Table>
          </div>

          {hasInsufficientStock && isManagerOrAdmin && (
            <div className='space-y-3 rounded-md border border-[#D82C0D]/40 bg-[#FFF4F4] p-3 text-xs'>
              <div className='flex items-start gap-2'>
                <Checkbox
                  id='confirm-neg-stock'
                  checked={negativeStockConfirmed}
                  onCheckedChange={(v) => setNegativeStockConfirmed(Boolean(v))}
                />
                <Label
                  htmlFor='confirm-neg-stock'
                  className='text-xs leading-snug font-semibold text-[#D82C0D]'
                >
                  Je confirme l&apos;enregistrement de cette sortie malgré le
                  passage en stock négatif (Autorisation Manager / Admin).
                </Label>
              </div>
              <div className='space-y-1'>
                <Label className='text-xs font-medium text-[#202223]'>
                  Motif obligatoire du stock négatif (inscrit au journal
                  d&apos;audit) *
                </Label>
                <Input
                  value={negativeStockReason}
                  onChange={(e) => setNegativeStockReason(e.target.value)}
                  placeholder='Ex: Facture de livraison du matin pas encore saisie...'
                  className='h-8 bg-white text-xs'
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setConfirmSaveDialogOpen(false)}
            >
              Modifier la saisie
            </Button>
            <Button
              size='sm'
              className='bg-[#008060] text-white hover:bg-[#006e52]'
              disabled={
                createExitMutation.isPending ||
                (hasInsufficientStock &&
                  (!isManagerOrAdmin ||
                    !negativeStockConfirmed ||
                    !negativeStockReason.trim()))
              }
              onClick={() => createExitMutation.mutate()}
            >
              {createExitMutation.isPending
                ? 'Enregistrement...'
                : 'Confirmer la sortie de stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Reverse / Correct Exit Document */}
      <Dialog open={reversalDialogOpen} onOpenChange={setReversalDialogOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              {reversalMode === 'correct'
                ? 'Corriger cette sortie (Contre-passation + Nouvelle sortie)'
                : 'Annuler cette sortie (Contre-passation)'}
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Une écriture inverse liée à cette sortie va être créée pour
              réintégrer les quantités dans le stock. Le document original
              restera visible.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-3 py-2'>
            {selectedDocCutoffDate && (
              <div className='rounded-md border border-[#D82C0D]/40 bg-[#FFF4F4] p-3 text-xs text-[#D82C0D]'>
                <p className='font-semibold'>
                  Attention : Sortie antérieure à un inventaire confirmé (
                  {formatDateFR(selectedDocCutoffDate)})
                </p>
                {isManagerOrAdmin && (
                  <label className='mt-2 flex items-center gap-2 font-medium'>
                    <input
                      type='checkbox'
                      checked={approveCutoffOverride}
                      onChange={(e) =>
                        setApproveCutoffOverride(e.target.checked)
                      }
                    />
                    <span>
                      J&apos;approuve la contre-passation avant la date de
                      clôture d&apos;inventaire
                    </span>
                  </label>
                )}
              </div>
            )}

            <div className='space-y-1.5'>
              <Label className='text-xs font-medium text-[#202223]'>
                Motif obligatoire <span className='text-[#D82C0D]'>*</span>
              </Label>
              <Textarea
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder='Ex: Erreur de quantité saisie par la cuisine...'
                rows={3}
                className='text-xs'
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setReversalDialogOpen(false)}
            >
              Fermer
            </Button>
            <Button
              size='sm'
              variant={reversalMode === 'cancel' ? 'destructive' : 'default'}
              className={
                reversalMode === 'correct'
                  ? 'bg-[#008060] text-white hover:bg-[#006e52]'
                  : ''
              }
              disabled={
                !reversalReason.trim() ||
                reverseExitMutation.isPending ||
                Boolean(
                  selectedDocCutoffDate &&
                    isManagerOrAdmin &&
                    !approveCutoffOverride
                )
              }
              onClick={() => {
                if (!selectedDocument) return
                reverseExitMutation.mutate({
                  exitId: selectedDocument.id,
                  reason: reversalReason.trim(),
                  mode: reversalMode,
                  approveCutoff: approveCutoffOverride,
                })
              }}
            >
              {reversalMode === 'correct'
                ? 'Contre-passer et ouvrir la correction'
                : 'Confirmer la contre-passation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
export { SortiesDeStock as SortiesDeStockPage }
