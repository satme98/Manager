import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Edit3,
  Eye,
  FileSpreadsheet,
  GitMerge,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { repository } from '@/data'
import type { SupplierRecord, VatConvention } from '@/data/types'
import { formatDateFR, formatMAD } from '@/lib/format'
import { canPerformCollectionAction } from '@/lib/rbac'
import {
  computeSupplierAggregates,
  findNearDuplicateSuppliers,
  normalizeSearchText,
  normalizeSupplierName,
} from '@/lib/stock-engine'
import { useAuthStore } from '@/stores/auth-store'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search as GlobalSearchButton } from '@/components/search'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
import { SupplierDetailView } from './supplier-detail'

type SupplierSortField =
  | 'name'
  | 'contact'
  | 'phone'
  | 'email'
  | 'payment_terms'
  | 'totalPurchases'
  | 'unpaidBalance'
  | 'lastPurchaseDate'

type SortDirection = 'asc' | 'desc'

interface SupplierFormState {
  name: string
  contact: string
  phone: string
  email: string
  payment_terms: string
  notes: string
}

function readUrlParam(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const params = new URLSearchParams(window.location.search)
  return params.get(key) ?? fallback
}

export function FournisseursPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.auth.user)
  const role = user?.role ?? 'consultation'

  const canList = canPerformCollectionAction(role, 'suppliers', 'list')
  const canCreate = canPerformCollectionAction(role, 'suppliers', 'create')
  const canEdit = canPerformCollectionAction(role, 'suppliers', 'update')

  // URL-synced state
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(() =>
    readUrlParam('supplierId', '')
  )
  const [searchQuery, setSearchQuery] = useState<string>(() =>
    readUrlParam('q', '')
  )
  const [unpaidOnly, setUnpaidOnly] = useState<boolean>(
    () => readUrlParam('unpaid', '0') === '1'
  )
  const [archiveFilter, setArchiveFilter] = useState<string>(() =>
    readUrlParam('arch', 'active')
  )
  const [sortField, setSortField] = useState<SupplierSortField>(
    () => (readUrlParam('sort', 'name') as SupplierSortField) || 'name'
  )
  const [sortDir, setSortDir] = useState<SortDirection>(
    () => (readUrlParam('dir', 'asc') as SortDirection) || 'asc'
  )
  const [pageSize, setPageSize] = useState<number>(() => {
    const parsed = parseInt(readUrlParam('size', '25'), 10)
    return [25, 50, 100].includes(parsed) ? parsed : 25
  })
  const [currentPage, setCurrentPage] = useState<number>(() => {
    const parsed = parseInt(readUrlParam('page', '1'), 10)
    return parsed > 0 ? parsed : 1
  })

  useEffect(() => {
    const syncFromUrl = () => {
      const sid = readUrlParam('supplierId', '')
      setSelectedSupplierId(sid)
    }
    window.addEventListener('popstate', syncFromUrl)
    window.addEventListener('monarq:navigate', syncFromUrl)
    return () => {
      window.removeEventListener('popstate', syncFromUrl)
      window.removeEventListener('monarq:navigate', syncFromUrl)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams()
    if (selectedSupplierId) params.set('supplierId', selectedSupplierId)
    if (searchQuery) params.set('q', searchQuery)
    if (unpaidOnly) params.set('unpaid', '1')
    if (archiveFilter !== 'active') params.set('arch', archiveFilter)
    if (sortField !== 'name') params.set('sort', sortField)
    if (sortDir !== 'asc') params.set('dir', sortDir)
    if (pageSize !== 25) params.set('size', String(pageSize))
    if (currentPage > 1) params.set('page', String(currentPage))

    const qs = params.toString()
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    window.history.replaceState(null, '', nextUrl)
  }, [
    selectedSupplierId,
    searchQuery,
    unpaidOnly,
    archiveFilter,
    sortField,
    sortDir,
    pageSize,
    currentPage,
  ])

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<SupplierRecord | null>(
    null
  )
  const [formState, setFormState] = useState<SupplierFormState>({
    name: '',
    contact: '',
    phone: '',
    email: '',
    payment_terms: '',
    notes: '',
  })
  const [submittedAttempt, setSubmittedAttempt] = useState(false)

  // Merge dialog state
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSourceId, setMergeSourceId] = useState<string>('')
  const [mergeTargetId, setMergeTargetId] = useState<string>('')

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => repository.listSuppliers(),
    enabled: canList,
  })

  const purchasesQuery = useQuery({
    queryKey: ['purchases'],
    queryFn: () => repository.listPurchases(),
    enabled: canList,
  })

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => repository.listProducts(),
  })

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => repository.listSettings(),
  })

  const suppliers = useMemo(
    () => suppliersQuery.data ?? [],
    [suppliersQuery.data]
  )
  const purchasesData = useMemo(
    () => purchasesQuery.data ?? { headers: [], lines: [] },
    [purchasesQuery.data]
  )
  const products = useMemo(
    () => productsQuery.data ?? [],
    [productsQuery.data]
  )
  const settings = useMemo(
    () => settingsQuery.data ?? [],
    [settingsQuery.data]
  )

  const vatConvention: VatConvention = useMemo(() => {
    const found = settings.find((s) => s.key === 'vat_convention')
    return found?.value === 'HT' ? 'HT' : 'TTC'
  }, [settings])

  const supplierAggregates = useMemo(
    () =>
      computeSupplierAggregates(
        suppliers,
        purchasesData.headers,
        purchasesData.lines
      ),
    [suppliers, purchasesData]
  )

  const filteredSuppliers = useMemo(() => {
    const cleanQuery = normalizeSearchText(searchQuery)

    const filtered = suppliers.filter((s) => {
      if (archiveFilter === 'active' && s.archived) return false
      if (archiveFilter === 'archived' && !s.archived) return false

      const metrics = supplierAggregates.get(s.id)
      if (unpaidOnly && (metrics?.unpaidBalance ?? 0) <= 0) {
        return false
      }

      if (cleanQuery) {
        const hay = [s.name, s.contact, s.phone, s.email, s.payment_terms]
          .map((v) => normalizeSearchText(v))
          .join(' ')
        if (!hay.includes(cleanQuery)) return false
      }

      return true
    })

    filtered.sort((a, b) => {
      const mA = supplierAggregates.get(a.id)
      const mB = supplierAggregates.get(b.id)
      let cmp = 0

      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name, 'fr')
          break
        case 'contact':
          cmp = (a.contact || '').localeCompare(b.contact || '', 'fr')
          break
        case 'phone':
          cmp = (a.phone || '').localeCompare(b.phone || '', 'fr')
          break
        case 'email':
          cmp = (a.email || '').localeCompare(b.email || '', 'fr')
          break
        case 'payment_terms':
          cmp = (a.payment_terms || '').localeCompare(
            b.payment_terms || '',
            'fr'
          )
          break
        case 'totalPurchases':
          cmp = (mA?.totalPurchases ?? 0) - (mB?.totalPurchases ?? 0)
          break
        case 'unpaidBalance':
          cmp = (mA?.unpaidBalance ?? 0) - (mB?.unpaidBalance ?? 0)
          break
        case 'lastPurchaseDate':
          cmp = (mA?.lastPurchaseDate ?? '').localeCompare(
            mB?.lastPurchaseDate ?? ''
          )
          break
      }

      return sortDir === 'asc' ? cmp : -cmp
    })

    return filtered
  }, [
    suppliers,
    searchQuery,
    unpaidOnly,
    archiveFilter,
    sortField,
    sortDir,
    supplierAggregates,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedSuppliers = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredSuppliers.slice(start, start + pageSize)
  }, [filteredSuppliers, safePage, pageSize])

  // Exact collision vs near-duplicate check in Create/Edit Drawer
  const exactDuplicateSupplier = useMemo(() => {
    const clean = normalizeSupplierName(formState.name)
    if (!clean) return null
    return (
      suppliers.find(
        (s) =>
          s.id !== editingSupplier?.id && normalizeSupplierName(s.name) === clean
      ) ?? null
    )
  }, [formState.name, suppliers, editingSupplier])

  const nearDuplicateSuppliers = useMemo(() => {
    return findNearDuplicateSuppliers(
      formState.name,
      suppliers,
      editingSupplier?.id
    )
  }, [formState.name, suppliers, editingSupplier])

  const openCreateDrawer = () => {
    setEditingSupplier(null)
    setSubmittedAttempt(false)
    setFormState({
      name: '',
      contact: '',
      phone: '',
      email: '',
      payment_terms: '',
      notes: '',
    })
    setDrawerOpen(true)
  }

  const openEditDrawer = (supplier: SupplierRecord) => {
    setEditingSupplier(supplier)
    setSubmittedAttempt(false)
    setFormState({
      name: supplier.name,
      contact: supplier.contact || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      payment_terms: supplier.payment_terms || '',
      notes: supplier.notes || '',
    })
    setDrawerOpen(true)
  }

  const openMergeDialog = (source?: SupplierRecord, target?: SupplierRecord) => {
    const activeList = suppliers.filter((s) => !s.archived)
    const defaultSource = source?.id ?? activeList[0]?.id ?? ''
    const defaultTarget =
      target?.id ??
      activeList.find((s) => s.id !== defaultSource)?.id ??
      ''
    setMergeSourceId(defaultSource)
    setMergeTargetId(defaultTarget)
    setMergeOpen(true)
  }

  const saveSupplierMutation = useMutation({
    mutationFn: async () => {
      const cleanName = formState.name.trim()
      if (!cleanName) {
        throw new Error('Le nom du fournisseur est obligatoire.')
      }

      if (editingSupplier) {
        return await repository.updateSupplier(editingSupplier.id, {
          name: cleanName,
          contact: formState.contact.trim(),
          phone: formState.phone.trim(),
          email: formState.email.trim(),
          payment_terms: formState.payment_terms.trim(),
          notes: formState.notes.trim(),
        })
      } else {
        return await repository.createSupplier({
          name: cleanName,
          contact: formState.contact.trim(),
          phone: formState.phone.trim(),
          email: formState.email.trim(),
          payment_terms: formState.payment_terms.trim(),
          notes: formState.notes.trim(),
          archived: false,
        })
      }
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      void queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      setDrawerOpen(false)
      toast.success(
        editingSupplier
          ? `Fournisseur « ${saved.name} » mis à jour.`
          : `Fournisseur « ${saved.name} » créé.`
      )
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const mergeSuppliersMutation = useMutation({
    mutationFn: async () => {
      if (!mergeSourceId || !mergeTargetId) {
        throw new Error(
          'Veuillez sélectionner un fournisseur source et un fournisseur cible.'
        )
      }
      return await repository.mergeSuppliers(mergeSourceId, mergeTargetId)
    },
    onSuccess: ({ movedPurchasesCount }) => {
      const srcName =
        suppliers.find((s) => s.id === mergeSourceId)?.name ?? 'Source'
      const tgtName =
        suppliers.find((s) => s.id === mergeTargetId)?.name ?? 'Cible'
      setMergeOpen(false)
      if (selectedSupplierId === mergeSourceId) {
        setSelectedSupplierId(mergeTargetId)
      }
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      void queryClient.invalidateQueries({ queryKey: ['purchases'] })
      void queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      toast.success(
        `Fusion effectuée : ${movedPurchasesCount} bon(s) d’achat transféré(s) de « ${srcName} » vers « ${tgtName} ».`
      )
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleSort = (field: SupplierSortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const renderSortIcon = (field: SupplierSortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className='ml-1 inline h-3.5 w-3.5 text-[#6D7175]/60' />
    }
    return sortDir === 'asc' ? (
      <ArrowUp className='ml-1 inline h-3.5 w-3.5 text-[#202223]' />
    ) : (
      <ArrowDown className='ml-1 inline h-3.5 w-3.5 text-[#202223]' />
    )
  }

  const handleExportSuppliers = () => {
    const rows = filteredSuppliers.map((s) => {
      const m = supplierAggregates.get(s.id)
      return {
        Fournisseur: s.name,
        Contact: s.contact || '',
        Téléphone: s.phone || '',
        Email: s.email || '',
        'Conditions de paiement': s.payment_terms || '',
        [`Total achats (${vatConvention} MAD)`]: m?.totalPurchases ?? 0,
        'Solde impayé (MAD)': m?.unpaidBalance ?? 0,
        'Dernier achat': m?.lastPurchaseDate
          ? formatDateFR(m.lastPurchaseDate)
          : '',
        Notes: s.notes || '',
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Fournisseurs')
    const dateStamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `MONARQ_Fournisseurs_${dateStamp}.xlsx`)
    toast.success(`Export Excel généré (${rows.length} fournisseur(s)).`)
  }

  const selectedSupplierRecord = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId) ?? null,
    [suppliers, selectedSupplierId]
  )

  const mergeSourcePurchaseCount = useMemo(() => {
    if (!mergeSourceId) return 0
    return purchasesData.headers.filter((p) => p.supplier === mergeSourceId)
      .length
  }, [mergeSourceId, purchasesData.headers])

  if (!canList) {
    return (
      <>
        <Header fixed>
          <GlobalSearchButton />
          <div className='ms-auto flex items-center space-x-4'>
            <ProfileDropdown />
          </div>
        </Header>
        <Main className='bg-[#F6F6F7]'>
          <div className='flex flex-col items-center justify-center rounded-lg border border-[#E1E3E5] bg-white p-12 text-center'>
            <ShieldAlert className='mb-3 h-10 w-10 text-[#D72C0D]' />
            <h2 className='text-base font-semibold text-[#202223]'>
              Accès restreint
            </h2>
            <p className='mt-1 max-w-md text-xs text-[#6D7175]'>
              Votre rôle ({role}) n’a pas accès aux données fournisseurs et
              facturations.
            </p>
          </div>
        </Main>
      </>
    )
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchButton />
        <div className='ms-auto flex items-center space-x-4'>
          <ProfileDropdown />
        </div>
      </Header>

      <Main className='bg-[#F6F6F7]'>
        {selectedSupplierRecord ? (
          <SupplierDetailView
            supplier={selectedSupplierRecord}
            purchases={purchasesData.headers}
            purchaseLines={purchasesData.lines}
            products={products}
            vatConvention={vatConvention}
            canEdit={canEdit}
            onBack={() => setSelectedSupplierId('')}
            onEdit={(sup) => openEditDrawer(sup)}
            onOpenMerge={(sup) => openMergeDialog(sup)}
            onNavigateToProduct={(productId) => {
              void navigate({ to: '/produits' })
              setTimeout(() => {
                window.history.replaceState(
                  null,
                  '',
                  `/produits?productId=${encodeURIComponent(productId)}`
                )
                window.dispatchEvent(new Event('monarq:navigate'))
              }, 30)
            }}
          />
        ) : (
          <div className='space-y-5'>
            {/* Header + Primary Action */}
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <h1 className='text-xl font-semibold tracking-tight text-[#202223]'>
                  Fournisseurs
                </h1>
                <p className='text-xs text-[#6D7175]'>
                  Répertoire des fournisseurs, conditions de paiement, cumul des
                  achats ({vatConvention}) et suivi des soldes impayés.
                </p>
              </div>

              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={handleExportSuppliers}
                  className='border-[#E1E3E5] bg-white text-[#202223]'
                >
                  <FileSpreadsheet className='mr-1.5 h-4 w-4 text-[#6D7175]' />
                  Exporter (.xlsx)
                </Button>

                {canEdit && suppliers.length > 1 && (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => openMergeDialog()}
                    className='border-[#E1E3E5] bg-white text-[#202223]'
                  >
                    <GitMerge className='mr-1.5 h-4 w-4 text-[#6D7175]' />
                    Fusionner des doublons
                  </Button>
                )}

                {canCreate && (
                  <Button
                    size='sm'
                    onClick={openCreateDrawer}
                    className='bg-[#008060] text-white hover:bg-[#006e52]'
                  >
                    <Plus className='mr-1.5 h-4 w-4' />
                    Ajouter un fournisseur
                  </Button>
                )}
              </div>
            </div>

            {/* Search & Filters */}
            <div className='space-y-3 rounded-lg border border-[#E1E3E5] bg-white p-4'>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
                <div className='relative flex-1'>
                  <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6D7175]' />
                  <Input
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setCurrentPage(1)
                    }}
                    placeholder='Rechercher un fournisseur, contact, téléphone ou e-mail...'
                    className='h-9 border-[#E1E3E5] pl-9 text-sm'
                  />
                </div>

                <div className='flex flex-wrap items-center gap-3'>
                  <label className='inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#E1E3E5] bg-[#F6F6F7]/60 px-3 py-1.5 text-xs font-medium text-[#202223]'>
                    <Checkbox
                      checked={unpaidOnly}
                      onCheckedChange={(v) => {
                        setUnpaidOnly(Boolean(v))
                        setCurrentPage(1)
                      }}
                    />
                    Avec solde impayé
                  </label>

                  <Select
                    value={archiveFilter}
                    onValueChange={(v) => {
                      setArchiveFilter(v)
                      setCurrentPage(1)
                    }}
                  >
                    <SelectTrigger className='h-9 w-36 border-[#E1E3E5] text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='active'>Fournisseurs actifs</SelectItem>
                      <SelectItem value='archived'>
                        Archivés / Fusionnés
                      </SelectItem>
                      <SelectItem value='all'>Tous</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className='flex items-center justify-between border-t border-[#E1E3E5] pt-2 text-xs text-[#6D7175]'>
                <span>
                  <strong className='text-[#202223]'>
                    {filteredSuppliers.length}
                  </strong>{' '}
                  fournisseur{filteredSuppliers.length > 1 ? 's' : ''} affiché
                  {filteredSuppliers.length > 1 ? 's' : ''}
                </span>
                {(searchQuery ||
                  unpaidOnly ||
                  archiveFilter !== 'active') && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-7 px-2 text-xs text-[#008060]'
                    onClick={() => {
                      setSearchQuery('')
                      setUnpaidOnly(false)
                      setArchiveFilter('active')
                      setCurrentPage(1)
                    }}
                  >
                    <RotateCcw className='mr-1 h-3 w-3' />
                    Réinitialiser
                  </Button>
                )}
              </div>
            </div>

            {/* Table Card */}
            <div className='overflow-hidden rounded-lg border border-[#E1E3E5] bg-white'>
              {suppliersQuery.isLoading ? (
                <div className='space-y-3 p-6'>
                  <Skeleton className='h-8 w-full' />
                  <Skeleton className='h-8 w-full' />
                  <Skeleton className='h-8 w-full' />
                </div>
              ) : filteredSuppliers.length === 0 ? (
                <div className='flex flex-col items-center justify-center px-6 py-16 text-center'>
                  <div className='mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F6F6F7]'>
                    <Building2 className='h-6 w-6 text-[#6D7175]' />
                  </div>
                  <h3 className='text-sm font-semibold text-[#202223]'>
                    Aucun fournisseur trouvé
                  </h3>
                  <p className='mt-1 max-w-md text-xs text-[#6D7175]'>
                    {suppliers.length === 0
                      ? 'Aucun fournisseur enregistré. Ajoutez un fournisseur ou importez votre fichier Excel MONARQ_ECONOMAT.'
                      : 'Aucun fournisseur ne correspond aux filtres sélectionnés.'}
                  </p>
                  {canCreate && (
                    <Button
                      size='sm'
                      onClick={openCreateDrawer}
                      className='mt-4 bg-[#008060] text-white hover:bg-[#006e52]'
                    >
                      <Plus className='mr-1.5 h-4 w-4' />
                      Ajouter un fournisseur
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className='border-b border-[#E1E3E5] bg-[#F6F6F7] hover:bg-[#F6F6F7]'>
                        <TableHead
                          onClick={() => handleSort('name')}
                          className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                        >
                          Fournisseur {renderSortIcon('name')}
                        </TableHead>
                        <TableHead
                          onClick={() => handleSort('contact')}
                          className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                        >
                          Contact {renderSortIcon('contact')}
                        </TableHead>
                        <TableHead
                          onClick={() => handleSort('phone')}
                          className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                        >
                          Téléphone {renderSortIcon('phone')}
                        </TableHead>
                        <TableHead
                          onClick={() => handleSort('email')}
                          className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                        >
                          Email {renderSortIcon('email')}
                        </TableHead>
                        <TableHead
                          onClick={() => handleSort('payment_terms')}
                          className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                        >
                          Conditions de paiement{' '}
                          {renderSortIcon('payment_terms')}
                        </TableHead>
                        <TableHead
                          onClick={() => handleSort('totalPurchases')}
                          className='cursor-pointer select-none text-right text-xs font-semibold text-[#6D7175]'
                        >
                          Total achats ({vatConvention}){' '}
                          {renderSortIcon('totalPurchases')}
                        </TableHead>
                        <TableHead
                          onClick={() => handleSort('unpaidBalance')}
                          className='cursor-pointer select-none text-right text-xs font-semibold text-[#6D7175]'
                        >
                          Solde impayé {renderSortIcon('unpaidBalance')}
                        </TableHead>
                        <TableHead
                          onClick={() => handleSort('lastPurchaseDate')}
                          className='cursor-pointer select-none text-xs font-semibold text-[#6D7175]'
                        >
                          Dernier achat {renderSortIcon('lastPurchaseDate')}
                        </TableHead>
                        <TableHead className='w-12 text-right text-xs font-semibold text-[#6D7175]'>
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedSuppliers.map((supplier) => {
                        const metrics = supplierAggregates.get(supplier.id)
                        const unpaid = metrics?.unpaidBalance ?? 0
                        const total = metrics?.totalPurchases ?? 0

                        return (
                          <TableRow
                            key={supplier.id}
                            className='cursor-pointer border-b border-[#E1E3E5] hover:bg-[#F6F6F7]/70'
                            onClick={() => setSelectedSupplierId(supplier.id)}
                          >
                            <TableCell className='text-xs font-semibold text-[#202223]'>
                              <div className='flex items-center gap-2'>
                                <span>{supplier.name}</span>
                                {supplier.archived && (
                                  <Badge
                                    variant='secondary'
                                    className='bg-neutral-200 text-[10px] text-neutral-700'
                                  >
                                    Archivé
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className='text-xs text-[#6D7175]'>
                              {supplier.contact || '—'}
                            </TableCell>
                            <TableCell className='text-xs text-[#6D7175]'>
                              {supplier.phone || '—'}
                            </TableCell>
                            <TableCell className='text-xs text-[#6D7175]'>
                              {supplier.email || '—'}
                            </TableCell>
                            <TableCell className='text-xs text-[#6D7175]'>
                              {supplier.payment_terms || '—'}
                            </TableCell>
                            <TableCell className='text-right font-mono text-xs font-medium text-[#202223]'>
                              {formatMAD(total)}
                            </TableCell>
                            <TableCell className='text-right font-mono text-xs font-semibold'>
                              {unpaid > 0 ? (
                                <Badge className='border-transparent bg-[#FBEAE5] font-mono text-xs font-semibold text-[#D72C0D] hover:bg-[#FBEAE5]'>
                                  {formatMAD(unpaid)}
                                </Badge>
                              ) : (
                                <span className='text-[#008060]'>
                                  {formatMAD(0)}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className='text-xs text-[#6D7175]'>
                              {metrics?.lastPurchaseDate
                                ? formatDateFR(metrics.lastPurchaseDate)
                                : '—'}
                            </TableCell>
                            <TableCell
                              className='text-right'
                              onClick={(e) => e.stopPropagation()}
                            >
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-7 w-7 p-0'
                                  >
                                    <MoreHorizontal className='h-4 w-4' />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align='end'>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setSelectedSupplierId(supplier.id)
                                    }
                                  >
                                    <Eye className='mr-2 h-4 w-4' />
                                    Voir la fiche fournisseur
                                  </DropdownMenuItem>
                                  {canEdit && (
                                    <>
                                      <DropdownMenuItem
                                        onClick={() => openEditDrawer(supplier)}
                                      >
                                        <Edit3 className='mr-2 h-4 w-4' />
                                        Modifier
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() =>
                                          openMergeDialog(supplier)
                                        }
                                      >
                                        <GitMerge className='mr-2 h-4 w-4' />
                                        Fusionner vers un autre fournisseur
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className='flex flex-col items-center justify-between gap-3 border-t border-[#E1E3E5] bg-[#F6F6F7]/50 px-4 py-3 text-xs text-[#6D7175] sm:flex-row'>
                    <div className='flex items-center gap-2'>
                      <span>Lignes par page :</span>
                      <Select
                        value={String(pageSize)}
                        onValueChange={(v) => {
                          setPageSize(Number(v))
                          setCurrentPage(1)
                        }}
                      >
                        <SelectTrigger className='h-7 w-20 bg-white text-xs'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='25'>25</SelectItem>
                          <SelectItem value='50'>50</SelectItem>
                          <SelectItem value='100'>100</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className='flex items-center gap-3'>
                      <span>
                        Page{' '}
                        <strong className='text-[#202223]'>{safePage}</strong>{' '}
                        sur{' '}
                        <strong className='text-[#202223]'>{totalPages}</strong>
                      </span>
                      <div className='flex items-center gap-1'>
                        <Button
                          variant='outline'
                          size='sm'
                          className='h-7 bg-white px-2.5 text-xs'
                          disabled={safePage <= 1}
                          onClick={() =>
                            setCurrentPage((p) => Math.max(1, p - 1))
                          }
                        >
                          Précédent
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          className='h-7 bg-white px-2.5 text-xs'
                          disabled={safePage >= totalPages}
                          onClick={() =>
                            setCurrentPage((p) => Math.min(totalPages, p + 1))
                          }
                        >
                          Suivant
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Main>

      {/* Create / Edit Supplier Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className='flex w-full flex-col overflow-y-auto bg-white sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle className='text-base font-semibold text-[#202223]'>
              {editingSupplier
                ? `Modifier « ${editingSupplier.name} »`
                : 'Ajouter un fournisseur'}
            </SheetTitle>
            <SheetDescription className='text-xs text-[#6D7175]'>
              Renseignez les coordonnées et conditions de règlement du
              fournisseur.
            </SheetDescription>
          </SheetHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              setSubmittedAttempt(true)
              if (!formState.name.trim() || exactDuplicateSupplier) return
              saveSupplierMutation.mutate()
            }}
            className='mt-4 flex flex-1 flex-col justify-between space-y-5'
          >
            <div className='space-y-4'>
              {/* Name */}
              <div className='space-y-1.5'>
                <Label className='text-xs font-medium text-[#202223]'>
                  Nom du fournisseur <span className='text-[#D72C0D]'>*</span>
                </Label>
                <Input
                  value={formState.name}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder='Ex. BOXY Distribution'
                  className={
                    (submittedAttempt && !formState.name.trim()) ||
                    exactDuplicateSupplier
                      ? 'border-[#D72C0D] focus-visible:ring-[#D72C0D]'
                      : ''
                  }
                />
                {exactDuplicateSupplier && (
                  <p className='text-xs font-medium text-[#D72C0D]'>
                    Ce fournisseur existe déjà sous le nom «{' '}
                    {exactDuplicateSupplier.name} ».
                  </p>
                )}
                {!exactDuplicateSupplier &&
                  nearDuplicateSuppliers.length > 0 && (
                    <div className='rounded-md border border-[#B98900]/40 bg-[#FFF8E6] p-2.5 text-xs text-[#202223]'>
                      <div className='flex items-start gap-2'>
                        <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-[#B98900]' />
                        <div className='space-y-1.5'>
                          <p>
                            Fournisseur(s) au nom proche détecté(s) :{' '}
                            <strong>
                              {nearDuplicateSuppliers
                                .map((s) => s.name)
                                .join(', ')}
                            </strong>
                            .
                          </p>
                          {editingSupplier ? (
                            <Button
                              type='button'
                              size='sm'
                              variant='outline'
                              className='h-7 bg-white text-xs'
                              onClick={() => {
                                setDrawerOpen(false)
                                openMergeDialog(
                                  editingSupplier,
                                  nearDuplicateSuppliers[0]
                                )
                              }}
                            >
                              <GitMerge className='mr-1 h-3.5 w-3.5' />
                              Fusionner avec {nearDuplicateSuppliers[0].name}
                            </Button>
                          ) : (
                            <Button
                              type='button'
                              size='sm'
                              variant='outline'
                              className='h-7 bg-white text-xs'
                              onClick={() => {
                                setDrawerOpen(false)
                                setSelectedSupplierId(
                                  nearDuplicateSuppliers[0].id
                                )
                              }}
                            >
                              Ouvrir la fiche existante «{' '}
                              {nearDuplicateSuppliers[0].name} »
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
              </div>

              {/* Contact */}
              <div className='space-y-1.5'>
                <Label className='text-xs font-medium text-[#202223]'>
                  Nom du contact commercial
                </Label>
                <Input
                  value={formState.contact}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      contact: e.target.value,
                    }))
                  }
                  placeholder='Ex. Karim Bennani'
                />
              </div>

              {/* Phone & Email */}
              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Téléphone
                  </Label>
                  <Input
                    value={formState.phone}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        phone: e.target.value,
                      }))
                    }
                    placeholder='Ex. 06 61 00 00 00'
                  />
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs font-medium text-[#202223]'>
                    Adresse e-mail
                  </Label>
                  <Input
                    type='email'
                    value={formState.email}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        email: e.target.value,
                      }))
                    }
                    placeholder='commandes@fournisseur.ma'
                  />
                </div>
              </div>

              {/* Payment Terms */}
              <div className='space-y-1.5'>
                <Label className='text-xs font-medium text-[#202223]'>
                  Conditions de paiement
                </Label>
                <Input
                  value={formState.payment_terms}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      payment_terms: e.target.value,
                    }))
                  }
                  placeholder='Ex. 30 jours fin de mois, Paiement à la livraison, Chèque...'
                />
              </div>

              {/* Notes */}
              <div className='space-y-1.5'>
                <Label className='text-xs font-medium text-[#202223]'>
                  Notes & observations
                </Label>
                <Textarea
                  rows={3}
                  value={formState.notes}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder='Jours de livraison, Franco de port, RIB...'
                />
              </div>
            </div>

            <SheetFooter className='border-t border-[#E1E3E5] pt-4'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setDrawerOpen(false)}
              >
                Annuler
              </Button>
              <Button
                type='submit'
                disabled={
                  saveSupplierMutation.isPending ||
                  Boolean(exactDuplicateSupplier)
                }
                className='bg-[#008060] text-white hover:bg-[#006e52]'
              >
                {editingSupplier
                  ? 'Enregistrer les modifications'
                  : 'Créer le fournisseur'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Merge Suppliers Dialog */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className='bg-white sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2 text-base font-semibold text-[#202223]'>
              <GitMerge className='h-5 w-5 text-[#008060]' />
              Fusionner deux fournisseurs en doublon
            </DialogTitle>
            <DialogDescription className='text-xs text-[#6D7175]'>
              Tous les bons d’achat du fournisseur source seront transférés vers
              le fournisseur cible. Le fournisseur source sera ensuite archivé
              et une écriture sera ajoutée au journal d’audit.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-4 py-2'>
            <div className='space-y-1.5'>
              <Label className='text-xs font-medium text-[#202223]'>
                Fournisseur doublon à fusionner (Source — sera archivé)
              </Label>
              <Select value={mergeSourceId} onValueChange={setMergeSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder='Choisir le fournisseur source' />
                </SelectTrigger>
                <SelectContent>
                  {suppliers
                    .filter((s) => !s.archived)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs font-medium text-[#202223]'>
                Fournisseur principal à conserver (Cible)
              </Label>
              <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder='Choisir le fournisseur cible' />
                </SelectTrigger>
                <SelectContent>
                  {suppliers
                    .filter((s) => !s.archived && s.id !== mergeSourceId)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {mergeSourceId && mergeTargetId && (
              <div className='rounded-md border border-[#B98900]/40 bg-[#FFF8E6] p-3 text-xs text-[#202223]'>
                <strong>{mergeSourcePurchaseCount}</strong> bon(s) d’achat
                associé(s) à ce fournisseur seront rattachés au fournisseur
                cible.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => setMergeOpen(false)}>
              Annuler
            </Button>
            <Button
              disabled={
                !mergeSourceId ||
                !mergeTargetId ||
                mergeSourceId === mergeTargetId ||
                mergeSuppliersMutation.isPending
              }
              onClick={() => mergeSuppliersMutation.mutate()}
              className='bg-[#008060] text-white hover:bg-[#006e52]'
            >
              Confirmer la fusion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export const Fournisseurs = FournisseursPage

