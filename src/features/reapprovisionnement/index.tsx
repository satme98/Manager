import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  ArrowDownToLine,
  Boxes,
  Check,
  ClipboardList,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  MessageSquareShare,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import type { DraftPurchaseListLine, DraftPurchaseListRecord } from '@/data/types'
import {
  computeReplenishmentSuggestions,
  invalidateDashboardAnalyticsCache,
  type ReplenishmentSuggestionRow,
} from '@/data/analytics'
import { formatCurrencyMAD, formatDateFR, formatQuantity } from '@/lib/formatters'
import { isReadOnlyRole } from '@/lib/rbac'
import { roundCurrency, roundQty } from '@/lib/stock-engine'
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
import { Switch } from '@/components/ui/switch'
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

const ENTRY_DRAFT_STORAGE_KEY = 'monarq_purchase_entry_draft_v1'

export function Reapprovisionnement() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()
  const role = auth.user?.role ?? 'consultation'
  const priceHidden = role === 'cuisine'
  const readOnly = isReadOnlyRole(role)

  const [activeTab, setActiveTab] = useState<'suggestions' | 'undefined' | 'lists'>(
    'suggestions'
  )

  // Filters & options
  const [includeWatch, setIncludeWatch] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('all')

  // Per-line overrides
  const [lineMultipliers] = useState<Record<string, number>>({})
  const [lineQuantities, setLineQuantities] = useState<Record<string, number>>({})
  const [lineSuppliers, setLineSuppliers] = useState<Record<string, string>>({})

  // Selected product IDs for creating a draft purchase list
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])

  // Inline minimum stock editing for "À définir" tab
  const [inlineMinDrafts, setInlineMinDrafts] = useState<Record<string, string>>({})
  const [savingMinId, setSavingMinId] = useState<string | null>(null)

  // Create / Edit Draft Purchase List Modal
  const [listDialogOpen, setListDialogOpen] = useState(false)
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [listName, setListName] = useState('')
  const [listDate, setListDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [listStatus, setListStatus] = useState<'Brouillon' | 'Prête' | 'Convertie'>('Brouillon')
  const [listNotes, setListNotes] = useState('')
  const [listLines, setListLines] = useState<DraftPurchaseListLine[]>([])
  const [savingList, setSavingList] = useState(false)

  const { data: dataset, isLoading } = useQuery({
    queryKey: ['reapprovisionnement-dataset'],
    queryFn: async () => {
      const [
        products,
        suppliers,
        purchasesData,
        exitsData,
        inventoriesData,
        settings,
        draftLists,
      ] = await Promise.all([
        repository.listProducts(),
        repository.listSuppliers(),
        repository.listPurchases(),
        repository.listExits(),
        repository.listInventories(),
        repository.listSettings(),
        repository.listDraftPurchaseLists(),
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
        draftLists,
      }
    },
  })

  const categories = useMemo(() => {
    if (!dataset) return []
    const set = new Set<string>()
    for (const p of dataset.products) {
      if (!p.archived) set.add(p.category?.trim() || 'Sans catégorie')
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [dataset])

  const computed = useMemo(() => {
    if (!dataset) return null
    return computeReplenishmentSuggestions(dataset, {
      includeWatch,
      lineMultipliers,
      lineQuantities,
      lineSuppliers,
      categoryFilter,
      supplierFilter,
      search,
      role,
    })
  }, [
    dataset,
    includeWatch,
    lineMultipliers,
    lineQuantities,
    lineSuppliers,
    categoryFilter,
    supplierFilter,
    search,
    role,
  ])

  const suggestions = computed?.suggestions ?? []
  const undefinedMinProducts = computed?.undefinedMinProducts ?? []
  const draftLists = dataset?.draftLists ?? []

  async function handleSaveInlineMin(productId: string) {
    const raw = inlineMinDrafts[productId]
    const parsed = Number((raw ?? '').replace(',', '.'))
    if (Number.isNaN(parsed) || parsed <= 0) {
      toast.error('Veuillez saisir un stock minimum supérieur à 0.')
      return
    }
    setSavingMinId(productId)
    try {
      await repository.updateProduct(productId, { min_stock: parsed })
      invalidateDashboardAnalyticsCache()
      await queryClient.invalidateQueries({ queryKey: ['reapprovisionnement-dataset'] })
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })
      toast.success('Seuil de stock minimum enregistré.')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erreur lors de la mise à jour.'
      )
    } finally {
      setSavingMinId(null)
    }
  }

  function openCreateListModal(rows: ReplenishmentSuggestionRow[]) {
    if (rows.length === 0) {
      toast.error('Sélectionnez au moins un article à commander.')
      return
    }
    setEditingListId(null)
    const today = new Date().toISOString().slice(0, 10)
    setListName(`Liste d'achat du ${formatDateFR(today)}`)
    setListDate(today)
    setListStatus('Brouillon')
    setListNotes('')
    setListLines(
      rows.map((r) => ({
        productId: r.productId,
        ref: r.ref,
        name: r.name,
        category: r.category,
        unit: r.unit,
        currentStock: r.currentStock,
        minStock: r.minStock,
        suggestedQty: r.suggestedQty,
        orderedQty: r.suggestedQty,
        supplierId: r.lastSupplierId ?? '',
        supplierName: r.lastSupplierName ?? '',
        unitPrice: r.effectiveUnitPrice,
        estimatedCost: r.estimatedCost,
      }))
    )
    setListDialogOpen(true)
  }

  function openEditListModal(list: DraftPurchaseListRecord) {
    setEditingListId(list.id)
    setListName(list.name)
    setListDate(list.date.slice(0, 10))
    setListStatus(list.status)
    setListNotes(list.notes)
    setListLines(list.lines.map((l) => ({ ...l })))
    setListDialogOpen(true)
  }

  async function handleDuplicateList(list: DraftPurchaseListRecord) {
    try {
      await repository.saveDraftPurchaseList({
        name: `${list.name} (Copie)`,
        date: new Date().toISOString().slice(0, 10),
        status: 'Brouillon',
        notes: list.notes,
        created_by: auth.user?.id || 'admin',
        lines: list.lines.map((l) => ({ ...l })),
      })
      await queryClient.invalidateQueries({ queryKey: ['reapprovisionnement-dataset'] })
      toast.success('Liste d’achat dupliquée.')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Impossible de dupliquer la liste.'
      )
    }
  }

  async function handleDeleteList(id: string) {
    try {
      await repository.deleteDraftPurchaseList(id)
      await queryClient.invalidateQueries({ queryKey: ['reapprovisionnement-dataset'] })
      toast.success('Liste d’achat supprimée.')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Impossible de supprimer la liste.'
      )
    }
  }

  async function handleSaveList() {
    if (!listName.trim()) {
      toast.error('Le nom de la liste est obligatoire.')
      return
    }
    setSavingList(true)
    try {
      await repository.saveDraftPurchaseList({
        id: editingListId ?? undefined,
        name: listName.trim(),
        date: listDate,
        status: listStatus,
        notes: listNotes.trim(),
        created_by: auth.user?.id || 'admin',
        lines: listLines,
      })
      await queryClient.invalidateQueries({ queryKey: ['reapprovisionnement-dataset'] })
      setListDialogOpen(false)
      setSelectedProductIds([])
      setActiveTab('lists')
      toast.success('Liste d’achat enregistrée.')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.'
      )
    } finally {
      setSavingList(false)
    }
  }

  function handleShareWhatsApp(list: DraftPurchaseListRecord) {
    // Group lines by supplier for clean WhatsApp sharing
    const bySupplier = new Map<string, DraftPurchaseListLine[]>()
    for (const line of list.lines) {
      const sup = line.supplierName || 'À attribuer'
      const arr = bySupplier.get(sup) ?? []
      arr.push(line)
      bySupplier.set(sup, arr)
    }

    const parts: string[] = [
      `*MONARQ ÉCONOMAT — ${list.name}*`,
      `Date : ${formatDateFR(list.date)}`,
      '',
    ]
    for (const [sup, lines] of bySupplier.entries()) {
      parts.push(`*Fournisseur : ${sup}*`)
      for (const l of lines) {
        parts.push(
          `- ${l.name} : *${formatQuantity(l.orderedQty)} ${l.unit}*`
        )
      }
      parts.push('')
    }
    if (list.notes) {
      parts.push(`Notes : ${list.notes}`)
    }

    const text = parts.join('\n')
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
      toast.success('Texte formaté copié dans le presse-papiers pour WhatsApp.')
    }
  }

  function handleExportList(list: DraftPurchaseListRecord, format: 'xlsx' | 'csv') {
    const rows = list.lines.map((l) => {
      const row: Record<string, string | number> = {
        Fournisseur: l.supplierName || 'Non attribué',
        Référence: l.ref,
        Produit: l.name,
        'Stock actuel': l.currentStock,
        'Stock minimum': l.minStock,
        'Quantité à commander': l.orderedQty,
        Unité: l.unit,
      }
      if (!priceHidden) {
        row['Dernier prix U (DH)'] = l.unitPrice ?? 0
        row['Coût estimé (DH)'] = l.estimatedCost ?? 0
      }
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Liste_Achat')
    const safeName = list.name.replace(/[^a-zA-Z0-9_-]/g, '_')
    if (format === 'csv') {
      XLSX.writeFile(wb, `${safeName}.csv`, { bookType: 'csv' })
    } else {
      XLSX.writeFile(wb, `${safeName}.xlsx`)
    }
    toast.success(`Liste exportée en ${format.toUpperCase()}.`)
  }

  async function handleConvertToStockEntry(
    list: DraftPurchaseListRecord,
    supplierIdFilter?: string | null
  ) {
    const targetLines = supplierIdFilter
      ? list.lines.filter((l) => l.supplierId === supplierIdFilter)
      : list.lines

    if (targetLines.length === 0) {
      toast.error('Aucune ligne à convertir pour ce fournisseur.')
      return
    }

    const firstSupId =
      supplierIdFilter ||
      targetLines.find((l) => l.supplierId)?.supplierId ||
      dataset?.suppliers[0]?.id ||
      ''

    const draftPayload = {
      date: new Date().toISOString().slice(0, 10),
      supplierId: firstSupId,
      invoiceNo: '',
      paymentStatus: 'unpaid',
      paymentDate: new Date().toISOString().slice(0, 10),
      notes: `Pré-rempli depuis la liste d'achat : ${list.name}`,
      lines: targetLines.map((l, idx) => ({
        key: `reappro-${idx}-${Date.now()}`,
        productId: l.productId,
        productQuery: `${l.ref} — ${l.name}`,
        qty: String(l.orderedQty),
        unitPrice: l.unitPrice !== null ? String(l.unitPrice) : '',
      })),
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        ENTRY_DRAFT_STORAGE_KEY,
        JSON.stringify(draftPayload)
      )
    }

    // Update list status to 'Convertie'
    await repository.saveDraftPurchaseList({
      id: list.id,
      name: list.name,
      date: list.date,
      status: 'Convertie',
      notes: list.notes,
      created_by: list.created_by || auth.user?.id || 'admin',
      lines: list.lines,
    })
    await queryClient.invalidateQueries({ queryKey: ['reapprovisionnement-dataset'] })

    toast.success(
      'Brouillon d’entrée de stock pré-rempli. Vérifiez les quantités et prix avant d’enregistrer.'
    )
    void navigate({
      to: '/entrees-de-stock',
      search: { mode: 'new' } as never,
    })
  }

  return (
    <PageShell
      section='GESTION'
      title='Réapprovisionnement'
      description='Suggestions d’achat basées sur le stock minimum (formule : min × multiplicateur − stock actuel), regroupées par fournisseur habituel.'
      primaryAction={
        !readOnly && selectedProductIds.length > 0
          ? {
              label: `Créer une liste d'achat (${selectedProductIds.length})`,
              onClick: () =>
                openCreateListModal(
                  suggestions.filter((s) =>
                    selectedProductIds.includes(s.productId)
                  )
                ),
              icon: ShoppingCart,
            }
          : !readOnly && suggestions.length > 0
            ? {
                label: 'Créer une liste avec les alertes',
                onClick: () => openCreateListModal(suggestions),
                icon: Plus,
              }
            : {
                label: 'Voir l’état des stocks',
                to: '/etat-des-stocks',
                icon: Boxes,
              }
      }
      secondaryActions={[
        {
          label: 'État des stocks',
          to: '/etat-des-stocks',
          icon: Boxes,
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
          <Skeleton className='h-24 w-full rounded-lg' />
          <Skeleton className='h-96 w-full rounded-lg' />
        </div>
      ) : !dataset || dataset.products.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title='Aucun article dans le catalogue'
          description='Ajoutez ou importez vos produits et leurs seuils minimums pour générer automatiquement des suggestions de réapprovisionnement.'
          columnsPreview={[
            'Produit',
            'Stock actuel',
            'Stock minimum',
            'Quantité suggérée',
            'Dernier fournisseur',
            ...(priceHidden ? [] : ['Dernier prix (DH)', 'Coût estimé (DH)']),
          ]}
          primaryAction={{
            label: 'Catalogue Produits',
            to: '/produits',
            icon: Boxes,
          }}
          secondaryAction={{
            label: 'Importer depuis Excel',
            to: '/import-export',
            icon: FileSpreadsheet,
          }}
        />
      ) : (
        <div className='space-y-4'>
          {/* Summary Banner */}
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Produits en Alerte (≤ min)</span>
                <AlertTriangle className='h-4 w-4 text-[#D72C0D]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#D72C0D]'>
                {computed?.alertCount ?? 0}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                Sous le seuil minimum configuré
              </div>
            </Card>

            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Produits À surveiller</span>
                <RefreshCw className='h-4 w-4 text-[#B98900]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#B98900]'>
                {computed?.watchCount ?? 0}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                Proches du seuil de rupture
              </div>
            </Card>

            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Seuils « À définir »</span>
                <Boxes className='h-4 w-4 text-[#6D7175]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#202223]'>
                {computed?.undefinedMinCount ?? 0}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                Produits sans stock minimum
              </div>
            </Card>

            <Card className='border-[#E1E3E5] bg-white p-4 shadow-none'>
              <div className='flex items-center justify-between text-xs text-[#6D7175]'>
                <span>Coût estimé de réappro.</span>
                <ShoppingCart className='h-4 w-4 text-[#008060]' />
              </div>
              <div className='mt-1.5 text-xl font-semibold tabular-nums text-[#202223]'>
                {priceHidden
                  ? 'Masqué (Cuisine)'
                  : formatCurrencyMAD(computed?.totalEstimatedCost ?? 0)}
              </div>
              <div className='mt-1 text-[11px] text-[#6D7175]'>
                Multiplicateur par défaut : ×{computed?.defaultMultiplier ?? 2}
              </div>
            </Card>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          >
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <TabsList className='h-9 bg-[#EBEBEB]'>
                <TabsTrigger value='suggestions' className='text-xs'>
                  Suggestions d’achat ({suggestions.length})
                </TabsTrigger>
                <TabsTrigger value='undefined' className='text-xs'>
                  À définir ({undefinedMinProducts.length})
                </TabsTrigger>
                <TabsTrigger value='lists' className='text-xs'>
                  Listes d’achat ({draftLists.length})
                </TabsTrigger>
              </TabsList>

              {activeTab === 'suggestions' && (
                <div className='flex items-center gap-2 text-xs'>
                  <Switch
                    id='include-watch'
                    checked={includeWatch}
                    onCheckedChange={setIncludeWatch}
                  />
                  <Label htmlFor='include-watch' className='cursor-pointer text-xs'>
                    Inclure les produits « À surveiller »
                  </Label>
                </div>
              )}
            </div>

            {/* TAB 1: SUGGESTIONS */}
            <TabsContent value='suggestions' className='mt-3 space-y-3'>
              <Card className='border-[#E1E3E5] bg-white p-3 shadow-none'>
                <div className='grid gap-2.5 sm:grid-cols-3'>
                  <div className='relative'>
                    <Search className='pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-[#6D7175]' />
                    <Input
                      placeholder='Rechercher un produit ou fournisseur...'
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className='h-8 pl-8 text-xs'
                    />
                  </div>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue placeholder='Toutes les catégories' />
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
                  <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue placeholder='Tous les fournisseurs' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all' className='text-xs'>
                        Tous les fournisseurs
                      </SelectItem>
                      {dataset.suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id} className='text-xs'>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Card>

              <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      {!readOnly && (
                        <TableHead className='w-10 px-3'>
                          <Checkbox
                            checked={
                              suggestions.length > 0 &&
                              suggestions.every((s) =>
                                selectedProductIds.includes(s.productId)
                              )
                            }
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedProductIds(
                                  suggestions.map((s) => s.productId)
                                )
                              } else {
                                setSelectedProductIds([])
                              }
                            }}
                          />
                        </TableHead>
                      )}
                      <TableHead className='text-xs font-semibold'>Produit</TableHead>
                      <TableHead className='text-xs font-semibold'>Statut</TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Stock actuel
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Stock minimum
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Quantité suggérée
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Dernier fournisseur
                      </TableHead>
                      {!priceHidden && (
                        <>
                          <TableHead className='text-right text-xs font-semibold'>
                            Dernier prix
                          </TableHead>
                          <TableHead className='px-4 text-right text-xs font-semibold'>
                            Coût estimé
                          </TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suggestions.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={priceHidden ? 7 : 9}
                          className='py-8 text-center text-xs text-[#6D7175]'
                        >
                          Aucun produit en alerte de réapprovisionnement.
                        </TableCell>
                      </TableRow>
                    ) : (
                      suggestions.map((row) => {
                        const isSelected = selectedProductIds.includes(
                          row.productId
                        )
                        return (
                          <TableRow key={row.productId}>
                            {!readOnly && (
                              <TableCell className='px-3'>
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(val) =>
                                    setSelectedProductIds((prev) =>
                                      val
                                        ? [...prev, row.productId]
                                        : prev.filter((id) => id !== row.productId)
                                    )
                                  }
                                />
                              </TableCell>
                            )}
                            <TableCell className='text-xs'>
                              <div className='font-medium text-[#202223]'>
                                {row.name}
                              </div>
                              <div className='text-[11px] text-[#6D7175]'>
                                {row.ref} · {row.category}
                              </div>
                            </TableCell>
                            <TableCell>
                              {row.status === 'Alerte' ? (
                                <Badge className='border-0 bg-[#D72C0D]/10 text-[11px] text-[#D72C0D]'>
                                  Alerte
                                </Badge>
                              ) : (
                                <Badge className='border-0 bg-[#B98900]/15 text-[11px] text-[#B98900]'>
                                  À surveiller
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className='text-right tabular-nums text-xs font-semibold'>
                              {formatQuantity(row.currentStock)} {row.unit}
                            </TableCell>
                            <TableCell className='text-right tabular-nums text-xs'>
                              {formatQuantity(row.minStock)} {row.unit}
                            </TableCell>
                            <TableCell className='text-right'>
                              <div className='inline-flex items-center justify-end gap-1.5'>
                                <Input
                                  type='number'
                                  min={0}
                                  step='any'
                                  disabled={readOnly}
                                  value={
                                    lineQuantities[row.productId] !== undefined
                                      ? lineQuantities[row.productId]
                                      : row.suggestedQty
                                  }
                                  onChange={(e) => {
                                    const val = Number(e.target.value)
                                    setLineQuantities((prev) => ({
                                      ...prev,
                                      [row.productId]: Number.isNaN(val) ? 0 : val,
                                    }))
                                  }}
                                  className='h-7 w-20 text-right tabular-nums text-xs'
                                />
                                <span className='text-[11px] text-[#6D7175]'>
                                  {row.unit}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className='text-xs'>
                              <Select
                                value={row.lastSupplierId ?? 'none'}
                                disabled={readOnly}
                                onValueChange={(v) =>
                                  setLineSuppliers((prev) => ({
                                    ...prev,
                                    [row.productId]: v === 'none' ? '' : v,
                                  }))
                                }
                              >
                                <SelectTrigger className='h-7 w-44 text-xs'>
                                  <SelectValue placeholder='Choisir fournisseur' />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value='none' className='text-xs'>
                                    Non attribué
                                  </SelectItem>
                                  {dataset.suppliers.map((sup) => (
                                    <SelectItem
                                      key={sup.id}
                                      value={sup.id}
                                      className='text-xs'
                                    >
                                      {sup.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            {!priceHidden && (
                              <>
                                <TableCell className='text-right tabular-nums text-xs'>
                                  {row.effectiveUnitPrice !== null
                                    ? formatCurrencyMAD(row.effectiveUnitPrice)
                                    : 'Prix manquant'}
                                </TableCell>
                                <TableCell className='px-4 text-right tabular-nums text-xs font-semibold'>
                                  {row.estimatedCost !== null
                                    ? formatCurrencyMAD(row.estimatedCost)
                                    : '—'}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>

            {/* TAB 2: À DÉFINIR (INLINE MIN STOCK EDITOR) */}
            <TabsContent value='undefined' className='mt-3'>
              <Card className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'>
                <div className='border-b border-[#E1E3E5] px-4 py-3'>
                  <h3 className='text-xs font-semibold text-[#202223]'>
                    Produits sans stock minimum (« À définir »)
                  </h3>
                  <p className='text-[11px] text-[#6D7175]'>
                    Définissez directement le seuil minimum pour activer la surveillance automatique de ces articles.
                  </p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7]'>
                      <TableHead className='px-4 text-xs font-semibold'>
                        Référence
                      </TableHead>
                      <TableHead className='text-xs font-semibold'>Produit</TableHead>
                      <TableHead className='text-xs font-semibold'>
                        Catégorie
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold'>
                        Stock actuel
                      </TableHead>
                      <TableHead className='px-4 text-right text-xs font-semibold'>
                        Définir le stock minimum
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {undefinedMinProducts.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className='py-8 text-center text-xs text-[#6D7175]'
                        >
                          Tous vos produits actifs disposent déjà d’un stock minimum.
                        </TableCell>
                      </TableRow>
                    ) : (
                      undefinedMinProducts.map((item) => (
                        <TableRow key={item.productId}>
                          <TableCell className='px-4 font-mono text-xs'>
                            {item.ref}
                          </TableCell>
                          <TableCell className='text-xs font-medium'>
                            {item.name}
                          </TableCell>
                          <TableCell className='text-xs text-[#6D7175]'>
                            {item.category}
                          </TableCell>
                          <TableCell className='text-right tabular-nums text-xs'>
                            {formatQuantity(item.currentStock)} {item.unit}
                          </TableCell>
                          <TableCell className='px-4 text-right'>
                            <div className='inline-flex items-center justify-end gap-1.5'>
                              <Input
                                type='number'
                                min={0.01}
                                step='any'
                                placeholder={`Seuil (${item.unit})`}
                                disabled={readOnly}
                                value={inlineMinDrafts[item.productId] ?? ''}
                                onChange={(e) =>
                                  setInlineMinDrafts((prev) => ({
                                    ...prev,
                                    [item.productId]: e.target.value,
                                  }))
                                }
                                className='h-7 w-28 text-right text-xs'
                              />
                              {!readOnly && (
                                <Button
                                  size='sm'
                                  className='h-7 text-xs'
                                  disabled={savingMinId === item.productId}
                                  onClick={() =>
                                    void handleSaveInlineMin(item.productId)
                                  }
                                >
                                  {savingMinId === item.productId ? (
                                    <Loader2 className='h-3 w-3 animate-spin' />
                                  ) : (
                                    <Check className='mr-1 h-3 w-3' />
                                  )}
                                  Valider
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

            {/* TAB 3: DRAFT PURCHASE LISTS */}
            <TabsContent value='lists' className='mt-3 space-y-3'>
              {draftLists.length === 0 ? (
                <Card className='border-[#E1E3E5] bg-white p-8 text-center shadow-none'>
                  <ClipboardList className='mx-auto mb-2 h-7 w-7 text-[#6D7175]' />
                  <h3 className='text-sm font-semibold text-[#202223]'>
                    Aucune liste d’achat enregistrée
                  </h3>
                  <p className='mx-auto mt-1 max-w-md text-xs text-[#6D7175]'>
                    Sélectionnez des produits dans l’onglet « Suggestions d’achat » et cliquez sur « Créer une liste d’achat » pour préparer vos commandes par fournisseur.
                  </p>
                </Card>
              ) : (
                draftLists.map((list) => {
                  // Group lines by supplier
                  const supplierGroups = new Map<
                    string,
                    { supplierId: string | null; supplierName: string; lines: DraftPurchaseListLine[] }
                  >()
                  for (const line of list.lines) {
                    const key = line.supplierId || 'unassigned'
                    const existing = supplierGroups.get(key) ?? {
                      supplierId: line.supplierId || null,
                      supplierName: line.supplierName || 'Fournisseur à définir',
                      lines: [],
                    }
                    existing.lines.push(line)
                    supplierGroups.set(key, existing)
                  }

                  return (
                    <Card
                      key={list.id}
                      className='overflow-hidden border-[#E1E3E5] bg-white py-0 shadow-none'
                    >
                      <div className='flex flex-wrap items-center justify-between gap-2 border-b border-[#E1E3E5] bg-[#F6F6F7] px-4 py-3'>
                        <div className='flex items-center gap-2.5'>
                          <h3 className='text-sm font-semibold text-[#202223]'>
                            {list.name}
                          </h3>
                          <Badge
                            variant='outline'
                            className={
                              list.status === 'Convertie'
                                ? 'border-[#008060]/30 bg-[#008060]/10 text-[#008060]'
                                : list.status === 'Prête'
                                  ? 'border-[#B98900]/30 bg-[#B98900]/10 text-[#B98900]'
                                  : ''
                            }
                          >
                            {list.status}
                          </Badge>
                          <span className='text-xs text-[#6D7175]'>
                            {formatDateFR(list.date)} · {list.lines.length} article(s)
                          </span>
                        </div>

                        <div className='flex flex-wrap items-center gap-1.5'>
                          <Button
                            size='sm'
                            variant='outline'
                            className='h-7 text-xs'
                            onClick={() => handleShareWhatsApp(list)}
                          >
                            <MessageSquareShare className='mr-1 h-3 w-3' />
                            Copier WhatsApp
                          </Button>
                          <Button
                            size='sm'
                            variant='outline'
                            className='h-7 text-xs'
                            onClick={() => handleExportList(list, 'xlsx')}
                          >
                            <FileSpreadsheet className='mr-1 h-3 w-3' />
                            .xlsx
                          </Button>
                          <Button
                            size='sm'
                            variant='outline'
                            className='h-7 text-xs'
                            onClick={() => handleExportList(list, 'csv')}
                          >
                            <Download className='mr-1 h-3 w-3' />
                            .csv
                          </Button>
                          <Button
                            size='sm'
                            variant='outline'
                            className='h-7 text-xs'
                            onClick={() => window.print()}
                          >
                            <Printer className='mr-1 h-3 w-3' />
                            Imprimer / PDF
                          </Button>
                          {!readOnly && (
                            <>
                              <Button
                                size='sm'
                                variant='outline'
                                className='h-7 text-xs'
                                onClick={() => openEditListModal(list)}
                              >
                                Modifier
                              </Button>
                              <Button
                                size='sm'
                                variant='outline'
                                className='h-7 text-xs'
                                onClick={() => void handleDuplicateList(list)}
                              >
                                <Copy className='mr-1 h-3 w-3' />
                                Dupliquer
                              </Button>
                              <Button
                                size='sm'
                                className='h-7 bg-[#008060] text-xs text-white hover:bg-[#006e52]'
                                onClick={() =>
                                  void handleConvertToStockEntry(list, null)
                                }
                              >
                                <ArrowDownToLine className='mr-1 h-3 w-3' />
                                Convertir en entrée de stock
                              </Button>
                              <Button
                                size='sm'
                                variant='ghost'
                                className='h-7 text-xs text-[#D72C0D]'
                                onClick={() => void handleDeleteList(list.id)}
                              >
                                <Trash2 className='h-3.5 w-3.5' />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className='divide-y divide-[#E1E3E5]'>
                        {Array.from(supplierGroups.values()).map((grp) => (
                          <div key={grp.supplierName} className='p-3'>
                            <div className='mb-2 flex items-center justify-between'>
                              <span className='text-xs font-semibold text-[#202223]'>
                                Fournisseur : {grp.supplierName} ({grp.lines.length}{' '}
                                ligne(s))
                              </span>
                              {!readOnly && grp.supplierId && (
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  className='h-6 text-[11px] text-[#008060]'
                                  onClick={() =>
                                    void handleConvertToStockEntry(
                                      list,
                                      grp.supplierId
                                    )
                                  }
                                >
                                  Convertir ce fournisseur en entrée →
                                </Button>
                              )}
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow className='bg-[#F6F6F7]/60'>
                                  <TableHead className='text-xs'>Produit</TableHead>
                                  <TableHead className='text-right text-xs'>
                                    Stock actuel
                                  </TableHead>
                                  <TableHead className='text-right text-xs'>
                                    Quantité à commander
                                  </TableHead>
                                  {!priceHidden && (
                                    <>
                                      <TableHead className='text-right text-xs'>
                                        Dernier prix U
                                      </TableHead>
                                      <TableHead className='text-right text-xs'>
                                        Coût estimé
                                      </TableHead>
                                    </>
                                  )}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {grp.lines.map((l) => (
                                  <TableRow key={l.productId}>
                                    <TableCell className='text-xs'>
                                      {l.ref} — {l.name}
                                    </TableCell>
                                    <TableCell className='text-right tabular-nums text-xs'>
                                      {formatQuantity(l.currentStock)} {l.unit}
                                    </TableCell>
                                    <TableCell className='text-right tabular-nums text-xs font-semibold'>
                                      {formatQuantity(l.orderedQty)} {l.unit}
                                    </TableCell>
                                    {!priceHidden && (
                                      <>
                                        <TableCell className='text-right tabular-nums text-xs'>
                                          {l.unitPrice !== null
                                            ? formatCurrencyMAD(l.unitPrice)
                                            : '—'}
                                        </TableCell>
                                        <TableCell className='text-right tabular-nums text-xs font-semibold'>
                                          {l.estimatedCost !== null
                                            ? formatCurrencyMAD(l.estimatedCost)
                                            : '—'}
                                        </TableCell>
                                      </>
                                    )}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )
                })
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* DIALOG: CREATE / EDIT DRAFT PURCHASE LIST */}
      <Dialog open={listDialogOpen} onOpenChange={setListDialogOpen}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              {editingListId
                ? 'Modifier la liste d’achat'
                : 'Créer une liste d’achat prévisionnelle'}
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Cette liste est un document interne de préparation. Aucune commande n’est envoyée automatiquement aux fournisseurs.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-3 py-2 text-xs'>
            <div className='grid gap-3 sm:grid-cols-3'>
              <div className='space-y-1'>
                <Label className='text-xs'>Nom de la liste *</Label>
                <Input
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  className='h-8 text-xs'
                />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>Date</Label>
                <Input
                  type='date'
                  value={listDate}
                  onChange={(e) => setListDate(e.target.value)}
                  className='h-8 text-xs'
                />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>Statut</Label>
                <Select
                  value={listStatus}
                  onValueChange={(v) => setListStatus(v as typeof listStatus)}
                >
                  <SelectTrigger className='h-8 text-xs'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='Brouillon' className='text-xs'>
                      Brouillon
                    </SelectItem>
                    <SelectItem value='Prête' className='text-xs'>
                      Prête
                    </SelectItem>
                    <SelectItem value='Convertie' className='text-xs'>
                      Convertie
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className='space-y-1'>
              <Label className='text-xs'>Notes / Instructions</Label>
              <Textarea
                rows={2}
                value={listNotes}
                onChange={(e) => setListNotes(e.target.value)}
                placeholder='Instructions de livraison ou remarques...'
                className='text-xs'
              />
            </div>

            <div className='max-h-60 overflow-auto rounded-md border border-[#E1E3E5]'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7]'>
                    <TableHead className='text-xs'>Produit</TableHead>
                    <TableHead className='text-xs'>Fournisseur</TableHead>
                    <TableHead className='text-right text-xs'>Quantité</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listLines.map((line, idx) => (
                    <TableRow key={line.productId}>
                      <TableCell className='text-xs font-medium'>
                        {line.name}
                      </TableCell>
                      <TableCell className='text-xs'>
                        <Select
                          value={line.supplierId || 'none'}
                          onValueChange={(v) => {
                            const sup = dataset?.suppliers.find((s) => s.id === v)
                            setListLines((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? {
                                      ...item,
                                      supplierId: v === 'none' ? '' : v,
                                      supplierName: sup?.name ?? '',
                                    }
                                  : item
                              )
                            )
                          }}
                        >
                          <SelectTrigger className='h-7 w-40 text-xs'>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='none' className='text-xs'>
                              Non attribué
                            </SelectItem>
                            {dataset?.suppliers.map((s) => (
                              <SelectItem key={s.id} value={s.id} className='text-xs'>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className='text-right'>
                        <Input
                          type='number'
                          min={0}
                          step='any'
                          value={line.orderedQty}
                          onChange={(e) => {
                            const q = roundQty(Math.max(0, Number(e.target.value)))
                            setListLines((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? {
                                      ...item,
                                      orderedQty: q,
                                      estimatedCost:
                                        item.unitPrice !== null
                                          ? roundCurrency(q * item.unitPrice)
                                          : null,
                                    }
                                  : item
                              )
                            )
                          }}
                          className='ml-auto h-7 w-24 text-right text-xs'
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setListDialogOpen(false)}
              disabled={savingList}
            >
              Annuler
            </Button>
            <Button
              size='sm'
              onClick={() => void handleSaveList()}
              disabled={savingList}
            >
              {savingList && <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />}
              <Save className='mr-1.5 h-3.5 w-3.5' />
              Enregistrer la liste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
