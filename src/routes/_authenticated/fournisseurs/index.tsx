import { createFileRoute } from '@tanstack/react-router'
import { Fournisseurs } from '@/features/fournisseurs'

export const Route = createFileRoute('/_authenticated/fournisseurs/')({
  component: Fournisseurs,
})
