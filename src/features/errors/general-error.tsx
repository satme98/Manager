import { useNavigate, useRouter } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
}

export function GeneralError({
  className,
  minimal = false,
}: GeneralErrorProps) {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2 px-4'>
        {!minimal && (
          <h1 className='text-[5rem] leading-tight font-bold text-foreground'>
            500
          </h1>
        )}
        <span className='text-base font-semibold'>
          Une erreur inattendue est survenue
        </span>
        <p className='max-w-md text-center text-sm text-muted-foreground'>
          Veuillez réessayer ou revenir au tableau de bord.
        </p>
        {!minimal && (
          <div className='mt-4 flex gap-3'>
            <Button variant='outline' onClick={() => history.go(-1)}>
              Retour
            </Button>
            <Button onClick={() => navigate({ to: '/' })}>
              Tableau de bord
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
