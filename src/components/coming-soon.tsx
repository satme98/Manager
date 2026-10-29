import { PackageOpen } from 'lucide-react'

export function ComingSoon() {
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <PackageOpen size={56} className='text-muted-foreground' />
        <h1 className='text-2xl leading-tight font-bold'>
          Section en préparation
        </h1>
        <p className='text-center text-sm text-muted-foreground'>
          Aucune donnée n&apos;est encore disponible dans cette section.
        </p>
      </div>
    </div>
  )
}
