import { createFileRoute } from '@tanstack/react-router'
import { HistoriqueMouvements } from '@/features/historique-mouvements'

export const Route = createFileRoute('/_authenticated/historique-mouvements/')({
  component: HistoriqueMouvements,
})
