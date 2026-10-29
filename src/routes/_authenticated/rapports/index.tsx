import { createFileRoute } from '@tanstack/react-router'
import { Rapports } from '@/features/rapports'

export const Route = createFileRoute('/_authenticated/rapports/')({
  component: Rapports,
})
