import { type ElementType } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export type EmptyStateAction = {
  label: string
  to?: string
  onClick?: () => void
  icon?: ElementType
  variant?: 'default' | 'outline' | 'secondary'
}

export type EmptyStateProps = {
  icon: ElementType
  title: string
  description: string
  primaryAction?: EmptyStateAction
  secondaryAction?: EmptyStateAction
  columnsPreview?: string[]
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  columnsPreview,
}: EmptyStateProps) {
  return (
    <Card className='overflow-hidden p-0'>
      {columnsPreview && columnsPreview.length > 0 && (
        <div className='flex items-center gap-4 overflow-x-auto border-b border-border bg-muted/60 px-4 py-2.5 text-xs font-semibold text-muted-foreground'>
          {columnsPreview.map((col) => (
            <span key={col} className='whitespace-nowrap'>
              {col}
            </span>
          ))}
        </div>
      )}
      <CardContent className='flex flex-col items-center justify-center px-6 py-14 text-center'>
        <div className='mb-3 flex size-12 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground'>
          <Icon className='size-6' aria-hidden='true' />
        </div>
        <h2 className='text-base font-semibold text-foreground'>{title}</h2>
        <p className='mt-1 max-w-md text-xs leading-relaxed text-muted-foreground sm:text-sm'>
          {description}
        </p>

        {(primaryAction || secondaryAction) && (
          <div className='mt-5 flex flex-wrap items-center justify-center gap-2'>
            {primaryAction &&
              (primaryAction.to ? (
                <Button
                  size='sm'
                  variant={primaryAction.variant ?? 'default'}
                  asChild
                >
                  <Link to={primaryAction.to}>
                    {primaryAction.icon && (
                      <primaryAction.icon className='size-4' />
                    )}
                    {primaryAction.label}
                  </Link>
                </Button>
              ) : (
                <Button
                  size='sm'
                  variant={primaryAction.variant ?? 'default'}
                  onClick={primaryAction.onClick}
                >
                  {primaryAction.icon && (
                    <primaryAction.icon className='size-4' />
                  )}
                  {primaryAction.label}
                </Button>
              ))}

            {secondaryAction &&
              (secondaryAction.to ? (
                <Button
                  size='sm'
                  variant={secondaryAction.variant ?? 'outline'}
                  asChild
                >
                  <Link to={secondaryAction.to}>
                    {secondaryAction.icon && (
                      <secondaryAction.icon className='size-4' />
                    )}
                    {secondaryAction.label}
                  </Link>
                </Button>
              ) : (
                <Button
                  size='sm'
                  variant={secondaryAction.variant ?? 'outline'}
                  onClick={secondaryAction.onClick}
                >
                  {secondaryAction.icon && (
                    <secondaryAction.icon className='size-4' />
                  )}
                  {secondaryAction.label}
                </Button>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
