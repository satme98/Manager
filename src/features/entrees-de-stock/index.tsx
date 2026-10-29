import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Check,
  Clock,
  CreditCard,
  Edit3,
  FileSpreadsheet,
  History,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import { invalidateDashboardAnalyticsCache } from '@/data/analytics'
import type {
  AuditLogRecord,
  ProductRecord,
  PurchaseLineRecord,
  PurchaseRecord,
  SupplierRecord,
  VatConvention,
} from '@/data/types'
import {
  type ConfirmedInventoryCount,
  checkDocumentBeforeInventoryCutoff,
  checkPriceDeviationWarning,
  computeTargetedProductsStock,
  findSimilarPurchaseDocuments,
  normalizeProductRef,
  normalizeSearchText,
  roundCurrency,
} from '@/lib/stock-engine'
import { formatDateFR, formatDateTimeFR, formatMAD, formatQty } from '@/lib/format'
import { canPerformCollectionAction } from '@/lib/rbac'
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

const PURCHASE_DRAFT_STORAGE_KEY = 'monarq_purchase_entry_draft_v1'

interface DraftPurchaseLine {
  key: string
  productId: string
  productQuery: string
  qty: string
  unitPrice: string
}

interface DraftPurchaseForm {
  date: string
  supplierId: string
  invoiceNo: string
  paymentStatus: 'paid' | 'unpaid'
  paymentDate: string
  notes: string
  lines: DraftPurchaseLine[]
  correctedFromId?: string
}

interface EnrichedPurchaseDocument extends PurchaseRecord {
  lines: PurchaseLineRecord[]
  linesCount: number
  totalAmount: number
  supplierName: string
  isReversal: boolean
  isReversed: boolean
  reversedByDoc?: PurchaseRecord
  isPendingApproval: boolean
}

type SortField =
  | 'date'
  | 'invoice_no'
  | 'supplier'
  | 'lines_count'
  | 'total'
  | 'payment_status'
  | 'recorded_by'
type SortDir = 'asc' | 'desc'

function createBlankLine(): DraftPurchaseLine {
  return {
    key: `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    productId: '',
    productQuery: '',
    qty: '',
    unitPrice: '',
  }
}

function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function createFreshDraft(): DraftPurchaseForm {
  const today = getTodayIsoDate()
  return {
    date: today,
    supplierId: '',
    invoiceNo: '',
    paymentStatus: 'unpaid',
    paymentDate: today,
    notes: '',
    lines: [createBlankLine()],
  }
}

function loadSavedDraft(): DraftPurchaseForm {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createFreshDraft()
  }
  try {
    const raw = window.localStorage.getItem(PURCHASE_DRAFT_STORAGE_KEY)
    if (!raw) return createFreshDraft()
    const parsed = JSON.parse(raw) as Partial<DraftPurchaseForm>
    if (!parsed || typeof parsed !== 'object') return createFreshDraft()
    return {
      date: parsed.date || getTodayIsoDate(),
      supplierId: parsed.supplierId || '',
      invoiceNo: parsed.invoiceNo || '',
      paymentStatus: parsed.paymentStatus === 'paid' ? 'paid' : 'unpaid',
      paymentDate: parsed.paymentDate || getTodayIsoDate(),
      notes: parsed.notes || '',
      lines:
        Array.isArray(parsed.lines) && parsed.lines.length > 0
          ? parsed.lines
          : [createBlankLine()],
      correctedFromId: parsed.correctedFromId,
    }
  } catch {
    return createFreshDraft()
  }
}

export function EntreesDeStock() {
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()
  const role = auth.user?.role

  const canCreate = canPerformCollectionAction(role, 'purchases', 'create')
  const canUpdate = canPerformCollectionAction(role, 'purchases', 'update')
  const canReverse = canPerformCollectionAction(role, 'purchases', 'reverse')
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
  const [supplierFilter, setSupplierFilter] = useState(() => {
    if (typeof window === 'undefined') return 'all'
    return new URLSearchParams(window.location.search).get('supplier') || 'all'
  })
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid'>(
    () => {
      if (typeof window === 'undefined') return 'all'
      const p = new URLSearchParams(window.location.search).get('paymentStatus')
      return p === 'paid' || p === 'unpaid' ? p : 'all'
    }
  )
  const [productFilter, setProductFilter] = useState('all')
  const [correctionFilter, setCorrectionFilter] = useState<
    'all' | 'active_only' | 'reversed_only' | 'pending_approval'
  >(() => {
    if (typeof window === 'undefined') return 'all'
    const c = new URLSearchParams(window.location.search).get('correction')
    if (c === 'pending_approval' || c === 'reversed_only' || c === 'active_only') {
      return c
    }
    return 'all'
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
      const from = params.get('from')
      if (from !== null) setDateFrom(from)
      const to = params.get('to')
      if (to !== null) setDateTo(to)
      const sup = params.get('supplier')
      if (sup) setSupplierFilter(sup)
      const p = params.get('paymentStatus')
      if (p === 'paid' || p === 'unpaid') setPaymentFilter(p)
      const c = params.get('correction')
      if (
        c === 'pending_approval' ||
        c === 'reversed_only' ||
        c === 'active_only'
      ) {
        setCorrectionFilter(c)
      }
    }
    window.addEventListener('popstate', checkParams)
    window.addEventListener('monarq:navigate', checkParams)
    return () => {
      window.removeEventListener('popstate', checkParams)
      window.removeEventListener('monarq:navigate', checkParams)
    }
  }, [])
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [pageSize, setPageSize] = useState<number>(25)
  const [page, setPage] = useState<number>(1)

  // New Entry Form state
  const [draft, setDraft] = useState<DraftPurchaseForm>(loadSavedDraft)
  const [submittedAttempt, setSubmittedAttempt] = useState(false)
  const [openProductDropdownRowKey, setOpenProductDropdownRowKey] = useState<
    string | null
  >(null)
  const [supplierSearch, setSupplierSearch] = useState('')

  // Inline create supplier modal
  const [newSupplierDialogOpen, setNewSupplierDialogOpen] = useState(false)
  const [newSupplierName, setNewSupplierName] = useState('')
  const [newSupplierPhone, setNewSupplierPhone] = useState('')
  const [newSupplierPaymentTerms, setNewSupplierPaymentTerms] = useState('')

  // Detail actions dialogs
  const [markPaidDialogOpen, setMarkPaidDialogOpen] = useState(false)
  const [markPaidDate, setMarkPaidDate] = useState(getTodayIsoDate)
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
        PURCHASE_DRAFT_STORAGE_KEY,
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

  const { data: suppliers = [], isLoading: loadingSuppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => repository.listSuppliers(),
  })

  const { data: purchasesBundle, isLoading: loadingPurchases } = useQuery({
    queryKey: ['purchases'],
    queryFn: () => repository.listPurchases(),
  })

  const { data: exitsBundle } = useQuery({
    queryKey: ['exits'],
    queryFn: () => repository.listExits(),
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

  const purchaseHeaders = useMemo(
    () => purchasesBundle?.headers ?? [],
    [purchasesBundle]
  )
  const purchaseLines = useMemo(
    () => purchasesBundle?.lines ?? [],
    [purchasesBundle]
  )
  const exitHeaders = useMemo(() => exitsBundle?.headers ?? [], [exitsBundle])
  const exitLines = useMemo(() => exitsBundle?.lines ?? [], [exitsBundle])
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

  const productById = useMemo(() => {
    const map = new Map<string, ProductRecord>()
    for (const p of products) map.set(p.id, p)
    return map
  }, [products])

  const activeProducts = useMemo(
    () => products.filter((p) => !p.archived),
    [products]
  )

  const supplierById = useMemo(() => {
    const map = new Map<string, SupplierRecord>()
    for (const s of suppliers) map.set(s.id, s)
    return map
  }, [suppliers])

  const activeSuppliers = useMemo(
    () => suppliers.filter((s) => !s.archived),
    [suppliers]
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

  const linesByPurchaseId = useMemo(() => {
    const map = new Map<string, PurchaseLineRecord[]>()
    for (const l of purchaseLines) {
      const list = map.get(l.purchase) ?? []
      list.push(l)
      map.set(l.purchase, list)
    }
    return map
  }, [purchaseLines])

  // Last purchase price per product
  const lastPurchasePriceByProductId = useMemo(() => {
    const map = new Map<string, { price: number; date: string }>()
    const sortedHeaders = [...purchaseHeaders].sort((a, b) =>
      b.date.localeCompare(a.date)
    )
    for (const p of sortedHeaders) {
      if (p.reversed_of || p.correction_status === 'reversed') continue
      const lines = linesByPurchaseId.get(p.id) ?? []
      for (const line of lines) {
        if (line.qty > 0 && line.unit_price > 0 && !map.has(line.product)) {
          map.set(line.product, { price: line.unit_price, date: p.date })
        }
      }
    }
    return map
  }, [purchaseHeaders, linesByPurchaseId])

  const reversalByOriginalId = useMemo(() => {
    const map = new Map<string, PurchaseRecord>()
    for (const p of purchaseHeaders) {
      if (p.reversed_of) {
        map.set(p.reversed_of, p)
      }
    }
    return map
  }, [purchaseHeaders])

  const enrichedPurchases: EnrichedPurchaseDocument[] = useMemo(() => {
    return purchaseHeaders.map((p) => {
      const lines = linesByPurchaseId.get(p.id) ?? []
      const totalAmount = roundCurrency(
        lines.reduce(
          (acc: number, l: PurchaseLineRecord) =>
            acc + Number(l.amount ?? l.qty * l.unit_price),
          0
        )
      )
      const supplierName =
        supplierById.get(p.supplier)?.name || 'Fournisseur inconnu'
      const isReversal = Boolean(p.reversed_of)
      const reversedByDoc = reversalByOriginalId.get(p.id)
      const isReversed =
        Boolean(reversedByDoc) ||
        p.correction_status === 'reversed' ||
        p.correction_status === 'corrected'
      const isPendingApproval = p.correction_status === 'pending_approval'

      return {
        ...p,
        lines,
        linesCount: lines.length,
        totalAmount,
        supplierName,
        isReversal,
        isReversed,
        reversedByDoc,
        isPendingApproval,
      }
    })
  }, [purchaseHeaders, linesByPurchaseId, supplierById, reversalByOriginalId])

  const filteredPurchases = useMemo(() => {
    const normSearch = normalizeSearchText(searchQuery)

    const filtered = enrichedPurchases.filter((doc: EnrichedPurchaseDocument) => {
      const docDay = doc.date.slice(0, 10)
      if (dateFrom && docDay < dateFrom) return false
      if (dateTo && docDay > dateTo) return false

      if (supplierFilter !== 'all' && doc.supplier !== supplierFilter) {
        return false
      }

      if (paymentFilter !== 'all' && doc.payment_status !== paymentFilter) {
        return false
      }

      if (productFilter !== 'all') {
        const hasProduct = doc.lines.some(
          (l: PurchaseLineRecord) => l.product === productFilter
        )
        if (!hasProduct) return false
      }

      if (correctionFilter === 'active_only') {
        if (doc.isReversal || doc.isReversed) return false
      } else if (correctionFilter === 'reversed_only') {
        if (!doc.isReversal && !doc.isReversed) return false
      } else if (correctionFilter === 'pending_approval') {
        if (!doc.isPendingApproval) return false
      }

      if (normSearch) {
        const invoiceMatch = normalizeSearchText(doc.invoice_no || '').includes(
          normSearch
        )
        const supplierMatch = normalizeSearchText(doc.supplierName).includes(
          normSearch
        )
        const productMatch = doc.lines.some((l: PurchaseLineRecord) => {
          const prod = productById.get(l.product)
          if (!prod) return false
          return (
            normalizeSearchText(prod.ref).includes(normSearch) ||
            normalizeSearchText(prod.name).includes(normSearch)
          )
        })
        if (!invoiceMatch && !supplierMatch && !productMatch) return false
      }

      return true
    })

    filtered.sort(
      (a: EnrichedPurchaseDocument, b: EnrichedPurchaseDocument) => {
        let cmp = 0
        switch (sortField) {
          case 'date':
            cmp = a.date.localeCompare(b.date)
            break
          case 'invoice_no':
            cmp = (a.invoice_no || '').localeCompare(b.invoice_no || '')
            break
          case 'supplier':
            cmp = a.supplierName.localeCompare(b.supplierName)
            break
          case 'lines_count':
            cmp = a.linesCount - b.linesCount
            break
          case 'total':
            cmp = a.totalAmount - b.totalAmount
            break
          case 'payment_status':
            cmp = a.payment_status.localeCompare(b.payment_status)
            break
          case 'recorded_by':
            cmp = (a.recorded_by_name || '').localeCompare(
              b.recorded_by_name || ''
            )
            break
        }
        return sortDir === 'asc' ? cmp : -cmp
      }
    )

    return filtered
  }, [
    enrichedPurchases,
    searchQuery,
    dateFrom,
    dateTo,
    supplierFilter,
    paymentFilter,
    productFilter,
    correctionFilter,
    sortField,
    sortDir,
    productById,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredPurchases.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginatedPurchases = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredPurchases.slice(start, start + pageSize)
  }, [filteredPurchases, safePage, pageSize])

  const selectedDocument = useMemo(() => {
    if (!selectedDocId) return null
    return (
      enrichedPurchases.find(
        (d: EnrichedPurchaseDocument) => d.id === selectedDocId
      ) ?? null
    )
  }, [enrichedPurchases, selectedDocId])

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
      (l: PurchaseLineRecord) => l.product
    )
    const check = checkDocumentBeforeInventoryCutoff(
      selectedDocument.date,
      productIds,
      allConfirmedCountsFlat
    )
    return check.isBeforeCutoff ? check.latestCutoffDate : null
  }, [selectedDocument, allConfirmedCountsFlat])

  // New Entry Form computed values & warnings
  const draftTotalAmount = useMemo(() => {
    return roundCurrency(
      draft.lines.reduce((acc, line) => {
        const q = Number(line.qty)
        const p = Number(line.unitPrice)
        if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) {
          return acc
        }
        return acc + roundCurrency(q * p)
      }, 0)
    )
  }, [draft.lines])

  const duplicateProductIdsInDraft = useMemo(() => {
    const counts = new Map<string, number>()
    for (const line of draft.lines) {
      if (!line.productId) continue
      counts.set(line.productId, (counts.get(line.productId) ?? 0) + 1)
    }
    const duplicates = new Set<string>()
    for (const [pid, count] of counts.entries()) {
      if (count > 1) duplicates.add(pid)
    }
    return duplicates
  }, [draft.lines])

  const priceWarningsByLineKey = useMemo(() => {
    const map = new Map<
      string,
      { deviationPct: number; averagePrice: number }
    >()
    for (const line of draft.lines) {
      if (!line.productId || !line.unitPrice) continue
      const unitPrice = Number(line.unitPrice)
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue
      const avgPrice = stockByProductId.get(line.productId)?.averagePrice ?? null
      const check = checkPriceDeviationWarning(unitPrice, avgPrice)
      if (check.hasWarning && avgPrice !== null) {
        map.set(line.key, {
          deviationPct: Math.abs(check.deviationPct ?? 0),
          averagePrice: avgPrice,
        })
      }
    }
    return map
  }, [draft.lines, stockByProductId])

  const similarExistingDocs = useMemo(() => {
    if (!draft.supplierId || !draft.date || draftTotalAmount <= 0) return []
    return findSimilarPurchaseDocuments(
      {
        date: draft.date,
        supplierId: draft.supplierId,
        totalAmount: draftTotalAmount,
      },
      purchaseHeaders,
      purchaseLines
    )
  }, [
    draft.date,
    draft.supplierId,
    draftTotalAmount,
    purchaseHeaders,
    purchaseLines,
  ])

  const draftCutoffDate = useMemo(() => {
    const productIds = draft.lines.map((l) => l.productId).filter(Boolean)
    if (productIds.length === 0 || !draft.date) return null
    const check = checkDocumentBeforeInventoryCutoff(
      draft.date,
      productIds,
      allConfirmedCountsFlat
    )
    return check.isBeforeCutoff ? check.latestCutoffDate : null
  }, [draft.date, draft.lines, allConfirmedCountsFlat])

  const selectProductForLine = (lineKey: string, product: ProductRecord) => {
    const lastPrice = lastPurchasePriceByProductId.get(product.id)?.price
    const avgPrice = stockByProductId.get(product.id)?.averagePrice
    const suggestedPrice =
      lastPrice !== undefined
        ? String(lastPrice)
        : avgPrice !== null && avgPrice !== undefined
          ? String(avgPrice)
          : ''

    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((l) =>
        l.key === lineKey
          ? {
              ...l,
              productId: product.id,
              productQuery: `${product.ref} — ${product.name}`,
              unitPrice: l.unitPrice || suggestedPrice,
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
          const lastPrice = lastPurchasePriceByProductId.get(
            exactMatch.id
          )?.price
          return {
            ...l,
            productId: exactMatch.id,
            productQuery: value,
            unitPrice:
              l.unitPrice ||
              (lastPrice !== undefined ? String(lastPrice) : l.unitPrice),
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

  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const priceRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const productRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const addLineAndFocus = () => {
    const newLine = createBlankLine()
    setDraft((prev) => ({
      ...prev,
      lines: [...prev.lines, newLine],
    }))
    setTimeout(() => {
      productRefs.current[newLine.key]?.focus()
    }, 30)
  }

  const createSupplierMutation = useMutation({
    mutationFn: async () => {
      return repository.createSupplier({
        name: newSupplierName.trim(),
        contact: '',
        phone: newSupplierPhone.trim(),
        email: '',
        payment_terms: newSupplierPaymentTerms.trim(),
        notes: '',
      })
    },
    onSuccess: (created) => {
      invalidateDashboardAnalyticsCache()
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      setDraft((prev) => ({ ...prev, supplierId: created.id }))
      setNewSupplierDialogOpen(false)
      setNewSupplierName('')
      setNewSupplierPhone('')
      setNewSupplierPaymentTerms('')
      toast.success(`Fournisseur "${created.name}" créé et sélectionné.`)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const {
    mutate: triggerCreatePurchase,
    isPending: isCreatingPurchase,
  } = useMutation({
    mutationFn: async () => {
      const validLines = draft.lines.filter(
        (l) =>
          l.productId &&
          Number(l.qty) > 0 &&
          Number.isFinite(Number(l.unitPrice)) &&
          Number(l.unitPrice) >= 0
      )
      if (!draft.supplierId) {
        throw new Error('Veuillez sélectionner un fournisseur.')
      }
      if (!draft.date) {
        throw new Error('La date du bon d’entrée est obligatoire.')
      }
      if (validLines.length === 0) {
        throw new Error(
          'Veuillez saisir au moins une ligne valide (produit, quantité > 0, prix >= 0).'
        )
      }

      return repository.createPurchaseDocument({
        date: draft.date,
        supplier: draft.supplierId,
        invoice_no: draft.invoiceNo.trim(),
        payment_status: draft.paymentStatus,
        payment_date:
          draft.paymentStatus === 'paid'
            ? draft.paymentDate || draft.date
            : null,
        notes: draft.notes.trim(),
        lines: validLines.map((l) => ({
          product: l.productId,
          qty: Number(l.qty),
          unit_price: Number(l.unitPrice),
        })),
      })
    },
    onSuccess: (created) => {
      invalidateDashboardAnalyticsCache()
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      queryClient.invalidateQueries({ queryKey: ['factures-paiements-dataset'] })
      const fresh = createFreshDraft()
      setDraft(fresh)
      setSubmittedAttempt(false)
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(PURCHASE_DRAFT_STORAGE_KEY)
      }
      setSelectedDocId(created.header.id)
      setViewMode('list')
      toast.success('Bon d’entrée enregistré et stock mis à jour.', {
        action: {
          label: 'Voir le document',
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

  // Ctrl+Enter / Cmd+Enter keyboard shortcut on New Entry Form
  useEffect(() => {
    if (viewMode !== 'new') return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        setSubmittedAttempt(true)
        triggerCreatePurchase()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewMode, triggerCreatePurchase])

  const markPaidMutation = useMutation({
    mutationFn: async ({
      purchaseId,
      paymentDate,
    }: {
      purchaseId: string
      paymentDate: string
    }) => {
      return repository.markPurchasePaid(purchaseId, paymentDate)
    },
    onSuccess: () => {
      invalidateDashboardAnalyticsCache()
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      queryClient.invalidateQueries({ queryKey: ['factures-paiements-dataset'] })
      setMarkPaidDialogOpen(false)
      toast.success('Statut de paiement mis à jour : Payé.')
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const reversePurchaseMutation = useMutation({
    mutationFn: async ({
      purchaseId,
      reason,
      mode,
      approveCutoff,
    }: {
      purchaseId: string
      reason: string
      mode: 'cancel' | 'correct'
      approveCutoff: boolean
    }) => {
      const original = enrichedPurchases.find(
        (d: EnrichedPurchaseDocument) => d.id === purchaseId
      )
      const reversalResult = await repository.reversePurchaseDocument(
        purchaseId,
        reason,
        { mode, approveCutoff, approveBeforeInventoryCutoff: approveCutoff }
      )
      return { reversalResult, original, mode }
    },
    onSuccess: ({ reversalResult, original, mode }) => {
      invalidateDashboardAnalyticsCache()
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      queryClient.invalidateQueries({ queryKey: ['factures-paiements-dataset'] })
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
        const prefilledLines: DraftPurchaseLine[] = original.lines.map(
          (l: PurchaseLineRecord) => {
            const prod = productById.get(l.product)
            return {
              key: `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              productId: l.product,
              productQuery: prod ? `${prod.ref} — ${prod.name}` : l.product,
              qty: String(Math.abs(l.qty)),
              unitPrice: String(l.unit_price),
            }
          }
        )
        setDraft({
          date: original.date.slice(0, 10),
          supplierId: original.supplier,
          invoiceNo: original.invoice_no
            ? `${original.invoice_no}-CORR`
            : '',
          paymentStatus: original.payment_status === 'paid' ? 'paid' : 'unpaid',
          paymentDate: original.payment_date
            ? original.payment_date.slice(0, 10)
            : getTodayIsoDate(),
          notes: `Correction du bon ${original.invoice_no || original.id} (${reversalReason.trim()})`,
          lines:
            prefilledLines.length > 0 ? prefilledLines : [createBlankLine()],
          correctedFromId: original.id,
        })
        setViewMode('new')
        toast.success(
          'Contre-passation créée. Le nouveau formulaire est pré-rempli avec les valeurs d’origine pour correction.'
        )
      } else {
        toast.success(
          'Bon d’entrée annulé par contre-passation. Le document original reste visible dans l’historique.'
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

  const isLoading = loadingProducts || loadingSuppliers || loadingPurchases

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
            Entrées de stock
          </button>
          {viewMode === 'new' && (
            <>
              <span aria-hidden='true'>/</span>
              <span className='font-medium text-[#008060]'>
                Nouvelle entrée
              </span>
            </>
          )}
          {viewMode === 'detail' && selectedDocument && (
            <>
              <span aria-hidden='true'>/</span>
              <span className='font-medium text-foreground'>
                {selectedDocument.invoice_no || selectedDocument.id}
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
                  Entrées de stock
                </h1>
                <p className='mt-0.5 text-xs text-[#6D7175] sm:text-sm'>
                  Réceptions fournisseurs, bons de livraison, prix unitaires ({vatConvention} MAD) et suivi des paiements.
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
                    <span>Nouvelle entrée</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Filter Bar */}
            <div className='rounded-lg border border-[#E1E3E5] bg-white p-3 shadow-xs'>
              <div className='grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-6'>
                <div className='relative lg:col-span-2'>
                  <Search className='pointer-events-none absolute top-2.5 left-2.5 size-4 text-[#6D7175]' />
                  <Input
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setPage(1)
                    }}
                    placeholder='Rechercher N° facture, BL, produit ou réf...'
                    className='h-9 pl-8 text-xs'
                  />
                </div>

                <div>
                  <Select
                    value={supplierFilter}
                    onValueChange={(v) => {
                      setSupplierFilter(v)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='Fournisseur' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Tous les fournisseurs</SelectItem>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Select
                    value={paymentFilter}
                    onValueChange={(v: 'all' | 'paid' | 'unpaid') => {
                      setPaymentFilter(v)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='Statut paiement' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>Tous les paiements</SelectItem>
                      <SelectItem value='paid'>Payé</SelectItem>
                      <SelectItem value='unpaid'>Impayé</SelectItem>
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
                    value={correctionFilter}
                    onValueChange={(
                      v:
                        | 'all'
                        | 'active_only'
                        | 'reversed_only'
                        | 'pending_approval'
                    ) => {
                      setCorrectionFilter(v)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='Corrigées / annulées' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>
                        Tous (incl. corrigées/annulées)
                      </SelectItem>
                      <SelectItem value='active_only'>
                        Actives uniquement
                      </SelectItem>
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
                    aria-label='Date de début'
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
                    aria-label='Date de fin'
                  />
                  {(searchQuery ||
                    dateFrom ||
                    dateTo ||
                    supplierFilter !== 'all' ||
                    paymentFilter !== 'all' ||
                    productFilter !== 'all' ||
                    correctionFilter !== 'all') && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-8 text-xs text-[#6D7175]'
                      onClick={() => {
                        setSearchQuery('')
                        setDateFrom('')
                        setDateTo('')
                        setSupplierFilter('all')
                        setPaymentFilter('all')
                        setProductFilter('all')
                        setCorrectionFilter('all')
                        setPage(1)
                      }}
                    >
                      Réinitialiser les filtres
                    </Button>
                  )}
                </div>

                <div className='text-xs text-[#6D7175]'>
                  <span className='font-semibold text-[#202223]'>
                    {filteredPurchases.length}
                  </span>{' '}
                  document(s) trouvé(s)
                </div>
              </div>
            </div>

            {/* Table or Empty State */}
            {isLoading ? (
              <div className='space-y-2 rounded-lg border border-[#E1E3E5] bg-white p-4'>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className='h-10 w-full' />
                ))}
              </div>
            ) : purchaseHeaders.length === 0 ? (
              <EmptyState
                icon={ArrowDownToLine}
                title='Aucune entrée de stock enregistrée'
                description='Aucun bon de réception ou achat fournisseur ne figure dans la base. Les mouvements sont tracés et ne sont jamais supprimés.'
                columnsPreview={[
                  'Date (JJ/MM/AAAA)',
                  'N° facture / bon de livraison',
                  'Fournisseur',
                  'Nombre de lignes',
                  `Montant total (${vatConvention})`,
                  'Statut paiement',
                  'Enregistré par',
                ]}
                primaryAction={
                  canCreate
                    ? {
                        label: 'Nouvelle entrée',
                        onClick: () => setViewMode('new'),
                        icon: Plus,
                      }
                    : undefined
                }
                secondaryAction={{
                  label: 'Importer depuis Excel',
                  to: '/import-export',
                  icon: FileSpreadsheet,
                }}
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
                          onClick={() => handleSort('invoice_no')}
                        >
                          N° facture / bon de livraison{' '}
                          {renderSortIcon('invoice_no')}
                        </TableHead>
                        <TableHead
                          className='cursor-pointer text-xs font-semibold text-[#202223]'
                          onClick={() => handleSort('supplier')}
                        >
                          Fournisseur {renderSortIcon('supplier')}
                        </TableHead>
                        <TableHead
                          className='cursor-pointer text-right text-xs font-semibold text-[#202223]'
                          onClick={() => handleSort('lines_count')}
                        >
                          Nombre de lignes {renderSortIcon('lines_count')}
                        </TableHead>
                        <TableHead
                          className='cursor-pointer text-right text-xs font-semibold text-[#202223]'
                          onClick={() => handleSort('total')}
                        >
                          Montant total ({vatConvention}){' '}
                          {renderSortIcon('total')}
                        </TableHead>
                        <TableHead
                          className='cursor-pointer text-xs font-semibold text-[#202223]'
                          onClick={() => handleSort('payment_status')}
                        >
                          Statut paiement {renderSortIcon('payment_status')}
                        </TableHead>
                        <TableHead
                          className='cursor-pointer text-xs font-semibold text-[#202223]'
                          onClick={() => handleSort('recorded_by')}
                        >
                          Enregistré par {renderSortIcon('recorded_by')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedPurchases.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className='py-8 text-center text-sm text-[#6D7175]'
                          >
                            Aucune entrée ne correspond aux filtres sélectionnés.
                          </TableCell>
                        </TableRow>
                      ) : (
                        paginatedPurchases.map(
                          (doc: EnrichedPurchaseDocument) => (
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
                                  <span className='font-mono'>
                                    {doc.invoice_no || '—'}
                                  </span>
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
                              <TableCell className='text-xs font-medium text-[#202223]'>
                                {doc.supplierName}
                              </TableCell>
                              <TableCell className='text-right font-mono text-xs'>
                                {doc.linesCount}
                              </TableCell>
                              <TableCell
                                className={`text-right font-mono text-xs font-semibold ${
                                  doc.totalAmount < 0
                                    ? 'text-[#D82C0D]'
                                    : 'text-[#202223]'
                                }`}
                              >
                                {formatMAD(doc.totalAmount)}
                              </TableCell>
                              <TableCell className='text-xs'>
                                {doc.payment_status === 'paid' ? (
                                  <Badge className='border-[#008060]/20 bg-[#E3F1DF] text-[11px] font-medium text-[#008060] hover:bg-[#E3F1DF]'>
                                    Payé
                                    {doc.payment_date
                                      ? ` (${formatDateFR(doc.payment_date)})`
                                      : ''}
                                  </Badge>
                                ) : (
                                  <Badge className='border-[#B98900]/30 bg-[#FFF8E6] text-[11px] font-medium text-[#B98900] hover:bg-[#FFF8E6]'>
                                    Impayé
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className='text-xs text-[#6D7175]'>
                                {doc.recorded_by_name || 'Administrateur'}
                              </TableCell>
                            </TableRow>
                          )
                        )
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

        {/* ==================== VIEW 2: NEW ENTRY FORM (FULL PAGE) ==================== */}
        {viewMode === 'new' && (
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
                  <span>Retour à la liste</span>
                </Button>
                <div>
                  <h1 className='text-lg font-semibold text-[#202223]'>
                    Nouvelle entrée de stock (Bon de réception / Facture)
                  </h1>
                  <p className='text-xs text-[#6D7175]'>
                    Brouillon sauvegardé automatiquement • Raccourci clavier :{' '}
                    <kbd className='rounded border bg-[#F6F6F7] px-1 py-0.5 font-mono text-[10px]'>
                      Ctrl+Entrée
                    </kbd>{' '}
                    pour enregistrer
                  </p>
                </div>
              </div>

              <div className='flex items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  className='h-9 text-xs'
                  onClick={() => {
                    const fresh = createFreshDraft()
                    setDraft(fresh)
                    setSubmittedAttempt(false)
                    toast.info('Formulaire réinitialisé.')
                  }}
                >
                  Vider le brouillon
                </Button>
                <Button
                  size='sm'
                  className='h-9 gap-1.5 bg-[#008060] text-white hover:bg-[#006e52]'
                  disabled={isCreatingPurchase}
                  onClick={() => {
                    setSubmittedAttempt(true)
                    triggerCreatePurchase()
                  }}
                >
                  <Save className='size-4' />
                  <span>
                    {isCreatingPurchase
                      ? 'Enregistrement...'
                      : "Enregistrer l'entrée"}
                  </span>
                </Button>
              </div>
            </div>

            {/* Non-blocking Warnings */}
            {similarExistingDocs.length > 0 && (
              <div className='flex items-start gap-2.5 rounded-lg border border-[#B98900]/40 bg-[#FFF8E6] p-3 text-xs text-[#7E5700]'>
                <AlertTriangle className='mt-0.5 size-4 shrink-0 text-[#B98900]' />
                <div>
                  <p className='font-semibold'>
                    Attention : Un document très similaire existe déjà
                  </p>
                  <p className='mt-0.5'>
                    Un bon d&apos;entrée à la même date (
                    {formatDateFR(draft.date)}), pour le même fournisseur et le
                    même montant total ({formatMAD(draftTotalAmount)}) est déjà
                    enregistré (N°{' '}
                    {similarExistingDocs[0].invoice_no ||
                      similarExistingDocs[0].id}
                    ). Vérifiez qu&apos;il ne s&apos;agit pas d&apos;un doublon.
                  </p>
                </div>
              </div>
            )}

            {duplicateProductIdsInDraft.size > 0 && (
              <div className='flex items-start gap-2.5 rounded-lg border border-[#B98900]/40 bg-[#FFF8E6] p-3 text-xs text-[#7E5700]'>
                <AlertTriangle className='mt-0.5 size-4 shrink-0 text-[#B98900]' />
                <div>
                  <p className='font-semibold'>
                    Produit présent plusieurs fois dans ce bon
                  </p>
                  <p className='mt-0.5'>
                    Un même produit apparaît sur plusieurs lignes de ce
                    document. Vous pouvez continuer si cela est intentionnel
                    (ex: conditionnements ou prix distincts).
                  </p>
                </div>
              </div>
            )}

            {draftCutoffDate && (
              <div className='flex items-start gap-2.5 rounded-lg border border-[#B98900]/40 bg-[#FFF8E6] p-3 text-xs text-[#7E5700]'>
                <Clock className='mt-0.5 size-4 shrink-0 text-[#B98900]' />
                <div>
                  <p className='font-semibold'>
                    Date antérieure à un inventaire confirmé (
                    {formatDateFR(draftCutoffDate)})
                  </p>
                  <p className='mt-0.5'>
                    Ce bon est daté avant le dernier inventaire validé pour au
                    moins un produit. Il sera enregistré dans l&apos;historique
                    et pris en compte dans le prix moyen pondéré, mais le stock
                    actuel reste ancré sur le comptage d&apos;inventaire plus
                    récent.
                  </p>
                </div>
              </div>
            )}

            {/* Document Header Card */}
            <div className='rounded-lg border border-[#E1E3E5] bg-white p-4 shadow-xs'>
              <h2 className='mb-3 text-sm font-semibold text-[#202223]'>
                En-tête du document
              </h2>
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Date de réception <span className='text-[#D82C0D]'>*</span>
                  </Label>
                  <Input
                    type='date'
                    value={draft.date}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, date: e.target.value }))
                    }
                    className={`h-9 text-xs ${
                      submittedAttempt && !draft.date ? 'border-[#D82C0D]' : ''
                    }`}
                  />
                </div>

                <div className='space-y-1.5'>
                  <div className='flex items-center justify-between'>
                    <Label className='text-xs font-medium text-[#202223]'>
                      Fournisseur <span className='text-[#D82C0D]'>*</span>
                    </Label>
                    <button
                      type='button'
                      onClick={() => setNewSupplierDialogOpen(true)}
                      className='text-[11px] font-medium text-[#008060] hover:underline'
                    >
                      + Nouveau fournisseur
                    </button>
                  </div>
                  <Select
                    value={draft.supplierId || 'none'}
                    onValueChange={(v) => {
                      if (v === '__create_new__') {
                        setNewSupplierDialogOpen(true)
                        return
                      }
                      setDraft((prev) => ({
                        ...prev,
                        supplierId: v === 'none' ? '' : v,
                      }))
                    }}
                  >
                    <SelectTrigger
                      className={`h-9 text-xs ${
                        submittedAttempt && !draft.supplierId
                          ? 'border-[#D82C0D]'
                          : ''
                      }`}
                    >
                      <SelectValue placeholder='Choisir un fournisseur...' />
                    </SelectTrigger>
                    <SelectContent>
                      <div className='p-1.5'>
                        <Input
                          value={supplierSearch}
                          onChange={(e) => setSupplierSearch(e.target.value)}
                          placeholder='Filtrer les fournisseurs...'
                          className='h-7 text-xs'
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </div>
                      <SelectItem value='none'>
                        — Sélectionner un fournisseur —
                      </SelectItem>
                      {activeSuppliers
                        .filter((s) =>
                          normalizeSearchText(s.name).includes(
                            normalizeSearchText(supplierSearch)
                          )
                        )
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      <SelectItem
                        value='__create_new__'
                        className='font-medium text-[#008060]'
                      >
                        + Créer un nouveau fournisseur...
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    N° facture / bon de livraison
                  </Label>
                  <Input
                    value={draft.invoiceNo}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        invoiceNo: e.target.value,
                      }))
                    }
                    placeholder='Ex: FAC-2026-0142 ou BL-889'
                    className='h-9 font-mono text-xs'
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Statut de paiement
                  </Label>
                  <Select
                    value={draft.paymentStatus}
                    onValueChange={(v: 'paid' | 'unpaid') =>
                      setDraft((prev) => ({
                        ...prev,
                        paymentStatus: v,
                        paymentDate:
                          v === 'paid' && !prev.paymentDate
                            ? getTodayIsoDate()
                            : prev.paymentDate,
                      }))
                    }
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='unpaid'>Impayé (À payer)</SelectItem>
                      <SelectItem value='paid'>Payé</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {draft.paymentStatus === 'paid' && (
                  <div className='space-y-1.5'>
                    <Label className='text-xs font-medium text-[#202223]'>
                      Date de paiement
                    </Label>
                    <Input
                      type='date'
                      value={draft.paymentDate}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          paymentDate: e.target.value,
                        }))
                      }
                      className='h-9 text-xs'
                    />
                  </div>
                )}

                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Enregistré par
                  </Label>
                  <Input
                    value={
                      auth.user?.name || auth.user?.email || 'Utilisateur actif'
                    }
                    disabled
                    className='h-9 bg-[#F6F6F7] text-xs text-[#6D7175]'
                  />
                </div>

                <div className='space-y-1.5 sm:col-span-2'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Notes / Observations
                  </Label>
                  <Input
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, notes: e.target.value }))
                    }
                    placeholder='Ex: Livraison partielle, remarque qualité...'
                    className='h-9 text-xs'
                  />
                </div>
              </div>
            </div>

            {/* Lines Card */}
            <div className='rounded-lg border border-[#E1E3E5] bg-white p-4 shadow-xs'>
              <div className='mb-3 flex items-center justify-between'>
                <div>
                  <h2 className='text-sm font-semibold text-[#202223]'>
                    Lignes de réception ({draft.lines.length})
                  </h2>
                  <p className='text-xs text-[#6D7175]'>
                    Recherchez par référence (ex: P092 ou p092) ou par nom.
                    Appuyez sur Entrée pour passer au champ suivant.
                  </p>
                </div>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-8 gap-1.5 text-xs'
                  onClick={addLineAndFocus}
                >
                  <Plus className='size-3.5' />
                  <span>Ajouter une ligne</span>
                </Button>
              </div>

              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader className='bg-[#F6F6F7]'>
                    <TableRow>
                      <TableHead className='w-10 text-xs font-semibold text-[#6D7175]'>
                        #
                      </TableHead>
                      <TableHead className='min-w-[280px] text-xs font-semibold text-[#202223]'>
                        Produit (Réf. ou Nom) *
                      </TableHead>
                      <TableHead className='w-24 text-xs font-semibold text-[#202223]'>
                        Unité
                      </TableHead>
                      <TableHead className='w-36 text-right text-xs font-semibold text-[#202223]'>
                        Quantité *
                      </TableHead>
                      <TableHead className='w-44 text-right text-xs font-semibold text-[#202223]'>
                        Prix unitaire ({vatConvention} MAD) *
                      </TableHead>
                      <TableHead className='w-36 text-right text-xs font-semibold text-[#202223]'>
                        Montant (MAD)
                      </TableHead>
                      <TableHead className='w-12' />
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
                      const lastPriceInfo = line.productId
                        ? lastPurchasePriceByProductId.get(line.productId)
                        : undefined
                      const priceWarning = priceWarningsByLineKey.get(line.key)
                      const isDuplicate =
                        line.productId &&
                        duplicateProductIdsInDraft.has(line.productId)

                      const qtyNum = Number(line.qty)
                      const priceNum = Number(line.unitPrice)
                      const lineAmount =
                        Number.isFinite(qtyNum) &&
                        qtyNum > 0 &&
                        Number.isFinite(priceNum) &&
                        priceNum >= 0
                          ? roundCurrency(qtyNum * priceNum)
                          : 0

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
                                  qtyRefs.current[line.key]?.focus()
                                }
                              }}
                              placeholder='Tapez une réf (ex: P092) ou un nom...'
                              className={`h-8 text-xs ${
                                submittedAttempt && !line.productId
                                  ? 'border-[#D82C0D]'
                                  : ''
                              }`}
                            />

                            {openProductDropdownRowKey === line.key &&
                              matchingProducts.length > 0 && (
                                <div className='absolute right-2 left-2 z-50 mt-1 max-h-52 overflow-y-auto rounded-md border border-[#E1E3E5] bg-white shadow-lg'>
                                  {matchingProducts.map((p) => {
                                    const st = stockByProductId.get(p.id)
                                    return (
                                      <button
                                        key={p.id}
                                        type='button'
                                        onMouseDown={(e) => {
                                          e.preventDefault()
                                          selectProductForLine(line.key, p)
                                          qtyRefs.current[line.key]?.focus()
                                        }}
                                        className='flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-[#F6F6F7]'
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
                                          Stock: {formatQty(st?.stock ?? 0)}{' '}
                                          {p.unit}
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}

                            {selectedProduct && (
                              <div className='mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#6D7175]'>
                                <span>
                                  Stock actuel:{' '}
                                  <strong className='font-mono text-[#202223]'>
                                    {formatQty(stockInfo?.stock ?? 0)}{' '}
                                    {selectedProduct.unit}
                                  </strong>
                                </span>
                                {stockInfo?.averagePrice !== null &&
                                  stockInfo?.averagePrice !== undefined && (
                                    <span>
                                      • PMP:{' '}
                                      <strong className='font-mono text-[#202223]'>
                                        {formatMAD(stockInfo.averagePrice)}
                                      </strong>
                                    </span>
                                  )}
                                {isDuplicate && (
                                  <span className='font-medium text-[#B98900]'>
                                    • Produit en doublon sur ce bon
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>

                          <TableCell className='pt-2.5 font-mono text-xs text-[#6D7175]'>
                            {selectedProduct?.unit || '—'}
                          </TableCell>

                          <TableCell>
                            <Input
                              ref={(el) => {
                                qtyRefs.current[line.key] = el
                              }}
                              type='number'
                              step='any'
                              min='0'
                              value={line.qty}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  lines: prev.lines.map((l) =>
                                    l.key === line.key
                                      ? { ...l, qty: e.target.value }
                                      : l
                                  ),
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  priceRefs.current[line.key]?.focus()
                                }
                              }}
                              placeholder='0'
                              className={`h-8 text-right font-mono text-xs ${
                                submittedAttempt &&
                                (!line.qty || Number(line.qty) <= 0)
                                  ? 'border-[#D82C0D]'
                                  : ''
                              }`}
                            />
                          </TableCell>

                          <TableCell>
                            <Input
                              ref={(el) => {
                                priceRefs.current[line.key] = el
                              }}
                              type='number'
                              step='any'
                              min='0'
                              value={line.unitPrice}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  lines: prev.lines.map((l) =>
                                    l.key === line.key
                                      ? { ...l, unitPrice: e.target.value }
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
                              placeholder='0,00'
                              className={`h-8 text-right font-mono text-xs ${
                                submittedAttempt &&
                                (line.unitPrice === '' ||
                                  Number(line.unitPrice) < 0)
                                  ? 'border-[#D82C0D]'
                                  : priceWarning
                                    ? 'border-[#B98900] bg-[#FFF8E6]/50'
                                    : ''
                              }`}
                            />
                            {lastPriceInfo && (
                              <div className='mt-0.5 text-right text-[10px] text-[#6D7175]'>
                                Dernier achat :{' '}
                                <button
                                  type='button'
                                  onClick={() =>
                                    setDraft((prev) => ({
                                      ...prev,
                                      lines: prev.lines.map((l) =>
                                        l.key === line.key
                                          ? {
                                              ...l,
                                              unitPrice: String(
                                                lastPriceInfo.price
                                              ),
                                            }
                                          : l
                                      ),
                                    }))
                                  }
                                  className='font-mono font-medium text-[#008060] hover:underline'
                                >
                                  {formatMAD(lastPriceInfo.price)}
                                </button>
                              </div>
                            )}
                            {priceWarning && (
                              <div className='mt-0.5 text-right text-[10px] font-medium text-[#B98900]'>
                                Écart de {Math.round(priceWarning.deviationPct)}%
                                vs PMP ({formatMAD(priceWarning.averagePrice)})
                              </div>
                            )}
                          </TableCell>

                          <TableCell className='pt-2.5 text-right font-mono text-xs font-semibold text-[#202223]'>
                            {formatMAD(lineAmount)}
                          </TableCell>

                          <TableCell className='pt-1.5 text-right'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='sm'
                              className='size-7 p-0 text-[#6D7175] hover:text-[#D82C0D]'
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
                              <Trash2 className='size-3.5' />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Document Footer Total */}
              <div className='mt-4 flex flex-col items-end justify-between gap-3 border-t border-[#E1E3E5] pt-4 sm:flex-row sm:items-center'>
                <div className='text-xs text-[#6D7175]'>
                  Les montants sont calculés et vérifiés côté serveur lors de la
                  validation.
                </div>
                <div className='flex items-center gap-4 rounded-md bg-[#F6F6F7] px-4 py-2.5'>
                  <span className='text-xs font-medium text-[#6D7175]'>
                    Total du document ({vatConvention}) :
                  </span>
                  <span className='font-mono text-base font-bold text-[#202223]'>
                    {formatMAD(draftTotalAmount)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== VIEW 3: DOCUMENT DETAIL PAGE ==================== */}
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
                  <span>Retour aux entrées</span>
                </Button>
                <div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <h1 className='text-lg font-semibold text-[#202223]'>
                      Bon d&apos;entrée{' '}
                      <span className='font-mono'>
                        {selectedDocument.invoice_no || selectedDocument.id}
                      </span>
                    </h1>
                    {selectedDocument.isReversal && (
                      <Badge className='border-[#D82C0D]/30 bg-[#FFF4F4] text-xs text-[#D82C0D]'>
                        Contre-passation
                      </Badge>
                    )}
                    {selectedDocument.isReversed &&
                      !selectedDocument.isReversal && (
                        <Badge className='border-[#8C9196] bg-[#F1F2F3] text-xs text-[#6D7175]'>
                          Corrigée / Annulée
                        </Badge>
                      )}
                    {selectedDocument.isPendingApproval && (
                      <Badge className='border-[#B98900] bg-[#FFF8E6] text-xs text-[#B98900]'>
                        En attente d&apos;approbation
                      </Badge>
                    )}
                  </div>
                  <p className='text-xs text-[#6D7175]'>
                    Enregistré le {formatDateFR(selectedDocument.date)} par{' '}
                    {selectedDocument.recorded_by_name || 'Administrateur'}
                  </p>
                </div>
              </div>

              <div className='flex flex-wrap items-center gap-2'>
                {canUpdate &&
                  selectedDocument.payment_status === 'unpaid' &&
                  !selectedDocument.isReversal &&
                  !selectedDocument.isReversed && (
                    <Button
                      variant='outline'
                      size='sm'
                      className='h-8 gap-1.5 border-[#008060] text-xs text-[#008060] hover:bg-[#E3F1DF]/50'
                      onClick={() => {
                        setMarkPaidDate(getTodayIsoDate())
                        setMarkPaidDialogOpen(true)
                      }}
                    >
                      <CreditCard className='size-3.5' />
                      <span>Marquer comme payé</span>
                    </Button>
                  )}

                {isManagerOrAdmin && selectedDocument.isPendingApproval && (
                  <Button
                    size='sm'
                    className='h-8 gap-1.5 bg-[#008060] text-xs text-white hover:bg-[#006e52]'
                    onClick={() => {
                      reversePurchaseMutation.mutate({
                        purchaseId: selectedDocument.id,
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
                  Ce document est une écriture de contre-passation annulant le
                  document d&apos;origine{' '}
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
                  Voir le document d&apos;origine
                </Button>
              </div>
            )}

            {selectedDocument.reversedByDoc && (
              <div className='flex items-center justify-between rounded-lg border border-[#8C9196] bg-[#F1F2F3] p-3 text-xs text-[#202223]'>
                <div>
                  Ce document a été contre-passé le{' '}
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

            {/* Header Summary Grid */}
            <div className='grid grid-cols-1 gap-4 rounded-lg border border-[#E1E3E5] bg-white p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-4'>
              <div>
                <span className='text-xs text-[#6D7175]'>Fournisseur</span>
                <p className='mt-0.5 text-sm font-semibold text-[#202223]'>
                  {selectedDocument.supplierName}
                </p>
              </div>
              <div>
                <span className='text-xs text-[#6D7175]'>
                  N° Facture / Bon de livraison
                </span>
                <p className='mt-0.5 font-mono text-sm font-semibold text-[#202223]'>
                  {selectedDocument.invoice_no || '—'}
                </p>
              </div>
              <div>
                <span className='text-xs text-[#6D7175]'>
                  Statut de paiement
                </span>
                <div className='mt-1'>
                  {selectedDocument.payment_status === 'paid' ? (
                    <Badge className='bg-[#E3F1DF] text-xs font-medium text-[#008060]'>
                      Payé le{' '}
                      {selectedDocument.payment_date
                        ? formatDateFR(selectedDocument.payment_date)
                        : formatDateFR(selectedDocument.date)}
                    </Badge>
                  ) : (
                    <Badge className='bg-[#FFF8E6] text-xs font-medium text-[#B98900]'>
                      Impayé
                    </Badge>
                  )}
                </div>
              </div>
              <div>
                <span className='text-xs text-[#6D7175]'>
                  Total du document ({vatConvention})
                </span>
                <p className='mt-0.5 font-mono text-base font-bold text-[#202223]'>
                  {formatMAD(selectedDocument.totalAmount)}
                </p>
              </div>
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
                  Lignes du document ({selectedDocument.linesCount})
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
                      Quantité
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#202223]'>
                      Prix unitaire ({vatConvention})
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#202223]'>
                      Montant
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedDocument.lines.map((line: PurchaseLineRecord) => {
                    const prod = productById.get(line.product)
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
                          {formatQty(line.qty)}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs'>
                          {formatMAD(line.unit_price)}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs font-semibold'>
                          {formatMAD(line.amount)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Document Audit Trail */}
            {canListAudit && (
              <div className='rounded-lg border border-[#E1E3E5] bg-white p-4 shadow-xs'>
                <div className='mb-3 flex items-center gap-2'>
                  <History className='size-4 text-[#6D7175]' />
                  <h2 className='text-sm font-semibold text-[#202223]'>
                    Journal d&apos;audit de ce document
                  </h2>
                </div>
                {selectedDocAuditLogs.length === 0 ? (
                  <p className='text-xs text-[#6D7175]'>
                    Aucune trace d&apos;audit supplémentaire pour ce document.
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
                              ? 'Création du bon d’entrée'
                              : log.action === 'reversal'
                                ? 'Contre-passation (Annulation / Correction)'
                                : log.action === 'update'
                                  ? 'Mise à jour (Paiement / Approbation)'
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

      {/* Dialog: Create New Supplier Inline */}
      <Dialog
        open={newSupplierDialogOpen}
        onOpenChange={setNewSupplierDialogOpen}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              Nouveau fournisseur
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Créez rapidement un fournisseur sans quitter votre bon d&apos;entrée.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3 py-2'>
            <div className='space-y-1'>
              <Label className='text-xs'>Nom du fournisseur *</Label>
              <Input
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder='Ex: Cash Plus Alimentaire'
                className='h-8 text-xs'
              />
            </div>
            <div className='space-y-1'>
              <Label className='text-xs'>Téléphone</Label>
              <Input
                value={newSupplierPhone}
                onChange={(e) => setNewSupplierPhone(e.target.value)}
                placeholder='Ex: 0522-000000'
                className='h-8 text-xs'
              />
            </div>
            <div className='space-y-1'>
              <Label className='text-xs'>Conditions de paiement</Label>
              <Input
                value={newSupplierPaymentTerms}
                onChange={(e) => setNewSupplierPaymentTerms(e.target.value)}
                placeholder='Ex: 30 jours fin de mois'
                className='h-8 text-xs'
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setNewSupplierDialogOpen(false)}
            >
              Annuler
            </Button>
            <Button
              size='sm'
              className='bg-[#008060] text-white hover:bg-[#006e52]'
              disabled={!newSupplierName.trim() || createSupplierMutation.isPending}
              onClick={() => createSupplierMutation.mutate()}
            >
              Créer et sélectionner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Mark as Paid */}
      <Dialog open={markPaidDialogOpen} onOpenChange={setMarkPaidDialogOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              Marquer ce bon d&apos;entrée comme payé
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Indiquez la date effective du règlement fournisseur.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2 py-2'>
            <Label className='text-xs'>Date de paiement *</Label>
            <Input
              type='date'
              value={markPaidDate}
              onChange={(e) => setMarkPaidDate(e.target.value)}
              className='h-9 text-xs'
            />
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setMarkPaidDialogOpen(false)}
            >
              Annuler
            </Button>
            <Button
              size='sm'
              className='bg-[#008060] text-white hover:bg-[#006e52]'
              disabled={!markPaidDate || markPaidMutation.isPending}
              onClick={() => {
                if (!selectedDocument) return
                markPaidMutation.mutate({
                  purchaseId: selectedDocument.id,
                  paymentDate: markPaidDate,
                })
              }}
            >
              Confirmer le paiement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Reverse / Correct Purchase Document */}
      <Dialog open={reversalDialogOpen} onOpenChange={setReversalDialogOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              {reversalMode === 'correct'
                ? 'Corriger ce bon d’entrée (Contre-passation + Nouveau bon)'
                : 'Annuler ce bon d’entrée (Contre-passation)'}
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Les mouvements de stock ne sont jamais supprimés. Une écriture
              inverse (négative) liée à ce document va être créée, et le
              document original restera visible dans l&apos;historique.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-3 py-2'>
            {selectedDocCutoffDate && (
              <div className='rounded-md border border-[#D82C0D]/40 bg-[#FFF4F4] p-3 text-xs text-[#D82C0D]'>
                <p className='font-semibold'>
                  Attention : Document antérieur à un inventaire confirmé (
                  {formatDateFR(selectedDocCutoffDate)})
                </p>
                <p className='mt-1'>
                  Contre-passer un document antérieur à un inventaire validé
                  nécessite l&apos;approbation d&apos;un Manager ou
                  Administrateur.
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
                Motif obligatoire de la{' '}
                {reversalMode === 'correct' ? 'correction' : 'contre-passation'}{' '}
                <span className='text-[#D82C0D]'>*</span>
              </Label>
              <Textarea
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder='Ex: Erreur de saisie sur le prix unitaire ou la quantité livrée...'
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
                reversePurchaseMutation.isPending ||
                Boolean(
                  selectedDocCutoffDate &&
                    isManagerOrAdmin &&
                    !approveCutoffOverride
                )
              }
              onClick={() => {
                if (!selectedDocument) return
                reversePurchaseMutation.mutate({
                  purchaseId: selectedDocument.id,
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
export { EntreesDeStock as EntreesDeStockPage }
