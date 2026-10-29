import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowDownToLine, ArrowUpFromLine, Plus, Shield } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  canAccessRoute,
  canPerformCollectionAction,
  ROLE_LABELS_FR,
} from '@/lib/rbac'
import { getDisplayNameInitials } from '@/lib/utils'
import useDialogState from '@/hooks/use-dialog-state'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SignOutDialog } from '@/components/sign-out-dialog'

export function ProfileDropdown() {
  const [open, setOpen] = useDialogState()
  const { auth } = useAuthStore()
  const navigate = useNavigate()

  const user = auth.user
  const displayName = user?.name || user?.email?.split('@')[0] || 'Utilisateur'
  const displayEmail = user?.email ?? ''
  const roleLabel = user ? ROLE_LABELS_FR[user.role] : 'Non connecté'
  const initials = getDisplayNameInitials(displayName)

  const canCreatePurchase = canPerformCollectionAction(
    user?.role,
    'purchases',
    'create'
  )
  const canCreateExit = canPerformCollectionAction(
    user?.role,
    'exits',
    'create'
  )

  return (
    <>
      {(canCreatePurchase || canCreateExit) && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              size='sm'
              className='h-8 gap-1.5 bg-[#008060] text-white hover:bg-[#006e52]'
              aria-label='Action rapide : Nouvelle entrée ou sortie'
            >
              <Plus className='size-4' />
              <span className='hidden sm:inline'>Saisie rapide</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-52'>
            <DropdownMenuLabel className='text-xs text-[#6D7175]'>
              Opérations quotidiennes
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canCreatePurchase && (
              <DropdownMenuItem
                onClick={() => {
                  void navigate({ to: '/entrees-de-stock' })
                  setTimeout(() => {
                    window.history.replaceState(
                      null,
                      '',
                      '/entrees-de-stock?mode=new'
                    )
                    window.dispatchEvent(new Event('monarq:navigate'))
                  }, 30)
                }}
              >
                <ArrowDownToLine className='mr-2 size-4 text-[#008060]' />
                <span>Nouvelle entrée</span>
              </DropdownMenuItem>
            )}
            {canCreateExit && (
              <DropdownMenuItem
                onClick={() => {
                  void navigate({ to: '/sorties-de-stock' })
                  setTimeout(() => {
                    window.history.replaceState(
                      null,
                      '',
                      '/sorties-de-stock?mode=new'
                    )
                    window.dispatchEvent(new Event('monarq:navigate'))
                  }, 30)
                }}
              >
                <ArrowUpFromLine className='mr-2 size-4 text-[#B98900]' />
                <span>Nouvelle sortie</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            className='relative h-8 gap-2 rounded-md px-2'
            aria-label='Menu profil utilisateur'
          >
            <Avatar className='h-6 w-6'>
              <AvatarFallback className='bg-primary text-[11px] font-medium text-primary-foreground'>
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className='hidden text-xs font-medium text-foreground sm:inline-block'>
              {displayName}
            </span>
            <Badge variant='secondary' className='hidden text-[10px] md:inline-flex'>
              {roleLabel}
            </Badge>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-60' align='end' forceMount>
          <DropdownMenuLabel className='font-normal'>
            <div className='flex flex-col gap-1.5'>
              <div className='flex items-center justify-between gap-2'>
                <p className='truncate text-sm leading-none font-semibold'>
                  {displayName}
                </p>
                <Badge variant='outline' className='gap-1 text-[10px]'>
                  <Shield className='size-2.5' />
                  {roleLabel}
                </Badge>
              </div>
              <p className='truncate text-xs leading-none text-muted-foreground'>
                {displayEmail}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link to='/'>
                Tableau de bord
                <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </Link>
            </DropdownMenuItem>
            {canAccessRoute(user?.role, '/utilisateurs') && (
              <DropdownMenuItem asChild>
                <Link to='/utilisateurs'>
                  Utilisateurs & Rôles
                  <DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
                </Link>
              </DropdownMenuItem>
            )}
            {canAccessRoute(user?.role, '/parametres') && (
              <DropdownMenuItem asChild>
                <Link to='/parametres'>
                  Paramètres
                  <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onClick={() => setOpen(true)}>
            Se déconnecter
            <DropdownMenuShortcut className='text-current'>
              ⇧⌘Q
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SignOutDialog open={!!open} onOpenChange={setOpen} />
    </>
  )
}
