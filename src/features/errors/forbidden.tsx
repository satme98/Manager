import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function ForbiddenError() {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2 px-4'>
        <h1 className='text-[5rem] leading-tight font-bold text-foreground'>
          403
        </h1>
        <span className='text-base font-semibold'>Accès refusé</span>
        <p className='max-w-md text-center text-sm text-muted-foreground'>
          Vous ne disposez pas des droits nécessaires pour consulter cette
          ressource.
        </p>
        <div className='mt-4 flex gap-3'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            Retour
          </Button>
          <Button onClick={() => navigate({ to: '/' })}>
            Tableau de bord
          </Button>
        </div>
      </div>
    </div>
  )
}
