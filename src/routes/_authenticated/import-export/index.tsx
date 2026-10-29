import { createFileRoute } from '@tanstack/react-router'
import { ImportExport } from '@/features/import-export'

export const Route = createFileRoute('/_authenticated/import-export/')({
  component: ImportExport,
})
