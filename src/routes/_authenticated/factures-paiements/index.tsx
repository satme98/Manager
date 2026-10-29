import { createFileRoute } from '@tanstack/react-router'
import { FacturesPaiements } from '@/features/factures-paiements'

export const Route = createFileRoute('/_authenticated/factures-paiements/')({
  component: FacturesPaiements,
})
