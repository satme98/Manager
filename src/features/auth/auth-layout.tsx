import { Logo } from '@/assets/logo'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='container grid h-svh max-w-none items-center justify-center bg-background'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-4 py-8 sm:w-[400px] sm:p-8'>
        <div className='mb-2 flex items-center justify-center gap-2.5'>
          <div className='flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
            <Logo className='size-4' />
          </div>
          <h1 className='text-lg font-semibold tracking-tight text-foreground'>
            MONARQ ÉCONOMAT
          </h1>
        </div>
        {children}
      </div>
    </div>
  )
}
