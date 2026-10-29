import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  History,
  Loader2,
  Plus,
  Settings,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import type { UserRecord, UserRole } from '@/data/types'
import { formatDateFR } from '@/lib/format'
import {
  ALL_ROLES,
  ROLE_DESCRIPTIONS_FR,
  ROLE_LABELS_FR,
  canApproveNegativeStock,
  canPerformCollectionAction,
  canSeeFinancialData,
} from '@/lib/rbac'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageShell } from '@/components/layout/page-shell'
import { PasswordInput } from '@/components/password-input'

export function Utilisateurs() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()

  const { data: users = [], isLoading: loading } = useQuery({
    queryKey: ['users'],
    queryFn: () => repository.listUsers(),
  })

  // Create user modal state
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('economat')

  // Disable/enable confirmation modal state
  const [toggleTarget, setToggleTarget] = useState<UserRecord | null>(null)

  async function refreshUsers() {
    await queryClient.invalidateQueries({ queryKey: ['users'] })
    await queryClient.invalidateQueries({ queryKey: ['audit_log'] })
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim() || !newEmail.trim() || newPassword.length < 8) {
      toast.error(
        'Veuillez renseigner un nom, un e-mail valide et un mot de passe d’au moins 8 caractères.'
      )
      return
    }
    setCreating(true)
    try {
      const created = await repository.createUser({
        name: newName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
      })
      toast.success(`Utilisateur ${created.name} créé avec succès.`)
      setCreateOpen(false)
      setNewName('')
      setNewEmail('')
      setNewPassword('')
      setNewRole('economat')
      await refreshUsers()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la création de l’utilisateur.'
      )
    } finally {
      setCreating(false)
    }
  }

  async function handleRoleChange(user: UserRecord, nextRole: UserRole) {
    if (user.role === nextRole) return
    try {
      const updated = await repository.updateUserRole(user.id, nextRole)
      if (auth.user?.id === updated.id) {
        auth.setUser(updated)
      }
      toast.success(
        `Rôle de ${updated.name} mis à jour : ${ROLE_LABELS_FR[nextRole]}`
      )
      await refreshUsers()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Impossible de modifier le rôle de cet utilisateur.'
      )
    }
  }

  async function handleConfirmToggleActive() {
    if (!toggleTarget) return
    try {
      const nextActive = !toggleTarget.active
      const updated = await repository.setUserActive(
        toggleTarget.id,
        nextActive
      )
      toast.success(
        nextActive
          ? `Compte ${updated.name} réactivé.`
          : `Compte ${updated.name} désactivé.`
      )
      setToggleTarget(null)
      await refreshUsers()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Impossible de modifier le statut du compte.'
      )
    }
  }

  return (
    <PageShell
      section='SYSTÈME'
      title='Utilisateurs'
      description='Gestion des comptes et des rôles d’accès : Admin, Manager, Économat, Cuisine et Consultation.'
      primaryAction={{
        label: 'Nouvel utilisateur',
        onClick: () => setCreateOpen(true),
        icon: Plus,
      }}
      secondaryActions={[
        {
          label: 'Journal d’audit',
          to: '/historique-mouvements',
          icon: History,
        },
        {
          label: 'Paramètres système',
          to: '/parametres',
          icon: Settings,
        },
      ]}
    >
      <div className='space-y-4'>
        {loading ? (
          <Card className='p-8 text-center text-sm text-muted-foreground'>
            <Loader2 className='mx-auto mb-2 h-5 w-5 animate-spin' />
            Chargement des comptes utilisateurs...
          </Card>
        ) : users.length === 0 ? (
          <EmptyState
            icon={Users}
            title='Aucun utilisateur enregistré'
            description='Créez le premier compte utilisateur pour votre équipe (Manager, Économat, Cuisine ou Consultation).'
            columnsPreview={[
              'Nom complet',
              'Adresse e-mail',
              'Rôle',
              'Permissions prix / stock',
              'Statut',
              'Créé le',
            ]}
            primaryAction={{
              label: 'Nouvel utilisateur',
              onClick: () => setCreateOpen(true),
              icon: Plus,
            }}
          />
        ) : (
          <Card className='gap-0 py-0 shadow-none'>
            <CardHeader className='border-b border-border px-4 py-3'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div>
                  <CardTitle className='text-sm font-semibold'>
                    Comptes utilisateurs ({users.length})
                  </CardTitle>
                  <CardDescription className='text-xs'>
                    Seul le rôle Administrateur peut créer des comptes, modifier
                    les rôles ou désactiver un accès.
                  </CardDescription>
                </div>
                <Badge variant='outline' className='text-xs'>
                  Adaptateur actif :{' '}
                  {repository.adapterName === 'pocketbase'
                    ? 'PocketBase SQLite'
                    : 'Mémoire (Aperçu AI Studio)'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-muted/40'>
                    <TableHead className='px-4'>Nom complet</TableHead>
                    <TableHead>Adresse e-mail</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead>Permissions clés</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Créé le</TableHead>
                    <TableHead className='px-4 text-right'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const isSelf = auth.user?.id === u.id
                    const seesPrices = canSeeFinancialData(u.role)
                    const canCreateExits = canPerformCollectionAction(
                      u.role,
                      'exits',
                      'create'
                    )
                    const canApproveReversal = canApproveNegativeStock(u.role)

                    return (
                      <TableRow key={u.id}>
                        <TableCell className='px-4 font-medium'>
                          <div className='flex items-center gap-2'>
                            <span>{u.name}</span>
                            {isSelf && (
                              <Badge variant='secondary' className='text-[10px]'>
                                Vous
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className='font-mono text-xs text-muted-foreground'>
                          {u.email}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={u.role}
                            onValueChange={(val) =>
                              void handleRoleChange(u, val as UserRole)
                            }
                          >
                            <SelectTrigger className='h-8 w-[155px] text-xs'>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ALL_ROLES.map((roleOpt) => (
                                <SelectItem
                                  key={roleOpt}
                                  value={roleOpt}
                                  className='text-xs'
                                >
                                  {ROLE_LABELS_FR[roleOpt]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className='text-xs text-muted-foreground'>
                          <div className='flex flex-wrap gap-1'>
                            <Badge
                              variant={seesPrices ? 'secondary' : 'outline'}
                              className='text-[11px]'
                            >
                              {seesPrices ? 'Prix visibles' : 'Prix masqués'}
                            </Badge>
                            {canCreateExits && (
                              <Badge variant='secondary' className='text-[11px]'>
                                Sorties stock
                              </Badge>
                            )}
                            {canApproveReversal && (
                              <Badge variant='secondary' className='text-[11px]'>
                                Extournes & stock négatif
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {u.active ? (
                            <Badge className='border-0 bg-[#008060]/15 text-[#008060] hover:bg-[#008060]/20'>
                              <CheckCircle2 className='mr-1 h-3 w-3' />
                              Actif
                            </Badge>
                          ) : (
                            <Badge className='border-0 bg-[#D72C0D]/15 text-[#D72C0D] hover:bg-[#D72C0D]/20'>
                              Désactivé
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className='tabular-nums text-xs text-muted-foreground'>
                          {formatDateFR(u.created_at)}
                        </TableCell>
                        <TableCell className='px-4 text-right'>
                          <Button
                            variant='outline'
                            size='sm'
                            className='h-7 text-xs'
                            disabled={isSelf}
                            onClick={() => setToggleTarget(u)}
                          >
                            {u.active ? (
                              <>
                                <UserX className='mr-1 h-3.5 w-3.5 text-[#D72C0D]' />
                                Désactiver
                              </>
                            ) : (
                              <>
                                <UserCheck className='mr-1 h-3.5 w-3.5 text-[#008060]' />
                                Activer
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Role permissions reference matrix */}
        <Card className='gap-0 py-0 shadow-none'>
          <CardHeader className='border-b border-border px-4 py-3'>
            <div className='flex items-center gap-2'>
              <ShieldCheck className='h-4 w-4 text-muted-foreground' />
              <CardTitle className='text-sm font-semibold'>
                Matrice des rôles et règles d’accès (RBAC)
              </CardTitle>
            </div>
            <CardDescription className='text-xs'>
              Aucun profil ne peut supprimer un mouvement (achat, sortie, ligne
              d’inventaire) ni le journal d’audit. Toute correction passe par
              une écriture d’extourne.
            </CardDescription>
          </CardHeader>
          <CardContent className='grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5'>
            {ALL_ROLES.map((roleKey) => (
              <div
                key={roleKey}
                className='rounded-md border border-border bg-muted/20 p-3'
              >
                <div className='mb-1 flex items-center justify-between'>
                  <span className='text-xs font-semibold'>
                    {ROLE_LABELS_FR[roleKey]}
                  </span>
                  <span className='font-mono text-[10px] text-muted-foreground'>
                    {roleKey}
                  </span>
                </div>
                <p className='text-xs leading-relaxed text-muted-foreground'>
                  {ROLE_DESCRIPTIONS_FR[roleKey]}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Create User Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Créer un compte utilisateur</DialogTitle>
            <DialogDescription>
              Ajoutez un collaborateur et attribuez-lui son rôle dans MONARQ
              ÉCONOMAT.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className='space-y-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='user-name'>Nom complet</Label>
              <Input
                id='user-name'
                placeholder='ex. Karim Benali'
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='user-email'>Adresse e-mail</Label>
              <Input
                id='user-email'
                type='email'
                placeholder='karim@monarq.ma'
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='user-password'>
                Mot de passe initial (min. 8 caractères)
              </Label>
              <PasswordInput
                id='user-password'
                placeholder='********'
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Rôle attribué</Label>
              <Select
                value={newRole}
                onValueChange={(val) => setNewRole(val as UserRole)}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS_FR[r]} — {ROLE_DESCRIPTIONS_FR[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className='pt-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setCreateOpen(false)}
              >
                Annuler
              </Button>
              <Button type='submit' disabled={creating}>
                {creating && <Loader2 className='mr-1 h-4 w-4 animate-spin' />}
                Créer le compte
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirm Disable / Enable User */}
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onOpenChange={(open) => {
          if (!open) setToggleTarget(null)
        }}
        title={
          toggleTarget?.active
            ? 'Désactiver ce compte utilisateur ?'
            : 'Réactiver ce compte utilisateur ?'
        }
        desc={
          toggleTarget?.active
            ? `L’utilisateur ${toggleTarget.name} (${toggleTarget.email}) ne pourra plus se connecter à MONARQ ÉCONOMAT. Ses mouvements historiques restent conservés dans le journal d’audit.`
            : `L’utilisateur ${toggleTarget?.name ?? ''} pourra de nouveau se connecter avec le rôle ${toggleTarget ? ROLE_LABELS_FR[toggleTarget.role] : ''}.`
        }
        cancelBtnText='Annuler'
        confirmText={
          toggleTarget?.active ? 'Désactiver le compte' : 'Activer le compte'
        }
        destructive={Boolean(toggleTarget?.active)}
        handleConfirm={() => void handleConfirmToggleActive()}
      />
    </PageShell>
  )
}
