import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  ExternalLink,
  FileSpreadsheet,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import {
  computeUnifiedMovementTimeline,
  type UnifiedMovementRow,
} from '@/data/analytics'
import {
  formatCurrencyMAD,
  formatDateFR,
  formatDateTimeFR,
  formatQuantity,
} from '@/lib/formatters'
import {
  canPerformCollectionAction,
  canReverseOrApprove,
} from '@/lib/rbac'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/empty-state'
import { PageShell } from '@/components/layout/page-shell'

export function HistoriqueMouvements() {
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const role = auth.user?.role ?? 'consultation'
  const priceHidden = role === 'cuisine'
  const canViewAuditLog = canReverseOrApprove(role)

  const [activeTab, setActiveTab] = useState<'movements' | 'audit'>('movements')

  // Movement timeline filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [typeFilter, setTypeFilter] = useState<
    'all' | 'entry' | 'exit' | 'loss' | 'inventory' | 'reversal' | 'import'
  >('all')
  const [productFilter, setProductFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('all')
  const [docSearch, setDocSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25

  // Audit log filters
  const [auditUserFilter, setAuditUserFilter] = useState('all')
  const [auditActionFilter, setAuditActionFilter] = useState('all')
  const [auditCollectionFilter, setAuditCollectionFilter] = useState('all')
  const [auditDateFrom, setAuditDateFrom] = useState('')
  const [auditDateTo, setAuditDateTo] = useState('')

  const { data: dataset, isLoading, refetch } = useQuery({
    queryKey: ['historique-mouvements-dataset', role],
    queryFn: async () => {
      const canListUsers = canPerformCollectionAction(role, 'users', 'list')
      const canListAudit = canPerformCollectionAction(role, 'audit_log', 'list')
      const [products, suppliers, pur, ext, inv, settings, users, auditLogs] =
        await Promise.all([
          repository.listProducts(),
          repository.listSuppliers(),
          repository.listPurchases(),
          repository.listExits(),
          repository.listInventories(),
          repository.listSettings(),
          canListUsers
            ? repository.listUsers()
            : repository.getCurrentUser().then((u) => (u ? [u] : [])),
          canListAudit ? repository.listAuditLogs() : Promise.resolve([]),
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
        auditLogs,
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

  const movements = useMemo(() => {
    if (!dataset) return []
    return computeUnifiedMovementTimeline(dataset, {
      from: dateFrom || null,
      to: dateTo || null,
      type: typeFilter,
      productId: productFilter,
      category: categoryFilter,
      supplierId: supplierFilter,
      userId: userFilter,
      documentSearch: docSearch,
      role,
    })
  }, [
    dataset,
    dateFrom,
    dateTo,
    typeFilter,
    productFilter,
    categoryFilter,
    supplierFilter,
    userFilter,
    docSearch,
    role,
  ])

  const totalPages = Math.max(1, Math.ceil(movements.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paginatedMovements = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return movements.slice(start, start + pageSize)
  }, [movements, currentPage])

  const filteredAuditLogs = useMemo(() => {
    if (!dataset) return []
    return dataset.auditLogs.filter((entry) => {
      const day = entry.timestamp.slice(0, 10)
      if (auditDateFrom && day < auditDateFrom) return false
      if (auditDateTo && day > auditDateTo) return false
      if (
        auditUserFilter !== 'all' &&
        entry.user !== auditUserFilter &&
        entry.user_email !== auditUserFilter
      )
        return false
      if (auditActionFilter !== 'all' && entry.action !== auditActionFilter)
        return false
      if (
        auditCollectionFilter !== 'all' &&
        entry.collection !== auditCollectionFilter
      )
        return false
      return true
    })
  }, [
    dataset,
    auditDateFrom,
    auditDateTo,
    auditUserFilter,
    auditActionFilter,
    auditCollectionFilter,
  ])

  const auditActions = useMemo(() => {
    if (!dataset) return []
    const set = new Set<string>()
    for (const a of dataset.auditLogs) set.add(a.action)
    return Array.from(set).sort()
  }, [dataset])

  const auditCollections = useMemo(() => {
    if (!dataset) return []
    const set = new Set<string>()
    for (const a of dataset.auditLogs) set.add(a.collection)
    return Array.from(set).sort()
  }, [dataset])

  function resetMovementFilters() {
    setDateFrom('')
    setDateTo('')
    setTypeFilter('all')
    setProductFilter('all')
    setCategoryFilter('all')
    setSupplierFilter('all')
    setUserFilter('all')
    setDocSearch('')
    setPage(1)
  }

  function handleExportMovements(format: 'xlsx' | 'csv') {
    if (movements.length === 0) {
      toast.error('Aucun mouvement à exporter.')
      return
    }
    const rows = movements.map((m) => {
      const row: Record<string, string | number> = {
        Date: formatDateFR(m.date),
        Type: m.typeLabel,
        Référence: m.productRef,
        Produit: m.productName,
        Catégorie: m.category,
        'Quantité (+/-)': m.qtyDelta,
        'Stock après': m.stockAfter,
        Unité: m.unit,
        Document: m.documentLabel,
        Fournisseur: m.supplierName || '—',
        Utilisateur: m.userName,
      }
      if (!priceHidden) {
        row['Valeur (DH)'] = m.valueDelta ?? 0
      }
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Historique_Mouvements')
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') {
      XLSX.writeFile(wb, `MONARQ_Mouvements_${stamp}.csv`, { bookType: 'csv' })
    } else {
      XLSX.writeFile(wb, `MONARQ_Mouvements_${stamp}.xlsx`)
    }
    toast.success(`Export ${format.toUpperCase()} téléchargé (${movements.length} lignes).`)
  }

  function renderTypeBadge(row: UnifiedMovementRow) {
    switch (row.type) {
      case 'entry':
        return (
          <Badge className='border-0 bg-[#008060]/10 text-[11px] text-[#008060]'>
            Entrée
          </Badge>
        )
      case 'import':
        return (
          <Badge className='border-0 bg-[#008060]/15 text-[11px] text-[#008060]'>
            Import
          </Badge>
        )
      case 'exit':
        return (
          <Badge variant='secondary' className='text-[11px]'>
            Sortie
          </Badge>
        )
      case 'loss':
        return (
          <Badge className='border-0 bg-[#D72C0D]/10 text-[11px] text-[#D72C0D]'>
            Perte
          </Badge>
        )
      case 'inventory':
        return (
          <Badge className='border-0 bg-[#B98900]/15 text-[11px] text-[#B98900]'>
            Inventaire
          </Badge>
        )
      case 'reversal':
        return (
          <Badge className='border-0 bg-[#D72C0D]/15 text-[11px] text-[#D72C0D]'>
            Correction / Annulation
          </Badge>
        )
    }
  }

  return (
    <PageShell
      section='ANALYSE'
      title='Historique des mouvements'
      description='Chronologie unifiée en lecture seule de tous les mouvements de stock (entrées, sorties, pertes, inventaires, corrections) et journal d’audit.'
      primaryAction={{
        label: 'Exporter (.xlsx)',
        onClick: () => handleExportMovements('xlsx'),
        icon: FileSpreadsheet,
      }}
      secondaryActions={[
        {
          label: 'Exporter (.csv)',
          onClick: () => handleExportMovements('csv'),
          icon: Download,
        },
        {
          label: 'Actualiser',
          onClick: () => void refetch(),
          icon: RefreshCw,
        },
      ]}
    >
      {isLoading ? (
        <div className='space-y-4'>
          <Skeleton className='h-20 w-full rounded-lg' />
          <Skeleton className='h-96 w-full rounded-lg' />
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        >
          <TabsList className='h-9 bg-[#EBEBEB]'>
            <TabsTrigger value='movements' className='text-xs'>
              <History className='mr-1.5 h-3.5 w-3.5' />
              Chronologie des mouvements ({movements.length})
            </TabsTrigger>
            {canViewAuditLog && (
              <TabsTrigger value='audit' className='text-xs'>
                <ShieldCheck className='mr-1.5 h-3.5 w-3.5' />
                Journal d’audit ({filteredAuditLogs.length})
              </TabsTrigger>
            )}
          </TabsList>

          {/* TAB 1: UNIFIED MOVEMENT TIMELINE */}
          <TabsContent value='movements' className='mt-3 space-y-3'>
            <Card className='border-[#E1E3E5] bg-white p-3 shadow-none'>
              <div className='grid gap-2.5 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7'>
                <div className='relative'>
                  <Search className='pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-[#6D7175]' />
                  <Input
                    placeholder='Document, produit...'
                    value={docSearch}
                    onChange={(e) => {
                      setDocSearch(e.target.value)
                      setPage(1)
                    }}
                    className='h-8 pl-8 text-xs'
                  />
                </div>

                <Select
                  value={typeFilter}
                  onValueChange={(v) => {
                    setTypeFilter(v as typeof typeFilter)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className='h-8 text-xs'>
                    <SelectValue placeholder='Tous les types' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all' className='text-xs'>
                      Tous les types
                    </SelectItem>
                    <SelectItem value='entry' className='text-xs'>
                      Entrées
                    </SelectItem>
                    <SelectItem value='exit' className='text-xs'>
                      Sorties (consommation)
                    </SelectItem>
                    <SelectItem value='loss' className='text-xs'>
                      Pertes & gaspillage
                    </SelectItem>
                    <SelectItem value='inventory' className='text-xs'>
                      Inventaires
                    </SelectItem>
                    <SelectItem value='reversal' className='text-xs'>
                      Annulations / Corrections
                    </SelectItem>
                    <SelectItem value='import' className='text-xs'>
                      Imports Excel
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={productFilter}
                  onValueChange={(v) => {
                    setProductFilter(v)
                    setPage(1)
                  }}
                >
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

                <Select
                  value={categoryFilter}
                  onValueChange={(v) => {
                    setCategoryFilter(v)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className='h-8 text-xs'>
                    <SelectValue placeholder='Catégorie' />
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

                <Select
                  value={supplierFilter}
                  onValueChange={(v) => {
                    setSupplierFilter(v)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className='h-8 text-xs'>
                    <SelectValue placeholder='Fournisseur' />
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

                <div className='flex items-center gap-1'>
                  <Input
                    type='date'
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value)
                      setPage(1)
                    }}
                    className='h-8 text-xs'
                  />
                  <Input
                    type='date'
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value)
                      setPage(1)
                    }}
                    className='h-8 text-xs'
                  />
                </div>

                <div className='flex items-center justify-end'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={resetMovementFilters}
                    className='h-8 text-xs'
                  >
                    <X className='mr-1 h-3.5 w-3.5' />
                    Réinitialiser
                  </Button>
                </div>
              </div>
            </Card>

            {movements.length === 0 ? (
              <EmptyState
                icon={History}
                title='Aucun mouvement sur la sélection'
                description='Les entrées, sorties, pertes, inventaires et écritures de contre-passation apparaîtront dans cette chronologie.'
                columnsPreview={[
                  'Date/heure',
                  'Type',
                  'Produit',
                  'Quantité (+/-)',
                  'Stock après',
                  ...(priceHidden ? [] : ['Valeur (DH)']),
                  'Document',
                  'Utilisateur',
                ]}
                primaryAction={{
                  label: 'Entrées de stock',
                  to: '/entrees-de-stock',
                  icon: ArrowDownToLine,
                }}
                secondaryAction={{
                  label: 'Sorties de stock',
                  to: '/sorties-de-stock',
                  icon: ArrowUpFromLine,
                }}
              />
            ) : (
              <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      <TableHead className='px-4 text-xs font-semibold'>
                        Date / heure
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>Type</TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Produit
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Quantité (+/−)
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Stock après
                      </TableHead>
                      {!priceHidden && (
                        <TableHead className='text-right text-xs font-semibold'>
                          Valeur
                        </TableHead>
                      )}
                      <TableHead className='text-xs font-semibold'>
                        Document
                      </TableHead>
                      <TableHead className='px-4 text-xs font-semibold'>
                        Utilisateur
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedMovements.map((m) => (
                      <TableRow
                        key={m.id}
                        className={
                          m.isReversedOrReversal ? 'bg-[#F6F6F7]/50 opacity-80' : ''
                        }
                      >
                        <TableCell className='px-4 tabular-nums text-xs'>
                          <div>{formatDateFR(m.date)}</div>
                          <div className='text-[10px] text-[#6D7175]'>
                            {formatDateTimeFR(m.timestamp).slice(11)}
                          </div>
                        </TableCell>
                        <TableCell>{renderTypeBadge(m)}</TableCell>
                        <TableCell className='text-xs'>
                          <div className='font-medium text-[#202223]'>
                            {m.productName}
                          </div>
                          <div className='text-[11px] text-[#6D7175]'>
                            {m.productRef} · {m.category}
                          </div>
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
                        <TableCell className='text-right tabular-nums text-xs font-semibold text-[#202223]'>
                          {formatQuantity(m.stockAfter)} {m.unit}
                        </TableCell>
                        {!priceHidden && (
                          <TableCell className='text-right tabular-nums text-xs'>
                            {m.valueDelta !== null
                              ? formatCurrencyMAD(m.valueDelta)
                              : '—'}
                          </TableCell>
                        )}
                        <TableCell className='text-xs'>
                          <button
                            type='button'
                            className='inline-flex items-center gap-1 text-left font-medium text-[#202223] underline-offset-2 hover:underline'
                            onClick={() => void navigate({ to: m.linkTo })}
                          >
                            <span>{m.documentLabel}</span>
                            <ExternalLink className='h-3 w-3 opacity-60' />
                          </button>
                          {m.reversedOfId && (
                            <div className='text-[10px] text-[#D72C0D]'>
                              Contre-passation de #{m.reversedOfId.slice(0, 6)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className='px-4 text-xs text-[#6D7175]'>
                          {m.userName}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {movements.length > pageSize && (
                  <div className='flex items-center justify-between border-t border-[#E1E3E5] px-4 py-2.5 text-xs text-[#6D7175]'>
                    <span>
                      Affichage {(currentPage - 1) * pageSize + 1}–
                      {Math.min(currentPage * pageSize, movements.length)} sur{' '}
                      {movements.length} mouvements
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
            )}
          </TabsContent>

          {/* TAB 2: IMMUTABLE AUDIT LOG (ADMIN / MANAGER ONLY) */}
          {canViewAuditLog && (
            <TabsContent value='audit' className='mt-3 space-y-3'>
              <Card className='border-[#E1E3E5] bg-white p-3 shadow-none'>
                <div className='grid gap-2.5 sm:grid-cols-2 md:grid-cols-5'>
                  <Select
                    value={auditUserFilter}
                    onValueChange={setAuditUserFilter}
                  >
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue placeholder='Tous les utilisateurs' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all' className='text-xs'>
                        Tous les utilisateurs
                      </SelectItem>
                      {dataset?.users.map((u) => (
                        <SelectItem key={u.id} value={u.id} className='text-xs'>
                          {u.name} ({u.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={auditActionFilter}
                    onValueChange={setAuditActionFilter}
                  >
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue placeholder='Toutes les actions' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all' className='text-xs'>
                        Toutes les actions
                      </SelectItem>
                      {auditActions.map((act) => (
                        <SelectItem key={act} value={act} className='text-xs'>
                          {act}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={auditCollectionFilter}
                    onValueChange={setAuditCollectionFilter}
                  >
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue placeholder='Toutes les collections' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all' className='text-xs'>
                        Toutes les collections
                      </SelectItem>
                      {auditCollections.map((col) => (
                        <SelectItem key={col} value={col} className='text-xs'>
                          {col}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    type='date'
                    value={auditDateFrom}
                    onChange={(e) => setAuditDateFrom(e.target.value)}
                    className='h-8 text-xs'
                  />

                  <Input
                    type='date'
                    value={auditDateTo}
                    onChange={(e) => setAuditDateTo(e.target.value)}
                    className='h-8 text-xs'
                  />
                </div>
              </Card>

              <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      <TableHead className='px-4 text-xs font-semibold'>
                        Horodatage
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Utilisateur
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Action
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Collection
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        ID Enregistrement
                      </TableHead>
                      <TableHead className='px-4 text-xs font-semibold'>
                        Détails
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAuditLogs.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className='py-8 text-center text-xs text-[#6D7175]'
                        >
                          Aucun événement d’audit pour ces filtres.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAuditLogs.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className='px-4 tabular-nums text-xs'>
                            {formatDateTimeFR(entry.timestamp)}
                          </TableCell>
                          <TableCell className='text-xs font-medium'>
                            {entry.user_email || entry.user || 'Système'}
                          </TableCell>
                          <TableCell>
                            <Badge variant='secondary' className='text-[11px]'>
                              {entry.action}
                            </Badge>
                          </TableCell>
                          <TableCell className='font-mono text-xs'>
                            {entry.collection}
                          </TableCell>
                          <TableCell className='font-mono text-xs text-[#6D7175]'>
                            {entry.record_id}
                          </TableCell>
                          <TableCell className='max-w-md truncate px-4 font-mono text-xs text-[#6D7175]'>
                            {JSON.stringify(entry.details)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      )}
    </PageShell>
  )
}
