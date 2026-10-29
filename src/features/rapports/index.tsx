import { BarChart3, Boxes, FileSpreadsheet, History } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { PageShell } from '@/components/layout/page-shell'

export function Rapports() {
  return (
    <PageShell
      section='ANALYSE'
      title='Rapports'
      description='9 rapports de synthèse et d’audit (valorisation, achats par fournisseur, consommations, pertes, écarts d’inventaire, factures impayées) exportables en Excel, CSV et PDF.'
      primaryAction={{
        label: 'Importer les données',
        to: '/import-export',
        icon: FileSpreadsheet,
      }}
      secondaryActions={[
        {
          label: 'État des stocks',
          to: '/etat-des-stocks',
          icon: Boxes,
        },
        {
          label: 'Historique des mouvements',
          to: '/historique-mouvements',
          icon: History,
        },
      ]}
    >
      <EmptyState
        icon={BarChart3}
        title='Aucune donnée à consolider'
        description='Les 9 rapports analytiques seront générés dès que des produits, achats, sorties ou inventaires seront présents dans la base.'
        columnsPreview={[
          'Valorisation du stock',
          'Achats par période',
          'Achats par fournisseur',
          'Factures impayées',
          'Consommations cuisine',
          'Pertes & gaspillage',
          'Écarts d’inventaire',
          'Produits en alerte',
          'Rotation des stocks',
        ]}
        primaryAction={{
          label: 'Importer un fichier Excel',
          to: '/import-export',
          icon: FileSpreadsheet,
        }}
        secondaryAction={{
          label: 'Consulter l’état des stocks',
          to: '/etat-des-stocks',
          icon: Boxes,
        }}
      />
    </PageShell>
  )
}
