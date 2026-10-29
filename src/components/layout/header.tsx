import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean
  ref?: React.Ref<HTMLElement>
}

export function Header({ className, fixed, children, ...props }: HeaderProps) {
  return (
    <header
      className={cn(
        'z-40 h-14 border-b border-border bg-card',
        fixed && 'header-fixed peer/header sticky top-0 w-[inherit]',
        className
      )}
      {...props}
    >
      <div className='relative flex h-full items-center gap-3 px-4 sm:gap-4'>
        <SidebarTrigger
          variant='outline'
          className='size-8 max-md:scale-110'
          aria-label='Basculer le menu latéral'
        />
        <Separator orientation='vertical' className='h-5' />
        {children}
      </div>
    </header>
  )
}
