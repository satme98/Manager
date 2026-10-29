import { useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Boxes,
  Building2,
  Download,
  FileSpreadsheet,
  HardDriveDownload,
  ListChecks,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import type { BackupPayload } from '@/data/types'
import { invalidateDashboardAnalyticsCache } from '@/data/analytics'
import { triggerManualBackupDownload } from '@/lib/backup-export'
import { formatDateTimeFR } from '@/lib/formatters'
import { canPerformCollectionAction } from '@/lib/rbac'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageShell } from '@/components/layout/page-shell'

const DEFAULT_LISTS: Record<string, string[]> = {
  categories_list: [
    'Viandes & Volailles',
    'Poissons & Fruits de mer',
    'Fruits & Légumes',
    'Épicerie sèche',
    'Crèmerie & Fromages',
    'Boissons & Cave',
    'Emballages & Hygiène',
  ],
  units_list: ['kg', 'g', 'L', 'cl', 'u', 'btl', 'boîte', 'carton', 'sac'],
  destinations_list: [
    'Cuisine chaude',
    'Cuisine froide',
    'Pâtisserie',
    'Bar',
    'Salle',
    'Personnel',
  ],
  locations_list: [
    'Économat central',
    'Chambre froide positive',
    'Chambre froide négative',
    'Cave à vins',
    'Réserve sèche',
  ],
  waste_reasons_list: [
    'Péremption / DLC dépassée',
    'Casse / Chute',
    'Erreur de préparation',
    'Altération / Chaîne du froid',
    'Retour client',
  ],
  payment_methods_list: [
    'Espèces',
    'Virement bancaire',
    'Chèque',
    'Carte bancaire',
    'Effet de commerce',
  ],
}

export function Parametres() {
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()
  const restoreInputRef = useRef<HTMLInputElement | null>(null)
  const [restoringBackup, setRestoringBackup] = useState(false)
  const role = auth.user?.role ?? 'consultation'
  const isAdmin = role === 'admin'
  const canEditSettings = canPerformCollectionAction(
    role,
    'settings',
    'update'
  )
  const canManageUsers = canPerformCollectionAction(role, 'users', 'create')

  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => repository.listSettings(),
  })

  const settingsMap = useMemo(() => {
    const map = new Map<string, unknown>()
    for (const s of settings) {
      map.set(s.key, s.value)
    }
    return map
  }, [settings])

  // Général state (local overrides on top of persisted settings)
  const [restaurantNameOverride, setRestaurantName] = useState<string | null>(null)
  const [vatConventionOverride, setVatConvention] = useState<'TTC' | 'HT' | null>(null)
  const [vatRateOverride, setVatRate] = useState<string | null>(null)
  const [savingGeneral, setSavingGeneral] = useState(false)

  // Stock & Paiements state
  const [watchThresholdPctOverride, setWatchThresholdPct] = useState<string | null>(null)
  const [varianceAlertPctOverride, setVarianceAlertPct] = useState<string | null>(null)
  const [replenishmentMultiplierOverride, setReplenishmentMultiplier] = useState<string | null>(null)
  const [allowNegativeStockOverride, setAllowNegativeStock] = useState<boolean | null>(null)
  const [partialPaymentsEnabledOverride, setPartialPaymentsEnabled] = useState<boolean | null>(null)
  const [savingStock, setSavingStock] = useState(false)

  // Listes state
  const [activeListKey, setActiveListKey] = useState<string>('categories_list')
  const [newListItem, setNewListItem] = useState('')
  const [savingList, setSavingList] = useState(false)

  const restaurantName =
    restaurantNameOverride ??
    (typeof settingsMap.get('restaurant_name') === 'string'
      ? String(settingsMap.get('restaurant_name'))
      : 'MONARQ ÉCONOMAT')

  const vatConvention: 'TTC' | 'HT' =
    vatConventionOverride ??
    (settingsMap.get('vat_convention') === 'HT' ? 'HT' : 'TTC')

  const vatRate =
    vatRateOverride ??
    (settingsMap.get('vat_rate') !== undefined
      ? String(settingsMap.get('vat_rate'))
      : '20')

  const watchThresholdPct =
    watchThresholdPctOverride ??
    (settingsMap.get('watch_threshold_pct') !== undefined
      ? String(settingsMap.get('watch_threshold_pct'))
      : '150')

  const varianceAlertPct =
    varianceAlertPctOverride ??
    (settingsMap.get('variance_alert_pct') !== undefined
      ? String(settingsMap.get('variance_alert_pct'))
      : '5')

  const replenishmentMultiplier =
    replenishmentMultiplierOverride ??
    (settingsMap.get('replenishment_multiplier') !== undefined
      ? String(settingsMap.get('replenishment_multiplier'))
      : '2')

  const allowNegativeStock =
    allowNegativeStockOverride ??
    (settingsMap.get('allow_negative_stock') === true ||
      settingsMap.get('allow_negative_stock') === 'true')

  const partialPaymentsEnabled =
    partialPaymentsEnabledOverride ??
    (settingsMap.get('partial_payments_enabled') === true ||
      settingsMap.get('partial_payments_enabled') === 'true')

  const currentListItems = useMemo(() => {
    const saved = settingsMap.get(activeListKey)
    if (Array.isArray(saved)) {
      return saved.map(String)
    }
    return DEFAULT_LISTS[activeListKey] ?? []
  }, [settingsMap, activeListKey])

  const lastBackupDate = useMemo(() => {
    const val = settingsMap.get('last_manual_backup_at')
    return typeof val === 'string' ? val : null
  }, [settingsMap])

  async function handleSaveGeneral() {
    if (!isAdmin) {
      toast.error('Seul un administrateur peut modifier ces paramètres sensibles.')
      return
    }
    setSavingGeneral(true)
    try {
      await repository.upsertSetting(
        'restaurant_name',
        restaurantName.trim() || 'MONARQ ÉCONOMAT'
      )
      await repository.upsertSetting('vat_convention', vatConvention)
      await repository.upsertSetting('vat_rate', Number(vatRate) || 20)
      invalidateDashboardAnalyticsCache()
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      await queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      toast.success('Paramètres généraux et fiscaux enregistrés.')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.'
      )
    } finally {
      setSavingGeneral(false)
    }
  }

  async function handleSaveStockSettings() {
    if (!isAdmin) {
      toast.error('Seul un administrateur peut modifier les règles de stock et de paiement.')
      return
    }
    setSavingStock(true)
    try {
      await repository.upsertSetting(
        'watch_threshold_pct',
        Math.max(100, Number(watchThresholdPct) || 150)
      )
      await repository.upsertSetting(
        'variance_alert_pct',
        Math.max(0, Number(varianceAlertPct) || 5)
      )
      await repository.upsertSetting(
        'replenishment_multiplier',
        Math.max(0.5, Number(replenishmentMultiplier) || 2)
      )
      await repository.upsertSetting('allow_negative_stock', allowNegativeStock)
      await repository.upsertSetting(
        'partial_payments_enabled',
        partialPaymentsEnabled
      )
      invalidateDashboardAnalyticsCache()
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      await queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      toast.success('Règles de stock, seuils et paiements enregistrés.')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.'
      )
    } finally {
      setSavingStock(false)
    }
  }

  async function handleAddListItem() {
    const trimmed = newListItem.trim()
    if (!trimmed) return
    if (currentListItems.some((i) => i.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('Cet élément existe déjà dans la liste.')
      return
    }
    setSavingList(true)
    try {
      const updated = [...currentListItems, trimmed]
      await repository.upsertSetting(activeListKey, updated)
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      await queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      setNewListItem('')
      toast.success(`« ${trimmed} » ajouté à la liste.`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Impossible d'ajouter l'élément."
      )
    } finally {
      setSavingList(false)
    }
  }

  async function handleRemoveListItem(itemToRemove: string) {
    setSavingList(true)
    try {
      const updated = currentListItems.filter((i) => i !== itemToRemove)
      await repository.upsertSetting(activeListKey, updated)
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      await queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      toast.success(`« ${itemToRemove} » retiré de la liste.`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Impossible de supprimer l'élément."
      )
    } finally {
      setSavingList(false)
    }
  }

  async function handleManualBackup() {
    await triggerManualBackupDownload()
    if (canEditSettings) {
      await repository.upsertSetting(
        'last_manual_backup_at',
        new Date().toISOString()
      )
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
    }
  }

  async function handleRestoreBackupFile(file: File) {
    if (!isAdmin) {
      toast.error('Seul un administrateur peut restaurer une sauvegarde.')
      return
    }
    setRestoringBackup(true)
    try {
      const text = await file.text()
      const payload = JSON.parse(text) as BackupPayload
      await repository.restoreBackup(payload)
      await queryClient.invalidateQueries()
      toast.success('Sauvegarde restaurée avec succès.', {
        description: `Archive du ${formatDateTimeFR(payload.exported_at)} appliquée.`,
      })
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Impossible de restaurer ce fichier de sauvegarde JSON.'
      )
    } finally {
      setRestoringBackup(false)
    }
  }

  return (
    <PageShell
      section='SYSTÈME'
      title='Paramètres'
      description='Configuration générale, règles de stock, seuils de réapprovisionnement, listes de référence, sauvegardes et gestion des utilisateurs.'
      primaryAction={{
        label: 'Exporter une sauvegarde',
        onClick: () => void handleManualBackup(),
        icon: Download,
      }}
      secondaryActions={[
        {
          label: 'Import / Export',
          to: '/import-export',
          icon: FileSpreadsheet,
        },
        ...(canManageUsers
          ? [
              {
                label: 'Gérer les utilisateurs',
                to: '/utilisateurs',
                icon: Users,
              },
            ]
          : []),
      ]}
    >
      <Tabs defaultValue='general' className='space-y-4'>
        <TabsList className='h-9 bg-[#EBEBEB]'>
          <TabsTrigger value='general' className='text-xs'>
            <Building2 className='mr-1.5 h-3.5 w-3.5' />
            Général
          </TabsTrigger>
          <TabsTrigger value='stock' className='text-xs'>
            <Boxes className='mr-1.5 h-3.5 w-3.5' />
            Stock & Paiements
          </TabsTrigger>
          <TabsTrigger value='lists' className='text-xs'>
            <ListChecks className='mr-1.5 h-3.5 w-3.5' />
            Listes de référence
          </TabsTrigger>
          <TabsTrigger value='backup' className='text-xs'>
            <HardDriveDownload className='mr-1.5 h-3.5 w-3.5' />
            Sauvegarde & Utilisateurs
          </TabsTrigger>
        </TabsList>

        {/* SECTION 1: GÉNÉRAL */}
        <TabsContent value='general'>
          <Card className='border-[#E1E3E5] bg-white py-0 shadow-none'>
            <CardHeader className='border-b border-[#E1E3E5] px-4 py-3'>
              <CardTitle className='text-sm font-semibold text-[#202223]'>
                Identité de l’établissement & conventions financières
              </CardTitle>
              <CardDescription className='text-xs'>
                Toute modification est tracée dans le journal d’audit. Les réglages financiers requièrent le rôle Administrateur.
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4 p-4 text-xs'>
              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Nom du restaurant / établissement</Label>
                  <Input
                    value={restaurantName}
                    disabled={!isAdmin}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    className='h-8 text-xs'
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Devise & Format de date</Label>
                  <Input
                    value='MAD (DH) — Format JJ/MM/AAAA'
                    disabled
                    className='h-8 bg-[#F6F6F7] text-xs'
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Convention d’affichage des prix</Label>
                  <Select
                    value={vatConvention}
                    disabled={!isAdmin}
                    onValueChange={(v) => setVatConvention(v as 'TTC' | 'HT')}
                  >
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='TTC' className='text-xs'>
                        Prix TTC (Toutes Taxes Comprises)
                      </SelectItem>
                      <SelectItem value='HT' className='text-xs'>
                        Prix HT (Hors Taxes)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Taux de TVA par défaut (%)</Label>
                  <Input
                    type='number'
                    min={0}
                    max={100}
                    value={vatRate}
                    disabled={!isAdmin}
                    onChange={(e) => setVatRate(e.target.value)}
                    className='h-8 text-xs'
                  />
                </div>
              </div>

              <div className='flex items-center justify-end border-t border-[#E1E3E5] pt-3'>
                {isAdmin ? (
                  <Button
                    size='sm'
                    onClick={() => void handleSaveGeneral()}
                    disabled={savingGeneral}
                  >
                    {savingGeneral && (
                      <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                    )}
                    <Save className='mr-1.5 h-3.5 w-3.5' />
                    Enregistrer les paramètres généraux
                  </Button>
                ) : (
                  <span className='inline-flex items-center gap-1 text-[#6D7175]'>
                    <ShieldAlert className='h-3.5 w-3.5' />
                    Réservé à l’administrateur
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SECTION 2: STOCK & PAIEMENTS */}
        <TabsContent value='stock'>
          <Card className='border-[#E1E3E5] bg-white py-0 shadow-none'>
            <CardHeader className='border-b border-[#E1E3E5] px-4 py-3'>
              <CardTitle className='text-sm font-semibold text-[#202223]'>
                Règles de calcul de stock, seuils d’alerte et paiements
              </CardTitle>
              <CardDescription className='text-xs'>
                Paramétrez les seuils utilisés par le moteur de stock (stock-engine), le réapprovisionnement et le suivi des factures.
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4 p-4 text-xs'>
              <div className='grid gap-4 sm:grid-cols-3'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>
                    Seuil « À surveiller » (% du stock min, défaut : 150%)
                  </Label>
                  <Input
                    type='number'
                    min={101}
                    max={500}
                    value={watchThresholdPct}
                    disabled={!isAdmin}
                    onChange={(e) => setWatchThresholdPct(e.target.value)}
                    className='h-8 text-xs'
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>
                    Seuil d’alerte d’écart d’inventaire (%)
                  </Label>
                  <Input
                    type='number'
                    min={0}
                    max={100}
                    value={varianceAlertPct}
                    disabled={!isAdmin}
                    onChange={(e) => setVarianceAlertPct(e.target.value)}
                    className='h-8 text-xs'
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>
                    Multiplicateur de réapprovisionnement (défaut : 2)
                  </Label>
                  <Input
                    type='number'
                    min={1}
                    step='0.5'
                    value={replenishmentMultiplier}
                    disabled={!isAdmin}
                    onChange={(e) => setReplenishmentMultiplier(e.target.value)}
                    className='h-8 text-xs'
                  />
                  <p className='text-[11px] text-[#6D7175]'>
                    Formule : quantité suggérée = min × multiplicateur − stock actuel
                  </p>
                </div>
              </div>

              <div className='grid gap-3 pt-2 sm:grid-cols-2'>
                <div className='flex items-center justify-between rounded-md border border-[#E1E3E5] p-3'>
                  <div className='space-y-0.5 pr-3'>
                    <div className='font-semibold text-[#202223]'>
                      Autoriser les dérogations de stock négatif
                    </div>
                    <p className='text-[11px] text-[#6D7175]'>
                      Permet à un responsable de forcer une sortie supérieure au stock disponible avec motif obligatoire.
                    </p>
                  </div>
                  <Switch
                    checked={allowNegativeStock}
                    disabled={!isAdmin}
                    onCheckedChange={setAllowNegativeStock}
                  />
                </div>

                <div className='flex items-center justify-between rounded-md border border-[#E1E3E5] p-3'>
                  <div className='space-y-0.5 pr-3'>
                    <div className='font-semibold text-[#202223]'>
                      Activer les paiements partiels fournisseurs
                    </div>
                    <p className='text-[11px] text-[#6D7175]'>
                      Active le statut « Partiellement payé » et le suivi du reste à payer par facture.
                    </p>
                  </div>
                  <Switch
                    checked={partialPaymentsEnabled}
                    disabled={!isAdmin}
                    onCheckedChange={setPartialPaymentsEnabled}
                  />
                </div>
              </div>

              <div className='flex items-center justify-end border-t border-[#E1E3E5] pt-3'>
                {isAdmin ? (
                  <Button
                    size='sm'
                    onClick={() => void handleSaveStockSettings()}
                    disabled={savingStock}
                  >
                    {savingStock && (
                      <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                    )}
                    <Save className='mr-1.5 h-3.5 w-3.5' />
                    Enregistrer les règles de stock
                  </Button>
                ) : (
                  <span className='inline-flex items-center gap-1 text-[#6D7175]'>
                    <ShieldAlert className='h-3.5 w-3.5' />
                    Réservé à l’administrateur
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SECTION 3: LISTES DE RÉFÉRENCE */}
        <TabsContent value='lists'>
          <Card className='border-[#E1E3E5] bg-white py-0 shadow-none'>
            <CardHeader className='border-b border-[#E1E3E5] px-4 py-3'>
              <CardTitle className='text-sm font-semibold text-[#202223]'>
                Listes déroulantes configurables
              </CardTitle>
              <CardDescription className='text-xs'>
                Gérez les valeurs proposées dans les formulaires (Catégories, Unités, Destinations, Emplacements, Motifs de perte, Modes de paiement).
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4 p-4 text-xs'>
              <div className='flex flex-wrap items-center gap-2'>
                {[
                  { key: 'categories_list', label: 'Catégories' },
                  { key: 'units_list', label: 'Unités' },
                  { key: 'destinations_list', label: 'Destinations' },
                  { key: 'locations_list', label: 'Emplacements' },
                  { key: 'waste_reasons_list', label: 'Motifs de perte' },
                  { key: 'payment_methods_list', label: 'Modes de paiement' },
                ].map((tab) => (
                  <Button
                    key={tab.key}
                    size='sm'
                    variant={activeListKey === tab.key ? 'default' : 'outline'}
                    className='h-7 text-xs'
                    onClick={() => setActiveListKey(tab.key)}
                  >
                    {tab.label}
                  </Button>
                ))}
              </div>

              {canEditSettings && (
                <div className='flex items-center gap-2'>
                  <Input
                    placeholder='Nouvel élément à ajouter...'
                    value={newListItem}
                    onChange={(e) => setNewListItem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleAddListItem()
                      }
                    }}
                    className='h-8 max-w-sm text-xs'
                  />
                  <Button
                    size='sm'
                    className='h-8 text-xs'
                    disabled={savingList || !newListItem.trim()}
                    onClick={() => void handleAddListItem()}
                  >
                    <Plus className='mr-1 h-3.5 w-3.5' />
                    Ajouter
                  </Button>
                </div>
              )}

              <div className='grid gap-2 sm:grid-cols-2 md:grid-cols-3'>
                {currentListItems.map((item) => (
                  <div
                    key={item}
                    className='flex items-center justify-between rounded-md border border-[#E1E3E5] bg-[#F6F6F7]/50 px-3 py-2'
                  >
                    <span className='font-medium text-[#202223]'>{item}</span>
                    {canEditSettings && (
                      <button
                        type='button'
                        className='text-[#6D7175] hover:text-[#D72C0D]'
                        disabled={savingList}
                        onClick={() => void handleRemoveListItem(item)}
                      >
                        <Trash2 className='h-3.5 w-3.5' />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SECTION 4: SAUVEGARDE & UTILISATEURS */}
        <TabsContent value='backup'>
          <div className='grid gap-4 md:grid-cols-2'>
            <Card className='border-[#E1E3E5] bg-white py-0 shadow-none'>
              <CardHeader className='border-b border-[#E1E3E5] px-4 py-3'>
                <div className='flex items-center justify-between'>
                  <CardTitle className='text-sm font-semibold text-[#202223]'>
                    Sauvegarde & Restauration
                  </CardTitle>
                  <Badge variant='outline' className='text-xs'>
                    {repository.adapterName === 'pocketbase'
                      ? 'PocketBase (Production)'
                      : 'Mémoire (Aperçu AI Studio)'}
                  </Badge>
                </div>
                <CardDescription className='text-xs'>
                  Téléchargez une archive complète ou utilisez les scripts automatisés du serveur.
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-3 p-4 text-xs'>
                <div className='space-y-1.5 rounded-md border border-[#E1E3E5] bg-[#F6F6F7] p-3'>
                  <div className='flex items-center justify-between'>
                    <span className='text-[#6D7175]'>Dernière sauvegarde manuelle</span>
                    <span className='font-semibold text-[#202223]'>
                      {lastBackupDate
                        ? formatDateTimeFR(lastBackupDate)
                        : 'Aucune sauvegarde récente'}
                    </span>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span className='text-[#6D7175]'>Sauvegarde automatique</span>
                    <span className='font-medium'>
                      Rotation 14 jours (scripts/backup.sh & backup.bat)
                    </span>
                  </div>
                </div>

                <div className='rounded-md border border-[#E1E3E5] p-3 text-[11px] text-[#6D7175]'>
                  <strong className='text-[#202223]'>
                    Instructions de restauration :
                  </strong>{' '}
                  Pour restaurer une sauvegarde PocketBase sur le PC principal du restaurant, arrêtez le service PocketBase, remplacez le dossier{' '}
                  <code className='rounded bg-[#F6F6F7] px-1'>pb_data</code> par l’archive souhaitée, puis relancez{' '}
                  <code className='rounded bg-[#F6F6F7] px-1'>
                    ./pocketbase serve --http=0.0.0.0:8090
                  </code>
                  .
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  <Button
                    size='sm'
                    onClick={() => void handleManualBackup()}
                  >
                    <Download className='mr-1.5 h-3.5 w-3.5' />
                    Télécharger une sauvegarde maintenant
                  </Button>

                  {isAdmin && (
                    <>
                      <input
                        ref={restoreInputRef}
                        type='file'
                        accept='.json,application/json'
                        className='hidden'
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) void handleRestoreBackupFile(f)
                          e.target.value = ''
                        }}
                      />
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={restoringBackup}
                        onClick={() => restoreInputRef.current?.click()}
                      >
                        {restoringBackup ? (
                          <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                        ) : (
                          <RotateCcw className='mr-1.5 h-3.5 w-3.5' />
                        )}
                        Restaurer une sauvegarde (.json)
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className='border-[#E1E3E5] bg-white py-0 shadow-none'>
              <CardHeader className='border-b border-[#E1E3E5] px-4 py-3'>
                <CardTitle className='text-sm font-semibold text-[#202223]'>
                  Gestion des comptes et rôles (RBAC)
                </CardTitle>
                <CardDescription className='text-xs'>
                  5 profils : Administrateur, Responsable, Économat, Cuisine (sans prix), Consultation.
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-3 p-4 text-xs'>
                <p className='text-[#6D7175]'>
                  Gérez les accès du personnel, réinitialisez les mots de passe ou désactivez un compte depuis l’écran dédié Utilisateurs.
                </p>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => void navigate({ to: '/utilisateurs' })}
                >
                  <Users className='mr-1.5 h-3.5 w-3.5' />
                  Ouvrir la gestion des utilisateurs
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
