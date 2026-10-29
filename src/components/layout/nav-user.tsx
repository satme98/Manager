import { Link } from '@tanstack/react-router'
import {
  ChevronsUpDown,
  FileSpreadsheet,
  LogOut,
  Settings,
  Shield,
  Users,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { canAccessRoute, ROLE_LABELS_FR } from '@/lib/rbac'
import { getDisplayNameInitials } from '@/lib/utils'
import useDialogState from '@/hooks/use-dialog-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { SignOutDialog } from '@/components/sign-out-dialog'

type NavUserProps = {
  user: {
    name: string
    email: string
    avatar: string
  }
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile } = useSidebar()
  const [open, setOpen] = useDialogState()
  const { auth } = useAuthStore()

  const activeUser = auth.user
  const displayName = activeUser?.name || activeUser?.email || user.name
  const displayEmail = activeUser?.email ?? user.email
  const roleLabel = activeUser ? ROLE_LABELS_FR[activeUser.role] : 'Non connecté'
  const initials = getDisplayNameInitials(displayName)

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size='lg'
                className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
              >
                <Avatar className='h-8 w-8 rounded-lg'>
                  <AvatarImage src={user.avatar} alt={displayName} />
                  <AvatarFallback className='rounded-lg bg-primary text-xs font-medium text-primary-foreground'>
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className='grid flex-1 text-start text-sm leading-tight'>
                  <span className='truncate font-semibold'>{displayName}</span>
                  <span className='truncate text-xs text-muted-foreground'>
                    {roleLabel}
                  </span>
                </div>
                <ChevronsUpDown className='ms-auto size-4' />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
              side={isMobile ? 'bottom' : 'right'}
              align='end'
              sideOffset={4}
            >
              <DropdownMenuLabel className='p-0 font-normal'>
                <div className='flex items-center gap-2 px-2 py-1.5 text-start text-sm'>
                  <Avatar className='h-8 w-8 rounded-lg'>
                    <AvatarImage src={user.avatar} alt={displayName} />
                    <AvatarFallback className='rounded-lg bg-primary text-xs font-medium text-primary-foreground'>
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className='grid flex-1 text-start text-sm leading-tight'>
                    <div className='flex items-center gap-1.5'>
                      <span className='truncate font-semibold'>
                        {displayName}
                      </span>
                      <Badge variant='outline' className='gap-1 text-[10px]'>
                        <Shield className='size-2.5' />
                        {roleLabel}
                      </Badge>
                    </div>
                    <span className='truncate text-xs text-muted-foreground'>
                      {displayEmail}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {canAccessRoute(activeUser?.role, '/utilisateurs') && (
                  <DropdownMenuItem asChild>
                    <Link to='/utilisateurs'>
                      <Users className='size-4' />
                      Utilisateurs
                    </Link>
                  </DropdownMenuItem>
                )}
                {canAccessRoute(activeUser?.role, '/import-export') && (
                  <DropdownMenuItem asChild>
                    <Link to='/import-export'>
                      <FileSpreadsheet className='size-4' />
                      Import / Export
                    </Link>
                  </DropdownMenuItem>
                )}
                {canAccessRoute(activeUser?.role, '/parametres') && (
                  <DropdownMenuItem asChild>
                    <Link to='/parametres'>
                      <Settings className='size-4' />
                      Paramètres
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant='destructive'
                onClick={() => setOpen(true)}
              >
                <LogOut className='size-4' />
                Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <SignOutDialog open={!!open} onOpenChange={setOpen} />
    </>
  )
}
