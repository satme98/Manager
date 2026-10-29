import { createFileRoute } from '@tanstack/react-router'
import { Inventaires } from '@/features/inventaires'

export const Route = createFileRoute('/_authenticated/inventaires/')({
  component: Inventaires,
})
