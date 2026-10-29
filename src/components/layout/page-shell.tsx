import { type ElementType, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

export type PageAction = {
  label: string
  to?: string
  onClick?: () => void
  icon?: ElementType
}

export type PageShellProps = {
  section?: string
  title: string
  description: string
  primaryAction?: PageAction
  secondaryActions?: PageAction[]
  children: ReactNode
}

export function PageShell({
  section,
  title,
  description,
  primaryAction,
  secondaryActions,
  children,
}: PageShellProps) {
  return (
    <>
      <Header fixed>
        <div className='hidden items-center gap-2 text-xs text-muted-foreground md:flex'>
          {section && (
            <>
              <span className='font-medium uppercase tracking-wider'>
                {section}
              </span>
              <span aria-hidden='true'>/</span>
            </>
          )}
          <span className='font-medium text-foreground'>{title}</span>
        </div>
        <div className='ms-auto flex items-center gap-2'>
          <Search />
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main id='content' className='space-y-4'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <h1 className='text-xl font-semibold tracking-tight text-foreground'>
              {title}
            </h1>
            <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
              {description}
            </p>
          </div>

          {(primaryAction ||
            (secondaryActions && secondaryActions.length > 0)) && (
            <div className='flex items-center gap-2'>
              {secondaryActions && secondaryActions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='outline' size='sm' className='h-8 gap-1.5'>
                      <MoreHorizontal className='size-4' />
                      <span>Actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-48'>
                    {secondaryActions.map((action) =>
                      action.to ? (
                        <DropdownMenuItem key={action.label} asChild>
                          <Link to={action.to}>
                            {action.icon && <action.icon className='size-4' />}
                            <span>{action.label}</span>
                          </Link>
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          key={action.label}
                          onClick={action.onClick}
                        >
                          {action.icon && <action.icon className='size-4' />}
                          <span>{action.label}</span>
                        </DropdownMenuItem>
                      )
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {primaryAction &&
                (primaryAction.to ? (
                  <Button size='sm' className='h-8 gap-1.5' asChild>
                    <Link to={primaryAction.to}>
                      {primaryAction.icon && (
                        <primaryAction.icon className='size-4' />
                      )}
                      <span>{primaryAction.label}</span>
                    </Link>
                  </Button>
                ) : (
                  <Button
                    size='sm'
                    className='h-8 gap-1.5'
                    onClick={primaryAction.onClick}
                  >
                    {primaryAction.icon && (
                      <primaryAction.icon className='size-4' />
                    )}
                    <span>{primaryAction.label}</span>
                  </Button>
                ))}
            </div>
          )}
        </div>

        {children}
      </Main>
    </>
  )
}
