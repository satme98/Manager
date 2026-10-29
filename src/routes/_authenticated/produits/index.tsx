import { createFileRoute } from '@tanstack/react-router'
import { Produits } from '@/features/produits'

export const Route = createFileRoute('/_authenticated/produits/')({
  component: Produits,
})
