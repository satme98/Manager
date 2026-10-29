import { createFileRoute } from '@tanstack/react-router'
import { ControleExcelPage } from '@/features/controle-excel'

export const Route = createFileRoute('/_authenticated/controle-excel/')({
  component: ControleExcelPage,
})
