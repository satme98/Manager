import { createFileRoute } from '@tanstack/react-router'
import { ACorrigerPage } from '@/features/a-corriger'

export const Route = createFileRoute('/_authenticated/a-corriger/')({
  component: ACorrigerPage,
})
