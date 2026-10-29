import { createFileRoute } from '@tanstack/react-router'
import { EntreesDeStock } from '@/features/entrees-de-stock'

export const Route = createFileRoute('/_authenticated/entrees-de-stock/')({
  component: EntreesDeStock,
})
