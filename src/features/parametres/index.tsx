import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Database,
  Download,
  FileSpreadsheet,
  HardDriveDownload,
  Save,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import { triggerManualBackupDownload } from '@/lib/backup-export'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageShell } from '@/components/layout/page-shell'

export function Parametres() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()
  const canEditSettings = canPerformCollectionAction(
    auth.user?.role,
    'settings',
    'update'
  )
  const canManageUsers = canPerformCollectionAction(
    auth.user?.role,
    'users',
    'create'
  )

  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => repository.listSettings(),
  })

  const persistedVat = settings.find((s) => s.key === 'vat_convention')?.value
  const [selectedVat, setSelectedVat] = useState<'HT' | 'TTC' | null>(null)
  const [savingVat, setSavingVat] = useState(false)

  const vatConvention: 'HT' | 'TTC' =
    selectedVat ?? (persistedVat === 'HT' ? 'HT' : 'TTC')

  async function handleSaveVatConvention() {
    setSavingVat(true)
    try {
      await repository.upsertSetting('vat_convention', vatConvention)
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      await queryClient.invalidateQueries({ queryKey: ['audit_log'] })
      toast.success(
        `Convention de prix enregistrée : Prix exprimés en ${vatConvention}.`
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Impossible d’enregistrer le paramètre.'
      )
    } finally {
      setSavingVat(false)
    }
  }

  return (
    <PageShell
      section='SYSTÈME'
      title='Paramètres'
      description='Configuration de l’établissement, convention de prix (HT / TTC), devise (MAD / DH), sauvegarde manuelle et connexion PocketBase locale.'
      primaryAction={{
        label: 'Exporter une sauvegarde',
        onClick: () => void triggerManualBackupDownload(),
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
      <div className='grid gap-4 md:grid-cols-2'>
        {/* Backup & Local Server Card */}
        <Card className='gap-0 py-0 shadow-none'>
          <CardHeader className='border-b border-border px-4 py-3'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <HardDriveDownload className='h-4 w-4 text-muted-foreground' />
                <CardTitle className='text-sm font-semibold'>
                  Sauvegarde des données & Serveur local
                </CardTitle>
              </div>
              <Badge variant='outline' className='text-xs'>
                {repository.adapterName === 'pocketbase'
                  ? 'PocketBase (Production)'
                  : 'Mémoire (Aperçu AI Studio)'}
              </Badge>
            </div>
            <CardDescription className='text-xs'>
              Exportez à tout moment une sauvegarde JSON complète ou utilisez le
              script de sauvegarde nocturne automatique (dossier pb_data).
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4 p-4 text-xs'>
            <div className='space-y-1.5 rounded-md border border-border bg-muted/30 p-3'>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>
                  Moteur de données actif
                </span>
                <span className='font-mono font-medium'>
                  VITE_DATA_ADAPTER={repository.adapterName}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>
                  Version PocketBase cible
                </span>
                <span className='font-mono font-medium'>
                  0.25.2 (syntaxe fields / _superusers)
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>
                  Rétention sauvegarde nocturne
                </span>
                <span className='font-medium'>
                  14 dernières copies (scripts/backup.bat & backup.sh)
                </span>
              </div>
            </div>

            <div className='flex flex-wrap items-center justify-between gap-2 pt-1'>
              <p className='text-muted-foreground'>
                Télécharge toutes les collections et le journal d’audit au
                format JSON horodaté.
              </p>
              <Button
                size='sm'
                onClick={() => void triggerManualBackupDownload()}
              >
                <Download className='mr-1.5 h-3.5 w-3.5' />
                Exporter une sauvegarde
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Financial & Regional Convention Card */}
        <Card className='gap-0 py-0 shadow-none'>
          <CardHeader className='border-b border-border px-4 py-3'>
            <div className='flex items-center gap-2'>
              <Database className='h-4 w-4 text-muted-foreground' />
              <CardTitle className='text-sm font-semibold'>
                Conventions financières et régionales
              </CardTitle>
            </div>
            <CardDescription className='text-xs'>
              Paramètres appliqués aux calculs de PMP, valorisation de stock et
              documents d’achat.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4 p-4 text-xs'>
            <div className='grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3'>
              <div>
                <span className='text-muted-foreground'>Établissement</span>
                <p className='font-semibold text-foreground'>MONARQ ÉCONOMAT</p>
              </div>
              <div>
                <span className='text-muted-foreground'>Devise officielle</span>
                <p className='font-semibold tabular-nums text-foreground'>
                  MAD (DH) — 2 décimales
                </p>
              </div>
              <div>
                <span className='text-muted-foreground'>Format de date</span>
                <p className='font-semibold tabular-nums text-foreground'>
                  JJ/MM/AAAA (fr-MA)
                </p>
              </div>
              <div>
                <span className='text-muted-foreground'>
                  Méthode de valorisation
                </span>
                <p className='font-semibold text-foreground'>
                  PMP (Prix Moyen Pondéré)
                </p>
              </div>
            </div>

            <div className='space-y-2'>
              <Label className='text-xs'>
                Convention d’affichage et de saisie des prix (collection
                settings)
              </Label>
              <div className='flex items-center gap-2'>
                <Select
                  value={vatConvention}
                  onValueChange={(v) => setSelectedVat(v as 'HT' | 'TTC')}
                  disabled={!canEditSettings}
                >
                  <SelectTrigger className='h-8 w-[240px] text-xs'>
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
                {canEditSettings ? (
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-8 text-xs'
                    disabled={savingVat}
                    onClick={() => void handleSaveVatConvention()}
                  >
                    <Save className='mr-1.5 h-3.5 w-3.5' />
                    Enregistrer
                  </Button>
                ) : (
                  <span className='inline-flex items-center gap-1 text-muted-foreground'>
                    <ShieldAlert className='h-3.5 w-3.5' />
                    Lecture seule
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
