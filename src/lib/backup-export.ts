import { toast } from 'sonner'
import { repository } from '@/data'

export async function triggerManualBackupDownload(): Promise<void> {
  try {
    const payload = await repository.exportBackup()
    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const dateStamp = new Date().toISOString().slice(0, 10)
    const a = document.createElement('a')
    a.href = url
    a.download = `monarq-economat-sauvegarde-${dateStamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast.success('Sauvegarde exportée avec succès', {
      description: `Fichier monarq-economat-sauvegarde-${dateStamp}.json téléchargé.`,
    })
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Impossible de générer la sauvegarde.'
    toast.error('Erreur lors de la sauvegarde', { description: message })
  }
}
