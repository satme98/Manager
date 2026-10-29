import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  ArrowUpFromLine,
  BarChart3,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Percent,
  Trash2,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import { repository } from '@/data'
import { computeLossesReport, type ChartGranularity } from '@/data/analytics'
import { formatCurrencyMAD, formatDateFR, formatQuantity } from '@/lib/formatters'
import { canPerformCollectionAction } from '@/lib/rbac'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { EmptyState } from '@/components/empty-state'
import { PageShell } from '@/components/layout/page-shell'

const CHART_COLORS = [
  '#D72C0D',
  '#B98900',
  '#303030',
  '#008060',
  '#5C5F62',
  '#8C9196',
]

export function PertesGaspillage() {
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const role = auth.user?.role ?? 'consultation'
  const priceHidden = role === 'cuisine'

  const [dateFrom, setDateFrom] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('from') || ''
  })
  const [dateTo, setDateTo] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('to') || ''
  })
  const [productFilter, setProductFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [destinationFilter, setDestinationFilter] = useState('all')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [granularity, setGranularity] = useState<ChartGranularity>('day')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const from = params.get('from')
      if (from !== null) setDateFrom(from)
      const to = params.get('to')
      if (to !== null) setDateTo(to)
    }
    window.addEventListener('popstate', syncFromUrl)
    window.addEventListener('monarq:navigate', syncFromUrl)
    return () => {
      window.removeEventListener('popstate', syncFromUrl)
      window.removeEventListener('monarq:navigate', syncFromUrl)
    }
  }, [])

  const { data: dataset, isLoading } = useQuery({
    queryKey: ['pertes-gaspillage-dataset', role],
    queryFn: async () => {
      const canListSuppliers = canPerformCollectionAction(
        role,
        'suppliers',
        'list'
      )
      const canListPurchases = canPerformCollectionAction(
        role,
        'purchases',
        'list'
      )
      const canListUsers = canPerformCollectionAction(role, 'users', 'list')

      const [products, suppliers, pur, ext, inv, settings, users] =
        await Promise.all([
          repository.listProducts(),
          canListSuppliers ? repository.listSuppliers() : Promise.resolve([]),
          canListPurchases
            ? repository.listPurchases()
            : Promise.resolve({ headers: [], lines: [] }),
          repository.listExits(),
          repository.listInventories(),
          repository.listSettings(),
          canListUsers
            ? repository.listUsers()
            : repository.getCurrentUser().then((u) => (u ? [u] : [])),
        ])
      return {
        products,
        suppliers,
        purchases: pur.headers,
        purchaseLines: pur.lines,
        exits: ext.headers,
        exitLines: ext.lines,
        inventorySessions: inv.sessions,
        inventoryLines: inv.lines,
        settings,
        users,
      }
    },
  })

  const categories = useMemo(() => {
    if (!dataset) return []
    const set = new Set<string>()
    for (const p of dataset.products) {
      set.add(p.category?.trim() || 'Sans catégorie')
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [dataset])

  const destinations = useMemo(() => {
    if (!dataset) return []
    const set = new Set<string>()
    for (const x of dataset.exits) {
      if (x.destination?.trim()) set.add(x.destination.trim())
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [dataset])

  const reasons = useMemo(() => {
    if (!dataset) return []
    const set = new Set<string>()
    for (const l of dataset.exitLines) {
      if (Number(l.qty_wasted ?? 0) > 0) {
        set.add(l.loss_reason?.trim() || 'Non renseigné')
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [dataset])

  const report = useMemo(() => {
    if (!dataset) return null
    return computeLossesReport(dataset, {
      from: dateFrom || null,
      to: dateTo || null,
      productId: productFilter,
      category: categoryFilter,
      destination: destinationFilter,
      reason: reasonFilter,
      role,
    })
  }, [
    dataset,
    dateFrom,
    dateTo,
    productFilter,
    categoryFilter,
    destinationFilter,
    reasonFilter,
    role,
  ])

  const evolutionSeries = useMemo(() => {
    if (!report) return []
    if (granularity === 'week') return report.charts.evolutionByWeek
    if (granularity === 'month') return report.charts.evolutionByMonth
    return report.charts.evolutionByDay
  }, [report, granularity])

  function resetFilters() {
    setDateFrom('')
    setDateTo('')
    setProductFilter('all')
    setCategoryFilter('all')
    setDestinationFilter('all')
    setReasonFilter('all')
  }

  function handleExport(format: 'xlsx' | 'csv') {
    if (!report || report.lines.length === 0) {
      toast.error('Aucune ligne de perte à exporter.')
      return
    }
    const rows = report.lines.map((line) => {
      const row: Record<string, string | number> = {
        'Date (JJ/MM/AAAA)': formatDateFR(line.date),
        Référence: line.productRef,
        Produit: line.productName,
        Catégorie: line.category,
        'Quantité perdue': line.wastedQty,
        Unité: line.unit,
        Destination: line.destination,
        Motif: line.reason,
        'Enregistré par': line.createdByName,
      }
      if (!priceHidden) {
        row['Prix moyen unitaire (DH)'] = line.unitPrice ?? 0
        row['Valeur de la perte (DH)'] = line.lossValue ?? 0
      }
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Pertes_Gaspillage')
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') {
      XLSX.writeFile(wb, `MONARQ_Pertes_${stamp}.csv`, { bookType: 'csv' })
    } else {
      XLSX.writeFile(wb, `MONARQ_Pertes_${stamp}.xlsx`)
    }
    toast.success(`Export ${format.toUpperCase()} généré (${report.lines.length} lignes).`)
  }

  const mostLost = priceHidden
    ? report?.summary.mostLostProductByQty
    : report?.summary.mostLostProductByValue

  return (
    <PageShell
      section='GESTION'
      title='Pertes & Gaspillage'
      description='Suivi détaillé des quantités perdues ou jetées lors des sorties de stock, analyse par motif et destination.'
      primaryAction={{
        label: 'Saisir une sortie / perte',
        to: '/sorties-de-stock',
        icon: ArrowUpFromLine,
      }}
      secondaryActions={[
        {
          label: 'Exporter (.xlsx)',
          onClick: () => handleExport('xlsx'),
          icon: FileSpreadsheet,
        },
        {
          label: 'Exporter (.csv)',
          onClick: () => handleExport('csv'),
          icon: Download,
        },
        {
          label: 'Rapports',
          to: '/rapports',
          icon: BarChart3,
        },
      ]}
    >
      {isLoading ? (
        <div className='space-y-4'>
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className='h-24 w-full rounded-lg' />
            ))}
          </div>
          <Skeleton className='h-80 w-full rounded-lg' />
        </div>
      ) : !report ||
        (report.lines.length === 0 &&
          !dateFrom &&
          !dateTo &&
          productFilter === 'all' &&
          categoryFilter === 'all' &&
          destinationFilter === 'all' &&
          reasonFilter === 'all') ? (
        <EmptyState
          icon={Trash2}
          title='Aucune perte enregistrée'
          description='Les quantités perdues (casse, péremption, erreur de préparation) déclarées dans les sorties de stock s’afficheront ici.'
          columnsPreview={[
            'Date (JJ/MM/AAAA)',
            'Produit',
            'Quantité perdue',
            ...(priceHidden ? [] : ['Valeur de la perte (DH)']),
            'Destination',
            'Motif',
            'Enregistré par',
          ]}
          primaryAction={{
            label: 'Saisir une sortie / perte',
            to: '/sorties-de-stock',
            icon: ArrowUpFromLine,
          }}
          secondaryAction={{
            label: 'Consulter les rapports',
            to: '/rapports',
            icon: BarChart3,
          }}
        />
      ) : (
        <div className='space-y-4'>
          {/* 4 Summary Cards */}
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>
                  {priceHidden
                    ? 'Quantité totale perdue'
                    : 'Valeur totale des pertes'}
                </span>
                <Trash2 className='h-4 w-4 text-[#D72C0D]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#D72C0D]'>
                {priceHidden
                  ? `${formatQuantity(report.summary.totalWastedQty)} u.`
                  : formatCurrencyMAD(report.summary.totalLossValue ?? 0)}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                {priceHidden
                  ? 'Somme des quantités jetées sur la période'
                  : `Volume : ${formatQuantity(report.summary.totalWastedQty)} unités`}
              </div>
            </Card>

            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Quantité de lignes</span>
                <AlertTriangle className='h-4 w-4 text-[#B98900]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#202223]'>
                {report.summary.linesCount}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                Déclarations de pertes validées
              </div>
            </Card>

            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Produit le plus perdu</span>
                <BarChart3 className='h-4 w-4 text-[#202223]' />
              </div>
              <div className='mt-1.5 truncate text-base font-semibold text-[#202223]'>
                {mostLost ? mostLost.name : '—'}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                {mostLost
                  ? priceHidden
                    ? `${formatQuantity(mostLost.qty)} ${mostLost.unit}`
                    : `${formatCurrencyMAD(mostLost.value ?? 0)} (${formatQuantity(mostLost.qty)} ${mostLost.unit})`
                  : 'Aucune perte'}
              </div>
            </Card>

            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Taux de perte</span>
                <Percent className='h-4 w-4 text-[#6D7175]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#202223]'>
                {priceHidden
                  ? 'Masqué (Cuisine)'
                  : report.summary.lossRatePct !== null
                    ? `${report.summary.lossRatePct.toFixed(2)} %`
                    : '0,00 %'}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                Ratio valeur perdue / valeur consommée
              </div>
            </Card>
          </div>

          {/* Filters */}
          <Card className='border-[#E1E3E5] bg-white p-3 shadow-none'>
            <div className='grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6'>
              <div className='flex items-center gap-1.5'>
                <Input
                  type='date'
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className='h-8 text-xs'
                />
                <span className='text-xs text-[#6D7175]'>→</span>
                <Input
                  type='date'
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className='h-8 text-xs'
                />
              </div>

              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger className='h-8 text-xs'>
                  <SelectValue placeholder='Tous les produits' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all' className='text-xs'>
                    Tous les produits
                  </SelectItem>
                  {dataset?.products.map((p) => (
                    <SelectItem key={p.id} value={p.id} className='text-xs'>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className='h-8 text-xs'>
                  <SelectValue placeholder='Toutes les catégories' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all' className='text-xs'>
                    Toutes les catégories
                  </SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat} className='text-xs'>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={destinationFilter}
                onValueChange={setDestinationFilter}
              >
                <SelectTrigger className='h-8 text-xs'>
                  <SelectValue placeholder='Toutes les destinations' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all' className='text-xs'>
                    Toutes les destinations
                  </SelectItem>
                  {destinations.map((d) => (
                    <SelectItem key={d} value={d} className='text-xs'>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={reasonFilter} onValueChange={setReasonFilter}>
                <SelectTrigger className='h-8 text-xs'>
                  <SelectValue placeholder='Tous les motifs' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all' className='text-xs'>
                    Tous les motifs
                  </SelectItem>
                  {reasons.map((r) => (
                    <SelectItem key={r} value={r} className='text-xs'>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className='flex items-center justify-end'>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={resetFilters}
                  className='h-8 text-xs'
                >
                  <X className='mr-1 h-3.5 w-3.5' />
                  Réinitialiser
                </Button>
              </div>
            </div>
          </Card>

          {/* 4 Charts Grid */}
          <div className='grid gap-4 lg:grid-cols-2'>
            {/* Chart 1: Évolution des pertes */}
            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='mb-3 flex items-center justify-between'>
                <div>
                  <h3 className='text-xs font-semibold text-[#202223]'>
                    Évolution des pertes
                  </h3>
                  <p className='text-[11px] text-[#6D7175]'>
                    {priceHidden ? 'Quantités perdues' : 'Valeur des pertes (DH)'} par période
                  </p>
                </div>
                <div className='flex items-center gap-1 rounded-md border border-[#E1E3E5] p-0.5'>
                  {(['day', 'week', 'month'] as ChartGranularity[]).map((g) => (
                    <button
                      key={g}
                      type='button'
                      onClick={() => setGranularity(g)}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        granularity === g
                          ? 'bg-[#303030] text-white'
                          : 'text-[#6D7175] hover:text-[#202223]'
                      }`}
                    >
                      {g === 'day' ? 'Jour' : g === 'week' ? 'Semaine' : 'Mois'}
                    </button>
                  ))}
                </div>
              </div>
              {evolutionSeries.length === 0 ? (
                <div className='flex h-52 items-center justify-center text-xs text-[#6D7175]'>
                  Aucune donnée sur la période
                </div>
              ) : (
                <div className='h-52 w-full'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart data={evolutionSeries}>
                      <CartesianGrid strokeDasharray='3 3' stroke='#E1E3E5' />
                      <XAxis dataKey='label' tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(val) =>
                          priceHidden
                            ? [`${formatQuantity(Number(val ?? 0))} u.`, 'Quantité perdue']
                            : [formatCurrencyMAD(Number(val ?? 0)), 'Valeur perte']
                        }
                      />
                      <Bar
                        dataKey={priceHidden ? 'wastedQty' : 'wastedValue'}
                        fill='#D72C0D'
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Chart 2: Pertes par produit (Top 10) */}
            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='mb-3'>
                <h3 className='text-xs font-semibold text-[#202223]'>
                  Pertes par produit (Top 10)
                </h3>
                <p className='text-[11px] text-[#6D7175]'>
                  Articles générant le plus de gaspillage
                </p>
              </div>
              {report.charts.byProduct.length === 0 ? (
                <div className='flex h-52 items-center justify-center text-xs text-[#6D7175]'>
                  Aucune perte par produit
                </div>
              ) : (
                <div className='h-52 w-full'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart
                      data={report.charts.byProduct}
                      layout='vertical'
                      margin={{ left: 20 }}
                    >
                      <CartesianGrid strokeDasharray='3 3' stroke='#E1E3E5' />
                      <XAxis type='number' tick={{ fontSize: 11 }} />
                      <YAxis
                        type='category'
                        dataKey='name'
                        width={110}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip
                        formatter={(val) =>
                          priceHidden
                            ? [`${formatQuantity(Number(val ?? 0))}`, 'Quantité perdue']
                            : [formatCurrencyMAD(Number(val ?? 0)), 'Valeur perte']
                        }
                      />
                      <Bar
                        dataKey={priceHidden ? 'wastedQty' : 'lossValue'}
                        fill='#B98900'
                        radius={[0, 3, 3, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            {/* Chart 3: Pertes par motif */}
            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='mb-3'>
                <h3 className='text-xs font-semibold text-[#202223]'>
                  Pertes par motif
                </h3>
                <p className='text-[11px] text-[#6D7175]'>
                  Répartition par cause déclarée
                </p>
              </div>
              {report.charts.byReason.length === 0 ? (
                <div className='flex h-48 items-center justify-center text-xs text-[#6D7175]'>
                  Aucun motif enregistré
                </div>
              ) : (
                <div className='grid grid-cols-2 items-center gap-2'>
                  <div className='h-44 w-full'>
                    <ResponsiveContainer width='100%' height='100%'>
                      <PieChart>
                        <Pie
                          data={report.charts.byReason}
                          dataKey={priceHidden ? 'wastedQty' : 'lossValue'}
                          nameKey='reason'
                          innerRadius={35}
                          outerRadius={65}
                        >
                          {report.charts.byReason.map((entry, idx) => (
                            <Cell
                              key={entry.reason}
                              fill={CHART_COLORS[idx % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(val) =>
                            priceHidden
                              ? `${formatQuantity(Number(val ?? 0))} u.`
                              : formatCurrencyMAD(Number(val ?? 0))
                          }
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className='space-y-1.5 text-xs'>
                    {report.charts.byReason.map((r, idx) => (
                      <div
                        key={r.reason}
                        className='flex items-center justify-between gap-2'
                      >
                        <span className='flex items-center gap-1.5 truncate'>
                          <span
                            className='inline-block h-2.5 w-2.5 shrink-0 rounded-sm'
                            style={{
                              backgroundColor:
                                CHART_COLORS[idx % CHART_COLORS.length],
                            }}
                          />
                          <span className='truncate'>{r.reason}</span>
                        </span>
                        <span className='font-semibold tabular-nums'>
                          {priceHidden
                            ? `${formatQuantity(r.wastedQty)}`
                            : formatCurrencyMAD(r.lossValue ?? 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* Chart 4: Pertes par destination */}
            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='mb-3'>
                <h3 className='text-xs font-semibold text-[#202223]'>
                  Pertes par destination
                </h3>
                <p className='text-[11px] text-[#6D7175]'>
                  Postes ou services concernés (Cuisine, Bar, Pâtisserie...)
                </p>
              </div>
              {report.charts.byDestination.length === 0 ? (
                <div className='flex h-48 items-center justify-center text-xs text-[#6D7175]'>
                  Aucune destination
                </div>
              ) : (
                <div className='space-y-2.5 pt-1'>
                  {report.charts.byDestination.map((d) => (
                    <div key={d.destination} className='space-y-1 text-xs'>
                      <div className='flex items-center justify-between'>
                        <span className='font-medium text-[#202223]'>
                          {d.destination}{' '}
                          <span className='text-[#6D7175]'>({d.count} lignes)</span>
                        </span>
                        <span className='font-semibold tabular-nums'>
                          {priceHidden
                            ? `${formatQuantity(d.wastedQty)} u.`
                            : formatCurrencyMAD(d.lossValue ?? 0)}{' '}
                          {d.sharePct !== null ? `(${d.sharePct}%)` : ''}
                        </span>
                      </div>
                      <div className='h-2 w-full overflow-hidden rounded-full bg-[#F6F6F7]'>
                        <div
                          className='h-full bg-[#303030]'
                          style={{
                            width: `${Math.min(100, Math.max(4, d.sharePct ?? 0))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Loss Lines Table */}
          <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
            <div className='flex items-center justify-between border-b border-[#E1E3E5] px-4 py-3'>
              <div>
                <h3 className='text-xs font-semibold text-[#202223]'>
                  Lignes de pertes ({report.lines.length})
                </h3>
                <p className='text-[11px] text-[#6D7175]'>
                  Cliquez sur une ligne pour consulter le bon de sortie d’origine.
                </p>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow className='bg-[#F6F6F7]'>
                  <TableHead className='px-4 text-xs font-semibold'>Date</TableHead>
                  <TableHead className='text-xs font-semibold'>Produit</TableHead>
                  <TableHead className='text-right text-xs font-semibold'>
                    Quantité perdue
                  </TableHead>
                  {!priceHidden && (
                    <TableHead className='text-right text-xs font-semibold'>
                      Valeur de la perte
                    </TableHead>
                  )}
                  <TableHead className='text-xs font-semibold'>
                    Destination
                  </TableHead>
                  <TableHead className='text-xs font-semibold'>Motif</TableHead>
                  <TableHead className='px-4 text-xs font-semibold'>
                    Enregistré par
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.lines.map((line) => (
                  <TableRow
                    key={line.lineId}
                    className='cursor-pointer hover:bg-[#F6F6F7]/70'
                    onClick={() =>
                      void navigate({
                        to: '/sorties-de-stock',
                      })
                    }
                  >
                    <TableCell className='px-4 tabular-nums text-xs'>
                      {formatDateFR(line.date)}
                    </TableCell>
                    <TableCell className='text-xs'>
                      <div className='font-medium text-[#202223]'>
                        {line.productName}
                      </div>
                      <div className='text-[11px] text-[#6D7175]'>
                        {line.productRef} · {line.category}
                      </div>
                    </TableCell>
                    <TableCell className='text-right tabular-nums text-xs font-semibold text-[#D72C0D]'>
                      {formatQuantity(line.wastedQty)} {line.unit}
                    </TableCell>
                    {!priceHidden && (
                      <TableCell className='text-right tabular-nums text-xs font-semibold text-[#D72C0D]'>
                        {formatCurrencyMAD(line.lossValue ?? 0)}
                      </TableCell>
                    )}
                    <TableCell className='text-xs'>
                      <Badge variant='outline' className='text-[11px]'>
                        {line.destination}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-xs text-[#202223]'>
                      {line.reason}
                    </TableCell>
                    <TableCell className='px-4 text-xs text-[#6D7175]'>
                      <span className='inline-flex items-center gap-1'>
                        {line.createdByName}
                        <ExternalLink className='h-3 w-3 opacity-60' />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </PageShell>
  )
}
