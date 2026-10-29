import { createFileRoute } from '@tanstack/react-router'
import { SortiesDeStock } from '@/features/sorties-de-stock'

export const Route = createFileRoute('/_authenticated/sorties-de-stock/')({
  component: SortiesDeStock,
})
