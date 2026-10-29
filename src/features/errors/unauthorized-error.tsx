import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function UnauthorisedError() {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2 px-4'>
        <h1 className='text-[5rem] leading-tight font-bold text-foreground'>
          401
        </h1>
        <span className='text-base font-semibold'>Accès non autorisé</span>
        <p className='max-w-md text-center text-sm text-muted-foreground'>
          Veuillez vous connecter avec un compte autorisé pour accéder à cette
          section.
        </p>
        <div className='mt-4 flex gap-3'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            Retour
          </Button>
          <Button onClick={() => navigate({ to: '/sign-in' })}>
            Se connecter
          </Button>
        </div>
      </div>
    </div>
  )
}
