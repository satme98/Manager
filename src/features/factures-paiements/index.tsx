import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  ShieldAlert,
  Truck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import {
  computeInvoicesAndAgingReport,
  invalidateDashboardAnalyticsCache,
  type InvoiceComputedRow,
  type SupplierOutstandingBalanceRow,
} from '@/data/analytics'
import { formatCurrencyMAD, formatDateFR, formatDateTimeFR } from '@/lib/formatters'
import {
  canPerformCollectionAction,
  canReverseOrApprove,
  isReadOnlyRole,
} from '@/lib/rbac'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/empty-state'
import { PageShell } from '@/components/layout/page-shell'

type InvoiceSortField =
  | 'date'
  | 'invoiceNo'
  | 'supplierName'
  | 'totalAmount'
  | 'paymentStatus'
  | 'paymentDate'
  | 'daysSincePurchase'

const DEFAULT_PAYMENT_METHODS = [
  'Espèces',
  'Virement bancaire',
  'Chèque',
  'Carte bancaire',
  'Effet de commerce',
]

export function FacturesPaiements() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()
  const role = auth.user?.role ?? 'consultation'
  const priceHidden = role === 'cuisine'
  const readOnly = isReadOnlyRole(role) || priceHidden
  const canReversePayment = canReverseOrApprove(role)

  // Active tab: 'invoices' | 'suppliers' | 'history'
  const [activeTab, setActiveTab] = useState<'invoices' | 'suppliers' | 'history'>('invoices')

  // Filters (initialized from URL query parameters when navigated from Dashboard or CommandMenu)
  const [search, setSearch] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('q') || ''
  })
  const [supplierFilter, setSupplierFilter] = useState(() => {
    if (typeof window === 'undefined') return 'all'
    return new URLSearchParams(window.location.search).get('supplier') || 'all'
  })
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'unpaid' | 'paid' | 'partial'
  >(() => {
    if (typeof window === 'undefined') return 'all'
    const s = new URLSearchParams(window.location.search).get('status')
    if (s === 'unpaid' || s === 'paid' || s === 'partial') return s
    return 'all'
  })
  const [dateFrom, setDateFrom] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('from') || ''
  })
  const [dateTo, setDateTo] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('to') || ''
  })
  const [minAmountStr, setMinAmountStr] = useState('')
  const [maxAmountStr, setMaxAmountStr] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const q = params.get('q')
      if (q !== null) setSearch(q)
      const sup = params.get('supplier')
      if (sup) setSupplierFilter(sup)
      const st = params.get('status')
      if (st === 'unpaid' || st === 'paid' || st === 'partial' || st === 'all') {
        setStatusFilter(st)
      }
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

  // Sort & Pagination
  const [sortField, setSortField] = useState<InvoiceSortField>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 20

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Mark as paid dialog state
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [targetPayInvoices, setTargetPayInvoices] = useState<InvoiceComputedRow[]>([])
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod] = useState('Espèces')
  const [payReference, setPayReference] = useState('')
  const [payPartialAmount, setPayPartialAmount] = useState('')
  const [submittingPay, setSubmittingPay] = useState(false)

  // Reverse payment dialog state
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false)
  const [targetReverseInvoice, setTargetReverseInvoice] = useState<InvoiceComputedRow | null>(null)
  const [reverseReason, setReverseReason] = useState('')
  const [submittingReverse, setSubmittingReverse] = useState(false)

  // Supplier Statement ("Relevé fournisseur") modal
  const [statementSupplier, setStatementSupplier] = useState<SupplierOutstandingBalanceRow | null>(null)

  const { data: dataset, isLoading } = useQuery({
    queryKey: ['factures-paiements-dataset', role],
    queryFn: async () => {
      const canListUsers = canPerformCollectionAction(role, 'users', 'list')
      const [
        products,
        suppliers,
        pur,
        ext,
        inv,
        settings,
        users,
        paymentEvents,
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
        repository.listPaymentEvents(),
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
        paymentEvents,
      }
    },
  })

  const paymentMethods = useMemo(() => {
    const custom = dataset?.settings?.find((s) => s.key === 'payment_methods_list')?.value
    if (Array.isArray(custom) && custom.length > 0) {
      return custom.map(String)
    }
    return DEFAULT_PAYMENT_METHODS
  }, [dataset?.settings])

  const report = useMemo(() => {
    if (!dataset) return null
    const minAmount = minAmountStr.trim() !== '' ? Number(minAmountStr) : null
    const maxAmount = maxAmountStr.trim() !== '' ? Number(maxAmountStr) : null
    return computeInvoicesAndAgingReport(dataset, {
      from: dateFrom || null,
      to: dateTo || null,
      supplierId: supplierFilter,
      paymentStatus: statusFilter,
      minAmount: minAmount !== null && !Number.isNaN(minAmount) ? minAmount : null,
      maxAmount: maxAmount !== null && !Number.isNaN(maxAmount) ? maxAmount : null,
      search,
      role,
    })
  }, [
    dataset,
    dateFrom,
    dateTo,
    supplierFilter,
    statusFilter,
    minAmountStr,
    maxAmountStr,
    search,
    role,
  ])

  const sortedInvoices = useMemo(() => {
    if (!report) return []
    const rows = [...report.invoices]
    rows.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'date':
          cmp = a.date.localeCompare(b.date)
          break
        case 'invoiceNo':
          cmp = a.invoiceNo.localeCompare(b.invoiceNo, 'fr')
          break
        case 'supplierName':
          cmp = a.supplierName.localeCompare(b.supplierName, 'fr')
          break
        case 'totalAmount':
          cmp = (a.totalAmount ?? 0) - (b.totalAmount ?? 0)
          break
        case 'paymentStatus':
          cmp = a.paymentStatus.localeCompare(b.paymentStatus)
          break
        case 'paymentDate':
          cmp = (a.paymentDate ?? '').localeCompare(b.paymentDate ?? '')
          break
        case 'daysSincePurchase':
          cmp = a.daysSincePurchase - b.daysSincePurchase
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [report, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedInvoices.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paginatedInvoices = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return sortedInvoices.slice(start, start + pageSize)
  }, [sortedInvoices, currentPage])

  const unpaidInView = useMemo(
    () => sortedInvoices.filter((inv) => inv.paymentStatus !== 'paid'),
    [sortedInvoices]
  )

  function handleSort(field: InvoiceSortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  function resetFilters() {
    setSearch('')
    setSupplierFilter('all')
    setStatusFilter('all')
    setDateFrom('')
    setDateTo('')
    setMinAmountStr('')
    setMaxAmountStr('')
    setPage(1)
  }

  function openMarkPaidModal(invoices: InvoiceComputedRow[]) {
    if (invoices.length === 0) return
    setTargetPayInvoices(invoices)
    setPayDate(new Date().toISOString().slice(0, 10))
    setPayMethod(paymentMethods[0] ?? 'Espèces')
    setPayReference('')
    if (invoices.length === 1 && invoices[0].remainingAmount !== null) {
      setPayPartialAmount(String(invoices[0].remainingAmount))
    } else {
      setPayPartialAmount('')
    }
    setPayDialogOpen(true)
  }

  async function handleConfirmPayment() {
    if (targetPayInvoices.length === 0) return
    setSubmittingPay(true)
    try {
      const effectiveDate = payDate || new Date().toISOString().slice(0, 10)
      const options: {
        method?: string
        reference?: string
        amount?: number
      } = {
        method: payMethod,
        reference: payReference.trim(),
      }

      if (
        report?.partialPaymentsEnabled &&
        targetPayInvoices.length === 1 &&
        payPartialAmount.trim() !== ''
      ) {
        const parsedAmt = Number(payPartialAmount.replace(',', '.'))
        if (!Number.isNaN(parsedAmt) && parsedAmt > 0) {
          options.amount = parsedAmt
        }
      }

      if (targetPayInvoices.length === 1) {
        await repository.markPurchasePaid(
          targetPayInvoices[0].id,
          effectiveDate,
          options
        )
      } else {
        await repository.bulkMarkPurchasesPaid(
          targetPayInvoices.map((i) => i.id),
          effectiveDate,
          options
        )
      }

      invalidateDashboardAnalyticsCache()
      await queryClient.invalidateQueries({ queryKey: ['factures-paiements-dataset'] })
      await queryClient.invalidateQueries({ queryKey: ['purchases'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      await queryClient.invalidateQueries({ queryKey: ['audit_log'] })

      toast.success(
        targetPayInvoices.length === 1
          ? `Facture ${targetPayInvoices[0].invoiceNo} marquée comme réglée.`
          : `${targetPayInvoices.length} factures marquées comme réglées.`
      )
      setSelectedIds([])
      setPayDialogOpen(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erreur lors de la validation du paiement.'
      )
    } finally {
      setSubmittingPay(false)
    }
  }

  function openReversePaymentModal(invoice: InvoiceComputedRow) {
    setTargetReverseInvoice(invoice)
    setReverseReason('')
    setReverseDialogOpen(true)
  }

  async function handleConfirmReversePayment() {
    if (!targetReverseInvoice) return
    if (!reverseReason.trim()) {
      toast.error("Le motif d'annulation du paiement est obligatoire.")
      return
    }
    setSubmittingReverse(true)
    try {
      await repository.reversePurchasePayment(
        targetReverseInvoice.id,
        reverseReason.trim()
      )
      invalidateDashboardAnalyticsCache()
      await queryClient.invalidateQueries({ queryKey: ['factures-paiements-dataset'] })
      await queryClient.invalidateQueries({ queryKey: ['purchases'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      await queryClient.invalidateQueries({ queryKey: ['audit_log'] })

      toast.success(
        `Paiement de la facture ${targetReverseInvoice.invoiceNo} annulé et tracé dans le journal d'audit.`
      )
      setReverseDialogOpen(false)
      setTargetReverseInvoice(null)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Impossible d'annuler ce paiement."
      )
    } finally {
      setSubmittingReverse(false)
    }
  }

  function handleExportInvoices(format: 'xlsx' | 'csv') {
    if (!report || sortedInvoices.length === 0) {
      toast.error('Aucune facture à exporter.')
      return
    }
    const exportRows = sortedInvoices.map((inv) => {
      const base: Record<string, string | number> = {
        'Date (JJ/MM/AAAA)': formatDateFR(inv.date),
        'N° Facture / BL': inv.invoiceNo,
        Fournisseur: inv.supplierName,
        Statut:
          inv.paymentStatus === 'paid'
            ? 'Payé'
            : inv.paymentStatus === 'partial'
              ? 'Partiellement payé'
              : 'Impayé',
        'Date de paiement': inv.paymentDate ? formatDateFR(inv.paymentDate) : '—',
        'Mode de règlement': inv.paymentMethod || '—',
        'Réf. règlement': inv.paymentReference || '—',
        'Ancienneté (jours)': inv.paymentStatus === 'paid' ? 0 : inv.daysSincePurchase,
      }
      if (!priceHidden) {
        base['Montant TTC (DH)'] = inv.totalAmount ?? 0
        base['Montant réglé (DH)'] = inv.amountPaid ?? 0
        base['Reste à payer (DH)'] = inv.remainingAmount ?? 0
      }
      return base
    })

    const ws = XLSX.utils.json_to_sheet(exportRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Factures_Paiements')
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') {
      XLSX.writeFile(wb, `MONARQ_Factures_Paiements_${stamp}.csv`, { bookType: 'csv' })
    } else {
      XLSX.writeFile(wb, `MONARQ_Factures_Paiements_${stamp}.xlsx`)
    }
    toast.success(`Export ${format.toUpperCase()} téléchargé (${sortedInvoices.length} lignes).`)
  }

  if (priceHidden) {
    return (
      <PageShell
        section='GESTION'
        title='Factures & Paiements'
        description='Suivi des factures fournisseurs et règlements.'
      >
        <Card className='border-[#E1E3E5] bg-white p-8 text-center shadow-none'>
          <ShieldAlert className='mx-auto mb-3 h-8 w-8 text-[#B98900]' />
          <h2 className='text-base font-semibold text-[#202223]'>
            Accès restreint aux données financières
          </h2>
          <p className='mx-auto mt-1 max-w-md text-xs text-[#6D7175]'>
            Le profil Cuisine ne permet pas de consulter ou d’exporter les montants de factures et soldes fournisseurs.
          </p>
        </Card>
      </PageShell>
    )
  }

  return (
    <PageShell
      section='GESTION'
      title='Factures & Paiements'
      description='Suivi des factures fournisseurs (Payé / Impayé), échéances, règlements groupés et soldes fournisseurs en dirhams (DH).'
      primaryAction={
        !readOnly && selectedIds.length > 0
          ? {
              label: `Marquer comme payé (${selectedIds.length})`,
              onClick: () =>
                openMarkPaidModal(
                  sortedInvoices.filter((i) => selectedIds.includes(i.id))
                ),
              icon: CheckCircle2,
            }
          : {
              label: 'Voir les entrées de stock',
              to: '/entrees-de-stock',
              icon: ArrowDownToLine,
            }
      }
      secondaryActions={[
        {
          label: 'Exporter (.xlsx)',
          onClick: () => handleExportInvoices('xlsx'),
          icon: FileSpreadsheet,
        },
        {
          label: 'Exporter (.csv)',
          onClick: () => handleExportInvoices('csv'),
          icon: Download,
        },
        {
          label: 'Fournisseurs',
          to: '/fournisseurs',
          icon: Truck,
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
          <Skeleton className='h-96 w-full rounded-lg' />
        </div>
      ) : !dataset || dataset.purchases.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title='Aucune facture fournisseur enregistrée'
          description='Les factures et bons de livraison issus des entrées de stock apparaîtront ici avec leur statut (Payé / Impayé) et leur ancienneté.'
          columnsPreview={[
            'Date (JJ/MM/AAAA)',
            'N° Facture / BL',
            'Fournisseur',
            'Montant (DH)',
            'Statut',
            'Date de paiement',
            'Ancienneté (jours)',
          ]}
          primaryAction={{
            label: 'Saisir une entrée de stock',
            to: '/entrees-de-stock',
            icon: ArrowDownToLine,
          }}
          secondaryAction={{
            label: 'Importer depuis Excel',
            to: '/import-export',
            icon: FileSpreadsheet,
          }}
        />
      ) : (
        <div className='space-y-4'>
          {/* 4 Summary Cards */}
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Total impayé</span>
                <Receipt className='h-4 w-4 text-[#D72C0D]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#202223]'>
                {formatCurrencyMAD(report?.summary.totalUnpaidAmount ?? 0)}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                Encours global fournisseurs (hors documents annulés)
              </div>
            </Card>

            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Nombre de factures impayées</span>
                <Clock className='h-4 w-4 text-[#B98900]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#202223]'>
                {report?.summary.unpaidInvoicesCount ?? 0}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                En attente de règlement
              </div>
            </Card>

            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Impayé de plus de 30 jours</span>
                <AlertTriangle className='h-4 w-4 text-[#D72C0D]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#D72C0D]'>
                {formatCurrencyMAD(report?.summary.unpaidOver30DaysAmount ?? 0)}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                {report?.summary.unpaidOver30DaysCount ?? 0} facture(s) dépassant 30 jours
              </div>
            </Card>

            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Payé sur la période</span>
                <CheckCircle2 className='h-4 w-4 text-[#008060]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#008060]'>
                {formatCurrencyMAD(report?.summary.paidInPeriodAmount ?? 0)}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                {report?.summary.paidInPeriodCount ?? 0} facture(s) réglée(s)
              </div>
            </Card>
          </div>

          {/* Filter Bar */}
          <Card className='border-[#E1E3E5] bg-white p-3 shadow-none'>
            <div className='grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6'>
              <div className='relative'>
                <Search className='pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-[#6D7175]' />
                <Input
                  placeholder='N° facture, fournisseur...'
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(1)
                  }}
                  className='h-8 pl-8 text-xs'
                />
              </div>

              <Select
                value={supplierFilter}
                onValueChange={(v) => {
                  setSupplierFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className='h-8 text-xs'>
                  <SelectValue placeholder='Tous les fournisseurs' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all' className='text-xs'>
                    Tous les fournisseurs
                  </SelectItem>
                  {dataset.suppliers.map((sup) => (
                    <SelectItem key={sup.id} value={sup.id} className='text-xs'>
                      {sup.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v as typeof statusFilter)
                  setPage(1)
                }}
              >
                <SelectTrigger className='h-8 text-xs'>
                  <SelectValue placeholder='Tous les statuts' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all' className='text-xs'>
                    Tous les statuts
                  </SelectItem>
                  <SelectItem value='unpaid' className='text-xs'>
                    Impayé
                  </SelectItem>
                  {report?.partialPaymentsEnabled && (
                    <SelectItem value='partial' className='text-xs'>
                      Partiellement payé
                    </SelectItem>
                  )}
                  <SelectItem value='paid' className='text-xs'>
                    Payé
                  </SelectItem>
                </SelectContent>
              </Select>

              <div className='flex items-center gap-1.5'>
                <Input
                  type='date'
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value)
                    setPage(1)
                  }}
                  className='h-8 text-xs'
                  title='Date début'
                />
                <span className='text-xs text-[#6D7175]'>→</span>
                <Input
                  type='date'
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value)
                    setPage(1)
                  }}
                  className='h-8 text-xs'
                  title='Date fin'
                />
              </div>

              <div className='flex items-center gap-1.5'>
                <Input
                  type='number'
                  placeholder='Min DH'
                  value={minAmountStr}
                  onChange={(e) => {
                    setMinAmountStr(e.target.value)
                    setPage(1)
                  }}
                  className='h-8 text-xs'
                />
                <Input
                  type='number'
                  placeholder='Max DH'
                  value={maxAmountStr}
                  onChange={(e) => {
                    setMaxAmountStr(e.target.value)
                    setPage(1)
                  }}
                  className='h-8 text-xs'
                />
              </div>

              <div className='flex items-center justify-end gap-1.5'>
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

          {/* Tabs: Liste des factures | Par fournisseur (soldes & relevés) | Historique des paiements */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          >
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <TabsList className='h-9 bg-[#EBEBEB]'>
                <TabsTrigger value='invoices' className='text-xs'>
                  <Receipt className='mr-1.5 h-3.5 w-3.5' />
                  Factures ({sortedInvoices.length})
                </TabsTrigger>
                <TabsTrigger value='suppliers' className='text-xs'>
                  <Building2 className='mr-1.5 h-3.5 w-3.5' />
                  Par fournisseur ({report?.supplierBalances.length ?? 0})
                </TabsTrigger>
                <TabsTrigger value='history' className='text-xs'>
                  <History className='mr-1.5 h-3.5 w-3.5' />
                  Historique des paiements ({dataset.paymentEvents.length})
                </TabsTrigger>
              </TabsList>

              {!readOnly && selectedIds.length > 0 && (
                <div className='flex items-center gap-2 rounded-md border border-[#E1E3E5] bg-white px-3 py-1 text-xs'>
                  <span className='font-medium text-[#202223]'>
                    {selectedIds.length} facture(s) sélectionnée(s)
                  </span>
                  <Button
                    size='sm'
                    className='h-7 bg-[#008060] text-xs text-white hover:bg-[#006e52]'
                    onClick={() =>
                      openMarkPaidModal(
                        sortedInvoices.filter((i) => selectedIds.includes(i.id))
                      )
                    }
                  >
                    <CheckCircle2 className='mr-1 h-3.5 w-3.5' />
                    Marquer comme payé
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-7 text-xs'
                    onClick={() => setSelectedIds([])}
                  >
                    Effacer
                  </Button>
                </div>
              )}
            </div>

            {/* TAB 1: INVOICES TABLE */}
            <TabsContent value='invoices' className='mt-3'>
              <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      {!readOnly && (
                        <TableHead className='w-10 px-3'>
                          <Checkbox
                            checked={
                              unpaidInView.length > 0 &&
                              unpaidInView.every((i) => selectedIds.includes(i.id))
                            }
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedIds(unpaidInView.map((i) => i.id))
                              } else {
                                setSelectedIds([])
                              }
                            }}
                            aria-label='Tout sélectionner'
                          />
                        </TableHead>
                      )}
                      <TableHead
                        className='cursor-pointer text-xs font-semibold'
                        onClick={() => handleSort('date')}
                      >
                        <span className='inline-flex items-center gap-1'>
                          Date <ArrowUpDown className='h-3 w-3' />
                        </span>
                      </TableHead>
                      <TableHead
                        className='cursor-pointer text-xs font-semibold'
                        onClick={() => handleSort('invoiceNo')}
                      >
                        <span className='inline-flex items-center gap-1'>
                          N° facture <ArrowUpDown className='h-3 w-3' />
                        </span>
                      </TableHead>
                      <TableHead
                        className='cursor-pointer text-xs font-semibold'
                        onClick={() => handleSort('supplierName')}
                      >
                        <span className='inline-flex items-center gap-1'>
                          Fournisseur <ArrowUpDown className='h-3 w-3' />
                        </span>
                      </TableHead>
                      <TableHead
                        className='cursor-pointer text-right text-xs font-semibold'
                        onClick={() => handleSort('totalAmount')}
                      >
                        <span className='inline-flex items-center justify-end gap-1'>
                          Montant <ArrowUpDown className='h-3 w-3' />
                        </span>
                      </TableHead>
                      <TableHead
                        className='cursor-pointer text-xs font-semibold'
                        onClick={() => handleSort('paymentStatus')}
                      >
                        <span className='inline-flex items-center gap-1'>
                          Statut <ArrowUpDown className='h-3 w-3' />
                        </span>
                      </TableHead>
                      <TableHead
                        className='cursor-pointer text-xs font-semibold'
                        onClick={() => handleSort('paymentDate')}
                      >
                        <span className='inline-flex items-center gap-1'>
                          Date de paiement <ArrowUpDown className='h-3 w-3' />
                        </span>
                      </TableHead>
                      <TableHead
                        className='cursor-pointer text-right text-xs font-semibold'
                        onClick={() => handleSort('daysSincePurchase')}
                      >
                        <span className='inline-flex items-center justify-end gap-1'>
                          Ancienneté <ArrowUpDown className='h-3 w-3' />
                        </span>
                      </TableHead>
                      <TableHead className='px-4 text-right text-xs font-semibold'>
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedInvoices.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={readOnly ? 8 : 9}
                          className='py-8 text-center text-xs text-[#6D7175]'
                        >
                          Aucune facture ne correspond aux filtres sélectionnés.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedInvoices.map((inv) => {
                        const isUnpaid = inv.paymentStatus !== 'paid'
                        const checked = selectedIds.includes(inv.id)
                        return (
                          <TableRow key={inv.id} className='hover:bg-[#F6F6F7]/60'>
                            {!readOnly && (
                              <TableCell className='px-3'>
                                {isUnpaid ? (
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(val) => {
                                      setSelectedIds((prev) =>
                                        val
                                          ? [...prev, inv.id]
                                          : prev.filter((id) => id !== inv.id)
                                      )
                                    }}
                                  />
                                ) : null}
                              </TableCell>
                            )}
                            <TableCell className='tabular-nums text-xs'>
                              {formatDateFR(inv.date)}
                            </TableCell>
                            <TableCell className='text-xs font-medium'>
                              <button
                                type='button'
                                className='text-left font-mono text-xs text-[#202223] underline-offset-2 hover:underline'
                                onClick={() =>
                                  void navigate({
                                    to: '/entrees-de-stock',
                                  })
                                }
                              >
                                {inv.invoiceNo}
                              </button>
                            </TableCell>
                            <TableCell className='text-xs'>{inv.supplierName}</TableCell>
                            <TableCell className='text-right tabular-nums text-xs font-semibold'>
                              {formatCurrencyMAD(inv.totalAmount ?? 0)}
                              {inv.paymentStatus === 'partial' && (
                                <div className='text-[10px] font-normal text-[#B98900]'>
                                  Reste : {formatCurrencyMAD(inv.remainingAmount ?? 0)}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {inv.paymentStatus === 'paid' ? (
                                <Badge className='border-0 bg-[#008060]/10 text-[11px] font-medium text-[#008060]'>
                                  Payé
                                </Badge>
                              ) : inv.paymentStatus === 'partial' ? (
                                <Badge className='border-0 bg-[#B98900]/15 text-[11px] font-medium text-[#B98900]'>
                                  Partiellement payé
                                </Badge>
                              ) : (
                                <Badge className='border-0 bg-[#D72C0D]/10 text-[11px] font-medium text-[#D72C0D]'>
                                  Impayé
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className='tabular-nums text-xs text-[#6D7175]'>
                              {inv.paymentDate ? (
                                <div>
                                  <div>{formatDateFR(inv.paymentDate)}</div>
                                  {inv.paymentMethod && (
                                    <div className='text-[10px] text-[#6D7175]'>
                                      {inv.paymentMethod}
                                      {inv.paymentReference
                                        ? ` (${inv.paymentReference})`
                                        : ''}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className='text-right tabular-nums text-xs'>
                              {inv.paymentStatus === 'paid' ? (
                                <span className='text-[#6D7175]'>—</span>
                              ) : (
                                <span
                                  className={
                                    inv.daysSincePurchase > 30
                                      ? 'font-semibold text-[#D72C0D]'
                                      : 'text-[#202223]'
                                  }
                                >
                                  {inv.daysSincePurchase} j
                                </span>
                              )}
                            </TableCell>
                            <TableCell className='px-4 text-right'>
                              <div className='flex items-center justify-end gap-1.5'>
                                {!readOnly && inv.paymentStatus !== 'paid' && (
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    className='h-7 border-[#008060]/30 text-[11px] text-[#008060] hover:bg-[#008060]/5'
                                    onClick={() => openMarkPaidModal([inv])}
                                  >
                                    <CheckCircle2 className='mr-1 h-3 w-3' />
                                    Marquer comme payé
                                  </Button>
                                )}
                                {!readOnly &&
                                  canReversePayment &&
                                  (inv.paymentStatus === 'paid' ||
                                    inv.paymentStatus === 'partial') && (
                                    <Button
                                      size='sm'
                                      variant='ghost'
                                      className='h-7 text-[11px] text-[#D72C0D] hover:bg-[#D72C0D]/10'
                                      onClick={() => openReversePaymentModal(inv)}
                                    >
                                      <RotateCcw className='mr-1 h-3 w-3' />
                                      Annuler un paiement
                                    </Button>
                                  )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>

                {/* Pagination Footer */}
                {sortedInvoices.length > pageSize && (
                  <div className='flex items-center justify-between border-t border-[#E1E3E5] px-4 py-2.5 text-xs text-[#6D7175]'>
                    <span>
                      Affichage {(currentPage - 1) * pageSize + 1}–
                      {Math.min(currentPage * pageSize, sortedInvoices.length)} sur{' '}
                      {sortedInvoices.length} factures
                    </span>
                    <div className='flex items-center gap-1.5'>
                      <Button
                        size='sm'
                        variant='outline'
                        className='h-7 text-xs'
                        disabled={currentPage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Précédent
                      </Button>
                      <span className='px-2 font-medium text-[#202223]'>
                        Page {currentPage} / {totalPages}
                      </span>
                      <Button
                        size='sm'
                        variant='outline'
                        className='h-7 text-xs'
                        disabled={currentPage >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Suivant
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </TabsContent>

            {/* TAB 2: GROUP BY SUPPLIER */}
            <TabsContent value='suppliers' className='mt-3'>
              <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      <TableHead className='px-4 text-xs font-semibold'>
                        Fournisseur
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Factures impayées
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Total facturé
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Total réglé
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Solde restant dû
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Dont &gt; 30 jours
                      </TableHead>
                      <TableHead className='px-4 text-right text-xs font-semibold'>
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(report?.supplierBalances ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className='py-8 text-center text-xs text-[#6D7175]'
                        >
                          Aucun solde fournisseur sur la sélection actuelle.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (report?.supplierBalances ?? []).map((sup) => (
                        <TableRow key={sup.supplierId}>
                          <TableCell className='px-4 text-xs font-semibold text-[#202223]'>
                            {sup.supplierName}
                          </TableCell>
                          <TableCell className='text-right tabular-nums text-xs'>
                            {sup.unpaidInvoicesCount}
                          </TableCell>
                          <TableCell className='text-right tabular-nums text-xs'>
                            {formatCurrencyMAD(sup.totalInvoiced ?? 0)}
                          </TableCell>
                          <TableCell className='text-right tabular-nums text-xs text-[#008060]'>
                            {formatCurrencyMAD(sup.totalPaid ?? 0)}
                          </TableCell>
                          <TableCell className='text-right tabular-nums text-xs font-bold text-[#D72C0D]'>
                            {formatCurrencyMAD(sup.outstandingBalance ?? 0)}
                          </TableCell>
                          <TableCell className='text-right tabular-nums text-xs text-[#B98900]'>
                            {formatCurrencyMAD(sup.overdueOver30DaysAmount ?? 0)}
                          </TableCell>
                          <TableCell className='px-4 text-right'>
                            <div className='flex items-center justify-end gap-1.5'>
                              <Button
                                size='sm'
                                variant='outline'
                                className='h-7 text-[11px]'
                                onClick={() => setStatementSupplier(sup)}
                              >
                                <FileText className='mr-1 h-3 w-3' />
                                Relevé fournisseur
                              </Button>
                              {!readOnly && sup.unpaidInvoicesCount > 0 && (
                                <Button
                                  size='sm'
                                  className='h-7 bg-[#008060] text-[11px] text-white hover:bg-[#006e52]'
                                  onClick={() =>
                                    openMarkPaidModal(
                                      sup.invoices.filter(
                                        (i) => i.paymentStatus !== 'paid'
                                      )
                                    )
                                  }
                                >
                                  Tout régler ({sup.unpaidInvoicesCount})
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>

            {/* TAB 3: PAYMENT HISTORY */}
            <TabsContent value='history' className='mt-3'>
              <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      <TableHead className='px-4 text-xs font-semibold'>
                        Date règlement
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Événement
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        N° Facture
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Mode de paiement
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Référence / Motif
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Montant
                      </TableHead>
                      <TableHead className='px-4 text-xs font-semibold'>
                        Utilisateur
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dataset.paymentEvents.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className='py-8 text-center text-xs text-[#6D7175]'
                        >
                          Aucun événement de paiement enregistré dans cette session.
                        </TableCell>
                      </TableRow>
                    ) : (
                      dataset.paymentEvents.map((ev) => {
                        const pur = dataset.purchases.find(
                          (p) => p.id === ev.purchase_id
                        )
                        return (
                          <TableRow key={ev.id}>
                            <TableCell className='px-4 tabular-nums text-xs'>
                              {formatDateFR(ev.date)}
                            </TableCell>
                            <TableCell>
                              {ev.type === 'reversal' ? (
                                <Badge className='border-0 bg-[#D72C0D]/10 text-[11px] text-[#D72C0D]'>
                                  Annulation paiement
                                </Badge>
                              ) : (
                                <Badge className='border-0 bg-[#008060]/10 text-[11px] text-[#008060]'>
                                  Règlement enregistré
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className='font-mono text-xs'>
                              {ev.invoice_no || pur?.invoice_no || ev.purchase_id.slice(0, 8)}
                            </TableCell>
                            <TableCell className='text-xs'>
                              {ev.method || '—'}
                            </TableCell>
                            <TableCell className='text-xs text-[#6D7175]'>
                              {ev.type === 'reversal'
                                ? `Motif : ${ev.reversal_reason || '—'}`
                                : ev.reference || '—'}
                            </TableCell>
                            <TableCell
                              className={`text-right tabular-nums text-xs font-semibold ${
                                ev.amount < 0 ? 'text-[#D72C0D]' : 'text-[#008060]'
                              }`}
                            >
                              {formatCurrencyMAD(ev.amount)}
                            </TableCell>
                            <TableCell className='px-4 text-xs'>
                              {ev.user_name}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* DIALOG: MARQUER COMME PAYÉ */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              {targetPayInvoices.length > 1
                ? `Régler ${targetPayInvoices.length} factures fournisseurs`
                : `Marquer la facture ${targetPayInvoices[0]?.invoiceNo ?? ''} comme payée`}
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Enregistrez la date et le mode de règlement. Cette opération met à jour le solde fournisseur et le journal d’audit.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-3 py-2 text-xs'>
            <div className='rounded-md border border-[#E1E3E5] bg-[#F6F6F7] p-3'>
              <div className='flex items-center justify-between'>
                <span className='text-[#6D7175]'>Montant total à régler</span>
                <span className='text-sm font-bold tabular-nums text-[#202223]'>
                  {formatCurrencyMAD(
                    targetPayInvoices.reduce(
                      (acc, i) => acc + (i.remainingAmount ?? i.totalAmount ?? 0),
                      0
                    )
                  )}
                </span>
              </div>
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs'>Date de paiement</Label>
              <Input
                type='date'
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className='h-8 text-xs'
              />
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs'>Mode de paiement (optionnel)</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger className='h-8 text-xs'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m} value={m} className='text-xs'>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs'>
                Référence de règlement (n° chèque, virement...)
              </Label>
              <Input
                placeholder='Ex. CHQ-884120 ou VIR-BMCE'
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
                className='h-8 text-xs'
              />
            </div>

            {report?.partialPaymentsEnabled && targetPayInvoices.length === 1 && (
              <div className='space-y-1.5'>
                <Label className='text-xs'>
                  Montant réglé en DH (paiement partiel activé)
                </Label>
                <Input
                  type='number'
                  step='0.01'
                  value={payPartialAmount}
                  onChange={(e) => setPayPartialAmount(e.target.value)}
                  className='h-8 text-xs'
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPayDialogOpen(false)}
              disabled={submittingPay}
            >
              Annuler
            </Button>
            <Button
              size='sm'
              className='bg-[#008060] text-white hover:bg-[#006e52]'
              onClick={() => void handleConfirmPayment()}
              disabled={submittingPay}
            >
              {submittingPay && <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />}
              Confirmer le paiement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: ANNULER UN PAIEMENT */}
      <Dialog open={reverseDialogOpen} onOpenChange={setReverseDialogOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base text-[#D72C0D]'>
              Annuler le paiement ({targetReverseInvoice?.invoiceNo})
            </DialogTitle>
            <DialogDescription className='text-xs'>
              L’annulation d’un règlement rétablit le statut « Impayé », crée une écriture d’extourne de paiement et journalise l’opération dans l’audit.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-3 py-2 text-xs'>
            <div className='space-y-1.5'>
              <Label className='text-xs font-semibold'>
                Motif obligatoire de l’annulation *
              </Label>
              <Textarea
                placeholder='Ex. Erreur de saisie de facture, chèque rejeté...'
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                rows={3}
                className='text-xs'
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setReverseDialogOpen(false)}
              disabled={submittingReverse}
            >
              Fermer
            </Button>
            <Button
              size='sm'
              variant='destructive'
              onClick={() => void handleConfirmReversePayment()}
              disabled={submittingReverse || !reverseReason.trim()}
            >
              {submittingReverse && (
                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
              )}
              Confirmer l’annulation du paiement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: RELEVÉ FOURNISSEUR IMPRIMABLE */}
      <Dialog
        open={Boolean(statementSupplier)}
        onOpenChange={(open) => !open && setStatementSupplier(null)}
      >
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              Relevé fournisseur — {statementSupplier?.supplierName}
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Situation des factures impayées éditée le{' '}
              {formatDateTimeFR(new Date().toISOString())} par{' '}
              {auth.user?.name || 'Administrateur'}.
            </DialogDescription>
          </DialogHeader>

          {statementSupplier && (
            <div className='space-y-4 py-2 text-xs'>
              <div className='grid grid-cols-3 gap-3 rounded-md border border-[#E1E3E5] bg-[#F6F6F7] p-3'>
                <div>
                  <span className='text-[#6D7175]'>Factures impayées</span>
                  <div className='mt-0.5 text-sm font-bold'>
                    {statementSupplier.unpaidInvoicesCount}
                  </div>
                </div>
                <div>
                  <span className='text-[#6D7175]'>Total réglé</span>
                  <div className='mt-0.5 text-sm font-bold text-[#008060]'>
                    {formatCurrencyMAD(statementSupplier.totalPaid ?? 0)}
                  </div>
                </div>
                <div>
                  <span className='text-[#6D7175]'>Solde net à payer</span>
                  <div className='mt-0.5 text-sm font-bold text-[#D72C0D]'>
                    {formatCurrencyMAD(statementSupplier.outstandingBalance ?? 0)}
                  </div>
                </div>
              </div>

              <div className='max-h-72 overflow-auto rounded-md border border-[#E1E3E5]'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      <TableHead className='text-xs'>Date</TableHead>
                      <TableHead className='text-xs'>N° Facture</TableHead>
                      <TableHead className='text-xs'>Statut</TableHead>
                      <TableHead className='text-right text-xs'>Ancienneté</TableHead>
                      <TableHead className='text-right text-xs'>Reste à payer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statementSupplier.invoices
                      .filter((i) => i.paymentStatus !== 'paid')
                      .map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className='tabular-nums text-xs'>
                            {formatDateFR(inv.date)}
                          </TableCell>
                          <TableCell className='font-mono text-xs'>
                            {inv.invoiceNo}
                          </TableCell>
                          <TableCell className='text-xs'>
                            {inv.paymentStatus === 'partial'
                              ? 'Partiellement payé'
                              : 'Impayé'}
                          </TableCell>
                          <TableCell className='text-right tabular-nums text-xs'>
                            {inv.daysSincePurchase} jours
                          </TableCell>
                          <TableCell className='text-right tabular-nums text-xs font-semibold'>
                            {formatCurrencyMAD(inv.remainingAmount ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setStatementSupplier(null)}
            >
              Fermer
            </Button>
            <Button
              size='sm'
              onClick={() => window.print()}
            >
              <Printer className='mr-1.5 h-3.5 w-3.5' />
              Imprimer le relevé
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
