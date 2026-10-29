import { createFileRoute } from '@tanstack/react-router'
import { Reapprovisionnement } from '@/features/reapprovisionnement'

export const Route = createFileRoute('/_authenticated/reapprovisionnement/')({
  component: Reapprovisionnement,
})
