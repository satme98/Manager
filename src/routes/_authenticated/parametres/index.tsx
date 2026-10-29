import { createFileRoute } from '@tanstack/react-router'
import { Parametres } from '@/features/parametres'

export const Route = createFileRoute('/_authenticated/parametres/')({
  component: Parametres,
})
