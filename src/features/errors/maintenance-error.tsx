import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function MaintenanceError() {
  const navigate = useNavigate()
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2 px-4'>
        <h1 className='text-[5rem] leading-tight font-bold text-foreground'>
          503
        </h1>
        <span className='text-base font-semibold'>Maintenance en cours</span>
        <p className='max-w-md text-center text-sm text-muted-foreground'>
          Le service est temporairement indisponible. Veuillez réessayer dans
          quelques instants.
        </p>
        <div className='mt-4 flex gap-3'>
          <Button variant='outline' onClick={() => navigate({ to: '/' })}>
            Tableau de bord
          </Button>
        </div>
      </div>
    </div>
  )
}
