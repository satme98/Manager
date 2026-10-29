import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Info,
  Package,
  RefreshCw,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  Truck,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import { repository } from '@/data'
import {
  invalidateDashboardAnalyticsCache,
  type ChartGranularity,
  type DashboardRangePreset,
  type PeriodTrend,
} from '@/data/analytics'
import type { StockStatusLabel } from '@/data/types'
import {
  formatDateFR,
  formatDateTimeFR,
  formatMAD,
  formatQuantity,
} from '@/lib/formatters'
import { canPerformCollectionAction } from '@/lib/rbac'
import { useAuthStore } from '@/stores/auth-store'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search as GlobalSearch } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const RANGE_PRESET_OPTIONS: Array<{
  value: DashboardRangePreset
  label: string
}> = [
  { value: 'today', label: "Aujourd'hui" },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: 'this_month', label: 'Ce mois' },
  { value: 'last_month', label: 'Mois dernier' },
  { value: 'this_year', label: 'Cette année' },
  { value: 'custom', label: 'Personnalisé' },
]

const CATEGORY_COLORS = [
  '#303030',
  '#008060',
  '#2C6ECB',
  '#B98900',
  '#8C6239',
  '#5C6AC4',
  '#00A0AC',
  '#6D7175',
]

function navigateToFilteredUrl(path: string, params?: Record<string, string>) {
  if (typeof window === 'undefined') return
  const search = params ? new URLSearchParams(params).toString() : ''
  const target = search ? `${path}?${search}` : path
  window.history.pushState({}, '', target)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// ============================================================================
// ISOLATED WIDGET ERROR BOUNDARY (One failing widget never breaks the page)
// ============================================================================

interface WidgetBoundaryProps {
  title: string
  onRetry: () => void
  children: ReactNode
}

interface WidgetBoundaryState {
  hasError: boolean
  errorMessage: string
}

class WidgetErrorBoundary extends Component<
  WidgetBoundaryProps,
  WidgetBoundaryState
> {
  constructor(props: WidgetBoundaryProps) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error: Error): WidgetBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erreur lors du calcul de ce module.',
    }
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Isolated widget failure
  }

  handleRetryClick = () => {
    this.setState({ hasError: false, errorMessage: '' })
    this.props.onRetry()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className='flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-6 text-center'>
          <AlertCircle className='mb-2 h-6 w-6 text-[#D72C0D]' />
          <p className='text-sm font-semibold text-[#202223]'>
            Impossible d’afficher « {this.props.title} »
          </p>
          <p className='mt-1 max-w-sm text-xs text-[#6D7175]'>
            {this.state.errorMessage}
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={this.handleRetryClick}
            className='mt-3 border-[#E1E3E5] text-[#202223]'
          >
            <RefreshCw className='mr-1.5 h-3.5 w-3.5' />
            Réessayer
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

function WidgetEmptyState({
  message,
  subMessage,
  actionLabel,
  actionTo,
}: {
  message: string
  subMessage?: string
  actionLabel?: string
  actionTo?: string
}) {
  return (
    <div className='flex min-h-[200px] flex-col items-center justify-center rounded-md border border-dashed border-[#E1E3E5] bg-[#F6F6F7]/60 px-4 py-6 text-center'>
      <p className='text-xs font-medium text-[#202223]'>{message}</p>
      {subMessage && (
        <p className='mt-1 max-w-xs text-[11px] text-[#6D7175]'>{subMessage}</p>
      )}
      {actionLabel && actionTo && (
        <Button
          asChild
          variant='outline'
          size='sm'
          className='mt-3 h-7 border-[#E1E3E5] bg-[#FFFFFF] text-xs text-[#202223]'
        >
          <Link to={actionTo}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  )
}

function TrendBadge({
  trend,
  invertSentiment = false,
}: {
  trend: PeriodTrend | null
  invertSentiment?: boolean
}) {
  if (!trend) return null
  const isUp = trend.direction === 'up'
  const isDown = trend.direction === 'down'
  const sign = trend.percentChange > 0 ? '+' : ''
  const formattedPct = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(trend.percentChange)

  // For losses, an increase is critical (#D72C0D) and a decrease is positive (#008060)
  const colorClass =
    trend.direction === 'flat'
      ? 'text-[#6D7175]'
      : invertSentiment
        ? isUp
          ? 'text-[#D72C0D]'
          : 'text-[#008060]'
        : isUp
          ? 'text-[#202223]'
          : 'text-[#008060]'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${colorClass}`}
        >
          {isUp && <ArrowUpRight className='h-3 w-3' />}
          {isDown && <ArrowDownRight className='h-3 w-3' />}
          {sign}
          {formattedPct} % vs pér. préc.
        </span>
      </TooltipTrigger>
      <TooltipContent className='border-[#E1E3E5] bg-[#202223] text-xs text-white'>
        Période précédente ({trend.previousPeriodLabel}) :{' '}
        {formatMAD(trend.previousValue)}
      </TooltipContent>
    </Tooltip>
  )
}

function ReversedExcludedFootnote() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex cursor-help items-center gap-1 text-[11px] text-[#6D7175]'>
          <Info className='h-3 w-3 text-[#6D7175]' />
          <span className='hidden sm:inline'>Hors annulés</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className='border-[#E1E3E5] bg-[#202223] text-xs text-white'>
        Les documents annulés sont exclus
      </TooltipContent>
    </Tooltip>
  )
}

export function Dashboard() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.auth.user)
  const role = user?.role ?? 'consultation'
  const isCuisine = role === 'cuisine'
  const isEconomat = role === 'economat'
  const canEditProducts = canPerformCollectionAction(role, 'products', 'update')

  // URL-synced date range state (default = 'this_month')
  const [rangePreset, setRangePreset] = useState<DashboardRangePreset>(() => {
    if (typeof window === 'undefined') return 'this_month'
    const p = new URLSearchParams(window.location.search).get(
      'range'
    ) as DashboardRangePreset | null
    const validPresets: DashboardRangePreset[] = [
      'today',
      '7d',
      '30d',
      'this_month',
      'last_month',
      'this_year',
      'custom',
    ]
    return p && validPresets.includes(p) ? p : 'this_month'
  })

  const [customFrom, setCustomFrom] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('from') || ''
  })

  const [customTo, setCustomTo] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('to') || ''
  })

  // Keep selected date range in URL
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    params.set('range', rangePreset)
    if (rangePreset === 'custom') {
      if (customFrom) params.set('from', customFrom)
      else params.delete('from')
      if (customTo) params.set('to', customTo)
      else params.delete('to')
    } else {
      params.delete('from')
      params.delete('to')
    }
    const nextUrl = `${window.location.pathname}?${params.toString()}`
    window.history.replaceState({}, '', nextUrl)
  }, [rangePreset, customFrom, customTo])

  // Chart local toggles
  const [purchasesGranularity, setPurchasesGranularity] =
    useState<ChartGranularity>('day')
  const [purchasesChartType, setPurchasesChartType] = useState<'bar' | 'line'>(
    'bar'
  )
  const [categoryViewMode, setCategoryViewMode] = useState<'bars' | 'donut'>(
    'bars'
  )
  const [topConsumedMetric, setTopConsumedMetric] = useState<'qty' | 'value'>(
    'qty'
  )
  const [lossesGranularity, setLossesGranularity] =
    useState<ChartGranularity>('day')

  // Inline min_stock editor inside Priority Actions panel
  const [editingMinProductId, setEditingMinProductId] = useState<string | null>(
    null
  )
  const [editingMinVal, setEditingMinVal] = useState<string>('')
  const [savingInlineMin, setSavingInlineMin] = useState(false)

  // Query Dashboard Analytics from Repository / Server layer
  const {
    data: analytics,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: [
      'dashboard-analytics',
      role,
      rangePreset,
      customFrom,
      customTo,
    ],
    queryFn: () =>
      repository.getDashboardAnalytics({
        preset: rangePreset,
        customFrom: rangePreset === 'custom' ? customFrom : null,
        customTo: rangePreset === 'custom' ? customTo : null,
        role,
      }),
  })

  const handleManualRefresh = async () => {
    invalidateDashboardAnalyticsCache()
    await refetch()
    toast.success('Tableau de bord actualisé.')
  }

  const handleSaveInlineMinStock = async (productId: string, name: string) => {
    const parsed = Number(editingMinVal.replace(',', '.'))
    if (Number.isNaN(parsed) || parsed <= 0) {
      toast.error('Veuillez saisir un stock minimum strictement positif.')
      return
    }
    try {
      setSavingInlineMin(true)
      await repository.updateProduct(productId, { min_stock: parsed })
      invalidateDashboardAnalyticsCache()
      await queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(`Stock minimum défini pour « ${name} » (${parsed}).`)
      setEditingMinProductId(null)
      setEditingMinVal('')
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la mise à jour du stock minimum.'
      )
    } finally {
      setSavingInlineMin(false)
    }
  }

  const purchasesEvolutionData =
    purchasesGranularity === 'day'
      ? (analytics?.charts.purchasesEvolution.byDay ?? [])
      : purchasesGranularity === 'week'
        ? (analytics?.charts.purchasesEvolution.byWeek ?? [])
        : (analytics?.charts.purchasesEvolution.byMonth ?? [])

  const lossesEvolutionData =
    lossesGranularity === 'day'
      ? (analytics?.charts.lossesEvolution.byDay ?? [])
      : lossesGranularity === 'week'
        ? (analytics?.charts.lossesEvolution.byWeek ?? [])
        : (analytics?.charts.lossesEvolution.byMonth ?? [])

  const topConsumedData =
    isCuisine || topConsumedMetric === 'qty'
      ? (analytics?.charts.topConsumedProducts.byQuantity ?? [])
      : (analytics?.charts.topConsumedProducts.byValue ?? [])

  const vatLabel = analytics?.vatConvention ?? 'TTC'
  const periodFrom = analytics?.range.from ?? ''
  const periodTo = analytics?.range.to ?? ''

  return (
    <TooltipProvider delayDuration={150}>
      <Header fixed>
        <GlobalSearch />
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main className='min-h-[calc(100vh-4rem)] bg-[#F6F6F7] pb-12'>
        {/* ================================================================ */}
        {/* 1. HEADER: Title, Date-Range Filter, Last Updated & Refresh      */}
        {/* ================================================================ */}
        <div className='mb-6 flex flex-col gap-4 border-b border-[#E1E3E5] pb-4 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <div className='flex items-center gap-2.5'>
              <h1 className='text-xl font-semibold tracking-tight text-[#202223]'>
                Tableau de bord
              </h1>
              {isCuisine && (
                <Badge
                  variant='outline'
                  className='border-[#E1E3E5] bg-[#FFFFFF] text-xs font-medium text-[#6D7175]'
                >
                  Vue Cuisine (Quantités & Statuts)
                </Badge>
              )}
              {role === 'consultation' && (
                <Badge
                  variant='outline'
                  className='border-[#E1E3E5] bg-[#FFFFFF] text-xs font-medium text-[#6D7175]'
                >
                  Lecture seule
                </Badge>
              )}
            </div>
            <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6D7175]'>
              <span>
                Période active :{' '}
                <strong className='font-medium text-[#202223]'>
                  {analytics?.range.label ?? 'Ce mois'}
                </strong>
              </span>
              <span>•</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className='inline-flex cursor-help items-center gap-1 underline decoration-dotted'>
                    <Info className='h-3 w-3' />
                    Les documents annulés sont exclus
                  </span>
                </TooltipTrigger>
                <TooltipContent className='border-[#E1E3E5] bg-[#202223] text-xs text-white'>
                  Les documents annulés et leurs contre-passations sont exclus de
                  tous les totaux et graphiques.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            {/* Date Range Selector */}
            <div className='flex items-center gap-1.5 rounded-md border border-[#E1E3E5] bg-[#FFFFFF] px-2.5 py-1'>
              <Calendar className='h-3.5 w-3.5 text-[#6D7175]' />
              <Select
                value={rangePreset}
                onValueChange={(v) => setRangePreset(v as DashboardRangePreset)}
              >
                <SelectTrigger className='h-7 w-[145px] border-0 bg-transparent px-1 text-xs font-medium text-[#202223] shadow-none focus:ring-0'>
                  <SelectValue placeholder='Période' />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_PRESET_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      className='text-xs'
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {rangePreset === 'custom' && (
              <div className='flex items-center gap-1.5 rounded-md border border-[#E1E3E5] bg-[#FFFFFF] px-2 py-1'>
                <span className='text-[11px] text-[#6D7175]'>Du</span>
                <Input
                  type='date'
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className='h-7 w-[128px] border-[#E1E3E5] px-2 text-xs'
                />
                <span className='text-[11px] text-[#6D7175]'>au</span>
                <Input
                  type='date'
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className='h-7 w-[128px] border-[#E1E3E5] px-2 text-xs'
                />
              </div>
            )}

            {/* Dernière mise à jour + Refresh button */}
            <div className='flex items-center gap-2 rounded-md border border-[#E1E3E5] bg-[#FFFFFF] px-3 py-1.5 text-xs text-[#6D7175]'>
              <Clock className='h-3.5 w-3.5 text-[#6D7175]' />
              <span>
                Dernière mise à jour :{' '}
                <strong className='font-medium text-[#202223]'>
                  {analytics?.generatedAt
                    ? formatDateTimeFR(analytics.generatedAt)
                    : '—'}
                </strong>
              </span>
              <Button
                variant='ghost'
                size='sm'
                onClick={handleManualRefresh}
                disabled={isFetching}
                className='h-6 px-2 text-xs font-medium text-[#202223] hover:bg-[#F6F6F7]'
                title='Actualiser les données'
              >
                <RefreshCw
                  className={`mr-1 h-3 w-3 ${isFetching ? 'animate-spin' : ''}`}
                />
                Actualiser
              </Button>
            </div>
          </div>
        </div>

        {/* Top-level Error Banner if query fails completely */}
        {isError && (
          <div className='mb-6 flex items-center justify-between rounded-lg border border-[#D72C0D]/40 bg-[#FFFFFF] p-4'>
            <div className='flex items-center gap-3'>
              <AlertCircle className='h-5 w-5 text-[#D72C0D]' />
              <div>
                <p className='text-sm font-semibold text-[#202223]'>
                  Erreur lors du chargement du tableau de bord
                </p>
                <p className='text-xs text-[#6D7175]'>
                  {error instanceof Error
                    ? error.message
                    : 'Une erreur inattendue est survenue.'}
                </p>
              </div>
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={() => refetch()}
              className='border-[#E1E3E5] text-xs text-[#202223]'
            >
              <RefreshCw className='mr-1.5 h-3.5 w-3.5' />
              Réessayer
            </Button>
          </div>
        )}

        {/* ================================================================ */}
        {/* 2. KPI ROW (6 CARDS on Desktop, 3+3 Tablet, 2-col Mobile)        */}
        {/* ================================================================ */}
        {isLoading ? (
          <div className='mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className='rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'
              >
                <Skeleton className='h-3.5 w-28' />
                <Skeleton className='mt-3 h-6 w-24' />
                <Skeleton className='mt-2 h-3 w-20' />
              </div>
            ))}
          </div>
        ) : isCuisine ? (
          /* CUISINE SIMPLIFIED KPI ROW (Quantities & Statuses ONLY — zero prices/values) */
          <div className='mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
            {/* Card 1: Produits en alerte */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/etat-des-stocks', { status: 'Alerte' })
              }
              className='cursor-pointer rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div className='flex items-center justify-between'>
                <span className='text-xs font-medium text-[#6D7175]'>
                  Produits en alerte
                </span>
                <AlertTriangle
                  className={`h-4 w-4 ${
                    (analytics?.kpis.alertProducts.alertCount ?? 0) > 0
                      ? 'text-[#D72C0D]'
                      : 'text-[#6D7175]'
                  }`}
                />
              </div>
              {analytics?.kpis.alertProducts.hasData ? (
                <p
                  className={`mt-2 text-lg font-semibold tabular-nums ${
                    analytics.kpis.alertProducts.alertCount > 0
                      ? 'text-[#D72C0D]'
                      : 'text-[#008060]'
                  }`}
                >
                  {analytics.kpis.alertProducts.alertCount} produit
                  {analytics.kpis.alertProducts.alertCount > 1 ? 's' : ''}
                </p>
              ) : (
                <p className='mt-2 text-xs text-[#6D7175]'>Aucun produit</p>
              )}
              <p className='mt-1 text-[11px] text-[#6D7175]'>
                {analytics?.kpis.alertProducts.periodLabel}
              </p>
            </div>

            {/* Card 2: Produits à surveiller */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/etat-des-stocks', {
                  status: 'À surveiller',
                })
              }
              className='cursor-pointer rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div className='flex items-center justify-between'>
                <span className='text-xs font-medium text-[#6D7175]'>
                  À surveiller
                </span>
                <Clock className='h-4 w-4 text-[#B98900]' />
              </div>
              {analytics?.kpis.alertProducts.hasData ? (
                <p className='mt-2 text-lg font-semibold text-[#B98900] tabular-nums'>
                  {analytics.kpis.alertProducts.watchCount} produit
                  {analytics.kpis.alertProducts.watchCount > 1 ? 's' : ''}
                </p>
              ) : (
                <p className='mt-2 text-xs text-[#6D7175]'>Aucun produit</p>
              )}
              <p className='mt-1 text-[11px] text-[#6D7175]'>
                Seuil &le; 150 % du min.
              </p>
            </div>

            {/* Card 3: Stock OK */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/etat-des-stocks', { status: 'OK' })
              }
              className='cursor-pointer rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div className='flex items-center justify-between'>
                <span className='text-xs font-medium text-[#6D7175]'>
                  Produits en stock OK
                </span>
                <CheckCircle2 className='h-4 w-4 text-[#008060]' />
              </div>
              {analytics?.kpis.alertProducts.hasData ? (
                <p className='mt-2 text-lg font-semibold text-[#008060] tabular-nums'>
                  {analytics.kpis.alertProducts.okCount} produit
                  {analytics.kpis.alertProducts.okCount > 1 ? 's' : ''}
                </p>
              ) : (
                <p className='mt-2 text-xs text-[#6D7175]'>Aucun produit</p>
              )}
              <p className='mt-1 text-[11px] text-[#6D7175]'>
                Sur {analytics?.kpis.alertProducts.activeProductsCount ?? 0}{' '}
                actifs
              </p>
            </div>

            {/* Card 4: Sans stock minimum */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/etat-des-stocks', {
                  missingMin: 'true',
                })
              }
              className='cursor-pointer rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div className='flex items-center justify-between'>
                <span className='text-xs font-medium text-[#6D7175]'>
                  Sans stock minimum
                </span>
                <Package className='h-4 w-4 text-[#6D7175]' />
              </div>
              {analytics?.kpis.alertProducts.hasData ? (
                <p className='mt-2 text-lg font-semibold text-[#202223] tabular-nums'>
                  {analytics.kpis.alertProducts.undefinedMinCount} produit
                  {analytics.kpis.alertProducts.undefinedMinCount > 1
                    ? 's'
                    : ''}
                </p>
              ) : (
                <p className='mt-2 text-xs text-[#6D7175]'>Aucun produit</p>
              )}
              <p className='mt-1 text-[11px] text-[#6D7175]'>
                Statut « À définir »
              </p>
            </div>

            {/* Card 5: Sorties de la période (Quantité) */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/sorties-de-stock', {
                  from: periodFrom,
                  to: periodTo,
                })
              }
              className='cursor-pointer rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div className='flex items-center justify-between'>
                <span className='text-xs font-medium text-[#6D7175]'>
                  Sorties (période)
                </span>
                <Boxes className='h-4 w-4 text-[#202223]' />
              </div>
              {analytics?.kpis.periodExits.hasData ? (
                <p className='mt-2 text-lg font-semibold text-[#202223] tabular-nums'>
                  {analytics.kpis.periodExits.documentsCount} bon
                  {analytics.kpis.periodExits.documentsCount > 1 ? 's' : ''}
                </p>
              ) : (
                <p className='mt-2 text-xs text-[#6D7175]'>
                  Aucune sortie sur la période
                </p>
              )}
              <p className='mt-1 text-[11px] text-[#6D7175]'>
                {analytics?.kpis.periodExits.periodLabel}
              </p>
            </div>

            {/* Card 6: Pertes déclarées (Quantité) */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/sorties-de-stock', {
                  from: periodFrom,
                  to: periodTo,
                  filter: 'with_losses',
                })
              }
              className='cursor-pointer rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div className='flex items-center justify-between'>
                <span className='text-xs font-medium text-[#6D7175]'>
                  Pertes (période)
                </span>
                <TrendingDown className='h-4 w-4 text-[#D72C0D]' />
              </div>
              {analytics?.kpis.periodLosses.hasData ? (
                <p
                  className={`mt-2 text-lg font-semibold tabular-nums ${
                    analytics.kpis.periodLosses.eventsCount > 0
                      ? 'text-[#D72C0D]'
                      : 'text-[#202223]'
                  }`}
                >
                  {analytics.kpis.periodLosses.eventsCount} ligne
                  {analytics.kpis.periodLosses.eventsCount > 1 ? 's' : ''}
                </p>
              ) : (
                <p className='mt-2 text-xs text-[#6D7175]'>
                  Aucune perte sur la période
                </p>
              )}
              <p className='mt-1 text-[11px] text-[#6D7175]'>
                {analytics?.kpis.periodLosses.periodLabel}
              </p>
            </div>
          </div>
        ) : (
          /* STANDARD 6 KPI CARDS ROW (Admin, Manager, Économat, Consultation) */
          <div className='mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
            {/* KPI 1: Valeur totale du stock */}
            <div
              onClick={() => navigateToFilteredUrl('/etat-des-stocks')}
              className='group flex cursor-pointer flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div>
                <div className='flex items-center justify-between gap-1'>
                  <span className='text-xs font-medium text-[#6D7175]'>
                    Valeur totale du stock
                  </span>
                  <Boxes className='h-4 w-4 shrink-0 text-[#6D7175] group-hover:text-[#202223]' />
                </div>
                {analytics?.kpis.stockValue.hasData ? (
                  <p className='mt-2 text-lg font-semibold text-[#202223] tabular-nums'>
                    {formatMAD(analytics.kpis.stockValue.value)}
                  </p>
                ) : (
                  <p className='mt-2 text-xs font-medium text-[#6D7175]'>
                    Aucun produit en stock
                  </p>
                )}
              </div>
              <div className='mt-2 flex flex-col gap-1 border-t border-[#E1E3E5]/60 pt-2'>
                <span className='text-[11px] text-[#6D7175]'>
                  {analytics?.kpis.stockValue.periodLabel} •{' '}
                  {analytics?.kpis.stockValue.activeProductsCount ?? 0} réf.
                </span>
                {(analytics?.kpis.stockValue.missingPriceCount ?? 0) > 0 && (
                  <button
                    type='button'
                    onClick={(e) => {
                      e.stopPropagation()
                      navigateToFilteredUrl('/etat-des-stocks', {
                        priceMissing: 'true',
                      })
                    }}
                    className='inline-flex items-center gap-1 text-left text-[11px] font-medium text-[#B98900] hover:underline'
                  >
                    <AlertTriangle className='h-3 w-3 shrink-0 text-[#B98900]' />
                    {analytics?.kpis.stockValue.missingPriceCount} avec « Prix
                    manquant »
                  </button>
                )}
              </div>
            </div>

            {/* KPI 2: Achats de la période */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/entrees-de-stock', {
                  from: periodFrom,
                  to: periodTo,
                })
              }
              className='group flex cursor-pointer flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div>
                <div className='flex items-center justify-between gap-1'>
                  <span className='text-xs font-medium text-[#6D7175]'>
                    Achats ({vatLabel})
                  </span>
                  <Truck className='h-4 w-4 shrink-0 text-[#6D7175] group-hover:text-[#202223]' />
                </div>
                {analytics?.kpis.periodPurchases.hasData ? (
                  <p className='mt-2 text-lg font-semibold text-[#202223] tabular-nums'>
                    {formatMAD(analytics.kpis.periodPurchases.value)}
                  </p>
                ) : (
                  <p className='mt-2 text-xs font-medium text-[#6D7175]'>
                    Aucun achat sur la période
                  </p>
                )}
              </div>
              <div className='mt-2 flex flex-col gap-1 border-t border-[#E1E3E5]/60 pt-2'>
                <span className='truncate text-[11px] text-[#6D7175]'>
                  {analytics?.kpis.periodPurchases.periodLabel}
                </span>
                <TrendBadge
                  trend={analytics?.kpis.periodPurchases.trend ?? null}
                />
              </div>
            </div>

            {/* KPI 3: Factures impayées */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/factures-paiements', {
                  status: 'unpaid',
                })
              }
              className='group flex cursor-pointer flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div>
                <div className='flex items-center justify-between gap-1'>
                  <span className='text-xs font-medium text-[#6D7175]'>
                    Factures impayées ({vatLabel})
                  </span>
                  <AlertCircle
                    className={`h-4 w-4 shrink-0 ${
                      (analytics?.kpis.unpaidInvoices.invoicesCount ?? 0) > 0
                        ? 'text-[#B98900]'
                        : 'text-[#6D7175]'
                    }`}
                  />
                </div>
                {analytics?.kpis.unpaidInvoices.hasData ? (
                  <p
                    className={`mt-2 text-lg font-semibold tabular-nums ${
                      (analytics?.kpis.unpaidInvoices.invoicesCount ?? 0) > 0
                        ? 'text-[#B98900]'
                        : 'text-[#008060]'
                    }`}
                  >
                    {formatMAD(analytics.kpis.unpaidInvoices.totalAmount)}
                  </p>
                ) : (
                  <p className='mt-2 text-xs font-medium text-[#6D7175]'>
                    Aucune facture enregistrée
                  </p>
                )}
              </div>
              <div className='mt-2 flex flex-col gap-1 border-t border-[#E1E3E5]/60 pt-2'>
                <span className='text-[11px] text-[#6D7175]'>
                  {analytics?.kpis.unpaidInvoices.hasData
                    ? `${analytics.kpis.unpaidInvoices.invoicesCount} facture${
                        analytics.kpis.unpaidInvoices.invoicesCount > 1
                          ? 's'
                          : ''
                      } • Toutes périodes`
                    : 'Toutes périodes'}
                </span>
              </div>
            </div>

            {/* KPI 4: Produits en alerte */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/etat-des-stocks', { status: 'Alerte' })
              }
              className='group flex cursor-pointer flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div>
                <div className='flex items-center justify-between gap-1'>
                  <span className='text-xs font-medium text-[#6D7175]'>
                    Produits en alerte
                  </span>
                  <AlertTriangle
                    className={`h-4 w-4 shrink-0 ${
                      (analytics?.kpis.alertProducts.alertCount ?? 0) > 0
                        ? 'text-[#D72C0D]'
                        : 'text-[#008060]'
                    }`}
                  />
                </div>
                {analytics?.kpis.alertProducts.hasData ? (
                  <p
                    className={`mt-2 text-lg font-semibold tabular-nums ${
                      analytics.kpis.alertProducts.alertCount > 0
                        ? 'text-[#D72C0D]'
                        : 'text-[#008060]'
                    }`}
                  >
                    {analytics.kpis.alertProducts.alertCount} produit
                    {analytics.kpis.alertProducts.alertCount > 1 ? 's' : ''}
                  </p>
                ) : (
                  <p className='mt-2 text-xs font-medium text-[#6D7175]'>
                    Aucun produit configuré
                  </p>
                )}
              </div>
              <div className='mt-2 flex flex-col gap-1 border-t border-[#E1E3E5]/60 pt-2'>
                <span className='text-[11px] text-[#6D7175]'>
                  {analytics?.kpis.alertProducts.hasData
                    ? `${analytics.kpis.alertProducts.watchCount} à surveiller • Temps réel`
                    : 'Temps réel'}
                </span>
              </div>
            </div>

            {/* KPI 5: Valeur des pertes */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/pertes-gaspillage', {
                  from: periodFrom,
                  to: periodTo,
                })
              }
              className='group flex cursor-pointer flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div>
                <div className='flex items-center justify-between gap-1'>
                  <span className='text-xs font-medium text-[#6D7175]'>
                    Valeur des pertes
                  </span>
                  <TrendingDown
                    className={`h-4 w-4 shrink-0 ${
                      (analytics?.kpis.periodLosses.value ?? 0) > 0
                        ? 'text-[#D72C0D]'
                        : 'text-[#6D7175]'
                    }`}
                  />
                </div>
                {analytics?.kpis.periodLosses.hasData ? (
                  <p
                    className={`mt-2 text-lg font-semibold tabular-nums ${
                      (analytics.kpis.periodLosses.value ?? 0) > 0
                        ? 'text-[#D72C0D]'
                        : 'text-[#202223]'
                    }`}
                  >
                    {formatMAD(analytics.kpis.periodLosses.value)}
                  </p>
                ) : (
                  <p className='mt-2 text-xs font-medium text-[#6D7175]'>
                    Aucune perte sur la période
                  </p>
                )}
              </div>
              <div className='mt-2 flex flex-col gap-1 border-t border-[#E1E3E5]/60 pt-2'>
                <span className='truncate text-[11px] text-[#6D7175]'>
                  {analytics?.kpis.periodLosses.periodLabel}
                </span>
                <TrendBadge
                  trend={analytics?.kpis.periodLosses.trend ?? null}
                  invertSentiment
                />
              </div>
            </div>

            {/* KPI 6: Valeur des sorties */}
            <div
              onClick={() =>
                navigateToFilteredUrl('/sorties-de-stock', {
                  from: periodFrom,
                  to: periodTo,
                })
              }
              className='group flex cursor-pointer flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-3.5 transition-colors hover:border-[#303030]'
            >
              <div>
                <div className='flex items-center justify-between gap-1'>
                  <span className='text-xs font-medium text-[#6D7175]'>
                    Valeur des sorties
                  </span>
                  <TrendingUp className='h-4 w-4 shrink-0 text-[#6D7175] group-hover:text-[#202223]' />
                </div>
                {analytics?.kpis.periodExits.hasData ? (
                  <p className='mt-2 text-lg font-semibold text-[#202223] tabular-nums'>
                    {formatMAD(analytics.kpis.periodExits.value)}
                  </p>
                ) : (
                  <p className='mt-2 text-xs font-medium text-[#6D7175]'>
                    Aucune sortie sur la période
                  </p>
                )}
              </div>
              <div className='mt-2 flex flex-col gap-1 border-t border-[#E1E3E5]/60 pt-2'>
                <span className='truncate text-[11px] text-[#6D7175]'>
                  {analytics?.kpis.periodExits.periodLabel}
                </span>
                <TrendBadge trend={analytics?.kpis.periodExits.trend ?? null} />
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions Bar for Cuisine role */}
        {isCuisine && (
          <div className='mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
            <div>
              <h2 className='text-sm font-semibold text-[#202223]'>
                Actions rapides Cuisine
              </h2>
              <p className='text-xs text-[#6D7175]'>
                Enregistrez les sorties quotidiennes, déclarez une perte ou
                consultez les disponibilités en stock.
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                onClick={() =>
                  navigateToFilteredUrl('/sorties-de-stock', { mode: 'new' })
                }
                size='sm'
                className='bg-[#303030] text-xs text-white hover:bg-[#202223]'
              >
                Nouvelle sortie / perte
              </Button>
              <Button
                asChild
                variant='outline'
                size='sm'
                className='border-[#E1E3E5] text-xs text-[#202223]'
              >
                <Link to='/etat-des-stocks'>Consulter l’état des stocks</Link>
              </Button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* 3. ACTIONS PRIORITAIRES PANEL                                    */}
        {/* ================================================================ */}
        <div className='mb-6 rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
          <div className='mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#E1E3E5] pb-3'>
            <div>
              <h2 className='text-sm font-semibold text-[#202223]'>
                Actions prioritaires
              </h2>
              <p className='text-xs text-[#6D7175]'>
                Points d’attention opérationnels nécessitant une vérification ou
                une action immédiate.
              </p>
            </div>
            <ReversedExcludedFootnote />
          </div>

          {isLoading ? (
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
              {Array.from({ length: isCuisine ? 2 : 6 }).map((_, i) => (
                <Skeleton key={i} className='h-40 w-full rounded-md' />
              ))}
            </div>
          ) : (
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
              {/* Priority 1: Produits à réapprovisionner */}
              <div className='flex flex-col justify-between rounded-md border border-[#E1E3E5] bg-[#F6F6F7]/40 p-3.5'>
                <div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-xs font-semibold text-[#202223]'>
                      Produits à réapprovisionner
                    </span>
                    <Badge
                      variant='outline'
                      className={
                        (analytics?.priorityActions.restockAlerts.totalCount ??
                          0) > 0
                          ? 'border-[#D72C0D]/40 bg-[#FFF4F4] text-[#D72C0D]'
                          : 'border-[#E1E3E5] bg-[#FFFFFF] text-[#008060]'
                      }
                    >
                      {analytics?.priorityActions.restockAlerts.totalCount ?? 0}
                    </Badge>
                  </div>

                  {(analytics?.priorityActions.restockAlerts.items.length ??
                    0) === 0 ? (
                    <div className='my-6 flex items-center justify-center gap-1.5 text-xs text-[#008060]'>
                      <CheckCircle2 className='h-4 w-4' />
                      <span>Rien à faire — aucun produit en alerte</span>
                    </div>
                  ) : (
                    <ul className='mt-2.5 divide-y divide-[#E1E3E5] text-xs'>
                      {analytics?.priorityActions.restockAlerts.items.map(
                        (item) => (
                          <li
                            key={item.productId}
                            className='flex items-center justify-between py-1.5'
                          >
                            <div className='min-w-0 pr-2'>
                              <span className='font-mono text-[11px] text-[#6D7175]'>
                                {item.ref}
                              </span>{' '}
                              <span className='font-medium text-[#202223]'>
                                {item.name}
                              </span>
                            </div>
                            <span className='shrink-0 font-semibold text-[#D72C0D] tabular-nums'>
                              {formatQuantity(item.stock, item.unit)} / min{' '}
                              {formatQuantity(item.minStock, item.unit)}
                            </span>
                          </li>
                        )
                      )}
                    </ul>
                  )}
                </div>
                <div className='mt-3 border-t border-[#E1E3E5] pt-2.5'>
                  <Button
                    asChild
                    variant='outline'
                    size='sm'
                    className='h-7 w-full justify-between border-[#E1E3E5] bg-[#FFFFFF] text-xs text-[#202223]'
                  >
                    <Link to='/reapprovisionnement'>
                      <span>Ouvrir Réapprovisionnement</span>
                      <ArrowRight className='h-3.5 w-3.5' />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Priority 2: Produits sans stock minimum défini (with inline fix) */}
              <div className='flex flex-col justify-between rounded-md border border-[#E1E3E5] bg-[#F6F6F7]/40 p-3.5'>
                <div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-xs font-semibold text-[#202223]'>
                      Produits sans stock minimum défini
                    </span>
                    <Badge
                      variant='outline'
                      className={
                        (analytics?.priorityActions.missingMinStock
                          .totalCount ?? 0) > 0
                          ? 'border-[#B98900]/40 bg-[#FFF8E6] text-[#B98900]'
                          : 'border-[#E1E3E5] bg-[#FFFFFF] text-[#008060]'
                      }
                    >
                      {analytics?.priorityActions.missingMinStock.totalCount ??
                        0}
                    </Badge>
                  </div>

                  {(analytics?.priorityActions.missingMinStock.items.length ??
                    0) === 0 ? (
                    <div className='my-6 flex items-center justify-center gap-1.5 text-xs text-[#008060]'>
                      <CheckCircle2 className='h-4 w-4' />
                      <span>Rien à faire — tous les seuils sont définis</span>
                    </div>
                  ) : (
                    <ul className='mt-2.5 divide-y divide-[#E1E3E5] text-xs'>
                      {analytics?.priorityActions.missingMinStock.items.map(
                        (item) => (
                          <li
                            key={item.productId}
                            className='flex items-center justify-between gap-2 py-1.5'
                          >
                            <div className='min-w-0 truncate'>
                              <span className='font-mono text-[11px] text-[#6D7175]'>
                                {item.ref}
                              </span>{' '}
                              <span className='font-medium text-[#202223]'>
                                {item.name}
                              </span>
                            </div>
                            {canEditProducts &&
                            editingMinProductId === item.productId ? (
                              <div className='flex shrink-0 items-center gap-1'>
                                <Input
                                  type='number'
                                  min='0.01'
                                  step='any'
                                  placeholder='Min'
                                  value={editingMinVal}
                                  onChange={(e) =>
                                    setEditingMinVal(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      handleSaveInlineMinStock(
                                        item.productId,
                                        item.name
                                      )
                                    } else if (e.key === 'Escape') {
                                      setEditingMinProductId(null)
                                    }
                                  }}
                                  className='h-6 w-16 border-[#E1E3E5] bg-[#FFFFFF] px-1.5 text-xs'
                                  autoFocus
                                />
                                <Button
                                  size='sm'
                                  disabled={savingInlineMin}
                                  onClick={() =>
                                    handleSaveInlineMinStock(
                                      item.productId,
                                      item.name
                                    )
                                  }
                                  className='h-6 bg-[#303030] px-1.5 text-white'
                                >
                                  <Check className='h-3 w-3' />
                                </Button>
                              </div>
                            ) : canEditProducts ? (
                              <button
                                type='button'
                                onClick={() => {
                                  setEditingMinProductId(item.productId)
                                  setEditingMinVal('')
                                }}
                                className='shrink-0 rounded border border-[#E1E3E5] bg-[#FFFFFF] px-2 py-0.5 text-[11px] font-medium text-[#202223] hover:bg-[#F6F6F7]'
                              >
                                Définir min.
                              </button>
                            ) : (
                              <span className='text-[11px] text-[#6D7175]'>
                                À définir
                              </span>
                            )}
                          </li>
                        )
                      )}
                    </ul>
                  )}
                </div>
                <div className='mt-3 border-t border-[#E1E3E5] pt-2.5'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() =>
                      navigateToFilteredUrl('/etat-des-stocks', {
                        missingMin: 'true',
                      })
                    }
                    className='h-7 w-full justify-between border-[#E1E3E5] bg-[#FFFFFF] text-xs text-[#202223]'
                  >
                    <span>Voir la liste filtrée</span>
                    <ArrowRight className='h-3.5 w-3.5' />
                  </Button>
                </div>
              </div>

              {/* Financial Priority Items (Hidden for Cuisine) */}
              {!isCuisine && (
                <>
                  {/* Priority 3: Factures impayées les plus anciennes */}
                  <div className='flex flex-col justify-between rounded-md border border-[#E1E3E5] bg-[#F6F6F7]/40 p-3.5'>
                    <div>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='text-xs font-semibold text-[#202223]'>
                          Factures impayées les plus anciennes
                        </span>
                        <Badge
                          variant='outline'
                          className={
                            (analytics?.priorityActions.oldestUnpaidInvoices
                              .totalCount ?? 0) > 0
                              ? 'border-[#B98900]/40 bg-[#FFF8E6] text-[#B98900]'
                              : 'border-[#E1E3E5] bg-[#FFFFFF] text-[#008060]'
                          }
                        >
                          {analytics?.priorityActions.oldestUnpaidInvoices
                            .totalCount ?? 0}
                        </Badge>
                      </div>

                      {(analytics?.priorityActions.oldestUnpaidInvoices.items
                        .length ?? 0) === 0 ? (
                        <div className='my-6 flex items-center justify-center gap-1.5 text-xs text-[#008060]'>
                          <CheckCircle2 className='h-4 w-4' />
                          <span>Rien à faire — aucune facture impayée</span>
                        </div>
                      ) : (
                        <ul className='mt-2.5 divide-y divide-[#E1E3E5] text-xs'>
                          {analytics?.priorityActions.oldestUnpaidInvoices.items.map(
                            (inv) => (
                              <li
                                key={inv.purchaseId}
                                className='flex items-center justify-between py-1.5'
                              >
                                <div className='min-w-0 pr-2'>
                                  <p className='truncate font-medium text-[#202223]'>
                                    {inv.supplierName}{' '}
                                    <span className='font-normal text-[#6D7175]'>
                                      ({inv.invoiceNo})
                                    </span>
                                  </p>
                                  <p className='text-[11px] text-[#6D7175]'>
                                    {formatDateFR(inv.date)} •{' '}
                                    <span className='text-[#D72C0D]'>
                                      {inv.daysOverdue} j
                                    </span>
                                  </p>
                                </div>
                                <span className='shrink-0 font-semibold text-[#202223] tabular-nums'>
                                  {formatMAD(inv.amount)}
                                </span>
                              </li>
                            )
                          )}
                        </ul>
                      )}
                    </div>
                    <div className='mt-3 border-t border-[#E1E3E5] pt-2.5'>
                      <Button
                        asChild
                        variant='outline'
                        size='sm'
                        className='h-7 w-full justify-between border-[#E1E3E5] bg-[#FFFFFF] text-xs text-[#202223]'
                      >
                        <Link to='/factures-paiements'>
                          <span>Gérer Factures & Paiements</span>
                          <ArrowRight className='h-3.5 w-3.5' />
                        </Link>
                      </Button>
                    </div>
                  </div>

                  {/* Priority 4: Écarts d'inventaire à vérifier */}
                  <div className='flex flex-col justify-between rounded-md border border-[#E1E3E5] bg-[#F6F6F7]/40 p-3.5'>
                    <div>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='text-xs font-semibold text-[#202223]'>
                          Écarts d’inventaire à vérifier
                        </span>
                        <Badge
                          variant='outline'
                          className={
                            (analytics?.priorityActions
                              .inventoryVariancesToVerify.totalCount ?? 0) > 0
                              ? 'border-[#D72C0D]/40 bg-[#FFF4F4] text-[#D72C0D]'
                              : 'border-[#E1E3E5] bg-[#FFFFFF] text-[#008060]'
                          }
                        >
                          {analytics?.priorityActions.inventoryVariancesToVerify
                            .totalCount ?? 0}
                        </Badge>
                      </div>

                      {(analytics?.priorityActions.inventoryVariancesToVerify
                        .items.length ?? 0) === 0 ? (
                        <div className='my-6 flex items-center justify-center gap-1.5 text-xs text-[#008060]'>
                          <CheckCircle2 className='h-4 w-4' />
                          <span>Rien à faire — aucun écart majeur</span>
                        </div>
                      ) : (
                        <ul className='mt-2.5 divide-y divide-[#E1E3E5] text-xs'>
                          {analytics?.priorityActions.inventoryVariancesToVerify.items.map(
                            (v) => (
                              <li
                                key={v.lineId}
                                className='flex items-center justify-between py-1.5'
                              >
                                <div className='min-w-0 pr-2'>
                                  <span className='font-mono text-[11px] text-[#6D7175]'>
                                    {v.ref}
                                  </span>{' '}
                                  <span className='font-medium text-[#202223]'>
                                    {v.name}
                                  </span>
                                </div>
                                <span
                                  className={`shrink-0 font-semibold tabular-nums ${
                                    v.diff < 0
                                      ? 'text-[#D72C0D]'
                                      : 'text-[#008060]'
                                  }`}
                                >
                                  {v.diff > 0 ? '+' : ''}
                                  {formatQuantity(v.diff, v.unit)}
                                  {v.valueDiff !== null
                                    ? ` (${formatMAD(v.valueDiff)})`
                                    : ''}
                                </span>
                              </li>
                            )
                          )}
                        </ul>
                      )}
                    </div>
                    <div className='mt-3 border-t border-[#E1E3E5] pt-2.5'>
                      <Button
                        asChild
                        variant='outline'
                        size='sm'
                        className='h-7 w-full justify-between border-[#E1E3E5] bg-[#FFFFFF] text-xs text-[#202223]'
                      >
                        <Link to='/inventaires'>
                          <span>Consulter les inventaires</span>
                          <ArrowRight className='h-3.5 w-3.5' />
                        </Link>
                      </Button>
                    </div>
                  </div>

                  {/* Priority 5: Produits sans prix (Prix manquant) */}
                  <div className='flex flex-col justify-between rounded-md border border-[#E1E3E5] bg-[#F6F6F7]/40 p-3.5'>
                    <div>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='text-xs font-semibold text-[#202223]'>
                          Produits sans prix (Prix manquant)
                        </span>
                        <Badge
                          variant='outline'
                          className={
                            (analytics?.priorityActions.missingPriceProducts
                              .totalCount ?? 0) > 0
                              ? 'border-[#B98900]/40 bg-[#FFF8E6] text-[#B98900]'
                              : 'border-[#E1E3E5] bg-[#FFFFFF] text-[#008060]'
                          }
                        >
                          {analytics?.priorityActions.missingPriceProducts
                            .totalCount ?? 0}
                        </Badge>
                      </div>

                      {(analytics?.priorityActions.missingPriceProducts.items
                        .length ?? 0) === 0 ? (
                        <div className='my-6 flex items-center justify-center gap-1.5 text-xs text-[#008060]'>
                          <CheckCircle2 className='h-4 w-4' />
                          <span>Rien à faire — tous les produits ont un coût</span>
                        </div>
                      ) : (
                        <ul className='mt-2.5 divide-y divide-[#E1E3E5] text-xs'>
                          {analytics?.priorityActions.missingPriceProducts.items.map(
                            (p) => (
                              <li
                                key={p.productId}
                                className='flex items-center justify-between py-1.5'
                              >
                                <div className='min-w-0 truncate pr-2'>
                                  <span className='font-mono text-[11px] text-[#6D7175]'>
                                    {p.ref}
                                  </span>{' '}
                                  <span className='font-medium text-[#202223]'>
                                    {p.name}
                                  </span>
                                </div>
                                <span className='shrink-0 text-[11px] font-medium text-[#B98900]'>
                                  Prix manquant
                                </span>
                              </li>
                            )
                          )}
                        </ul>
                      )}
                    </div>
                    <div className='mt-3 border-t border-[#E1E3E5] pt-2.5'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() =>
                          navigateToFilteredUrl('/etat-des-stocks', {
                            priceMissing: 'true',
                          })
                        }
                        className='h-7 w-full justify-between border-[#E1E3E5] bg-[#FFFFFF] text-xs text-[#202223]'
                      >
                        <span>Filtrer dans État des stocks</span>
                        <ArrowRight className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  </div>

                  {/* Priority 6: Entrées ou sorties en attente d'approbation (Admin / Manager / Consultation) */}
                  {!isEconomat && (
                    <div className='flex flex-col justify-between rounded-md border border-[#E1E3E5] bg-[#F6F6F7]/40 p-3.5'>
                      <div>
                        <div className='flex items-center justify-between gap-2'>
                          <span className='text-xs font-semibold text-[#202223]'>
                            Entrées ou sorties en attente d’approbation
                          </span>
                          <Badge
                            variant='outline'
                            className={
                              (analytics?.priorityActions.pendingApprovals
                                .totalCount ?? 0) > 0
                                ? 'border-[#D72C0D]/40 bg-[#FFF4F4] text-[#D72C0D]'
                                : 'border-[#E1E3E5] bg-[#FFFFFF] text-[#008060]'
                            }
                          >
                            {analytics?.priorityActions.pendingApprovals
                              .totalCount ?? 0}
                          </Badge>
                        </div>

                        {(analytics?.priorityActions.pendingApprovals.items
                          .length ?? 0) === 0 ? (
                          <div className='my-6 flex items-center justify-center gap-1.5 text-xs text-[#008060]'>
                            <CheckCircle2 className='h-4 w-4' />
                            <span>
                              Rien à faire — aucune approbation en attente
                            </span>
                          </div>
                        ) : (
                          <ul className='mt-2.5 divide-y divide-[#E1E3E5] text-xs'>
                            {analytics?.priorityActions.pendingApprovals.items.map(
                              (item) => (
                                <li
                                  key={item.id}
                                  className='flex items-center justify-between py-1.5'
                                >
                                  <div className='min-w-0 pr-2'>
                                    <p className='truncate font-medium text-[#202223]'>
                                      {item.label}
                                    </p>
                                    <p className='truncate text-[11px] text-[#6D7175]'>
                                      Par {item.requestedBy} • {item.reason}
                                    </p>
                                  </div>
                                  <Button
                                    variant='outline'
                                    size='sm'
                                    onClick={() =>
                                      navigateToFilteredUrl(item.linkTo, {
                                        doc: item.id,
                                      })
                                    }
                                    className='h-6 shrink-0 border-[#E1E3E5] px-2 text-[11px]'
                                  >
                                    Examiner
                                  </Button>
                                </li>
                              )
                            )}
                          </ul>
                        )}
                      </div>
                      <div className='mt-3 border-t border-[#E1E3E5] pt-2.5'>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() =>
                            navigateToFilteredUrl('/entrees-de-stock', {
                              correction: 'pending_approval',
                            })
                          }
                          className='h-7 w-full justify-between border-[#E1E3E5] bg-[#FFFFFF] text-xs text-[#202223]'
                        >
                          <span>Voir les demandes de correction</span>
                          <ArrowRight className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* ================================================================ */}
        {/* 4. ANALYTICS GRID (2-column desktop, 1-2 tablet, stacked mobile) */}
        {/* ================================================================ */}
        <div className='mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2'>
          {/* WIDGET 1: Évolution des achats (Financial roles only) */}
          {!isCuisine && (
            <WidgetErrorBoundary
              title='Évolution des achats'
              onRetry={() => refetch()}
            >
              <div className='flex flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
                <div className='mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[#E1E3E5] pb-3'>
                  <div>
                    <div className='flex items-center gap-2'>
                      <h3 className='text-sm font-semibold text-[#202223]'>
                        Évolution des achats ({vatLabel})
                      </h3>
                      <ReversedExcludedFootnote />
                    </div>
                    <p className='text-xs text-[#6D7175]'>
                      {analytics?.range.shortPeriodLabel ?? 'Période active'}
                    </p>
                  </div>
                  <div className='flex flex-wrap items-center gap-1.5'>
                    <div className='inline-flex rounded border border-[#E1E3E5] bg-[#F6F6F7] p-0.5'>
                      {(
                        [
                          { k: 'day', l: 'Jour' },
                          { k: 'week', l: 'Semaine' },
                          { k: 'month', l: 'Mois' },
                        ] as const
                      ).map((g) => (
                        <button
                          key={g.k}
                          type='button'
                          onClick={() => setPurchasesGranularity(g.k)}
                          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                            purchasesGranularity === g.k
                              ? 'bg-[#FFFFFF] text-[#202223] shadow-xs'
                              : 'text-[#6D7175] hover:text-[#202223]'
                          }`}
                        >
                          {g.l}
                        </button>
                      ))}
                    </div>
                    <div className='inline-flex rounded border border-[#E1E3E5] bg-[#F6F6F7] p-0.5'>
                      <button
                        type='button'
                        onClick={() => setPurchasesChartType('bar')}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          purchasesChartType === 'bar'
                            ? 'bg-[#FFFFFF] text-[#202223] shadow-xs'
                            : 'text-[#6D7175]'
                        }`}
                      >
                        Barres
                      </button>
                      <button
                        type='button'
                        onClick={() => setPurchasesChartType('line')}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          purchasesChartType === 'line'
                            ? 'bg-[#FFFFFF] text-[#202223] shadow-xs'
                            : 'text-[#6D7175]'
                        }`}
                      >
                        Courbe
                      </button>
                    </div>
                    <Link
                      to='/rapports'
                      className='ms-1 text-xs font-medium text-[#202223] hover:underline'
                    >
                      Voir le rapport →
                    </Link>
                  </div>
                </div>

                {isLoading ? (
                  <Skeleton className='h-[240px] w-full' />
                ) : !analytics?.charts.purchasesEvolution.hasData ||
                  purchasesEvolutionData.length === 0 ? (
                  <WidgetEmptyState
                    message='Aucun achat enregistré sur cette période'
                    subMessage='Sélectionnez une autre période ou enregistrez une entrée de stock.'
                    actionLabel='Nouvelle entrée'
                    actionTo='/entrees-de-stock'
                  />
                ) : (
                  <div className='h-[240px] w-full'>
                    <ResponsiveContainer width='100%' height='100%'>
                      {purchasesChartType === 'bar' ? (
                        <BarChart
                          data={purchasesEvolutionData}
                          margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                        >
                          <CartesianGrid
                            strokeDasharray='3 3'
                            stroke='#E1E3E5'
                            vertical={false}
                          />
                          <XAxis
                            dataKey='label'
                            tick={{ fontSize: 11, fill: '#6D7175' }}
                            axisLine={{ stroke: '#E1E3E5' }}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: '#6D7175' }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `${v} DH`}
                          />
                          <RechartsTooltip
                            formatter={(val) => [
                              formatMAD(Number(val ?? 0)),
                              `Montant (${vatLabel})`,
                            ]}
                            contentStyle={{
                              backgroundColor: '#FFFFFF',
                              borderColor: '#E1E3E5',
                              borderRadius: '6px',
                              fontSize: '12px',
                            }}
                          />
                          <Bar
                            dataKey='amount'
                            name={`Achats (${vatLabel})`}
                            fill='#303030'
                            radius={[3, 3, 0, 0]}
                          />
                        </BarChart>
                      ) : (
                        <LineChart
                          data={purchasesEvolutionData}
                          margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                        >
                          <CartesianGrid
                            strokeDasharray='3 3'
                            stroke='#E1E3E5'
                            vertical={false}
                          />
                          <XAxis
                            dataKey='label'
                            tick={{ fontSize: 11, fill: '#6D7175' }}
                            axisLine={{ stroke: '#E1E3E5' }}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: '#6D7175' }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `${v} DH`}
                          />
                          <RechartsTooltip
                            formatter={(val) => [
                              formatMAD(Number(val ?? 0)),
                              `Montant (${vatLabel})`,
                            ]}
                            contentStyle={{
                              backgroundColor: '#FFFFFF',
                              borderColor: '#E1E3E5',
                              borderRadius: '6px',
                              fontSize: '12px',
                            }}
                          />
                          <Line
                            type='monotone'
                            dataKey='amount'
                            name={`Achats (${vatLabel})`}
                            stroke='#303030'
                            strokeWidth={2}
                            dot={{ r: 3, fill: '#303030' }}
                          />
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </WidgetErrorBoundary>
          )}

          {/* WIDGET 2: Valeur du stock par catégorie (Financial roles only) */}
          {!isCuisine && (
            <WidgetErrorBoundary
              title='Valeur du stock par catégorie'
              onRetry={() => refetch()}
            >
              <div className='flex flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
                <div className='mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[#E1E3E5] pb-3'>
                  <div>
                    <h3 className='text-sm font-semibold text-[#202223]'>
                      Valeur du stock par catégorie
                    </h3>
                    <p className='text-xs text-[#6D7175]'>
                      Valorisation actuelle par famille issue de la base produits
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <div className='inline-flex rounded border border-[#E1E3E5] bg-[#F6F6F7] p-0.5'>
                      <button
                        type='button'
                        onClick={() => setCategoryViewMode('bars')}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          categoryViewMode === 'bars'
                            ? 'bg-[#FFFFFF] text-[#202223] shadow-xs'
                            : 'text-[#6D7175]'
                        }`}
                      >
                        Barres
                      </button>
                      <button
                        type='button'
                        onClick={() => setCategoryViewMode('donut')}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          categoryViewMode === 'donut'
                            ? 'bg-[#FFFFFF] text-[#202223] shadow-xs'
                            : 'text-[#6D7175]'
                        }`}
                      >
                        Anneau
                      </button>
                    </div>
                    <Link
                      to='/etat-des-stocks'
                      className='text-xs font-medium text-[#202223] hover:underline'
                    >
                      Voir le rapport →
                    </Link>
                  </div>
                </div>

                {isLoading ? (
                  <Skeleton className='h-[240px] w-full' />
                ) : !analytics?.charts.stockValueByCategory.hasData ||
                  analytics.charts.stockValueByCategory.items.length === 0 ? (
                  <WidgetEmptyState
                    message='Aucune catégorie valorisée disponible'
                    subMessage='Importez ou créez vos produits et achats pour afficher la répartition.'
                    actionLabel='Voir les produits'
                    actionTo='/produits'
                  />
                ) : categoryViewMode === 'bars' ? (
                  <div className='h-[240px] w-full'>
                    <ResponsiveContainer width='100%' height='100%'>
                      <BarChart
                        layout='vertical'
                        data={analytics.charts.stockValueByCategory.items.slice(
                          0,
                          8
                        )}
                        margin={{ top: 4, right: 16, left: 24, bottom: 4 }}
                      >
                        <CartesianGrid
                          strokeDasharray='3 3'
                          stroke='#E1E3E5'
                          horizontal={false}
                        />
                        <XAxis
                          type='number'
                          tick={{ fontSize: 11, fill: '#6D7175' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `${v} DH`}
                        />
                        <YAxis
                          type='category'
                          dataKey='category'
                          width={110}
                          tick={{ fontSize: 11, fill: '#202223' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <RechartsTooltip
                          formatter={(val) => [
                            formatMAD(Number(val ?? 0)),
                            'Valeur du stock',
                          ]}
                          contentStyle={{
                            backgroundColor: '#FFFFFF',
                            borderColor: '#E1E3E5',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                        />
                        <Bar
                          dataKey='stockValue'
                          name='Valeur du stock'
                          fill='#008060'
                          radius={[0, 3, 3, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className='h-[240px] w-full'>
                    <ResponsiveContainer width='100%' height='100%'>
                      <PieChart>
                        <Pie
                          data={analytics.charts.stockValueByCategory.items.slice(
                            0,
                            8
                          )}
                          dataKey='stockValue'
                          nameKey='category'
                          innerRadius={52}
                          outerRadius={82}
                          paddingAngle={2}
                        >
                          {analytics.charts.stockValueByCategory.items
                            .slice(0, 8)
                            .map((entry, idx) => (
                              <Cell
                                key={entry.category}
                                fill={
                                  CATEGORY_COLORS[idx % CATEGORY_COLORS.length]
                                }
                              />
                            ))}
                        </Pie>
                        <RechartsTooltip
                          formatter={(val) => [
                            formatMAD(Number(val ?? 0)),
                            'Valeur du stock',
                          ]}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: '11px', color: '#202223' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </WidgetErrorBoundary>
          )}

          {/* WIDGET 3: Produits les plus consommés (Top 10 by Quantity or Value) */}
          <WidgetErrorBoundary
            title='Produits les plus consommés'
            onRetry={() => refetch()}
          >
            <div className='flex flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
              <div className='mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[#E1E3E5] pb-3'>
                <div>
                  <div className='flex items-center gap-2'>
                    <h3 className='text-sm font-semibold text-[#202223]'>
                      Produits les plus consommés (Top 10)
                    </h3>
                    <ReversedExcludedFootnote />
                  </div>
                  <p className='text-xs text-[#6D7175]'>
                    {analytics?.range.shortPeriodLabel ?? 'Période active'}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  {!isCuisine && (
                    <div className='inline-flex rounded border border-[#E1E3E5] bg-[#F6F6F7] p-0.5'>
                      <button
                        type='button'
                        onClick={() => setTopConsumedMetric('qty')}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          topConsumedMetric === 'qty'
                            ? 'bg-[#FFFFFF] text-[#202223] shadow-xs'
                            : 'text-[#6D7175]'
                        }`}
                      >
                        Par quantité
                      </button>
                      <button
                        type='button'
                        onClick={() => setTopConsumedMetric('value')}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          topConsumedMetric === 'value'
                            ? 'bg-[#FFFFFF] text-[#202223] shadow-xs'
                            : 'text-[#6D7175]'
                        }`}
                      >
                        Par valeur
                      </button>
                    </div>
                  )}
                  <Link
                    to='/sorties-de-stock'
                    className='text-xs font-medium text-[#202223] hover:underline'
                  >
                    Voir le rapport →
                  </Link>
                </div>
              </div>

              {isLoading ? (
                <Skeleton className='h-[240px] w-full' />
              ) : !analytics?.charts.topConsumedProducts.hasData ||
                topConsumedData.length === 0 ? (
                <WidgetEmptyState
                  message='Aucune consommation enregistrée sur la période'
                  subMessage='Les produits sortis vers la cuisine ou le bar apparaîtront ici.'
                  actionLabel='Voir les sorties'
                  actionTo='/sorties-de-stock'
                />
              ) : (
                <div className='h-[240px] w-full'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart
                      layout='vertical'
                      data={topConsumedData}
                      margin={{ top: 4, right: 16, left: 24, bottom: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray='3 3'
                        stroke='#E1E3E5'
                        horizontal={false}
                      />
                      <XAxis
                        type='number'
                        tick={{ fontSize: 11, fill: '#6D7175' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type='category'
                        dataKey='name'
                        width={120}
                        tick={{ fontSize: 11, fill: '#202223' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <RechartsTooltip
                        formatter={(val) =>
                          isCuisine || topConsumedMetric === 'qty'
                            ? [formatQuantity(Number(val ?? 0)), 'Quantité consommée']
                            : [formatMAD(Number(val ?? 0)), 'Valeur consommée']
                        }
                        contentStyle={{
                          backgroundColor: '#FFFFFF',
                          borderColor: '#E1E3E5',
                          borderRadius: '6px',
                          fontSize: '12px',
                        }}
                      />
                      <Bar
                        dataKey={
                          isCuisine || topConsumedMetric === 'qty'
                            ? 'qtyConsumed'
                            : 'consumedValue'
                        }
                        name={
                          isCuisine || topConsumedMetric === 'qty'
                            ? 'Quantité sortie'
                            : 'Valeur sortie (DH)'
                        }
                        fill='#303030'
                        radius={[0, 3, 3, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </WidgetErrorBoundary>

          {/* WIDGET 4: Achats par fournisseur (Top 10, Financial roles only) */}
          {!isCuisine && (
            <WidgetErrorBoundary
              title='Achats par fournisseur'
              onRetry={() => refetch()}
            >
              <div className='flex flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
                <div className='mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[#E1E3E5] pb-3'>
                  <div>
                    <div className='flex items-center gap-2'>
                      <h3 className='text-sm font-semibold text-[#202223]'>
                        Achats par fournisseur (Top 10)
                      </h3>
                      <ReversedExcludedFootnote />
                    </div>
                    <p className='text-xs text-[#6D7175]'>
                      {analytics?.range.shortPeriodLabel ?? 'Période active'}
                    </p>
                  </div>
                  <Link
                    to='/fournisseurs'
                    className='text-xs font-medium text-[#202223] hover:underline'
                  >
                    Voir le rapport →
                  </Link>
                </div>

                {isLoading ? (
                  <Skeleton className='h-[240px] w-full' />
                ) : !analytics?.charts.purchasesBySupplier.hasData ||
                  analytics.charts.purchasesBySupplier.items.length === 0 ? (
                  <WidgetEmptyState
                    message='Aucun achat fournisseur sur cette période'
                    subMessage='Les volumes d’achats par fournisseur s’afficheront dès la première facture.'
                    actionLabel='Voir les fournisseurs'
                    actionTo='/fournisseurs'
                  />
                ) : (
                  <div className='h-[240px] w-full'>
                    <ResponsiveContainer width='100%' height='100%'>
                      <BarChart
                        layout='vertical'
                        data={analytics.charts.purchasesBySupplier.items}
                        margin={{ top: 4, right: 16, left: 24, bottom: 4 }}
                      >
                        <CartesianGrid
                          strokeDasharray='3 3'
                          stroke='#E1E3E5'
                          horizontal={false}
                        />
                        <XAxis
                          type='number'
                          tick={{ fontSize: 11, fill: '#6D7175' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `${v} DH`}
                        />
                        <YAxis
                          type='category'
                          dataKey='supplierName'
                          width={120}
                          tick={{ fontSize: 11, fill: '#202223' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <RechartsTooltip
                          formatter={(val) => [
                            formatMAD(Number(val ?? 0)),
                            `Achats (${vatLabel})`,
                          ]}
                          contentStyle={{
                            backgroundColor: '#FFFFFF',
                            borderColor: '#E1E3E5',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                        />
                        <Bar
                          dataKey='amount'
                          name={`Achats (${vatLabel})`}
                          fill='#303030'
                          radius={[0, 3, 3, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </WidgetErrorBoundary>
          )}

          {/* WIDGET 5: Répartition des statuts de stock (Clickable segments -> filter État des stocks) */}
          <WidgetErrorBoundary
            title='Répartition des statuts de stock'
            onRetry={() => refetch()}
          >
            <div className='flex flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
              <div className='mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[#E1E3E5] pb-3'>
                <div>
                  <h3 className='text-sm font-semibold text-[#202223]'>
                    Répartition des statuts de stock
                  </h3>
                  <p className='text-xs text-[#6D7175]'>
                    Cliquez sur un statut pour filtrer l’État des stocks
                  </p>
                </div>
                <Link
                  to='/etat-des-stocks'
                  className='text-xs font-medium text-[#202223] hover:underline'
                >
                  Voir le rapport →
                </Link>
              </div>

              {isLoading ? (
                <Skeleton className='h-[240px] w-full' />
              ) : !analytics?.charts.stockStatusDistribution.hasData ? (
                <WidgetEmptyState
                  message='Aucun produit actif dans le catalogue'
                  subMessage='Ajoutez ou importez vos articles pour suivre leurs statuts de stock.'
                  actionLabel='Catalogue Produits'
                  actionTo='/produits'
                />
              ) : (
                <div className='grid grid-cols-1 items-center gap-4 sm:grid-cols-2'>
                  <div className='h-[210px] w-full'>
                    <ResponsiveContainer width='100%' height='100%'>
                      <PieChart>
                        <Pie
                          data={analytics.charts.stockStatusDistribution.items}
                          dataKey='count'
                          nameKey='status'
                          innerRadius={48}
                          outerRadius={78}
                          paddingAngle={2}
                          onClick={(data) => {
                            const status = (
                              data as unknown as { status?: StockStatusLabel }
                            )?.status
                            if (status) {
                              navigateToFilteredUrl('/etat-des-stocks', {
                                status,
                              })
                            }
                          }}
                          className='cursor-pointer'
                        >
                          {analytics.charts.stockStatusDistribution.items.map(
                            (item) => (
                              <Cell key={item.status} fill={item.color} />
                            )
                          )}
                        </Pie>
                        <RechartsTooltip
                          formatter={(val, name) => [
                            `${val} produit${Number(val) > 1 ? 's' : ''}`,
                            String(name),
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className='space-y-2'>
                    {analytics.charts.stockStatusDistribution.items.map(
                      (item) => (
                        <button
                          key={item.status}
                          type='button'
                          onClick={() =>
                            navigateToFilteredUrl('/etat-des-stocks', {
                              status: item.status,
                            })
                          }
                          className='flex w-full items-center justify-between rounded-md border border-[#E1E3E5] bg-[#F6F6F7]/50 px-3 py-2 text-left text-xs transition-colors hover:border-[#303030] hover:bg-[#FFFFFF]'
                        >
                          <div className='flex items-center gap-2'>
                            <span
                              className='h-2.5 w-2.5 rounded-full'
                              style={{ backgroundColor: item.color }}
                            />
                            <span className='font-medium text-[#202223]'>
                              {item.status}
                            </span>
                          </div>
                          <div className='text-right tabular-nums'>
                            <span className='font-semibold text-[#202223]'>
                              {item.count}
                            </span>{' '}
                            <span className='text-[11px] text-[#6D7175]'>
                              ({item.sharePct} %)
                            </span>
                          </div>
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </WidgetErrorBoundary>

          {/* WIDGET 6: Évolution des pertes */}
          <WidgetErrorBoundary
            title='Évolution des pertes'
            onRetry={() => refetch()}
          >
            <div className='flex flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
              <div className='mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[#E1E3E5] pb-3'>
                <div>
                  <div className='flex items-center gap-2'>
                    <h3 className='text-sm font-semibold text-[#202223]'>
                      Évolution des pertes{' '}
                      {isCuisine ? '(Quantités)' : '(Valeur DH)'}
                    </h3>
                    <ReversedExcludedFootnote />
                  </div>
                  <p className='text-xs text-[#6D7175]'>
                    {analytics?.range.shortPeriodLabel ?? 'Période active'}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <div className='inline-flex rounded border border-[#E1E3E5] bg-[#F6F6F7] p-0.5'>
                    {(
                      [
                        { k: 'day', l: 'Jour' },
                        { k: 'week', l: 'Semaine' },
                        { k: 'month', l: 'Mois' },
                      ] as const
                    ).map((g) => (
                      <button
                        key={g.k}
                        type='button'
                        onClick={() => setLossesGranularity(g.k)}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          lossesGranularity === g.k
                            ? 'bg-[#FFFFFF] text-[#202223] shadow-xs'
                            : 'text-[#6D7175]'
                        }`}
                      >
                        {g.l}
                      </button>
                    ))}
                  </div>
                  <Link
                    to={isCuisine ? '/sorties-de-stock' : '/pertes-gaspillage'}
                    className='text-xs font-medium text-[#202223] hover:underline'
                  >
                    Voir le rapport →
                  </Link>
                </div>
              </div>

              {isLoading ? (
                <Skeleton className='h-[240px] w-full' />
              ) : !analytics?.charts.lossesEvolution.hasData ||
                lossesEvolutionData.length === 0 ? (
                <WidgetEmptyState
                  message='Aucune perte enregistrée sur cette période'
                  subMessage='Aucune casse ou perte n’a été déclarée pendant la période sélectionnée.'
                />
              ) : (
                <div className='h-[240px] w-full'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <LineChart
                      data={lossesEvolutionData}
                      margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray='3 3'
                        stroke='#E1E3E5'
                        vertical={false}
                      />
                      <XAxis
                        dataKey='label'
                        tick={{ fontSize: 11, fill: '#6D7175' }}
                        axisLine={{ stroke: '#E1E3E5' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#6D7175' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => (isCuisine ? `${v}` : `${v} DH`)}
                      />
                      <RechartsTooltip
                        formatter={(val) =>
                          isCuisine
                            ? [formatQuantity(Number(val ?? 0)), 'Quantité perdue']
                            : [formatMAD(Number(val ?? 0)), 'Valeur des pertes']
                        }
                        contentStyle={{
                          backgroundColor: '#FFFFFF',
                          borderColor: '#E1E3E5',
                          borderRadius: '6px',
                          fontSize: '12px',
                        }}
                      />
                      <Line
                        type='monotone'
                        dataKey={isCuisine ? 'wastedQty' : 'wastedValue'}
                        name={
                          isCuisine
                            ? 'Quantité perdue'
                            : 'Valeur des pertes (DH)'
                        }
                        stroke='#D72C0D'
                        strokeWidth={2}
                        dot={{ r: 3, fill: '#D72C0D' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </WidgetErrorBoundary>

          {/* WIDGET 7: Dépenses mensuelles (12 derniers mois, Financial roles only) */}
          {!isCuisine && (
            <WidgetErrorBoundary
              title='Dépenses mensuelles (12 derniers mois)'
              onRetry={() => refetch()}
            >
              <div className='flex flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
                <div className='mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[#E1E3E5] pb-3'>
                  <div>
                    <div className='flex items-center gap-2'>
                      <h3 className='text-sm font-semibold text-[#202223]'>
                        Dépenses mensuelles ({vatLabel})
                      </h3>
                      <ReversedExcludedFootnote />
                    </div>
                    <p className='text-xs text-[#6D7175]'>
                      Historique sur les 12 derniers mois
                    </p>
                  </div>
                  <Link
                    to='/rapports'
                    className='text-xs font-medium text-[#202223] hover:underline'
                  >
                    Voir le rapport →
                  </Link>
                </div>

                {isLoading ? (
                  <Skeleton className='h-[240px] w-full' />
                ) : !analytics?.charts.monthlySpending12Months.hasData ? (
                  <WidgetEmptyState
                    message='Aucune dépense sur les 12 derniers mois'
                    subMessage='Les achats mensuels s’afficheront automatiquement dès l’enregistrement de factures.'
                  />
                ) : (
                  <div className='h-[240px] w-full'>
                    <ResponsiveContainer width='100%' height='100%'>
                      <BarChart
                        data={analytics.charts.monthlySpending12Months.items}
                        margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                      >
                        <CartesianGrid
                          strokeDasharray='3 3'
                          stroke='#E1E3E5'
                          vertical={false}
                        />
                        <XAxis
                          dataKey='label'
                          tick={{ fontSize: 10, fill: '#6D7175' }}
                          axisLine={{ stroke: '#E1E3E5' }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#6D7175' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `${v} DH`}
                        />
                        <RechartsTooltip
                          formatter={(val) => [
                            formatMAD(Number(val ?? 0)),
                            `Dépenses (${vatLabel})`,
                          ]}
                          contentStyle={{
                            backgroundColor: '#FFFFFF',
                            borderColor: '#E1E3E5',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                        />
                        <Bar
                          dataKey='amount'
                          name={`Dépenses (${vatLabel})`}
                          fill='#303030'
                          radius={[3, 3, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </WidgetErrorBoundary>
          )}

          {/* WIDGET 8: Écarts d'inventaire (Manquants vs Excédents en valeur, Financial roles only) */}
          {!isCuisine && (
            <WidgetErrorBoundary
              title='Écarts d’inventaire'
              onRetry={() => refetch()}
            >
              <div className='flex flex-col justify-between rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
                <div className='mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[#E1E3E5] pb-3'>
                  <div>
                    <h3 className='text-sm font-semibold text-[#202223]'>
                      Écarts d’inventaire (Manquants vs Excédents)
                    </h3>
                    <p className='text-xs text-[#6D7175]'>
                      Comparaison en valeur (DH) sur les dernières sessions
                      confirmées
                    </p>
                  </div>
                  <Link
                    to='/inventaires'
                    className='text-xs font-medium text-[#202223] hover:underline'
                  >
                    Voir le rapport →
                  </Link>
                </div>

                {isLoading ? (
                  <Skeleton className='h-[240px] w-full' />
                ) : !analytics?.charts.inventoryVariancesBySession.hasData ? (
                  <WidgetEmptyState
                    message='Aucun écart d’inventaire valorisé'
                    subMessage='Confirmez une session d’inventaire physique pour comparer les manquants et excédents.'
                    actionLabel='Sessions d’inventaire'
                    actionTo='/inventaires'
                  />
                ) : (
                  <div className='h-[240px] w-full'>
                    <ResponsiveContainer width='100%' height='100%'>
                      <BarChart
                        data={
                          analytics.charts.inventoryVariancesBySession.items
                        }
                        margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                      >
                        <CartesianGrid
                          strokeDasharray='3 3'
                          stroke='#E1E3E5'
                          vertical={false}
                        />
                        <XAxis
                          dataKey='label'
                          tick={{ fontSize: 11, fill: '#6D7175' }}
                          axisLine={{ stroke: '#E1E3E5' }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#6D7175' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `${v} DH`}
                        />
                        <RechartsTooltip
                          formatter={(val, name) => [
                            formatMAD(Number(val ?? 0)),
                            String(name),
                          ]}
                          contentStyle={{
                            backgroundColor: '#FFFFFF',
                            borderColor: '#E1E3E5',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Bar
                          dataKey='shortageValue'
                          name='Manquants (DH)'
                          fill='#D72C0D'
                          radius={[3, 3, 0, 0]}
                        />
                        <Bar
                          dataKey='surplusValue'
                          name='Excédents (DH)'
                          fill='#008060'
                          radius={[3, 3, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </WidgetErrorBoundary>
          )}
        </div>

        {/* ================================================================ */}
        {/* 5. RECENT ACTIVITY FEED (Last 10 movements)                      */}
        {/* ================================================================ */}
        <div className='rounded-lg border border-[#E1E3E5] bg-[#FFFFFF] p-4'>
          <div className='mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#E1E3E5] pb-3'>
            <div>
              <h2 className='text-sm font-semibold text-[#202223]'>
                Activité récente (10 derniers mouvements)
              </h2>
              <p className='text-xs text-[#6D7175]'>
                Dernières entrées, sorties, sessions d’inventaire et
                contre-passations enregistrées.
              </p>
            </div>
            {!isCuisine && (
              <Link
                to='/historique-mouvements'
                className='text-xs font-medium text-[#202223] hover:underline'
              >
                Tout l’historique →
              </Link>
            )}
          </div>

          {isLoading ? (
            <div className='space-y-2'>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className='h-12 w-full' />
              ))}
            </div>
          ) : (analytics?.recentActivity.length ?? 0) === 0 ? (
            <WidgetEmptyState
              message='Aucun mouvement récent enregistré'
              subMessage='Importez votre classeur Excel ou créez votre première opération pour alimenter le journal d’activité.'
              actionLabel={
                isCuisine ? 'Nouvelle sortie' : 'Importer un fichier Excel'
              }
              actionTo={isCuisine ? '/sorties-de-stock' : '/import-export'}
            />
          ) : (
            <div className='divide-y divide-[#E1E3E5]'>
              {analytics?.recentActivity.map((act) => {
                const badgeConfig =
                  act.type === 'entry'
                    ? {
                        label: 'Entrée',
                        cls: 'border-[#008060]/30 bg-[#EBF9F3] text-[#008060]',
                        Icon: Truck,
                      }
                    : act.type === 'exit'
                      ? {
                          label: 'Sortie',
                          cls: 'border-[#E1E3E5] bg-[#F6F6F7] text-[#202223]',
                          Icon: BarChart3,
                        }
                      : act.type === 'inventory'
                        ? {
                            label: 'Inventaire',
                            cls: 'border-[#B98900]/30 bg-[#FFF8E6] text-[#B98900]',
                            Icon: ClipboardCheck,
                          }
                        : {
                            label: 'Contre-passation',
                            cls: 'border-[#D72C0D]/30 bg-[#FFF4F4] text-[#D72C0D]',
                            Icon: RotateCcw,
                          }
                const IconComp = badgeConfig.Icon

                return (
                  <div
                    key={act.id}
                    onClick={() =>
                      navigateToFilteredUrl(act.linkTo, { doc: act.docId })
                    }
                    className='flex cursor-pointer flex-col justify-between gap-2 py-2.5 transition-colors hover:bg-[#F6F6F7]/70 sm:flex-row sm:items-center sm:px-2'
                  >
                    <div className='flex items-start gap-3'>
                      <div className='mt-0.5 rounded border border-[#E1E3E5] bg-[#F6F6F7] p-1.5 text-[#202223]'>
                        <IconComp className='h-3.5 w-3.5' />
                      </div>
                      <div>
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='text-xs font-semibold text-[#202223]'>
                            {act.title}
                          </span>
                          <Badge
                            variant='outline'
                            className={`h-5 px-1.5 text-[10px] font-medium ${badgeConfig.cls}`}
                          >
                            {badgeConfig.label}
                          </Badge>
                        </div>
                        <p className='text-[11px] text-[#6D7175]'>
                          {act.subtitle} • Par{' '}
                          <strong className='font-medium text-[#202223]'>
                            {act.userName}
                          </strong>
                        </p>
                      </div>
                    </div>

                    <div className='flex items-center justify-between gap-4 sm:justify-end'>
                      {act.amountOrQtyLabel && (
                        <span className='text-xs font-semibold text-[#202223] tabular-nums'>
                          {act.amountOrQtyLabel}
                        </span>
                      )}
                      <span className='text-[11px] text-[#6D7175] tabular-nums'>
                        {formatDateFR(act.date)}
                      </span>
                      <ArrowRight className='h-3.5 w-3.5 text-[#6D7175]' />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Main>
    </TooltipProvider>
  )
}
