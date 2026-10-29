import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  Edit3,
  GitMerge,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import type { ProductRecord } from '@/data/types'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type TaxonomyKind = 'categories' | 'units' | 'locations'

interface TaxonomyManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: TaxonomyKind
  products: ProductRecord[]
  configuredCategories: string[]
  configuredUnits: string[]
  configuredLocations: string[]
  canEdit: boolean
}

export function TaxonomyManagerDialog({
  open,
  onOpenChange,
  initialTab = 'categories',
  products,
  configuredCategories,
  configuredUnits,
  configuredLocations,
  canEdit,
}: TaxonomyManagerDialogProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TaxonomyKind>(initialTab)
  const [newItemName, setNewItemName] = useState('')
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  // Merge state
  const [mergeSource, setMergeSource] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState<string>('')

  const countsByKind = useMemo(() => {
    const catCounts = new Map<string, number>()
    const unitCounts = new Map<string, number>()
    const locCounts = new Map<string, number>()

    for (const c of configuredCategories) {
      if (c.trim()) catCounts.set(c.trim(), 0)
    }
    for (const u of configuredUnits) {
      if (u.trim()) unitCounts.set(u.trim(), 0)
    }
    for (const l of configuredLocations) {
      if (l.trim()) locCounts.set(l.trim(), 0)
    }

    for (const p of products) {
      const cat = p.category?.trim()
      if (cat) {
        catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1)
      }
      const unit = p.unit?.trim()
      if (unit) {
        unitCounts.set(unit, (unitCounts.get(unit) ?? 0) + 1)
      }
      const loc = p.location?.trim()
      if (loc) {
        locCounts.set(loc, (locCounts.get(loc) ?? 0) + 1)
      }
    }

    const toSortedArray = (map: Map<string, number>) =>
      Array.from(map.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))

    return {
      categories: toSortedArray(catCounts),
      units: toSortedArray(unitCounts),
      locations: toSortedArray(locCounts),
    }
  }, [products, configuredCategories, configuredUnits, configuredLocations])

  const currentItems = countsByKind[activeTab]

  const settingKeyForTab = (tab: TaxonomyKind) => {
    if (tab === 'categories') return 'categories_list'
    if (tab === 'units') return 'units_list'
    return 'locations_list'
  }

  const labelSingular = (tab: TaxonomyKind) => {
    if (tab === 'categories') return 'catégorie'
    if (tab === 'units') return 'unité'
    return 'emplacement'
  }

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      const clean = name.trim()
      if (!clean) throw new Error('Le nom ne peut pas être vide.')
      const existing = currentItems.some(
        (i) => i.name.toLowerCase() === clean.toLowerCase()
      )
      if (existing) {
        throw new Error(`« ${clean} » existe déjà dans la liste.`)
      }
      const nextList = currentItems.map((i) => i.name).concat([clean])
      await repository.upsertSetting(settingKeyForTab(activeTab), nextList)
      return clean
    },
    onSuccess: (added) => {
      setNewItemName('')
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success(`Nouvel élément « ${added} » ajouté.`)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const renameOrMergeMutation = useMutation({
    mutationFn: async ({
      from,
      to,
      mode,
    }: {
      from: string
      to: string
      mode: 'rename' | 'merge'
    }) => {
      const cleanFrom = from.trim()
      const cleanTo = to.trim()
      if (!cleanFrom || !cleanTo) {
        throw new Error('Veuillez saisir un nom valide.')
      }
      let moved: number
      if (activeTab === 'categories') {
        moved = await repository.renameOrMergeCategory(cleanFrom, cleanTo)
      } else if (activeTab === 'units') {
        moved = await repository.renameOrMergeUnit(cleanFrom, cleanTo)
      } else {
        moved = await repository.renameOrMergeLocation(cleanFrom, cleanTo)
      }

      // Also sync the setting list
      const updatedList = Array.from(
        new Set(
          currentItems
            .map((i) =>
              i.name.toLowerCase() === cleanFrom.toLowerCase()
                ? cleanTo
                : i.name
            )
            .concat([cleanTo])
        )
      )
      await repository.upsertSetting(settingKeyForTab(activeTab), updatedList)
      return { moved, from: cleanFrom, to: cleanTo, mode }
    },
    onSuccess: ({ moved, from, to, mode }) => {
      setEditingItem(null)
      setEditingValue('')
      setMergeSource(null)
      setMergeTarget('')
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      void queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      if (mode === 'merge') {
        toast.success(
          `Fusion effectuée : ${moved} produit(s) déplacé(s) de « ${from} » vers « ${to} ».`
        )
      } else {
        toast.success(
          `Renommage effectué : « ${from} » → « ${to} » (${moved} produit(s) mis à jour).`
        )
      }
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const disableUnusedMutation = useMutation({
    mutationFn: async (itemName: string) => {
      const item = currentItems.find((i) => i.name === itemName)
      if (item && item.count > 0) {
        throw new Error(
          `Impossible de supprimer « ${itemName} » car ${item.count} produit(s) l'utilisent. Utilisez la fonction Fusionner.`
        )
      }
      const nextList = currentItems
        .filter((i) => i.name.toLowerCase() !== itemName.toLowerCase())
        .map((i) => i.name)
      await repository.upsertSetting(settingKeyForTab(activeTab), nextList)
      return itemName
    },
    onSuccess: (removed) => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success(`Élément inutilisé « ${removed} » désactivé.`)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const mergeSourceItem = currentItems.find((i) => i.name === mergeSource)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl bg-white'>
        <DialogHeader>
          <DialogTitle className='text-lg font-semibold text-[#202223]'>
            Gérer les catégories, unités et emplacements
          </DialogTitle>
          <DialogDescription className='text-sm text-[#6D7175]'>
            Ajoutez, renommez ou fusionnez des éléments. Une catégorie ou unité
            utilisée par des produits ne peut jamais être supprimée : fusionnez-la
            vers une autre pour conserver l’historique.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as TaxonomyKind)
            setEditingItem(null)
            setMergeSource(null)
          }}
        >
          <TabsList className='grid w-full grid-cols-3'>
            <TabsTrigger value='categories'>
              Catégories ({countsByKind.categories.length})
            </TabsTrigger>
            <TabsTrigger value='units'>
              Unités ({countsByKind.units.length})
            </TabsTrigger>
            <TabsTrigger value='locations'>
              Emplacements ({countsByKind.locations.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className='mt-4 space-y-4'>
            {canEdit && (
              <div className='flex gap-2'>
                <Input
                  placeholder={`Nouvelle ${labelSingular(activeTab)}...`}
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newItemName.trim()) {
                      e.preventDefault()
                      addMutation.mutate(newItemName)
                    }
                  }}
                />
                <Button
                  type='button'
                  disabled={!newItemName.trim() || addMutation.isPending}
                  onClick={() => addMutation.mutate(newItemName)}
                  className='shrink-0 bg-[#008060] text-white hover:bg-[#006e52]'
                >
                  <Plus className='mr-1.5 h-4 w-4' />
                  Ajouter
                </Button>
              </div>
            )}

            {mergeSource && (
              <div className='rounded-md border border-[#B98900]/40 bg-[#FFF8E6] p-3.5'>
                <div className='flex items-start gap-2.5'>
                  <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-[#B98900]' />
                  <div className='flex-1 space-y-2.5'>
                    <div className='text-sm font-medium text-[#202223]'>
                      Fusionner « {mergeSource} » ({mergeSourceItem?.count ?? 0}{' '}
                      produit(s)) vers :
                    </div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <Select
                        value={mergeTarget}
                        onValueChange={setMergeTarget}
                      >
                        <SelectTrigger className='w-60 bg-white'>
                          <SelectValue placeholder='Choisir la cible...' />
                        </SelectTrigger>
                        <SelectContent>
                          {currentItems
                            .filter((i) => i.name !== mergeSource)
                            .map((i) => (
                              <SelectItem key={i.name} value={i.name}>
                                {i.name} ({i.count} produit(s))
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size='sm'
                        disabled={
                          !mergeTarget || renameOrMergeMutation.isPending
                        }
                        onClick={() =>
                          renameOrMergeMutation.mutate({
                            from: mergeSource,
                            to: mergeTarget,
                            mode: 'merge',
                          })
                        }
                        className='bg-[#008060] text-white hover:bg-[#006e52]'
                      >
                        Confirmer la fusion ({mergeSourceItem?.count ?? 0}{' '}
                        produit(s))
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => {
                          setMergeSource(null)
                          setMergeTarget('')
                        }}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className='max-h-80 divide-y divide-[#E1E3E5] overflow-y-auto rounded-md border border-[#E1E3E5]'>
              {currentItems.length === 0 ? (
                <div className='p-6 text-center text-sm text-[#6D7175]'>
                  Aucun élément configuré pour le moment.
                </div>
              ) : (
                currentItems.map((item) => {
                  const isEditing = editingItem === item.name
                  return (
                    <div
                      key={item.name}
                      className='flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm hover:bg-[#F6F6F7]'
                    >
                      {isEditing ? (
                        <div className='flex flex-1 items-center gap-2'>
                          <Input
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            className='h-8 max-w-xs'
                            autoFocus
                          />
                          <Button
                            size='sm'
                            className='h-8 bg-[#008060] px-2.5 text-white hover:bg-[#006e52]'
                            disabled={
                              !editingValue.trim() ||
                              renameOrMergeMutation.isPending
                            }
                            onClick={() =>
                              renameOrMergeMutation.mutate({
                                from: item.name,
                                to: editingValue,
                                mode: 'rename',
                              })
                            }
                          >
                            <Check className='h-3.5 w-3.5' />
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-8 px-2'
                            onClick={() => {
                              setEditingItem(null)
                              setEditingValue('')
                            }}
                          >
                            <X className='h-3.5 w-3.5' />
                          </Button>
                        </div>
                      ) : (
                        <div className='flex items-center gap-2.5'>
                          <span className='font-medium text-[#202223]'>
                            {item.name}
                          </span>
                          <Badge
                            variant='secondary'
                            className='bg-[#F1F2F3] text-xs font-normal text-[#6D7175]'
                          >
                            {item.count} produit{item.count > 1 ? 's' : ''}
                          </Badge>
                        </div>
                      )}

                      {canEdit && !isEditing && (
                        <div className='flex items-center gap-1'>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-7 px-2 text-xs text-[#202223]'
                            onClick={() => {
                              setEditingItem(item.name)
                              setEditingValue(item.name)
                            }}
                          >
                            <Edit3 className='mr-1 h-3.5 w-3.5' />
                            Renommer
                          </Button>
                          {currentItems.length > 1 && (
                            <Button
                              size='sm'
                              variant='ghost'
                              className='h-7 px-2 text-xs text-[#202223]'
                              onClick={() => {
                                setMergeSource(item.name)
                                const firstOther = currentItems.find(
                                  (other) => other.name !== item.name
                                )
                                setMergeTarget(firstOther?.name ?? '')
                              }}
                            >
                              <GitMerge className='mr-1 h-3.5 w-3.5' />
                              Fusionner
                            </Button>
                          )}
                          {item.count === 0 ? (
                            <Button
                              size='sm'
                              variant='ghost'
                              className='h-7 px-2 text-xs text-[#D72C0D] hover:bg-red-50 hover:text-[#D72C0D]'
                              onClick={() =>
                                disableUnusedMutation.mutate(item.name)
                              }
                            >
                              <Trash2 className='mr-1 h-3.5 w-3.5' />
                              Désactiver
                            </Button>
                          ) : (
                            <Label className='px-2 text-[11px] text-[#6D7175]'>
                              Utilisé
                            </Label>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
