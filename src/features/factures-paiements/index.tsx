import { ArrowDownToLine, FileSpreadsheet, Receipt, Truck } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { PageShell } from '@/components/layout/page-shell'

export function FacturesPaiements() {
  return (
    <PageShell
      section='GESTION'
      title='Factures & Paiements'
      description='Suivi des factures fournisseurs (Payé / Impayé), échéances, règlements et solde fournisseur en dirhams (DH).'
      primaryAction={{
        label: 'Voir les entrées de stock',
        to: '/entrees-de-stock',
        icon: ArrowDownToLine,
      }}
      secondaryActions={[
        {
          label: 'Fournisseurs',
          to: '/fournisseurs',
          icon: Truck,
        },
        {
          label: 'Importer depuis Excel',
          to: '/import-export',
          icon: FileSpreadsheet,
        },
      ]}
    >
      <EmptyState
        icon={Receipt}
        title='Aucune facture fournisseur enregistrée'
        description='Les factures et bons de livraison issus des entrées de stock apparaîtront ici avec leur statut (OUI → Payé, NON → Impayé).'
        columnsPreview={[
          'Date (JJ/MM/AAAA)',
          'N° Facture / BL',
          'Fournisseur',
          'Montant total (DH)',
          'Statut paiement',
          'Date de règlement',
          'Saisi par',
        ]}
        primaryAction={{
          label: 'Consulter les entrées de stock',
          to: '/entrees-de-stock',
          icon: ArrowDownToLine,
        }}
        secondaryAction={{
          label: 'Importer un fichier Excel',
          to: '/import-export',
          icon: FileSpreadsheet,
        }}
      />
    </PageShell>
  )
}
