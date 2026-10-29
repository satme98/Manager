import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Eye,
  FileSpreadsheet,
  Lock,
  Plus,
  Printer,
  Save,
  Search,
  ShieldAlert,
  Undo2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import { invalidateDashboardAnalyticsCache } from '@/data/analytics'
import type {
  InventoryLineRecord,
  InventoryScope,
  InventorySessionRecord,
  ProductRecord,
} from '@/data/types'
import {
  formatDateFR as formatDateDDMMYYYY,
  formatDateTimeFR,
  formatMAD,
  formatQuantity as formatNumberFR,
} from '@/lib/formatters'
import {
  canConfirmInventory,
  canPerformCollectionAction,
  canSeeFinancialData,
} from '@/lib/rbac'
import {
  computeAllProductsStock,
  normalizeSearchText,
  roundCurrency,
  roundQty,
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
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

type ScreenMode = 'list' | 'count' | 'detail' | 'print_sheet'

interface CountLineDraftState {
  countedRaw: string // '' when not yet counted
  comment: string
}

type LineVarianceStatus = 'Non compté' | 'OK' | 'Manquant' | 'Excédent'

const LOCAL_DRAFT_STORAGE_PREFIX = 'monarq_inventory_draft_v1_'

export function Inventaires() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.auth.user)
  const role = user?.role ?? 'consultation'

  const showFinancials = canSeeFinancialData(role)
  const canCreateOrEditDraft = canPerformCollectionAction(
    role,
    'inventory_sessions',
    'create'
  )
  const canReverseSession = canPerformCollectionAction(
    role,
    'inventory_sessions',
    'reverse'
  )

  // Screen mode & active session
  const [mode, setMode] = useState<ScreenMode>('list')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Start New Inventory Modal state
  const [startDialogOpen, setStartDialogOpen] = useState(false)
  const [newDate, setNewDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [newScope, setNewScope] = useState<InventoryScope>('full')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [newLocation, setNewLocation] = useState<string>('all')
  const [newNotes, setNewNotes] = useState<string>('')
  const [creatingSession, setCreatingSession] = useState(false)

  // Count screen state (for active draft session)
  const [draftInputs, setDraftInputs] = useState<
    Record<string, CountLineDraftState>
  >({})
  const [draftNotes, setDraftNotes] = useState('')
  const [countSearch, setCountSearch] = useState('')
  const [countCategoryFilter, setCountCategoryFilter] = useState('all')
  const [onlyUncounted, setOnlyUncounted] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [lastAutosavedAt, setLastAutosavedAt] = useState<string | null>(null)

  // Review & Confirm Dialog state
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [confirmingSession, setConfirmingSession] = useState(false)

  // Reversal Dialog state (on Detail screen)
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false)
  const [reverseReason, setReverseReason] = useState('')
  const [reversingSession, setReversingSession] = useState(false)

  // Printable Count Sheet options
  const [printScopeCategories, setPrintScopeCategories] = useState<string>('all')
  const [printLocationFilter, setPrintLocationFilter] = useState<string>('all')
  const [printIncludeTheoretical, setPrintIncludeTheoretical] = useState(false)
  const [printDate, setPrintDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )

  // Detail view filter
  const [detailSearch, setDetailSearch] = useState('')
  const [detailStatusFilter, setDetailStatusFilter] = useState<string>('all')

  // Refs for keyboard navigation (Enter moves to next product's count input)
  const countInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => repository.listProducts(),
  })

  const inventoriesQuery = useQuery({
    queryKey: ['inventories'],
    queryFn: () => repository.listInventories(),
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

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => repository.listSettings(),
  })

  const loading =
    productsQuery.isLoading ||
    inventoriesQuery.isLoading ||
    exitsQuery.isLoading ||
    (showFinancials && purchasesQuery.isLoading)

  const products = useMemo(
    () => (productsQuery.data ?? []).filter((p) => !p.archived),
    [productsQuery.data]
  )

  const sessions = useMemo(
    () =>
      [...(inventoriesQuery.data?.sessions ?? [])].sort((a, b) =>
        a.date > b.date ? -1 : a.date < b.date ? 1 : 0
      ),
    [inventoriesQuery.data]
  )

  const allLines = useMemo(
    () => inventoriesQuery.data?.lines ?? [],
    [inventoriesQuery.data]
  )

  const allowEconomatConfirm = useMemo(() => {
    const s = (settingsQuery.data ?? []).find(
      (item) => item.key === 'allow_economat_confirm_inventory'
    )
    return typeof s?.value === 'boolean' ? s.value : false
  }, [settingsQuery.data])

  const varianceThresholdPct = useMemo(() => {
    const s = (settingsQuery.data ?? []).find(
      (item) => item.key === 'inventory_variance_threshold_pct'
    )
    return typeof s?.value === 'number' && !Number.isNaN(s.value) ? s.value : 20
  }, [settingsQuery.data])

  const varianceThresholdMad = useMemo(() => {
    const s = (settingsQuery.data ?? []).find(
      (item) => item.key === 'inventory_variance_threshold_mad'
    )
    return typeof s?.value === 'number' && !Number.isNaN(s.value)
      ? s.value
      : 500
  }, [settingsQuery.data])

  const userCanConfirm = canConfirmInventory(role, allowEconomatConfirm)

  const invalidateAllInventoryQueries = async () => {
    invalidateDashboardAnalyticsCache()
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventories'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] }),
    ])
  }

  // Categories & locations from active products
  const allCategories = useMemo(() => {
    const s = new Set<string>()
    for (const p of products) {
      if (p.category?.trim()) s.add(p.category.trim())
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [products])

  const allLocations = useMemo(() => {
    const s = new Set<string>()
    for (const p of products) {
      if (p.location?.trim()) s.add(p.location.trim())
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [products])

  // Group lines by session ID
  const linesBySession = useMemo(() => {
    const map = new Map<string, InventoryLineRecord[]>()
    for (const line of allLines) {
      const arr = map.get(line.session) ?? []
      arr.push(line)
      map.set(line.session, arr)
    }
    return map
  }, [allLines])

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  )

  // Theoretical stock map at activeSession.date (for Count screen) or printDate (for Print sheet)
  const theoreticalStockMapForSession = useMemo(() => {
    const targetDate =
      mode === 'print_sheet'
        ? printDate
        : activeSession?.date ?? new Date().toISOString().slice(0, 10)
    return computeAllProductsStock({
      products,
      purchases: purchasesQuery.data?.headers ?? [],
      purchaseLines: purchasesQuery.data?.lines ?? [],
      exits: exitsQuery.data?.headers ?? [],
      exitLines: exitsQuery.data?.lines ?? [],
      inventorySessions: sessions,
      inventoryLines: allLines,
      asOfDate: targetDate,
      excludeSessionId: activeSession?.id ?? null,
    })
  }, [
    mode,
    printDate,
    activeSession,
    products,
    purchasesQuery.data,
    exitsQuery.data,
    sessions,
    allLines,
  ])

  // Products scoped to the active draft session
  const sessionScopedProducts = useMemo(() => {
    if (!activeSession) return []
    const cats =
      activeSession.categories && activeSession.categories.length > 0
        ? new Set(activeSession.categories.map((c) => c.trim().toLowerCase()))
        : activeSession.category
          ? new Set(
              activeSession.category
                .split(',')
                .map((c) => c.trim().toLowerCase())
                .filter(Boolean)
            )
          : null

    const loc = activeSession.location?.trim().toLowerCase() || null

    return products
      .filter((p) => {
        if (activeSession.scope === 'category' && cats && cats.size > 0) {
          const pCat = (p.category || '').trim().toLowerCase()
          if (!cats.has(pCat)) return false
        }
        if (loc && (p.location || '').trim().toLowerCase() !== loc) {
          return false
        }
        return true
      })
      .sort((a, b) => a.ref.localeCompare(b.ref, 'fr', { numeric: true }))
  }, [activeSession, products])

  // Open a session (draft -> count screen, confirmed/reversed -> detail screen)
  const openSession = (session: InventorySessionRecord) => {
    setActiveSessionId(session.id)
    if (session.status === 'draft' && canCreateOrEditDraft) {
      const existingLines = linesBySession.get(session.id) ?? []
      const initialMap: Record<string, CountLineDraftState> = {}
      for (const l of existingLines) {
        initialMap[l.product] = {
          countedRaw:
            l.counted !== null && l.counted !== undefined
              ? String(l.counted)
              : '',
          comment: l.comment ?? '',
        }
      }

      // Check localStorage backup for any newer unsaved keystrokes
      try {
        const rawLocal = window.localStorage.getItem(
          `${LOCAL_DRAFT_STORAGE_PREFIX}${session.id}`
        )
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal) as Record<
            string,
            CountLineDraftState
          >
          for (const [prodId, val] of Object.entries(parsed)) {
            if (val && (val.countedRaw !== '' || val.comment !== '')) {
              initialMap[prodId] = val
            }
          }
        }
      } catch {
        // Ignore storage errors
      }

      setDraftInputs(initialMap)
      setDraftNotes(session.notes ?? '')
      setCountSearch('')
      setCountCategoryFilter('all')
      setOnlyUncounted(false)
      setMode('count')
    } else {
      setDetailSearch('')
      setDetailStatusFilter('all')
      setMode('detail')
    }
  }

  // Open session automatically when navigated with ?doc=<sessionId>
  useEffect(() => {
    if (typeof window === 'undefined' || sessions.length === 0) return
    const checkDocParam = () => {
      const docId = new URLSearchParams(window.location.search).get('doc')
      if (!docId) return
      const target = sessions.find((s) => s.id === docId)
      if (target && activeSessionId !== target.id) {
        openSession(target)
      }
    }
    checkDocParam()
    window.addEventListener('popstate', checkDocParam)
    window.addEventListener('monarq:navigate', checkDocParam)
    return () => {
      window.removeEventListener('popstate', checkDocParam)
      window.removeEventListener('monarq:navigate', checkDocParam)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, activeSessionId])

  // Persist draftInputs to localStorage on every keystroke
  useEffect(() => {
    if (mode !== 'count' || !activeSessionId) return
    try {
      window.localStorage.setItem(
        `${LOCAL_DRAFT_STORAGE_PREFIX}${activeSessionId}`,
        JSON.stringify(draftInputs)
      )
    } catch {
      // Ignore
    }
  }, [mode, activeSessionId, draftInputs])

  // Start a new draft inventory session
  const handleStartNewSession = async () => {
    if (!newDate.trim()) {
      toast.error('Veuillez choisir la date de l’inventaire.')
      return
    }
    if (newScope === 'category' && selectedCategories.length === 0) {
      toast.error('Veuillez sélectionner au moins une catégorie.')
      return
    }

    setCreatingSession(true)
    try {
      const { session } = await repository.createInventoryDraftSession({
        date: newDate.trim(),
        scope: newScope,
        categories: newScope === 'category' ? selectedCategories : undefined,
        location: newLocation !== 'all' ? newLocation : null,
        notes: newNotes.trim(),
      })

      setStartDialogOpen(false)
      setNewNotes('')
      await invalidateAllInventoryQueries()
      openSession(session)
      toast.success(
        'Session d’inventaire créée en brouillon. Vous pouvez saisir les quantités comptées.'
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Impossible de démarrer la session d’inventaire.'
      )
    } finally {
      setCreatingSession(false)
    }
  }

  // Save draft to repository
  const handleSaveDraft = async (silent = false) => {
    if (!activeSession) return
    setSavingDraft(true)
    try {
      const payloadLines = Object.entries(draftInputs)
        .filter(
          ([, v]) => v.countedRaw.trim() !== '' || v.comment.trim() !== ''
        )
        .map(([productId, v]) => {
          const clean = v.countedRaw.trim().replace(',', '.')
          const counted = clean === '' ? null : Number(clean)
          return {
            product: productId,
            counted:
              counted !== null && !Number.isNaN(counted) ? counted : null,
            comment: v.comment.trim() || null,
          }
        })

      await repository.saveInventoryDraftLines(
        activeSession.id,
        payloadLines,
        draftNotes
      )
      setLastAutosavedAt(new Date().toLocaleTimeString('fr-FR'))
      await invalidateAllInventoryQueries()
      if (!silent) {
        toast.success('Brouillon d’inventaire enregistré.')
      }
    } catch (err) {
      if (!silent) {
        toast.error(
          err instanceof Error
            ? err.message
            : 'Erreur lors de la sauvegarde du brouillon.'
        )
      }
    } finally {
      setSavingDraft(false)
    }
  }

  // Computed rows for the Count Screen
  const countScreenRows = useMemo(() => {
    return sessionScopedProducts.map((product) => {
      const st: ProductStockResult | undefined =
        theoreticalStockMapForSession.get(product.id)
      const theoretical = st ? st.stock : 0
      const avgPrice = st?.averagePrice ?? null
      const inputState = draftInputs[product.id] ?? {
        countedRaw: '',
        comment: '',
      }
      const rawTrimmed = inputState.countedRaw.trim().replace(',', '.')
      const isCounted = rawTrimmed !== '' && !Number.isNaN(Number(rawTrimmed))
      const counted = isCounted ? roundQty(Number(rawTrimmed)) : null
      const diff = counted !== null ? roundQty(counted - theoretical) : null
      const valueDiff =
        diff !== null && avgPrice !== null
          ? roundCurrency(diff * avgPrice)
          : null

      let varianceStatus: LineVarianceStatus = 'Non compté'
      if (diff !== null) {
        if (Math.abs(diff) < 0.0001) varianceStatus = 'OK'
        else if (diff < 0) varianceStatus = 'Manquant'
        else varianceStatus = 'Excédent'
      }

      // Check if variance is unusual (exceeds threshold pct or threshold MAD)
      let isUnusualVariance = false
      if (diff !== null && Math.abs(diff) > 0.0001) {
        const pct =
          theoretical > 0
            ? (Math.abs(diff) / theoretical) * 100
            : Math.abs(diff) > 0
              ? 100
              : 0
        const absMad = valueDiff !== null ? Math.abs(valueDiff) : 0
        if (
          pct >= varianceThresholdPct ||
          (showFinancials && absMad >= varianceThresholdMad)
        ) {
          isUnusualVariance = true
        }
      }

      return {
        product,
        theoretical,
        avgPrice,
        countedRaw: inputState.countedRaw,
        counted,
        diff,
        valueDiff,
        varianceStatus,
        isUnusualVariance,
        comment: inputState.comment,
      }
    })
  }, [
    sessionScopedProducts,
    theoreticalStockMapForSession,
    draftInputs,
    varianceThresholdPct,
    varianceThresholdMad,
    showFinancials,
  ])

  const filteredCountRows = useMemo(() => {
    const q = normalizeSearchText(countSearch)
    return countScreenRows.filter((row) => {
      if (q) {
        const hay = `${normalizeSearchText(row.product.ref)} ${normalizeSearchText(row.product.name)}`
        if (!hay.includes(q)) return false
      }
      if (
        countCategoryFilter !== 'all' &&
        (row.product.category || '') !== countCategoryFilter
      ) {
        return false
      }
      if (onlyUncounted && row.counted !== null) {
        return false
      }
      return true
    })
  }, [countScreenRows, countSearch, countCategoryFilter, onlyUncounted])

  // Progress & Review summary metrics
  const countReviewSummary = useMemo(() => {
    const totalScoped = countScreenRows.length
    const countedRows = countScreenRows.filter((r) => r.counted !== null)
    const uncountedCount = totalScoped - countedRows.length

    let missingCount = 0
    let missingValue = 0
    let surplusCount = 0
    let surplusValue = 0
    let okCount = 0
    let totalNetValueDiff = 0
    const unusualWithoutComment: typeof countScreenRows = []

    for (const r of countedRows) {
      if (r.varianceStatus === 'OK') okCount++
      if (r.varianceStatus === 'Manquant') {
        missingCount++
        if (r.valueDiff !== null) {
          missingValue = roundCurrency(missingValue + r.valueDiff)
        }
      }
      if (r.varianceStatus === 'Excédent') {
        surplusCount++
        if (r.valueDiff !== null) {
          surplusValue = roundCurrency(surplusValue + r.valueDiff)
        }
      }
      if (r.valueDiff !== null) {
        totalNetValueDiff = roundCurrency(totalNetValueDiff + r.valueDiff)
      }
      if (r.isUnusualVariance && !r.comment.trim()) {
        unusualWithoutComment.push(r)
      }
    }

    return {
      totalScoped,
      countedCount: countedRows.length,
      uncountedCount,
      okCount,
      missingCount,
      missingValue,
      surplusCount,
      surplusValue,
      totalNetValueDiff,
      unusualWithoutComment,
    }
  }, [countScreenRows])

  // Confirm Inventory Session
  const handleConfirmInventory = async () => {
    if (!activeSession) return
    if (countReviewSummary.countedCount === 0) {
      toast.error(
        'Veuillez compter au moins un produit avant de confirmer l’inventaire.'
      )
      return
    }
    if (countReviewSummary.unusualWithoutComment.length > 0) {
      toast.error(
        `Veuillez renseigner un commentaire pour les ${countReviewSummary.unusualWithoutComment.length} produit(s) présentant un écart inhabituel.`
      )
      setReviewDialogOpen(false)
      return
    }

    setConfirmingSession(true)
    try {
      const payloadLines = countScreenRows
        .filter((r) => r.counted !== null)
        .map((r) => ({
          product: r.product.id,
          counted: r.counted,
          comment: r.comment.trim() || null,
        }))

      const { session: confirmed } = await repository.confirmInventorySession(
        activeSession.id,
        payloadLines,
        draftNotes
      )

      try {
        window.localStorage.removeItem(
          `${LOCAL_DRAFT_STORAGE_PREFIX}${activeSession.id}`
        )
      } catch {
        // Ignore
      }

      setReviewDialogOpen(false)
      await invalidateAllInventoryQueries()
      setActiveSessionId(confirmed.id)
      setMode('detail')
      toast.success(
        `Inventaire du ${formatDateDDMMYYYY(confirmed.date)} confirmé (${payloadLines.length} produits mis à jour).`
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la confirmation de l’inventaire.'
      )
    } finally {
      setConfirmingSession(false)
    }
  }

  // Reverse a confirmed inventory session (manager/admin only)
  const handleReverseSession = async () => {
    if (!activeSession) return
    if (!reverseReason.trim()) {
      toast.error(
        'Un motif obligatoire est requis pour contre-passer cet inventaire.'
      )
      return
    }

    setReversingSession(true)
    try {
      await repository.reverseInventorySession(
        activeSession.id,
        reverseReason.trim()
      )
      setReverseDialogOpen(false)
      setReverseReason('')
      await invalidateAllInventoryQueries()
      toast.success(
        'Session d’inventaire contre-passée. Le stock a été recalculé automatiquement.'
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la contre-passation de la session.'
      )
    } finally {
      setReversingSession(false)
    }
  }

  // Export confirmed session detail to Excel
  const handleExportSessionDetail = (session: InventorySessionRecord) => {
    const sLines = linesBySession.get(session.id) ?? []
    const productMap = new Map(products.map((p) => [p.id, p]))

    const data = sLines.map((l) => {
      const prod = productMap.get(l.product)
      const status: LineVarianceStatus =
        Math.abs(l.diff) < 0.0001
          ? 'OK'
          : l.diff < 0
            ? 'Manquant'
            : 'Excédent'
      const row: Record<string, string | number> = {
        Référence: prod?.ref ?? l.product,
        Produit: prod?.name ?? 'Produit inconnu',
        Catégorie: prod?.category || 'Sans catégorie',
        Unité: prod?.unit ?? 'u',
        'Stock théorique': l.theoretical,
        'Stock réel compté': l.counted,
        Écart: l.diff,
        Statut: status,
      }
      if (showFinancials) {
        row["Valeur de l'écart (DH)"] =
          l.value_diff !== null && l.value_diff !== undefined
            ? l.value_diff
            : 'Prix manquant'
      }
      row['Commentaire'] = l.comment || ''
      return row
    })

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventaire')
    XLSX.writeFile(wb, `MONARQ_Inventaire_${session.date.slice(0, 10)}.xlsx`)
    toast.success('Export Excel de l’inventaire téléchargé.')
  }

  const openProductDetail = (productId: string) => {
    void navigate({
      to: '/produits',
      search: { productId } as never,
    })
  }

  // ============================================================================
  // VIEW 1: PRINTABLE COUNT SHEET ("Imprimer la feuille de comptage")
  // ============================================================================
  if (mode === 'print_sheet') {
    const sheetProducts = products
      .filter((p) => {
        if (
          printScopeCategories !== 'all' &&
          (p.category || 'Sans catégorie') !== printScopeCategories
        ) {
          return false
        }
        if (
          printLocationFilter !== 'all' &&
          (p.location || '') !== printLocationFilter
        ) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        const catCmp = (a.category || 'ZZZ').localeCompare(
          b.category || 'ZZZ',
          'fr'
        )
        if (catCmp !== 0) return catCmp
        return a.ref.localeCompare(b.ref, 'fr', { numeric: true })
      })

    const groupedByCategory = new Map<string, ProductRecord[]>()
    for (const p of sheetProducts) {
      const cat = p.category?.trim() || 'Sans catégorie'
      const arr = groupedByCategory.get(cat) ?? []
      arr.push(p)
      groupedByCategory.set(cat, arr)
    }

    return (
      <>
        <Header fixed>
          <div className='hidden items-center gap-2 text-xs text-muted-foreground md:flex'>
            <span className='font-medium uppercase tracking-wider'>
              Inventaires
            </span>
            <span aria-hidden='true'>/</span>
            <span className='font-medium text-foreground'>
              Feuille de comptage
            </span>
          </div>
          <div className='ms-auto flex items-center gap-2'>
            <GlobalSearch />
            <ThemeSwitch />
            <ConfigDrawer />
            <ProfileDropdown />
          </div>
        </Header>

        <Main id='content' className='space-y-4'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden'>
            <div>
              <h1 className='text-xl font-semibold tracking-tight text-foreground'>
                Feuille de comptage imprimable
              </h1>
              <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
                Fiche papier A4 groupée par catégorie pour le comptage physique
                en réserve ou cuisine.
              </p>
            </div>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setMode(activeSessionId ? 'count' : 'list')}
                className='bg-white'
              >
                <ArrowLeft className='mr-1.5 h-4 w-4' />
                Retour
              </Button>
              <Button size='sm' onClick={() => window.print()}>
                <Printer className='mr-1.5 h-4 w-4' />
                Imprimer / Enregistrer en PDF
              </Button>
            </div>
          </div>

          {/* Print configuration toolbar (hidden when printing) */}
          <Card className='border-slate-200 bg-white shadow-none print:hidden'>
            <CardContent className='p-4 flex flex-wrap items-end gap-4'>
              <div className='space-y-1'>
                <Label className='text-xs'>Date du comptage</Label>
                <Input
                  type='date'
                  value={printDate}
                  onChange={(e) => setPrintDate(e.target.value)}
                  className='h-9 w-44 bg-white'
                />
              </div>

              <div className='space-y-1'>
                <Label className='text-xs'>Catégorie</Label>
                <Select
                  value={printScopeCategories}
                  onValueChange={setPrintScopeCategories}
                >
                  <SelectTrigger className='h-9 w-52 bg-white'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>Toutes les catégories</SelectItem>
                    {allCategories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    <SelectItem value='Sans catégorie'>
                      Sans catégorie
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-1'>
                <Label className='text-xs'>Emplacement</Label>
                <Select
                  value={printLocationFilter}
                  onValueChange={setPrintLocationFilter}
                >
                  <SelectTrigger className='h-9 w-48 bg-white'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>Tous les emplacements</SelectItem>
                    {allLocations.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='flex items-center space-x-2 pb-1.5'>
                <Checkbox
                  id='include-theo'
                  checked={printIncludeTheoretical}
                  onCheckedChange={(v) => setPrintIncludeTheoretical(Boolean(v))}
                />
                <Label htmlFor='include-theo' className='text-xs cursor-pointer'>
                  Inclure le stock théorique (désactivé par défaut pour un
                  comptage à l’aveugle)
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Printable Sheet Content */}
          <Card className='border-slate-200 bg-white shadow-none print:border-0'>
            <CardContent className='p-6 space-y-6'>
              <div className='flex items-start justify-between border-b border-slate-300 pb-4'>
                <div>
                  <h2 className='text-lg font-bold text-slate-900'>
                    MONARQ ÉCONOMAT — FEUILLE DE COMPTAGE D’INVENTAIRE
                  </h2>
                  <p className='text-xs text-slate-600 mt-0.5'>
                    Date du comptage :{' '}
                    <strong>{formatDateDDMMYYYY(printDate)}</strong> • Portée :{' '}
                    <strong>
                      {printScopeCategories === 'all'
                        ? 'Inventaire complet'
                        : printScopeCategories}
                    </strong>
                    {printLocationFilter !== 'all' &&
                      ` • Emplacement : ${printLocationFilter}`}{' '}
                    ({sheetProducts.length} produits)
                  </p>
                </div>
                <div className='text-right text-xs text-slate-600'>
                  <p>
                    Mode :{' '}
                    {printIncludeTheoretical
                      ? 'Avec stock théorique'
                      : 'Comptage à l’aveugle'}
                  </p>
                </div>
              </div>

              {Array.from(groupedByCategory.entries()).map(
                ([categoryName, catProducts]) => (
                  <div
                    key={categoryName}
                    className='space-y-2 break-inside-avoid-page'
                  >
                    <div className='bg-slate-100 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider text-slate-800 flex justify-between'>
                      <span>{categoryName}</span>
                      <span>{catProducts.length} article(s)</span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-28 text-xs font-semibold'>
                            Référence
                          </TableHead>
                          <TableHead className='text-xs font-semibold'>
                            Produit
                          </TableHead>
                          <TableHead className='w-24 text-xs font-semibold'>
                            Unité
                          </TableHead>
                          {printIncludeTheoretical && (
                            <TableHead className='w-28 text-right text-xs font-semibold'>
                              Stock théorique
                            </TableHead>
                          )}
                          <TableHead className='w-36 text-center text-xs font-semibold'>
                            Stock réel compté
                          </TableHead>
                          <TableHead className='w-64 text-xs font-semibold'>
                            Notes / Observations
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {catProducts.map((p) => {
                          const theo =
                            theoreticalStockMapForSession.get(p.id)?.stock ?? 0
                          return (
                            <TableRow key={p.id}>
                              <TableCell className='py-2 font-mono text-xs font-semibold'>
                                {p.ref}
                              </TableCell>
                              <TableCell className='py-2 text-xs font-medium'>
                                {p.name}
                                {p.location ? ` (${p.location})` : ''}
                              </TableCell>
                              <TableCell className='py-2 text-xs'>
                                {p.unit}
                              </TableCell>
                              {printIncludeTheoretical && (
                                <TableCell className='py-2 text-right font-mono text-xs'>
                                  {formatNumberFR(theo)}
                                </TableCell>
                              )}
                              <TableCell className='py-2'>
                                <div className='h-6 w-full rounded border border-slate-300 bg-white' />
                              </TableCell>
                              <TableCell className='py-2'>
                                <div className='h-6 w-full border-b border-dotted border-slate-300' />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )
              )}

              {/* Signature Footer */}
              <div className='grid grid-cols-2 gap-8 pt-8 border-t border-slate-300 break-inside-avoid'>
                <div className='space-y-8'>
                  <p className='text-xs font-semibold text-slate-700'>
                    Compté par (Nom et signature) :
                  </p>
                  <div className='border-b border-slate-400 h-8' />
                </div>
                <div className='space-y-8'>
                  <p className='text-xs font-semibold text-slate-700'>
                    Validé par le Manager (Nom, date et signature) :
                  </p>
                  <div className='border-b border-slate-400 h-8' />
                </div>
              </div>
            </CardContent>
          </Card>
        </Main>
      </>
    )
  }

  // ============================================================================
  // VIEW 2: FULL-PAGE COUNT SCREEN (for active Draft Session)
  // ============================================================================
  if (mode === 'count' && activeSession) {
    return (
      <>
        <Header fixed>
          <div className='hidden items-center gap-2 text-xs text-muted-foreground md:flex'>
            <span className='font-medium uppercase tracking-wider'>
              Inventaires
            </span>
            <span aria-hidden='true'>/</span>
            <span className='font-medium text-foreground'>
              Comptage en cours
            </span>
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
                Comptage d’inventaire — {formatDateDDMMYYYY(activeSession.date)}
              </h1>
              <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
                {activeSession.scope === 'full'
                  ? 'Inventaire complet • Saisissez le stock réel compté. Appuyez sur Entrée pour passer à la ligne suivante.'
                  : `Inventaire par catégorie (${activeSession.category || 'Sélection'}) • Appuyez sur Entrée pour passer à la ligne suivante.`}
              </p>
            </div>

            <div className='flex flex-wrap items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  void handleSaveDraft(true)
                  setMode('list')
                }}
                className='bg-white'
              >
                <ArrowLeft className='mr-1.5 h-4 w-4' />
                Retour à la liste
              </Button>

              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  setPrintDate(activeSession.date.slice(0, 10))
                  setMode('print_sheet')
                }}
                className='bg-white'
              >
                <Printer className='mr-1.5 h-4 w-4' />
                Imprimer la feuille
              </Button>

              <Button
                variant='outline'
                size='sm'
                disabled={savingDraft}
                onClick={() => void handleSaveDraft(false)}
                className='bg-white'
              >
                <Save className='mr-1.5 h-4 w-4' />
                {savingDraft ? 'Sauvegarde...' : 'Enregistrer le brouillon'}
              </Button>

              {userCanConfirm && (
                <Button
                  size='sm'
                  onClick={() => {
                    void handleSaveDraft(true)
                    setReviewDialogOpen(true)
                  }}
                >
                  <CheckCircle2 className='mr-1.5 h-4 w-4' />
                  Vérifier et confirmer
                </Button>
              )}
            </div>
          </div>

          {/* Progress & Session Info Bar */}
          <Card className='border-slate-200 bg-white shadow-none'>
            <CardContent className='p-4 flex flex-wrap items-center justify-between gap-4'>
              <div className='flex flex-wrap items-center gap-3'>
                <Badge
                  variant='outline'
                  className='border-amber-300 bg-amber-50 text-amber-800 font-semibold'
                >
                  Brouillon en cours
                </Badge>
                <Badge
                  variant='secondary'
                  className='text-xs font-mono px-2.5 py-1'
                >
                  {countReviewSummary.countedCount} /{' '}
                  {countReviewSummary.totalScoped} comptés
                </Badge>
                {countReviewSummary.missingCount > 0 && (
                  <Badge
                    variant='outline'
                    className='border-red-200 bg-red-50 text-red-700 text-xs'
                  >
                    {countReviewSummary.missingCount} manquant(s)
                  </Badge>
                )}
                {countReviewSummary.surplusCount > 0 && (
                  <Badge
                    variant='outline'
                    className='border-blue-200 bg-blue-50 text-blue-700 text-xs'
                  >
                    {countReviewSummary.surplusCount} excédent(s)
                  </Badge>
                )}
                {showFinancials && (
                  <span className='text-xs text-slate-600'>
                    Écart net provisoire :{' '}
                    <strong
                      className={
                        countReviewSummary.totalNetValueDiff < 0
                          ? 'text-red-700'
                          : countReviewSummary.totalNetValueDiff > 0
                            ? 'text-emerald-700'
                            : 'text-slate-900'
                      }
                    >
                      {countReviewSummary.totalNetValueDiff > 0 ? '+' : ''}
                      {formatMAD(countReviewSummary.totalNetValueDiff)}
                    </strong>
                  </span>
                )}
              </div>

              <div className='text-xs text-slate-500'>
                {lastAutosavedAt
                  ? `Dernière sauvegarde brouillon à ${lastAutosavedAt}`
                  : 'Sauvegarde automatique activée'}
              </div>
            </CardContent>
          </Card>

          {/* Search & Filters for Tablet Count Screen */}
          <Card className='border-slate-200 bg-white shadow-none'>
            <CardContent className='p-4 flex flex-wrap items-center gap-3'>
              <div className='relative flex-1 min-w-[220px]'>
                <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-slate-400' />
                <Input
                  placeholder='Rechercher un produit par référence ou nom...'
                  value={countSearch}
                  onChange={(e) => setCountSearch(e.target.value)}
                  className='pl-9 h-9 bg-white'
                />
                {countSearch && (
                  <button
                    type='button'
                    onClick={() => setCountSearch('')}
                    className='absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600'
                  >
                    <X className='h-4 w-4' />
                  </button>
                )}
              </div>

              <Select
                value={countCategoryFilter}
                onValueChange={setCountCategoryFilter}
              >
                <SelectTrigger className='h-9 w-52 bg-white'>
                  <SelectValue placeholder='Catégorie' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>Toutes les catégories</SelectItem>
                  {allCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type='button'
                variant={onlyUncounted ? 'default' : 'outline'}
                size='sm'
                className='h-9'
                onClick={() => setOnlyUncounted((p) => !p)}
              >
                Non comptés ({countReviewSummary.uncountedCount})
              </Button>

              <div className='flex-1 min-w-[200px]'>
                <Input
                  placeholder='Note de session (optionnel)...'
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  className='h-9 bg-white text-xs'
                />
              </div>
            </CardContent>
          </Card>

          {/* Tablet-friendly Count Table */}
          <Card className='border-slate-200 bg-white shadow-none overflow-hidden'>
            <CardContent className='p-0'>
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader className='bg-slate-50/90'>
                    <TableRow>
                      <TableHead className='w-24 text-xs font-semibold'>
                        Référence
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Produit
                      </TableHead>
                      <TableHead className='w-20 text-xs font-semibold'>
                        Unité
                      </TableHead>
                      <TableHead className='w-32 text-right text-xs font-semibold'>
                        Stock théorique
                      </TableHead>
                      <TableHead className='w-40 text-right text-xs font-semibold'>
                        Stock réel
                      </TableHead>
                      <TableHead className='w-28 text-right text-xs font-semibold'>
                        Écart
                      </TableHead>
                      <TableHead className='w-32 text-xs font-semibold'>
                        Statut
                      </TableHead>
                      {showFinancials && (
                        <TableHead className='w-36 text-right text-xs font-semibold'>
                          Valeur de l’écart
                        </TableHead>
                      )}
                      <TableHead className='min-w-[220px] text-xs font-semibold'>
                        Commentaire / Motif d’écart
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCountRows.map((row, idx) => {
                      const nextProductId =
                        filteredCountRows[idx + 1]?.product.id ?? null

                      return (
                        <TableRow
                          key={row.product.id}
                          className={
                            row.isUnusualVariance
                              ? 'bg-amber-50/50 hover:bg-amber-50/80'
                              : 'hover:bg-slate-50/80'
                          }
                        >
                          <TableCell className='py-2 font-mono text-xs font-semibold text-slate-700'>
                            {row.product.ref}
                          </TableCell>
                          <TableCell className='py-2 text-sm font-medium text-slate-900'>
                            <div>{row.product.name}</div>
                            <div className='text-[11px] text-slate-400'>
                              {row.product.category || 'Sans catégorie'}
                              {row.product.location
                                ? ` • ${row.product.location}`
                                : ''}
                            </div>
                          </TableCell>
                          <TableCell className='py-2 text-xs text-slate-600'>
                            {row.product.unit}
                          </TableCell>
                          <TableCell className='py-2 text-right font-mono text-sm tabular-nums text-slate-700'>
                            {formatNumberFR(row.theoretical)}
                          </TableCell>
                          <TableCell className='py-2 text-right'>
                            <Input
                              ref={(el) => {
                                countInputRefs.current[row.product.id] = el
                              }}
                              type='number'
                              min='0'
                              step='any'
                              placeholder='Non compté'
                              value={row.countedRaw}
                              onChange={(e) => {
                                const val = e.target.value
                                setDraftInputs((prev) => ({
                                  ...prev,
                                  [row.product.id]: {
                                    countedRaw: val,
                                    comment:
                                      prev[row.product.id]?.comment ?? '',
                                  },
                                }))
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  if (
                                    nextProductId &&
                                    countInputRefs.current[nextProductId]
                                  ) {
                                    countInputRefs.current[
                                      nextProductId
                                    ]?.focus()
                                    countInputRefs.current[
                                      nextProductId
                                    ]?.select()
                                  }
                                }
                              }}
                              className='h-9 w-32 ml-auto text-right font-mono text-sm bg-white'
                            />
                          </TableCell>
                          <TableCell className='py-2 text-right font-mono text-sm font-semibold tabular-nums'>
                            {row.diff === null ? (
                              <span className='text-slate-400'>—</span>
                            ) : (
                              <span
                                className={
                                  row.diff < 0
                                    ? 'text-red-700'
                                    : row.diff > 0
                                      ? 'text-blue-700'
                                      : 'text-emerald-700'
                                }
                              >
                                {row.diff > 0 ? '+' : ''}
                                {formatNumberFR(row.diff)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className='py-2'>
                            {row.varianceStatus === 'Non compté' && (
                              <Badge
                                variant='outline'
                                className='border-slate-300 bg-slate-100 text-slate-600 text-xs'
                              >
                                Non compté
                              </Badge>
                            )}
                            {row.varianceStatus === 'OK' && (
                              <Badge
                                variant='outline'
                                className='border-emerald-300 bg-emerald-50 text-emerald-700 text-xs'
                              >
                                OK
                              </Badge>
                            )}
                            {row.varianceStatus === 'Manquant' && (
                              <Badge
                                variant='outline'
                                className='border-red-300 bg-red-50 text-red-700 text-xs'
                              >
                                Manquant
                              </Badge>
                            )}
                            {row.varianceStatus === 'Excédent' && (
                              <Badge
                                variant='outline'
                                className='border-blue-300 bg-blue-50 text-blue-700 text-xs'
                              >
                                Excédent
                              </Badge>
                            )}
                          </TableCell>
                          {showFinancials && (
                            <TableCell className='py-2 text-right font-mono text-xs tabular-nums'>
                              {row.diff === null ? (
                                <span className='text-slate-400'>—</span>
                              ) : row.valueDiff === null ? (
                                <Badge
                                  variant='outline'
                                  className='border-amber-300 bg-amber-50 text-amber-800 text-[11px]'
                                >
                                  Prix manquant
                                </Badge>
                              ) : (
                                <span
                                  className={
                                    row.valueDiff < 0
                                      ? 'text-red-700 font-semibold'
                                      : row.valueDiff > 0
                                        ? 'text-blue-700 font-semibold'
                                        : 'text-slate-600'
                                  }
                                >
                                  {row.valueDiff > 0 ? '+' : ''}
                                  {formatMAD(row.valueDiff)}
                                </span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className='py-2'>
                            <div className='space-y-1'>
                              <Input
                                placeholder={
                                  row.isUnusualVariance
                                    ? 'Motif obligatoire (écart important)...'
                                    : 'Observation optionnelle...'
                                }
                                value={row.comment}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setDraftInputs((prev) => ({
                                    ...prev,
                                    [row.product.id]: {
                                      countedRaw:
                                        prev[row.product.id]?.countedRaw ?? '',
                                      comment: val,
                                    },
                                  }))
                                }}
                                className={`h-8 text-xs bg-white ${
                                  row.isUnusualVariance && !row.comment.trim()
                                    ? 'border-amber-400 focus-visible:ring-amber-500'
                                    : ''
                                }`}
                              />
                              {row.isUnusualVariance && !row.comment.trim() && (
                                <p className='text-[11px] text-amber-700 flex items-center gap-1'>
                                  <AlertTriangle className='h-3 w-3 shrink-0' />
                                  Écart important (≥ {varianceThresholdPct}% ou{' '}
                                  {varianceThresholdMad} DH) : motif requis
                                </p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Review & Confirmation Dialog */}
          <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
            <DialogContent className='max-w-lg'>
              <DialogHeader>
                <DialogTitle>
                  Vérifier et confirmer l’inventaire du{' '}
                  {formatDateDDMMYYYY(activeSession.date)}
                </DialogTitle>
                <DialogDescription>
                  Les quantités comptées deviendront la nouvelle référence de
                  stock datée pour les produits comptés uniquement. Aucun
                  mouvement fictif d’entrée ou de sortie ne sera créé.
                </DialogDescription>
              </DialogHeader>

              <div className='space-y-4 text-sm'>
                <div className='grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3'>
                  <div>
                    <span className='text-xs text-slate-500'>
                      Produits comptés
                    </span>
                    <p className='text-base font-bold text-slate-900'>
                      {countReviewSummary.countedCount} /{' '}
                      {countReviewSummary.totalScoped}
                    </p>
                  </div>
                  <div>
                    <span className='text-xs text-slate-500'>
                      Non comptés (inchangés)
                    </span>
                    <p className='text-base font-bold text-slate-700'>
                      {countReviewSummary.uncountedCount}
                    </p>
                  </div>
                  <div>
                    <span className='text-xs text-slate-500'>
                      Lignes en manquant
                    </span>
                    <p className='text-sm font-semibold text-red-700'>
                      {countReviewSummary.missingCount} produit(s)
                      {showFinancials
                        ? ` (${formatMAD(countReviewSummary.missingValue)})`
                        : ''}
                    </p>
                  </div>
                  <div>
                    <span className='text-xs text-slate-500'>
                      Lignes en excédent
                    </span>
                    <p className='text-sm font-semibold text-blue-700'>
                      {countReviewSummary.surplusCount} produit(s)
                      {showFinancials
                        ? ` (+${formatMAD(countReviewSummary.surplusValue)})`
                        : ''}
                    </p>
                  </div>
                </div>

                {showFinancials && (
                  <div className='flex items-center justify-between rounded-md border border-slate-200 px-3 py-2'>
                    <span className='text-xs font-medium text-slate-600'>
                      Valeur totale nette de l’écart :
                    </span>
                    <span
                      className={`font-mono text-sm font-bold ${
                        countReviewSummary.totalNetValueDiff < 0
                          ? 'text-red-700'
                          : countReviewSummary.totalNetValueDiff > 0
                            ? 'text-blue-700'
                            : 'text-slate-900'
                      }`}
                    >
                      {countReviewSummary.totalNetValueDiff > 0 ? '+' : ''}
                      {formatMAD(countReviewSummary.totalNetValueDiff)}
                    </span>
                  </div>
                )}

                {countReviewSummary.uncountedCount > 0 && (
                  <div className='rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700'>
                    <strong>Information :</strong> Les{' '}
                    {countReviewSummary.uncountedCount} produit(s) non comptés
                    ne seront pas inclus dans cette session confirmée et
                    conserveront leur stock actuel sans modification.
                  </div>
                )}

                {countReviewSummary.unusualWithoutComment.length > 0 && (
                  <div className='rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-1'>
                    <div className='font-semibold flex items-center gap-1.5'>
                      <ShieldAlert className='h-4 w-4 text-amber-700' />
                      <span>
                        {countReviewSummary.unusualWithoutComment.length}{' '}
                        écart(s) important(s) sans commentaire :
                      </span>
                    </div>
                    <p>
                      Veuillez fermer cette fenêtre et saisir un motif sur les
                      lignes surlignées en orange avant de confirmer.
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant='outline'
                  onClick={() => setReviewDialogOpen(false)}
                >
                  Retour au comptage
                </Button>
                <Button
                  onClick={() => void handleConfirmInventory()}
                  disabled={
                    confirmingSession ||
                    countReviewSummary.countedCount === 0 ||
                    countReviewSummary.unusualWithoutComment.length > 0
                  }
                >
                  <Lock className='mr-1.5 h-4 w-4' />
                  {confirmingSession
                    ? 'Confirmation...'
                    : 'Confirmer et verrouiller l’inventaire'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Main>
      </>
    )
  }

  // ============================================================================
  // VIEW 3: INVENTORY DETAIL PAGE (Read-only Confirmed or Reversed Session)
  // ============================================================================
  if (mode === 'detail' && activeSession) {
    const sLines = linesBySession.get(activeSession.id) ?? []
    const productMap = new Map(products.map((p) => [p.id, p]))

    const enrichedDetailLines = sLines.map((line) => {
      const prod = productMap.get(line.product)
      const varianceStatus: LineVarianceStatus =
        Math.abs(line.diff) < 0.0001
          ? 'OK'
          : line.diff < 0
            ? 'Manquant'
            : 'Excédent'
      return {
        line,
        prod,
        varianceStatus,
      }
    })

    const filteredDetailLines = enrichedDetailLines.filter(
      ({ prod, varianceStatus }) => {
        if (detailSearch.trim()) {
          const q = normalizeSearchText(detailSearch)
          const hay = `${normalizeSearchText(prod?.ref)} ${normalizeSearchText(prod?.name)}`
          if (!hay.includes(q)) return false
        }
        if (
          detailStatusFilter !== 'all' &&
          varianceStatus !== detailStatusFilter
        ) {
          return false
        }
        return true
      }
    )

    const totalValueDiff = roundCurrency(
      sLines.reduce((sum, l) => sum + (l.value_diff ?? 0), 0)
    )
    const missingLinesCount = enrichedDetailLines.filter(
      (r) => r.varianceStatus === 'Manquant'
    ).length
    const surplusLinesCount = enrichedDetailLines.filter(
      (r) => r.varianceStatus === 'Excédent'
    ).length

    return (
      <>
        <Header fixed>
          <div className='hidden items-center gap-2 text-xs text-muted-foreground md:flex'>
            <span className='font-medium uppercase tracking-wider'>
              Inventaires
            </span>
            <span aria-hidden='true'>/</span>
            <span className='font-medium text-foreground'>
              Détail session {formatDateDDMMYYYY(activeSession.date)}
            </span>
          </div>
          <div className='ms-auto flex items-center gap-2'>
            <GlobalSearch />
            <ThemeSwitch />
            <ConfigDrawer />
            <ProfileDropdown />
          </div>
        </Header>

        <Main id='content' className='space-y-4'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden'>
            <div>
              <h1 className='text-xl font-semibold tracking-tight text-foreground'>
                Détail de l’inventaire —{' '}
                {formatDateDDMMYYYY(activeSession.date)}
              </h1>
              <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
                Session{' '}
                {activeSession.status === 'confirmed'
                  ? 'confirmée et verrouillée'
                  : 'contre-passée'}{' '}
                • {sLines.length} produit(s) compté(s).
              </p>
            </div>

            <div className='flex flex-wrap items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setMode('list')}
                className='bg-white'
              >
                <ArrowLeft className='mr-1.5 h-4 w-4' />
                Retour à la liste
              </Button>

              <Button
                variant='outline'
                size='sm'
                onClick={() => handleExportSessionDetail(activeSession)}
                className='bg-white'
              >
                <FileSpreadsheet className='mr-1.5 h-4 w-4 text-emerald-600' />
                Exporter Excel
              </Button>

              <Button
                variant='outline'
                size='sm'
                onClick={() => window.print()}
                className='bg-white'
              >
                <Printer className='mr-1.5 h-4 w-4' />
                Imprimer / PDF
              </Button>

              {activeSession.status === 'confirmed' && canReverseSession && (
                <Button
                  variant='destructive'
                  size='sm'
                  onClick={() => setReverseDialogOpen(true)}
                >
                  <Undo2 className='mr-1.5 h-4 w-4' />
                  Contre-passer la session
                </Button>
              )}
            </div>
          </div>

          {/* Session metadata & KPI summary */}
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            <Card className='border-slate-200 bg-white shadow-none'>
              <CardHeader className='pb-1 pt-4 px-4'>
                <CardTitle className='text-xs font-medium uppercase tracking-wider text-slate-500'>
                  Statut & Portée
                </CardTitle>
              </CardHeader>
              <CardContent className='px-4 pb-4 space-y-1'>
                <div className='flex items-center gap-2'>
                  {activeSession.status === 'confirmed' ? (
                    <Badge className='bg-emerald-600 text-white'>
                      Confirmé
                    </Badge>
                  ) : (
                    <Badge variant='destructive'>Contre-passé</Badge>
                  )}
                  <span className='text-xs font-medium text-slate-700'>
                    {activeSession.scope === 'full'
                      ? 'Inventaire complet'
                      : `Catégories : ${activeSession.category || '—'}`}
                  </span>
                </div>
                {activeSession.notes && (
                  <p className='text-xs text-slate-500'>
                    {activeSession.notes}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className='border-slate-200 bg-white shadow-none'>
              <CardHeader className='pb-1 pt-4 px-4'>
                <CardTitle className='text-xs font-medium uppercase tracking-wider text-slate-500'>
                  Produits comptés
                </CardTitle>
              </CardHeader>
              <CardContent className='px-4 pb-4'>
                <div className='text-xl font-bold text-slate-900'>
                  {sLines.length}
                </div>
                <p className='text-xs text-slate-500'>
                  {missingLinesCount} manquant(s) • {surplusLinesCount}{' '}
                  excédent(s)
                </p>
              </CardContent>
            </Card>

            {showFinancials && (
              <Card className='border-slate-200 bg-white shadow-none'>
                <CardHeader className='pb-1 pt-4 px-4'>
                  <CardTitle className='text-xs font-medium uppercase tracking-wider text-slate-500'>
                    Écart total en valeur
                  </CardTitle>
                </CardHeader>
                <CardContent className='px-4 pb-4'>
                  <div
                    className={`text-xl font-bold tabular-nums ${
                      totalValueDiff < 0
                        ? 'text-red-700'
                        : totalValueDiff > 0
                          ? 'text-blue-700'
                          : 'text-slate-900'
                    }`}
                  >
                    {totalValueDiff > 0 ? '+' : ''}
                    {formatMAD(totalValueDiff)}
                  </div>
                  <p className='text-xs text-slate-500'>
                    Valorisé au prix moyen pondéré
                  </p>
                </CardContent>
              </Card>
            )}

            <Card className='border-slate-200 bg-white shadow-none'>
              <CardHeader className='pb-1 pt-4 px-4'>
                <CardTitle className='text-xs font-medium uppercase tracking-wider text-slate-500'>
                  Traçabilité
                </CardTitle>
              </CardHeader>
              <CardContent className='px-4 pb-4 text-xs text-slate-600 space-y-1'>
                <div>
                  Créé par :{' '}
                  <strong className='text-slate-900'>
                    {activeSession.created_by_name ||
                      activeSession.confirmed_by_name ||
                      activeSession.confirmed_by ||
                      '—'}
                  </strong>
                </div>
                <div>
                  Confirmé par :{' '}
                  <strong className='text-slate-900'>
                    {activeSession.confirmed_by_name ||
                      activeSession.confirmed_by ||
                      '—'}
                  </strong>{' '}
                  ({formatDateTimeFR(activeSession.confirmed_at)})
                </div>
                {activeSession.status === 'reversed' && (
                  <div className='text-red-700'>
                    Contre-passé par{' '}
                    <strong>
                      {activeSession.reversed_by_name ||
                        activeSession.reversed_by}
                    </strong>{' '}
                    : « {activeSession.reversal_reason} »
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card className='border-slate-200 bg-white shadow-none print:hidden'>
            <CardContent className='p-4 flex flex-wrap items-center gap-3'>
              <div className='relative flex-1 min-w-[220px]'>
                <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-slate-400' />
                <Input
                  placeholder='Rechercher par référence ou produit...'
                  value={detailSearch}
                  onChange={(e) => setDetailSearch(e.target.value)}
                  className='pl-9 h-9 bg-white'
                />
              </div>

              <Select
                value={detailStatusFilter}
                onValueChange={setDetailStatusFilter}
              >
                <SelectTrigger className='h-9 w-48 bg-white'>
                  <SelectValue placeholder='Statut d’écart' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>Tous les statuts</SelectItem>
                  <SelectItem value='Manquant'>Manquant</SelectItem>
                  <SelectItem value='Excédent'>Excédent</SelectItem>
                  <SelectItem value='OK'>OK (Aucun écart)</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Detail Lines Table */}
          <Card className='border-slate-200 bg-white shadow-none overflow-hidden'>
            <CardContent className='p-0'>
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader className='bg-slate-50/90'>
                    <TableRow>
                      <TableHead className='text-xs font-semibold'>
                        Référence
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Produit
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Catégorie
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Unité
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Stock théorique
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Stock réel compté
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Écart
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Statut
                      </TableHead>
                      {showFinancials && (
                        <TableHead className='text-right text-xs font-semibold'>
                          Valeur de l’écart
                        </TableHead>
                      )}
                      <TableHead className='text-xs font-semibold'>
                        Commentaire
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDetailLines.map(
                      ({ line, prod, varianceStatus }) => (
                        <TableRow key={line.id}>
                          <TableCell className='py-2 font-mono text-xs font-semibold text-slate-700'>
                            {prod ? (
                              <button
                                type='button'
                                onClick={() => openProductDetail(prod.id)}
                                className='hover:underline'
                              >
                                {prod.ref}
                              </button>
                            ) : (
                              line.product
                            )}
                          </TableCell>
                          <TableCell className='py-2 text-sm font-medium text-slate-900'>
                            {prod ? (
                              <button
                                type='button'
                                onClick={() => openProductDetail(prod.id)}
                                className='hover:underline text-left'
                              >
                                {prod.name}
                              </button>
                            ) : (
                              'Produit inconnu'
                            )}
                          </TableCell>
                          <TableCell className='py-2 text-xs text-slate-600'>
                            {prod?.category || 'Sans catégorie'}
                          </TableCell>
                          <TableCell className='py-2 text-xs text-slate-600'>
                            {prod?.unit || 'u'}
                          </TableCell>
                          <TableCell className='py-2 text-right font-mono text-xs tabular-nums'>
                            {formatNumberFR(line.theoretical)}
                          </TableCell>
                          <TableCell className='py-2 text-right font-mono text-sm font-bold tabular-nums'>
                            {formatNumberFR(line.counted)}
                          </TableCell>
                          <TableCell className='py-2 text-right font-mono text-xs font-semibold tabular-nums'>
                            <span
                              className={
                                line.diff < 0
                                  ? 'text-red-700'
                                  : line.diff > 0
                                    ? 'text-blue-700'
                                    : 'text-emerald-700'
                              }
                            >
                              {line.diff > 0 ? '+' : ''}
                              {formatNumberFR(line.diff)}
                            </span>
                          </TableCell>
                          <TableCell className='py-2'>
                            {varianceStatus === 'OK' && (
                              <Badge
                                variant='outline'
                                className='border-emerald-300 bg-emerald-50 text-emerald-700 text-xs'
                              >
                                OK
                              </Badge>
                            )}
                            {varianceStatus === 'Manquant' && (
                              <Badge
                                variant='outline'
                                className='border-red-300 bg-red-50 text-red-700 text-xs'
                              >
                                Manquant
                              </Badge>
                            )}
                            {varianceStatus === 'Excédent' && (
                              <Badge
                                variant='outline'
                                className='border-blue-300 bg-blue-50 text-blue-700 text-xs'
                              >
                                Excédent
                              </Badge>
                            )}
                          </TableCell>
                          {showFinancials && (
                            <TableCell className='py-2 text-right font-mono text-xs tabular-nums'>
                              {line.value_diff === null ||
                              line.value_diff === undefined ? (
                                <Badge
                                  variant='outline'
                                  className='border-amber-300 bg-amber-50 text-amber-800 text-[11px]'
                                >
                                  Prix manquant
                                </Badge>
                              ) : (
                                <span
                                  className={
                                    line.value_diff < 0
                                      ? 'text-red-700 font-semibold'
                                      : line.value_diff > 0
                                        ? 'text-blue-700 font-semibold'
                                        : 'text-slate-600'
                                  }
                                >
                                  {line.value_diff > 0 ? '+' : ''}
                                  {formatMAD(line.value_diff)}
                                </span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className='py-2 text-xs text-slate-600'>
                            {line.comment || '—'}
                          </TableCell>
                        </TableRow>
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Reversal Dialog */}
          <Dialog open={reverseDialogOpen} onOpenChange={setReverseDialogOpen}>
            <DialogContent className='max-w-md'>
              <DialogHeader>
                <DialogTitle>
                  Contre-passer la session d’inventaire du{' '}
                  {formatDateDDMMYYYY(activeSession.date)}
                </DialogTitle>
                <DialogDescription>
                  Cette action annule l’effet de cette session d’inventaire sur
                  le calcul des stocks tout en conservant son historique complet
                  dans le journal d’audit.
                </DialogDescription>
              </DialogHeader>
              <div className='space-y-2'>
                <Label htmlFor='rev-reason' className='text-xs font-semibold'>
                  Motif obligatoire de la contre-passation
                </Label>
                <Textarea
                  id='rev-reason'
                  placeholder='Ex : Erreur de date de comptage, double saisie...'
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  rows={3}
                />
              </div>
              <DialogFooter>
                <Button
                  variant='outline'
                  onClick={() => setReverseDialogOpen(false)}
                >
                  Annuler
                </Button>
                <Button
                  variant='destructive'
                  disabled={reversingSession || !reverseReason.trim()}
                  onClick={() => void handleReverseSession()}
                >
                  {reversingSession
                    ? 'Contre-passation...'
                    : 'Confirmer la contre-passation'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Main>
      </>
    )
  }

  // ============================================================================
  // VIEW 4: DEFAULT SESSIONS LIST / HISTORY PAGE
  // ============================================================================
  return (
    <>
      <Header fixed>
        <div className='hidden items-center gap-2 text-xs text-muted-foreground md:flex'>
          <span className='font-medium uppercase tracking-wider'>
            Opérations
          </span>
          <span aria-hidden='true'>/</span>
          <span className='font-medium text-foreground'>Inventaires</span>
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
              Inventaires physiques
            </h1>
            <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
              Historique des sessions de comptage, feuilles d’inventaire
              imprimables et validation des écarts.
            </p>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setMode('print_sheet')}
              className='bg-white'
            >
              <Printer className='mr-1.5 h-4 w-4' />
              Imprimer la feuille de comptage
            </Button>

            {canCreateOrEditDraft && (
              <Button size='sm' onClick={() => setStartDialogOpen(true)}>
                <Plus className='mr-1.5 h-4 w-4' />
                Nouvel inventaire
              </Button>
            )}
          </div>
        </div>

        <Card className='border-slate-200 bg-white shadow-none overflow-hidden'>
          <CardHeader className='border-b border-slate-100 px-6 py-4'>
            <CardTitle className='text-base font-semibold text-slate-900'>
              Sessions d’inventaire ({sessions.length})
            </CardTitle>
            <CardDescription className='text-xs'>
              Les inventaires confirmés sont verrouillés en lecture seule et
              servent de référence datée au moteur de stock.
            </CardDescription>
          </CardHeader>
          <CardContent className='p-0'>
            {loading ? (
              <div className='p-6 space-y-3'>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className='h-12 w-full' />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-14 px-4 text-center'>
                <ClipboardList className='h-10 w-10 text-slate-300 mb-2' />
                <h3 className='text-sm font-semibold text-slate-900'>
                  Aucune session d’inventaire enregistrée
                </h3>
                <p className='mt-1 max-w-md text-xs text-slate-500'>
                  Démarrez un nouvel inventaire pour compter vos produits et
                  établir une nouvelle référence de stock datée, ou imprimez une
                  feuille de comptage papier.
                </p>
                {canCreateOrEditDraft && (
                  <Button
                    size='sm'
                    className='mt-4'
                    onClick={() => setStartDialogOpen(true)}
                  >
                    <Plus className='mr-1.5 h-4 w-4' />
                    Nouvel inventaire
                  </Button>
                )}
              </div>
            ) : (
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader className='bg-slate-50/80'>
                    <TableRow>
                      <TableHead className='text-xs font-semibold'>
                        Date
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Portée
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Statut
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Nombre de produits comptés
                      </TableHead>
                      {showFinancials && (
                        <TableHead className='text-right text-xs font-semibold'>
                          Écart total en valeur
                        </TableHead>
                      )}
                      <TableHead className='text-xs font-semibold'>
                        Créé par
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Confirmé par
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Action
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((session) => {
                      const sLines = linesBySession.get(session.id) ?? []
                      const totalValueDiff = roundCurrency(
                        sLines.reduce((sum, l) => sum + (l.value_diff ?? 0), 0)
                      )

                      return (
                        <TableRow
                          key={session.id}
                          className='cursor-pointer hover:bg-slate-50/80'
                          onClick={() => openSession(session)}
                        >
                          <TableCell className='py-3 font-medium text-sm text-slate-900 whitespace-nowrap'>
                            {formatDateDDMMYYYY(session.date)}
                          </TableCell>
                          <TableCell className='py-3 text-xs text-slate-700'>
                            <div className='font-medium'>
                              {session.scope === 'full'
                                ? 'Inventaire complet'
                                : `Catégories : ${session.category || '—'}`}
                            </div>
                            {session.location && (
                              <div className='text-[11px] text-slate-500'>
                                Emplacement : {session.location}
                              </div>
                            )}
                            {session.notes && (
                              <div className='text-[11px] text-slate-400 truncate max-w-xs'>
                                {session.notes}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className='py-3 whitespace-nowrap'>
                            {session.status === 'draft' && (
                              <Badge
                                variant='outline'
                                className='border-amber-300 bg-amber-50 text-amber-800'
                              >
                                Brouillon
                              </Badge>
                            )}
                            {session.status === 'confirmed' && (
                              <Badge
                                variant='outline'
                                className='border-emerald-300 bg-emerald-50 text-emerald-700'
                              >
                                Confirmé
                              </Badge>
                            )}
                            {session.status === 'reversed' && (
                              <Badge
                                variant='outline'
                                className='border-red-300 bg-red-50 text-red-700'
                              >
                                Contre-passé
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className='py-3 text-right font-mono text-sm font-semibold tabular-nums'>
                            {sLines.length}
                          </TableCell>
                          {showFinancials && (
                            <TableCell className='py-3 text-right font-mono text-xs font-semibold tabular-nums whitespace-nowrap'>
                              {sLines.length === 0 ? (
                                <span className='text-slate-400'>—</span>
                              ) : (
                                <span
                                  className={
                                    totalValueDiff < 0
                                      ? 'text-red-700'
                                      : totalValueDiff > 0
                                        ? 'text-blue-700'
                                        : 'text-slate-700'
                                  }
                                >
                                  {totalValueDiff > 0 ? '+' : ''}
                                  {formatMAD(totalValueDiff)}
                                </span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className='py-3 text-xs text-slate-600'>
                            {session.created_by_name ||
                              session.confirmed_by_name ||
                              session.confirmed_by ||
                              '—'}
                          </TableCell>
                          <TableCell className='py-3 text-xs text-slate-600'>
                            {session.status === 'confirmed' ||
                            session.status === 'reversed' ? (
                              <div>
                                <div className='font-medium text-slate-800'>
                                  {session.confirmed_by_name ||
                                    session.confirmed_by ||
                                    '—'}
                                </div>
                                {session.confirmed_at && (
                                  <div className='text-[11px] text-slate-400'>
                                    {formatDateDDMMYYYY(session.confirmed_at)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className='text-slate-400'>En attente</span>
                            )}
                          </TableCell>
                          <TableCell className='py-3 text-right'>
                            <Button
                              variant='ghost'
                              size='sm'
                              className='h-8 text-xs'
                              onClick={(e) => {
                                e.stopPropagation()
                                openSession(session)
                              }}
                            >
                              {session.status === 'draft' &&
                              canCreateOrEditDraft ? (
                                <>
                                  <ClipboardCheck className='mr-1.5 h-3.5 w-3.5 text-amber-700' />
                                  Reprendre
                                </>
                              ) : (
                                <>
                                  <Eye className='mr-1.5 h-3.5 w-3.5' />
                                  Consulter
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Start New Inventory Modal */}
        <Dialog open={startDialogOpen} onOpenChange={setStartDialogOpen}>
          <DialogContent className='max-w-lg'>
            <DialogHeader>
              <DialogTitle>Démarrer un nouvel inventaire</DialogTitle>
              <DialogDescription>
                Choisissez la date et la portée de la session. L’inventaire sera
                enregistré en brouillon jusqu’à sa confirmation.
              </DialogDescription>
            </DialogHeader>

            <div className='space-y-4'>
              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-1.5'>
                  <Label htmlFor='inv-date' className='text-xs font-semibold'>
                    Date de l’inventaire
                  </Label>
                  <Input
                    id='inv-date'
                    type='date'
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs font-semibold'>Portée</Label>
                  <Select
                    value={newScope}
                    onValueChange={(v) => setNewScope(v as InventoryScope)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='full'>Inventaire complet</SelectItem>
                      <SelectItem value='category'>Par catégorie(s)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {newScope === 'category' && (
                <div className='space-y-2 rounded-md border border-slate-200 p-3'>
                  <Label className='text-xs font-semibold'>
                    Sélectionnez une ou plusieurs catégories :
                  </Label>
                  <div className='grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pt-1'>
                    {allCategories.map((cat) => {
                      const checked = selectedCategories.includes(cat)
                      return (
                        <label
                          key={cat}
                          className='flex items-center space-x-2 text-xs cursor-pointer'
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              if (v) {
                                setSelectedCategories((prev) => [...prev, cat])
                              } else {
                                setSelectedCategories((prev) =>
                                  prev.filter((c) => c !== cat)
                                )
                              }
                            }}
                          />
                          <span className='truncate'>{cat}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className='space-y-1.5'>
                <Label className='text-xs font-semibold'>
                  Filtre d’emplacement (optionnel)
                </Label>
                <Select value={newLocation} onValueChange={setNewLocation}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>Tous les emplacements</SelectItem>
                    {allLocations.map((loc) => (
                      <SelectItem key={loc} value={loc}>
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-1.5'>
                <Label htmlFor='inv-notes' className='text-xs font-semibold'>
                  Nom ou note de session (optionnel)
                </Label>
                <Input
                  id='inv-notes'
                  placeholder='Ex : Inventaire de fin de mois, Contrôle réserve sèche...'
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setStartDialogOpen(false)}
              >
                Annuler
              </Button>
              <Button
                onClick={() => void handleStartNewSession()}
                disabled={creatingSession}
              >
                <ClipboardCheck className='mr-1.5 h-4 w-4' />
                {creatingSession
                  ? 'Création...'
                  : 'Ouvrir l’écran de comptage'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}

export const InventairesPage = Inventaires
