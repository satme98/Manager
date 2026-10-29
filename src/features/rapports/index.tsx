import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Calendar,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  History,
  Printer,
  Receipt,
  Trash2,
  Truck,
  Utensils,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import { repository } from '@/data'
import {
  computeDashboardAnalytics,
  computeInvoicesAndAgingReport,
  computeLossesReport,
  computeReplenishmentSuggestions,
  computeStockValuationAsOfDate,
  computeUnifiedMovementTimeline,
  type ChartGranularity,
} from '@/data/analytics'
import {
  formatCurrencyMAD,
  formatDateFR,
  formatDateTimeFR,
  formatQuantity,
} from '@/lib/formatters'
import { canPerformCollectionAction } from '@/lib/rbac'
import { roundCurrency, roundQty } from '@/lib/stock-engine'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageShell } from '@/components/layout/page-shell'

export type ReportId =
  | 'stock_valuation'
  | 'inventory_variances'
  | 'purchases_by_period'
  | 'purchases_by_supplier'
  | 'product_consumption'
  | 'losses_wastage'
  | 'unpaid_invoices_aging'
  | 'below_min_stock'
  | 'movement_history'

interface ReportDefinition {
  id: ReportId
  number: number
  title: string
  subtitle: string
  icon: typeof Boxes
}

const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: 'stock_valuation',
    number: 1,
    title: 'Valorisation du stock',
    subtitle:
      'Valeur du stock par produit et par catégorie à une date choisie (PMP), avec signalement des prix manquants.',
    icon: Boxes,
  },
  {
    id: 'inventory_variances',
    number: 2,
    title: "Écarts d'inventaire",
    subtitle:
      'Analyse des manquants et excédents par session d’inventaire validée, par produit et par catégorie.',
    icon: ClipboardCheck,
  },
  {
    id: 'purchases_by_period',
    number: 3,
    title: 'Achats par période',
    subtitle:
      'Consolidation des entrées de stock par jour, semaine ou mois (nombre de bons et montant total).',
    icon: Calendar,
  },
  {
    id: 'purchases_by_supplier',
    number: 4,
    title: 'Achats par fournisseur',
    subtitle:
      'Répartition du volume d’achat par fournisseur avec part en pourcentage et nombre de factures.',
    icon: Truck,
  },
  {
    id: 'product_consumption',
    number: 5,
    title: 'Consommation des produits',
    subtitle:
      'Quantités sorties et coût valorisé au PMP par produit, catégorie et destination.',
    icon: Utensils,
  },
  {
    id: 'losses_wastage',
    number: 6,
    title: 'Pertes et gaspillage',
    subtitle:
      'Détail et synthèse des pertes par produit, motif et destination avec taux de perte.',
    icon: Trash2,
  },
  {
    id: 'unpaid_invoices_aging',
    number: 7,
    title: 'Factures impayées (balance âgée)',
    subtitle:
      'Balance âgée des dettes fournisseurs par tranche d’ancienneté : 0–30, 31–60, 61–90 et 90+ jours.',
    icon: Receipt,
  },
  {
    id: 'below_min_stock',
    number: 8,
    title: 'Produits sous le stock minimum',
    subtitle:
      'Liste des articles en statut Alerte ou À surveiller avec déficit, quantité suggérée et coût estimé.',
    icon: AlertTriangle,
  },
  {
    id: 'movement_history',
    number: 9,
    title: 'Historique des mouvements',
    subtitle:
      'Journal chronologique complet des entrées, sorties, pertes, inventaires et contre-passations.',
    icon: History,
  },
]

export function Rapports() {
  const { auth } = useAuthStore()
  const role = auth.user?.role ?? 'consultation'
  const priceHidden = role === 'cuisine'

  const [selectedReport, setSelectedReport] = useState<ReportId | null>(null)

  // Shared filters for reports
  const [asOfDate, setAsOfDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [dateFrom, setDateFrom] = useState(() => {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  })
  const [dateTo, setDateTo] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [destinationFilter] = useState('all')
  const [granularity, setGranularity] = useState<ChartGranularity>('month')

  const { data: dataset, isLoading } = useQuery({
    queryKey: ['rapports-dataset', role],
    queryFn: async () => {
      const canListUsers = canPerformCollectionAction(role, 'users', 'list')
      const [
        products,
        suppliers,
        purchasesData,
        exitsData,
        inventoriesData,
        settings,
        users,
      ] = await Promise.all([
        repository.listProducts(),
        repository.listSuppliers(),
        repository.listPurchases(),
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
        purchases: purchasesData.headers,
        purchaseLines: purchasesData.lines,
        exits: exitsData.headers,
        exitLines: exitsData.lines,
        inventorySessions: inventoriesData.sessions,
        inventoryLines: inventoriesData.lines,
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

  // 1. Stock Valuation Report
  const stockValuation = useMemo(() => {
    if (!dataset) return null
    return computeStockValuationAsOfDate(dataset, {
      asOfDate,
      category: categoryFilter,
      role,
    })
  }, [dataset, asOfDate, categoryFilter, role])

  // 2. Dashboard / Period Analytics (used for Purchases by Period, Purchases by Supplier, Consumption, Variances)
  const periodAnalytics = useMemo(() => {
    if (!dataset) return null
    return computeDashboardAnalytics(dataset, {
      preset: 'custom',
      customFrom: dateFrom || '2000-01-01',
      customTo: dateTo || '2099-12-31',
      role,
      forceRefresh: true,
    })
  }, [dataset, dateFrom, dateTo, role])

  // 3. Detailed Inventory Variances lines
  const inventoryVarianceRows = useMemo(() => {
    if (!dataset) return []
    const prodById = new Map(dataset.products.map((p) => [p.id, p]))
    const confirmedSessions = new Map(
      dataset.inventorySessions
        .filter((s) => {
          if (s.status !== 'confirmed') return false
          const d = s.date.slice(0, 10)
          if (dateFrom && d < dateFrom) return false
          if (dateTo && d > dateTo) return false
          return true
        })
        .map((s) => [s.id, s])
    )
    const rows: Array<{
      lineId: string
      sessionDate: string
      scope: string
      productRef: string
      productName: string
      category: string
      unit: string
      theoretical: number
      counted: number
      diff: number
      shortageValue: number | null
      surplusValue: number | null
      netValue: number | null
    }> = []

    for (const line of dataset.inventoryLines) {
      const sess = confirmedSessions.get(line.session)
      if (!sess) continue
      const prod = prodById.get(line.product)
      const cat = prod?.category?.trim() || 'Sans catégorie'
      if (categoryFilter !== 'all' && cat !== categoryFilter) continue
      const diff = roundQty(Number(line.diff ?? 0))
      if (diff === 0) continue
      const valDiff = roundCurrency(Number(line.value_diff ?? 0))
      rows.push({
        lineId: line.id,
        sessionDate: sess.date.slice(0, 10),
        scope: sess.scope || 'Complet',
        productRef: prod?.ref || '—',
        productName: prod?.name || 'Produit',
        category: cat,
        unit: prod?.unit || 'u',
        theoretical: roundQty(Number(line.theoretical ?? 0)),
        counted: roundQty(Number(line.counted ?? 0)),
        diff,
        shortageValue: priceHidden
          ? null
          : valDiff < 0
            ? roundCurrency(Math.abs(valDiff))
            : 0,
        surplusValue: priceHidden
          ? null
          : valDiff > 0
            ? roundCurrency(valDiff)
            : 0,
        netValue: priceHidden ? null : valDiff,
      })
    }
    return rows.sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))
  }, [dataset, dateFrom, dateTo, categoryFilter, priceHidden])

  // 4. Consumption Report rows
  const consumptionRows = useMemo(() => {
    if (!dataset || !stockValuation) return []
    const avgPriceByProd = new Map(
      stockValuation.byProduct.map((p) => [p.productId, p.averagePrice])
    )
    const prodById = new Map(dataset.products.map((p) => [p.id, p]))
    const reversedExitIds = new Set(
      dataset.exits.filter((x) => x.reversed_of).map((x) => x.reversed_of!)
    )
    const validExits = new Map(
      dataset.exits
        .filter((x) => {
          if (
            x.reversed_of ||
            reversedExitIds.has(x.id) ||
            x.correction_status === 'reversed' ||
            x.correction_status === 'corrected'
          )
            return false
          const d = x.date.slice(0, 10)
          if (dateFrom && d < dateFrom) return false
          if (dateTo && d > dateTo) return false
          return true
        })
        .map((x) => [x.id, x])
    )

    const agg = new Map<
      string,
      {
        key: string
        productId: string
        ref: string
        name: string
        category: string
        destination: string
        unit: string
        qtyConsumed: number
        valueConsumed: number
      }
    >()

    for (const line of dataset.exitLines) {
      const header = validExits.get(line.exit)
      if (!header) continue
      const consumed = Number(line.qty_consumed ?? 0)
      if (consumed <= 0) continue
      const prod = prodById.get(line.product)
      const cat = prod?.category?.trim() || 'Sans catégorie'
      if (categoryFilter !== 'all' && cat !== categoryFilter) continue
      const dest = header.destination?.trim() || 'Cuisine'
      if (destinationFilter !== 'all' && dest !== destinationFilter) continue

      const key = `${line.product}::${dest}`
      const unitCost = avgPriceByProd.get(line.product) ?? 0
      const item = agg.get(key) ?? {
        key,
        productId: line.product,
        ref: prod?.ref || '—',
        name: prod?.name || 'Produit',
        category: cat,
        destination: dest,
        unit: prod?.unit || 'u',
        qtyConsumed: 0,
        valueConsumed: 0,
      }
      item.qtyConsumed = roundQty(item.qtyConsumed + consumed)
      item.valueConsumed = roundCurrency(
        item.valueConsumed + consumed * (unitCost ?? 0)
      )
      agg.set(key, item)
    }

    return Array.from(agg.values()).sort((a, b) =>
      priceHidden
        ? b.qtyConsumed - a.qtyConsumed
        : b.valueConsumed - a.valueConsumed
    )
  }, [
    dataset,
    stockValuation,
    dateFrom,
    dateTo,
    categoryFilter,
    destinationFilter,
    priceHidden,
  ])

  // 6. Losses Report
  const lossesReport = useMemo(() => {
    if (!dataset) return null
    return computeLossesReport(dataset, {
      from: dateFrom || null,
      to: dateTo || null,
      category: categoryFilter,
      destination: destinationFilter,
      role,
    })
  }, [dataset, dateFrom, dateTo, categoryFilter, destinationFilter, role])

  // 7. Unpaid Invoices & Aging Report
  const agingReport = useMemo(() => {
    if (!dataset) return null
    return computeInvoicesAndAgingReport(dataset, {
      from: dateFrom || null,
      to: dateTo || null,
      supplierId: supplierFilter,
      paymentStatus: 'unpaid',
      role,
    })
  }, [dataset, dateFrom, dateTo, supplierFilter, role])

  // 8. Below Min Stock Report
  const replenishmentReport = useMemo(() => {
    if (!dataset) return null
    return computeReplenishmentSuggestions(dataset, {
      includeWatch: true,
      categoryFilter,
      supplierFilter,
      role,
    })
  }, [dataset, categoryFilter, supplierFilter, role])

  // 9. Movement History Report
  const movementRows = useMemo(() => {
    if (!dataset) return []
    return computeUnifiedMovementTimeline(dataset, {
      from: dateFrom || null,
      to: dateTo || null,
      category: categoryFilter,
      supplierId: supplierFilter,
      role,
    })
  }, [dataset, dateFrom, dateTo, categoryFilter, supplierFilter, role])

  function handleExportActiveReport(format: 'xlsx' | 'csv') {
    if (!selectedReport) return
    let rows: Array<Record<string, string | number>> = []
    let sheetName = 'Rapport'

    switch (selectedReport) {
      case 'stock_valuation': {
        sheetName = 'Valorisation_Stock'
        rows = (stockValuation?.byProduct ?? []).map((r) => {
          const item: Record<string, string | number> = {
            'Date de valorisation': formatDateFR(asOfDate),
            Référence: r.ref,
            Produit: r.name,
            Catégorie: r.category,
            'Stock à date': r.stock,
            Unité: r.unit,
            Statut: r.status,
          }
          if (!priceHidden) {
            item['Prix moyen U (DH)'] = r.averagePrice ?? 'Prix manquant'
            item['Valeur stock (DH)'] = r.stockValue ?? 0
          }
          return item
        })
        break
      }
      case 'inventory_variances': {
        sheetName = 'Ecarts_Inventaire'
        rows = inventoryVarianceRows.map((r) => {
          const item: Record<string, string | number> = {
            'Date session': formatDateFR(r.sessionDate),
            Périmètre: r.scope,
            Référence: r.productRef,
            Produit: r.productName,
            Catégorie: r.category,
            'Stock théorique': r.theoretical,
            'Stock compté': r.counted,
            Écart: r.diff,
            Unité: r.unit,
          }
          if (!priceHidden) {
            item['Manquant (DH)'] = r.shortageValue ?? 0
            item['Excédent (DH)'] = r.surplusValue ?? 0
            item['Écart net (DH)'] = r.netValue ?? 0
          }
          return item
        })
        break
      }
      case 'purchases_by_period': {
        sheetName = 'Achats_Periode'
        const series =
          granularity === 'day'
            ? (periodAnalytics?.charts.purchasesEvolution.byDay ?? [])
            : granularity === 'week'
              ? (periodAnalytics?.charts.purchasesEvolution.byWeek ?? [])
              : (periodAnalytics?.charts.purchasesEvolution.byMonth ?? [])
        rows = series.map((s) => {
          const item: Record<string, string | number> = {
            Période: s.label,
            'Nombre de documents': s.count,
          }
          if (!priceHidden) {
            item['Montant total (DH)'] = s.amount ?? 0
          }
          return item
        })
        break
      }
      case 'purchases_by_supplier': {
        sheetName = 'Achats_Fournisseur'
        rows = (periodAnalytics?.charts.purchasesBySupplier.items ?? []).map(
          (s) => {
            const item: Record<string, string | number> = {
              Fournisseur: s.supplierName,
              'Nombre de bons': s.documentsCount,
            }
            if (!priceHidden) {
              item['Montant total (DH)'] = s.amount ?? 0
              item['Part (%)'] = s.sharePct ?? 0
            }
            return item
          }
        )
        break
      }
      case 'product_consumption': {
        sheetName = 'Consommation_Produits'
        rows = consumptionRows.map((r) => {
          const item: Record<string, string | number> = {
            Référence: r.ref,
            Produit: r.name,
            Catégorie: r.category,
            Destination: r.destination,
            'Quantité consommée': r.qtyConsumed,
            Unité: r.unit,
          }
          if (!priceHidden) {
            item['Valeur consommée (DH)'] = r.valueConsumed
          }
          return item
        })
        break
      }
      case 'losses_wastage': {
        sheetName = 'Pertes_Gaspillage'
        rows = (lossesReport?.lines ?? []).map((l) => {
          const item: Record<string, string | number> = {
            Date: formatDateFR(l.date),
            Référence: l.productRef,
            Produit: l.productName,
            Catégorie: l.category,
            'Quantité perdue': l.wastedQty,
            Unité: l.unit,
            Destination: l.destination,
            Motif: l.reason,
          }
          if (!priceHidden) {
            item['Valeur perte (DH)'] = l.lossValue ?? 0
          }
          return item
        })
        break
      }
      case 'unpaid_invoices_aging': {
        sheetName = 'Factures_Impayees'
        rows = (agingReport?.invoices ?? []).map((inv) => {
          const item: Record<string, string | number> = {
            Date: formatDateFR(inv.date),
            'N° Facture': inv.invoiceNo,
            Fournisseur: inv.supplierName,
            'Ancienneté (jours)': inv.daysSincePurchase,
            Tranche: inv.agingBucket ?? '—',
          }
          if (!priceHidden) {
            item['Reste à payer (DH)'] = inv.remainingAmount ?? 0
          }
          return item
        })
        break
      }
      case 'below_min_stock': {
        sheetName = 'Sous_Stock_Min'
        rows = (replenishmentReport?.suggestions ?? []).map((s) => {
          const item: Record<string, string | number> = {
            Référence: s.ref,
            Produit: s.name,
            Catégorie: s.category,
            Statut: s.status,
            'Stock actuel': s.currentStock,
            'Stock minimum': s.minStock,
            'Quantité suggérée': s.suggestedQty,
            Unité: s.unit,
            'Dernier fournisseur': s.lastSupplierName || '—',
          }
          if (!priceHidden) {
            item['Coût estimé (DH)'] = s.estimatedCost ?? 0
          }
          return item
        })
        break
      }
      case 'movement_history': {
        sheetName = 'Historique_Mouvements'
        rows = movementRows.map((m) => {
          const item: Record<string, string | number> = {
            Date: formatDateFR(m.date),
            Type: m.typeLabel,
            Référence: m.productRef,
            Produit: m.productName,
            'Quantité (+/-)': m.qtyDelta,
            'Stock après': m.stockAfter,
            Unité: m.unit,
            Document: m.documentLabel,
            Utilisateur: m.userName,
          }
          if (!priceHidden) {
            item['Valeur (DH)'] = m.valueDelta ?? 0
          }
          return item
        })
        break
      }
    }

    if (rows.length === 0) {
      toast.error('Aucune ligne à exporter pour les filtres actuels.')
      return
    }

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') {
      XLSX.writeFile(wb, `MONARQ_${sheetName}_${stamp}.csv`, { bookType: 'csv' })
    } else {
      XLSX.writeFile(wb, `MONARQ_${sheetName}_${stamp}.xlsx`)
    }
    toast.success(`Rapport exporté en ${format.toUpperCase()} (${rows.length} lignes).`)
  }

  const activeDef = REPORT_DEFINITIONS.find((d) => d.id === selectedReport)

  return (
    <PageShell
      section='ANALYSE'
      title={activeDef ? `Rapport : ${activeDef.title}` : 'Rapports'}
      description={
        activeDef
          ? activeDef.subtitle
          : '9 rapports analytiques et financiers temps réel exportables en Excel (.xlsx), CSV et vue imprimable PDF.'
      }
      primaryAction={
        activeDef
          ? {
              label: 'Exporter (.xlsx)',
              onClick: () => handleExportActiveReport('xlsx'),
              icon: FileSpreadsheet,
            }
          : undefined
      }
      secondaryActions={
        activeDef
          ? [
              {
                label: 'Tous les rapports',
                onClick: () => setSelectedReport(null),
                icon: ArrowLeft,
              },
              {
                label: 'Exporter (.csv)',
                onClick: () => handleExportActiveReport('csv'),
                icon: Download,
              },
              {
                label: 'Imprimer / PDF',
                onClick: () => window.print(),
                icon: Printer,
              },
            ]
          : undefined
      }
    >
      {isLoading ? (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className='h-36 w-full rounded-lg' />
          ))}
        </div>
      ) : !selectedReport ? (
        /* 9 REPORT CARDS GRID */
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {REPORT_DEFINITIONS.map((rep) => {
            const Icon = rep.icon
            return (
              <Card
                key={rep.id}
                onClick={() => setSelectedReport(rep.id)}
                className='group cursor-pointer border-[#E1E3E5] bg-white p-4 shadow-none transition-colors hover:border-[#303030]'
              >
                <div className='flex items-start justify-between'>
                  <div className='flex h-9 w-9 items-center justify-center rounded-md bg-[#F6F6F7] text-[#202223] group-hover:bg-[#303030] group-hover:text-white'>
                    <Icon className='h-4 w-4' />
                  </div>
                  <Badge variant='outline' className='text-[11px]'>
                    Rapport #{rep.number}
                  </Badge>
                </div>
                <h3 className='mt-3 text-sm font-semibold text-[#202223]'>
                  {rep.title}
                </h3>
                <p className='mt-1 line-clamp-2 text-xs text-[#6D7175]'>
                  {rep.subtitle}
                </p>
                <div className='mt-3 flex items-center justify-between border-t border-[#E1E3E5] pt-2.5 text-[11px] font-medium text-[#202223]'>
                  <span>Ouvrir le rapport</span>
                  <span>→</span>
                </div>
              </Card>
            )
          })}
        </div>
      ) : (
        /* ACTIVE REPORT VIEW */
        <div className='space-y-4'>
          {/* Printable Report Header Metadata */}
          <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b border-[#E1E3E5] pb-3 text-xs'>
              <div>
                <span className='font-semibold text-[#202223]'>
                  MONARQ ÉCONOMAT — {activeDef?.title}
                </span>
                <span className='ml-3 text-[#6D7175]'>
                  Généré le {formatDateTimeFR(new Date().toISOString())} par{' '}
                  {auth.user?.name || 'Utilisateur'}
                </span>
              </div>
              <Badge variant='outline' className='text-[11px]'>
                {selectedReport === 'stock_valuation'
                  ? `Stock au ${formatDateFR(asOfDate)}`
                  : `Période : ${formatDateFR(dateFrom)} au ${formatDateFR(dateTo)}`}
              </Badge>
            </div>

            {/* Report-specific filters */}
            <div className='mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-4'>
              {selectedReport === 'stock_valuation' ? (
                <div className='space-y-1'>
                  <Label className='text-xs'>Valorisation au (Stock à date)</Label>
                  <Input
                    type='date'
                    value={asOfDate}
                    onChange={(e) => setAsOfDate(e.target.value)}
                    className='h-8 text-xs'
                  />
                </div>
              ) : (
                <>
                  <div className='space-y-1'>
                    <Label className='text-xs'>Du</Label>
                    <Input
                      type='date'
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className='h-8 text-xs'
                    />
                  </div>
                  <div className='space-y-1'>
                    <Label className='text-xs'>Au</Label>
                    <Input
                      type='date'
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className='h-8 text-xs'
                    />
                  </div>
                </>
              )}

              {selectedReport !== 'purchases_by_period' &&
                selectedReport !== 'purchases_by_supplier' &&
                selectedReport !== 'unpaid_invoices_aging' && (
                  <div className='space-y-1'>
                    <Label className='text-xs'>Catégorie</Label>
                    <Select
                      value={categoryFilter}
                      onValueChange={setCategoryFilter}
                    >
                      <SelectTrigger className='h-8 text-xs'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='all' className='text-xs'>
                          Toutes les catégories
                        </SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c} value={c} className='text-xs'>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

              {(selectedReport === 'unpaid_invoices_aging' ||
                selectedReport === 'below_min_stock' ||
                selectedReport === 'movement_history') && (
                <div className='space-y-1'>
                  <Label className='text-xs'>Fournisseur</Label>
                  <Select
                    value={supplierFilter}
                    onValueChange={setSupplierFilter}
                  >
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all' className='text-xs'>
                        Tous les fournisseurs
                      </SelectItem>
                      {dataset?.suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id} className='text-xs'>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selectedReport === 'purchases_by_period' && (
                <div className='space-y-1'>
                  <Label className='text-xs'>Regroupement temporel</Label>
                  <Select
                    value={granularity}
                    onValueChange={(v) => setGranularity(v as ChartGranularity)}
                  >
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='day' className='text-xs'>
                        Par jour
                      </SelectItem>
                      <SelectItem value='week' className='text-xs'>
                        Par semaine
                      </SelectItem>
                      <SelectItem value='month' className='text-xs'>
                        Par mois
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </Card>

          {/* REPORT 1: STOCK VALUATION */}
          {selectedReport === 'stock_valuation' && stockValuation && (
            <div className='space-y-4'>
              <div className='grid gap-3 sm:grid-cols-3'>
                <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
                  <span className='text-xs text-[#6D7175]'>
                    Valeur totale du stock au {formatDateFR(asOfDate)}
                  </span>
                  <div className='mt-1 text-xl font-bold tabular-nums text-[#202223]'>
                    {priceHidden
                      ? 'Masqué (Cuisine)'
                      : formatCurrencyMAD(stockValuation.totalStockValue ?? 0)}
                  </div>
                </Card>
                <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
                  <span className='text-xs text-[#6D7175]'>Produits actifs</span>
                  <div className='mt-1 text-xl font-bold tabular-nums text-[#202223]'>
                    {stockValuation.totalProductsCount}
                  </div>
                </Card>
                <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
                  <span className='text-xs text-[#6D7175]'>
                    Produits avec « Prix manquant »
                  </span>
                  <div className='mt-1 text-xl font-bold tabular-nums text-[#B98900]'>
                    {stockValuation.missingPriceCount}
                  </div>
                </Card>
              </div>

              <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                <div className='border-b border-[#E1E3E5] px-4 py-2.5 text-xs font-semibold'>
                  Synthèse par catégorie
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      <TableHead className='px-4 text-xs'>Catégorie</TableHead>
                      <TableHead className='text-right text-xs'>
                        Nb produits
                      </TableHead>
                      <TableHead className='text-right text-xs'>
                        Quantité cumulée
                      </TableHead>
                      {!priceHidden && (
                        <>
                          <TableHead className='text-right text-xs'>
                            Valeur du stock
                          </TableHead>
                          <TableHead className='px-4 text-right text-xs'>
                            Part (%)
                          </TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockValuation.byCategory.map((cat) => (
                      <TableRow key={cat.category}>
                        <TableCell className='px-4 text-xs font-medium'>
                          {cat.category}
                        </TableCell>
                        <TableCell className='text-right tabular-nums text-xs'>
                          {cat.productsCount}
                        </TableCell>
                        <TableCell className='text-right tabular-nums text-xs'>
                          {formatQuantity(cat.totalQty)}
                        </TableCell>
                        {!priceHidden && (
                          <>
                            <TableCell className='text-right tabular-nums text-xs font-semibold'>
                              {formatCurrencyMAD(cat.stockValue ?? 0)}
                            </TableCell>
                            <TableCell className='px-4 text-right tabular-nums text-xs'>
                              {cat.sharePct !== null ? `${cat.sharePct}%` : '—'}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className='bg-[#F6F6F7] font-semibold'>
                      <TableCell className='px-4 text-xs'>TOTAL</TableCell>
                      <TableCell className='text-right tabular-nums text-xs'>
                        {stockValuation.totalProductsCount}
                      </TableCell>
                      <TableCell className='text-right tabular-nums text-xs'>
                        {formatQuantity(
                          stockValuation.byCategory.reduce(
                            (acc, c) => acc + c.totalQty,
                            0
                          )
                        )}
                      </TableCell>
                      {!priceHidden && (
                        <>
                          <TableCell className='text-right tabular-nums text-xs'>
                            {formatCurrencyMAD(
                              stockValuation.totalStockValue ?? 0
                            )}
                          </TableCell>
                          <TableCell className='px-4 text-right text-xs'>
                            100%
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  </TableFooter>
                </Table>
              </Card>

              <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                <div className='border-b border-[#E1E3E5] px-4 py-2.5 text-xs font-semibold'>
                  Détail par produit ({stockValuation.byProduct.length})
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      <TableHead className='px-4 text-xs'>Réf.</TableHead>
                      <TableHead className='text-xs'>Produit</TableHead>
                      <TableHead className='text-xs'>Catégorie</TableHead>
                      <TableHead className='text-right text-xs'>
                        Stock au {formatDateFR(asOfDate)}
                      </TableHead>
                      {!priceHidden && (
                        <>
                          <TableHead className='text-right text-xs'>
                            Prix moyen (PMP)
                          </TableHead>
                          <TableHead className='px-4 text-right text-xs'>
                            Valeur du stock
                          </TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockValuation.byProduct.map((p) => (
                      <TableRow key={p.productId}>
                        <TableCell className='px-4 font-mono text-xs'>
                          {p.ref}
                        </TableCell>
                        <TableCell className='text-xs font-medium'>
                          {p.name}
                        </TableCell>
                        <TableCell className='text-xs text-[#6D7175]'>
                          {p.category}
                        </TableCell>
                        <TableCell className='text-right tabular-nums text-xs font-semibold'>
                          {formatQuantity(p.stock)} {p.unit}
                        </TableCell>
                        {!priceHidden && (
                          <>
                            <TableCell className='text-right tabular-nums text-xs'>
                              {p.missingPrice ? (
                                <Badge
                                  variant='outline'
                                  className='border-[#B98900]/40 bg-[#B98900]/10 text-[10px] text-[#B98900]'
                                >
                                  Prix manquant
                                </Badge>
                              ) : (
                                formatCurrencyMAD(p.averagePrice ?? 0)
                              )}
                            </TableCell>
                            <TableCell className='px-4 text-right tabular-nums text-xs font-semibold'>
                              {p.stockValue !== null
                                ? formatCurrencyMAD(p.stockValue)
                                : '—'}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* REPORT 2: INVENTORY VARIANCES */}
          {selectedReport === 'inventory_variances' && (
            <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7]'>
                    <TableHead className='px-4 text-xs'>Date session</TableHead>
                    <TableHead className='text-xs'>Produit</TableHead>
                    <TableHead className='text-xs'>Catégorie</TableHead>
                    <TableHead className='text-right text-xs'>Théorique</TableHead>
                    <TableHead className='text-right text-xs'>Compté</TableHead>
                    <TableHead className='text-right text-xs'>Écart</TableHead>
                    {!priceHidden && (
                      <>
                        <TableHead className='text-right text-xs'>
                          Manquant (DH)
                        </TableHead>
                        <TableHead className='px-4 text-right text-xs'>
                          Excédent (DH)
                        </TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventoryVarianceRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={priceHidden ? 6 : 8}
                        className='py-8 text-center text-xs text-[#6D7175]'
                      >
                        Aucun écart d’inventaire sur la période sélectionnée.
                      </TableCell>
                    </TableRow>
                  ) : (
                    inventoryVarianceRows.map((r) => (
                      <TableRow key={r.lineId}>
                        <TableCell className='px-4 tabular-nums text-xs'>
                          {formatDateFR(r.sessionDate)}
                        </TableCell>
                        <TableCell className='text-xs font-medium'>
                          {r.productRef} — {r.productName}
                        </TableCell>
                        <TableCell className='text-xs'>{r.category}</TableCell>
                        <TableCell className='text-right tabular-nums text-xs'>
                          {formatQuantity(r.theoretical)} {r.unit}
                        </TableCell>
                        <TableCell className='text-right tabular-nums text-xs'>
                          {formatQuantity(r.counted)} {r.unit}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums text-xs font-semibold ${
                            r.diff < 0 ? 'text-[#D72C0D]' : 'text-[#008060]'
                          }`}
                        >
                          {r.diff > 0 ? `+${formatQuantity(r.diff)}` : formatQuantity(r.diff)}{' '}
                          {r.unit}
                        </TableCell>
                        {!priceHidden && (
                          <>
                            <TableCell className='text-right tabular-nums text-xs text-[#D72C0D]'>
                              {r.shortageValue
                                ? formatCurrencyMAD(r.shortageValue)
                                : '—'}
                            </TableCell>
                            <TableCell className='px-4 text-right tabular-nums text-xs text-[#008060]'>
                              {r.surplusValue
                                ? formatCurrencyMAD(r.surplusValue)
                                : '—'}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {inventoryVarianceRows.length > 0 && !priceHidden && (
                  <TableFooter>
                    <TableRow className='bg-[#F6F6F7] font-semibold'>
                      <TableCell colSpan={6} className='px-4 text-xs'>
                        TOTAL DES ÉCARTS
                      </TableCell>
                      <TableCell className='text-right tabular-nums text-xs text-[#D72C0D]'>
                        {formatCurrencyMAD(
                          inventoryVarianceRows.reduce(
                            (acc, r) => acc + (r.shortageValue ?? 0),
                            0
                          )
                        )}
                      </TableCell>
                      <TableCell className='px-4 text-right tabular-nums text-xs text-[#008060]'>
                        {formatCurrencyMAD(
                          inventoryVarianceRows.reduce(
                            (acc, r) => acc + (r.surplusValue ?? 0),
                            0
                          )
                        )}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </Card>
          )}

          {/* REPORT 3: PURCHASES BY PERIOD */}
          {selectedReport === 'purchases_by_period' && periodAnalytics && (
            <div className='space-y-4'>
              {(() => {
                const series =
                  granularity === 'day'
                    ? periodAnalytics.charts.purchasesEvolution.byDay
                    : granularity === 'week'
                      ? periodAnalytics.charts.purchasesEvolution.byWeek
                      : periodAnalytics.charts.purchasesEvolution.byMonth
                const totalDocs = series.reduce((acc, s) => acc + s.count, 0)
                const totalAmt = series.reduce(
                  (acc, s) => acc + (s.amount ?? 0),
                  0
                )
                return (
                  <>
                    {!priceHidden && series.length > 0 && (
                      <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
                        <div className='h-56 w-full'>
                          <ResponsiveContainer width='100%' height='100%'>
                            <BarChart data={series}>
                              <CartesianGrid
                                strokeDasharray='3 3'
                                stroke='#E1E3E5'
                              />
                              <XAxis dataKey='label' tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} />
                              <Tooltip
                                formatter={(val) => [
                                  formatCurrencyMAD(Number(val ?? 0)),
                                  'Montant achats',
                                ]}
                              />
                              <Bar
                                dataKey='amount'
                                fill='#303030'
                                radius={[3, 3, 0, 0]}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}
                    <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                      <Table>
                        <TableHeader>
                          <TableRow className='bg-[#F6F6F7]'>
                            <TableHead className='px-4 text-xs'>Période</TableHead>
                            <TableHead className='text-right text-xs'>
                              Nombre de documents
                            </TableHead>
                            {!priceHidden && (
                              <TableHead className='px-4 text-right text-xs'>
                                Montant total (DH)
                              </TableHead>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {series.map((s) => (
                            <TableRow key={s.bucketKey}>
                              <TableCell className='px-4 text-xs font-medium'>
                                {s.label}
                              </TableCell>
                              <TableCell className='text-right tabular-nums text-xs'>
                                {s.count}
                              </TableCell>
                              {!priceHidden && (
                                <TableCell className='px-4 text-right tabular-nums text-xs font-semibold'>
                                  {formatCurrencyMAD(s.amount ?? 0)}
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableFooter>
                          <TableRow className='bg-[#F6F6F7] font-semibold'>
                            <TableCell className='px-4 text-xs'>TOTAL</TableCell>
                            <TableCell className='text-right tabular-nums text-xs'>
                              {totalDocs}
                            </TableCell>
                            {!priceHidden && (
                              <TableCell className='px-4 text-right tabular-nums text-xs'>
                                {formatCurrencyMAD(totalAmt)}
                              </TableCell>
                            )}
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </Card>
                  </>
                )
              })()}
            </div>
          )}

          {/* REPORT 4: PURCHASES BY SUPPLIER */}
          {selectedReport === 'purchases_by_supplier' && periodAnalytics && (
            <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7]'>
                    <TableHead className='px-4 text-xs'>Fournisseur</TableHead>
                    <TableHead className='text-right text-xs'>
                      Nombre de factures / BL
                    </TableHead>
                    {!priceHidden && (
                      <>
                        <TableHead className='text-right text-xs'>
                          Montant total (DH)
                        </TableHead>
                        <TableHead className='px-4 text-right text-xs'>
                          Part (%)
                        </TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periodAnalytics.charts.purchasesBySupplier.items.map((s) => (
                    <TableRow key={s.supplierId}>
                      <TableCell className='px-4 text-xs font-medium'>
                        {s.supplierName}
                      </TableCell>
                      <TableCell className='text-right tabular-nums text-xs'>
                        {s.documentsCount}
                      </TableCell>
                      {!priceHidden && (
                        <>
                          <TableCell className='text-right tabular-nums text-xs font-semibold'>
                            {formatCurrencyMAD(s.amount ?? 0)}
                          </TableCell>
                          <TableCell className='px-4 text-right tabular-nums text-xs'>
                            {s.sharePct !== null ? `${s.sharePct}%` : '—'}
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className='bg-[#F6F6F7] font-semibold'>
                    <TableCell className='px-4 text-xs'>TOTAL</TableCell>
                    <TableCell className='text-right tabular-nums text-xs'>
                      {periodAnalytics.charts.purchasesBySupplier.items.reduce(
                        (acc, s) => acc + s.documentsCount,
                        0
                      )}
                    </TableCell>
                    {!priceHidden && (
                      <>
                        <TableCell className='text-right tabular-nums text-xs'>
                          {formatCurrencyMAD(
                            periodAnalytics.charts.purchasesBySupplier.items.reduce(
                              (acc, s) => acc + (s.amount ?? 0),
                              0
                            )
                          )}
                        </TableCell>
                        <TableCell className='px-4 text-right text-xs'>
                          100%
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>
          )}

          {/* REPORT 5: PRODUCT CONSUMPTION */}
          {selectedReport === 'product_consumption' && (
            <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7]'>
                    <TableHead className='px-4 text-xs'>Réf.</TableHead>
                    <TableHead className='text-xs'>Produit</TableHead>
                    <TableHead className='text-xs'>Catégorie</TableHead>
                    <TableHead className='text-xs'>Destination</TableHead>
                    <TableHead className='text-right text-xs'>
                      Quantité consommée
                    </TableHead>
                    {!priceHidden && (
                      <TableHead className='px-4 text-right text-xs'>
                        Valeur consommée (DH)
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumptionRows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className='px-4 font-mono text-xs'>
                        {r.ref}
                      </TableCell>
                      <TableCell className='text-xs font-medium'>
                        {r.name}
                      </TableCell>
                      <TableCell className='text-xs'>{r.category}</TableCell>
                      <TableCell className='text-xs'>{r.destination}</TableCell>
                      <TableCell className='text-right tabular-nums text-xs font-semibold'>
                        {formatQuantity(r.qtyConsumed)} {r.unit}
                      </TableCell>
                      {!priceHidden && (
                        <TableCell className='px-4 text-right tabular-nums text-xs font-semibold'>
                          {formatCurrencyMAD(r.valueConsumed)}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className='bg-[#F6F6F7] font-semibold'>
                    <TableCell colSpan={4} className='px-4 text-xs'>
                      TOTAL CONSOMMÉ
                    </TableCell>
                    <TableCell className='text-right tabular-nums text-xs'>
                      {formatQuantity(
                        consumptionRows.reduce((acc, r) => acc + r.qtyConsumed, 0)
                      )}
                    </TableCell>
                    {!priceHidden && (
                      <TableCell className='px-4 text-right tabular-nums text-xs'>
                        {formatCurrencyMAD(
                          consumptionRows.reduce(
                            (acc, r) => acc + r.valueConsumed,
                            0
                          )
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>
          )}

          {/* REPORT 6: LOSSES & WASTAGE */}
          {selectedReport === 'losses_wastage' && lossesReport && (
            <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7]'>
                    <TableHead className='px-4 text-xs'>Date</TableHead>
                    <TableHead className='text-xs'>Produit</TableHead>
                    <TableHead className='text-xs'>Destination</TableHead>
                    <TableHead className='text-xs'>Motif</TableHead>
                    <TableHead className='text-right text-xs'>
                      Quantité perdue
                    </TableHead>
                    {!priceHidden && (
                      <TableHead className='px-4 text-right text-xs'>
                        Valeur de la perte
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lossesReport.lines.map((l) => (
                    <TableRow key={l.lineId}>
                      <TableCell className='px-4 tabular-nums text-xs'>
                        {formatDateFR(l.date)}
                      </TableCell>
                      <TableCell className='text-xs font-medium'>
                        {l.productRef} — {l.productName}
                      </TableCell>
                      <TableCell className='text-xs'>{l.destination}</TableCell>
                      <TableCell className='text-xs'>{l.reason}</TableCell>
                      <TableCell className='text-right tabular-nums text-xs font-semibold text-[#D72C0D]'>
                        {formatQuantity(l.wastedQty)} {l.unit}
                      </TableCell>
                      {!priceHidden && (
                        <TableCell className='px-4 text-right tabular-nums text-xs font-semibold text-[#D72C0D]'>
                          {formatCurrencyMAD(l.lossValue ?? 0)}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className='bg-[#F6F6F7] font-semibold'>
                    <TableCell colSpan={4} className='px-4 text-xs'>
                      TOTAL DES PERTES
                    </TableCell>
                    <TableCell className='text-right tabular-nums text-xs text-[#D72C0D]'>
                      {formatQuantity(lossesReport.summary.totalWastedQty)}
                    </TableCell>
                    {!priceHidden && (
                      <TableCell className='px-4 text-right tabular-nums text-xs text-[#D72C0D]'>
                        {formatCurrencyMAD(
                          lossesReport.summary.totalLossValue ?? 0
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>
          )}

          {/* REPORT 7: UNPAID INVOICES AGING */}
          {selectedReport === 'unpaid_invoices_aging' && agingReport && (
            <div className='space-y-4'>
              <div className='grid gap-3 sm:grid-cols-4'>
                {agingReport.agingBuckets.map((b) => (
                  <Card
                    key={b.bucket}
                    className='border-[#E1E3E5] bg-white p-4 shadow-none'
                  >
                    <span className='text-xs text-[#6D7175]'>{b.label}</span>
                    <div className='mt-1 text-lg font-bold tabular-nums text-[#202223]'>
                      {priceHidden
                        ? `${b.count} facture(s)`
                        : formatCurrencyMAD(b.amount ?? 0)}
                    </div>
                    <div className='mt-0.5 text-[11px] text-[#6D7175]'>
                      {b.count} facture(s){' '}
                      {b.sharePct !== null ? `· ${b.sharePct}%` : ''}
                    </div>
                  </Card>
                ))}
              </div>

              <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      <TableHead className='px-4 text-xs'>Date</TableHead>
                      <TableHead className='text-xs'>N° Facture</TableHead>
                      <TableHead className='text-xs'>Fournisseur</TableHead>
                      <TableHead className='text-xs'>Tranche</TableHead>
                      <TableHead className='text-right text-xs'>
                        Ancienneté
                      </TableHead>
                      {!priceHidden && (
                        <TableHead className='px-4 text-right text-xs'>
                          Reste à payer (DH)
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agingReport.invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className='px-4 tabular-nums text-xs'>
                          {formatDateFR(inv.date)}
                        </TableCell>
                        <TableCell className='font-mono text-xs'>
                          {inv.invoiceNo}
                        </TableCell>
                        <TableCell className='text-xs font-medium'>
                          {inv.supplierName}
                        </TableCell>
                        <TableCell className='text-xs'>
                          <Badge variant='outline' className='text-[11px]'>
                            {inv.agingBucket ?? '0-30'} j
                          </Badge>
                        </TableCell>
                        <TableCell className='text-right tabular-nums text-xs'>
                          {inv.daysSincePurchase} jours
                        </TableCell>
                        {!priceHidden && (
                          <TableCell className='px-4 text-right tabular-nums text-xs font-semibold text-[#D72C0D]'>
                            {formatCurrencyMAD(inv.remainingAmount ?? 0)}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className='bg-[#F6F6F7] font-semibold'>
                      <TableCell colSpan={5} className='px-4 text-xs'>
                        TOTAL IMPAYÉ ({agingReport.invoices.length} factures)
                      </TableCell>
                      {!priceHidden && (
                        <TableCell className='px-4 text-right tabular-nums text-xs text-[#D72C0D]'>
                          {formatCurrencyMAD(
                            agingReport.summary.totalUnpaidAmount ?? 0
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  </TableFooter>
                </Table>
              </Card>
            </div>
          )}

          {/* REPORT 8: BELOW MIN STOCK */}
          {selectedReport === 'below_min_stock' && replenishmentReport && (
            <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7]'>
                    <TableHead className='px-4 text-xs'>Produit</TableHead>
                    <TableHead className='text-xs'>Statut</TableHead>
                    <TableHead className='text-right text-xs'>
                      Stock actuel
                    </TableHead>
                    <TableHead className='text-right text-xs'>
                      Stock minimum
                    </TableHead>
                    <TableHead className='text-right text-xs'>
                      Quantité suggérée
                    </TableHead>
                    <TableHead className='text-xs'>Fournisseur</TableHead>
                    {!priceHidden && (
                      <TableHead className='px-4 text-right text-xs'>
                        Coût estimé (DH)
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {replenishmentReport.suggestions.map((s) => (
                    <TableRow key={s.productId}>
                      <TableCell className='px-4 text-xs font-medium'>
                        {s.ref} — {s.name}
                      </TableCell>
                      <TableCell className='text-xs'>{s.status}</TableCell>
                      <TableCell className='text-right tabular-nums text-xs font-semibold'>
                        {formatQuantity(s.currentStock)} {s.unit}
                      </TableCell>
                      <TableCell className='text-right tabular-nums text-xs'>
                        {formatQuantity(s.minStock)} {s.unit}
                      </TableCell>
                      <TableCell className='text-right tabular-nums text-xs font-semibold'>
                        {formatQuantity(s.suggestedQty)} {s.unit}
                      </TableCell>
                      <TableCell className='text-xs'>
                        {s.lastSupplierName || '—'}
                      </TableCell>
                      {!priceHidden && (
                        <TableCell className='px-4 text-right tabular-nums text-xs font-semibold'>
                          {s.estimatedCost !== null
                            ? formatCurrencyMAD(s.estimatedCost)
                            : '—'}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className='bg-[#F6F6F7] font-semibold'>
                    <TableCell colSpan={6} className='px-4 text-xs'>
                      TOTAL COÛT ESTIMÉ DE RÉAPPROVISIONNEMENT
                    </TableCell>
                    {!priceHidden && (
                      <TableCell className='px-4 text-right tabular-nums text-xs'>
                        {formatCurrencyMAD(
                          replenishmentReport.totalEstimatedCost ?? 0
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>
          )}

          {/* REPORT 9: MOVEMENT HISTORY */}
          {selectedReport === 'movement_history' && (
            <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7]'>
                    <TableHead className='px-4 text-xs'>Date</TableHead>
                    <TableHead className='text-xs'>Type</TableHead>
                    <TableHead className='text-xs'>Produit</TableHead>
                    <TableHead className='text-right text-xs'>
                      Quantité (+/-)
                    </TableHead>
                    <TableHead className='text-right text-xs'>
                      Stock après
                    </TableHead>
                    {!priceHidden && (
                      <TableHead className='text-right text-xs'>
                        Valeur (DH)
                      </TableHead>
                    )}
                    <TableHead className='text-xs'>Document</TableHead>
                    <TableHead className='px-4 text-xs'>Utilisateur</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movementRows.slice(0, 100).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className='px-4 tabular-nums text-xs'>
                        {formatDateFR(m.date)}
                      </TableCell>
                      <TableCell className='text-xs'>{m.typeLabel}</TableCell>
                      <TableCell className='text-xs font-medium'>
                        {m.productRef} — {m.productName}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums text-xs font-semibold ${
                          m.qtyDelta >= 0 ? 'text-[#008060]' : 'text-[#D72C0D]'
                        }`}
                      >
                        {m.qtyDelta > 0
                          ? `+${formatQuantity(m.qtyDelta)}`
                          : formatQuantity(m.qtyDelta)}{' '}
                        {m.unit}
                      </TableCell>
                      <TableCell className='text-right tabular-nums text-xs'>
                        {formatQuantity(m.stockAfter)} {m.unit}
                      </TableCell>
                      {!priceHidden && (
                        <TableCell className='text-right tabular-nums text-xs'>
                          {m.valueDelta !== null
                            ? formatCurrencyMAD(m.valueDelta)
                            : '—'}
                        </TableCell>
                      )}
                      <TableCell className='text-xs'>{m.documentLabel}</TableCell>
                      <TableCell className='px-4 text-xs'>
                        {m.userName}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}
    </PageShell>
  )
}
