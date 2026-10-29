import { createFileRoute } from '@tanstack/react-router'
import { EtatDesStocks } from '@/features/etat-des-stocks'

export const Route = createFileRoute('/_authenticated/etat-des-stocks/')({
  component: EtatDesStocks,
})
