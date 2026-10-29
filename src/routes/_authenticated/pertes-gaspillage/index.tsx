import { createFileRoute } from '@tanstack/react-router'
import { PertesGaspillage } from '@/features/pertes-gaspillage'

export const Route = createFileRoute('/_authenticated/pertes-gaspillage/')({
  component: PertesGaspillage,
})
