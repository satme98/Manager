import { createFileRoute } from '@tanstack/react-router'
import { Utilisateurs } from '@/features/utilisateurs'

export const Route = createFileRoute('/_authenticated/utilisateurs/')({
  component: Utilisateurs,
})
