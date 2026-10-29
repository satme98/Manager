import { ArrowUpFromLine, BarChart3, FileSpreadsheet, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { PageShell } from '@/components/layout/page-shell'

export function PertesGaspillage() {
  return (
    <PageShell
      section='GESTION'
      title='Pertes & Gaspillage'
      description='Suivi détaillé des quantités perdues ou jetées lors des sorties de stock et valorisation financière en MAD.'
      primaryAction={{
        label: 'Saisir une sortie / perte',
        to: '/sorties-de-stock',
        icon: ArrowUpFromLine,
      }}
      secondaryActions={[
        {
          label: 'Rapports d’analyse',
          to: '/rapports',
          icon: BarChart3,
        },
        {
          label: 'Importer depuis Excel',
          to: '/import-export',
          icon: FileSpreadsheet,
        },
      ]}
    >
      <EmptyState
        icon={Trash2}
        title='Aucune perte enregistrée'
        description='Les quantités perdues (qty_wasted) déclarées dans les sorties de stock ainsi que leur coût valorisé au prix moyen pondéré s’afficheront ici.'
        columnsPreview={[
          'Date (JJ/MM/AAAA)',
          'Référence',
          'Produit',
          'Catégorie',
          'Quantité perdue',
          'Coût unitaire (DH)',
          'Valeur perte (DH)',
          'Motif / Notes',
        ]}
        primaryAction={{
          label: 'Aller aux Sorties de stock',
          to: '/sorties-de-stock',
          icon: ArrowUpFromLine,
        }}
        secondaryAction={{
          label: 'Voir les rapports',
          to: '/rapports',
          icon: BarChart3,
        }}
      />
    </PageShell>
  )
}
