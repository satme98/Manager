import { Boxes, Package, RefreshCw, Truck } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { PageShell } from '@/components/layout/page-shell'

export function Reapprovisionnement() {
  return (
    <PageShell
      section='GESTION'
      title='Réapprovisionnement'
      description='Suggestions d’achat pour les produits en statut Alerte ou À surveiller, regroupées par fournisseur habituel.'
      primaryAction={{
        label: 'Voir l’état des stocks',
        to: '/etat-des-stocks',
        icon: Boxes,
      }}
      secondaryActions={[
        {
          label: 'Consulter les fournisseurs',
          to: '/fournisseurs',
          icon: Truck,
        },
        {
          label: 'Catalogue Produits',
          to: '/produits',
          icon: Package,
        },
      ]}
    >
      <EmptyState
        icon={RefreshCw}
        title='Aucun article à réapprovisionner'
        description='Les propositions de commande sont générées à partir des articles dont le stock actuel est inférieur ou égal au seuil minimum configuré (sans envoi automatique).'
        columnsPreview={[
          'Référence',
          'Produit',
          'Fournisseur habituel',
          'Stock actuel',
          'Seuil min.',
          'Quantité suggérée',
          'Dernier prix (DH)',
          'Montant estimé (DH)',
        ]}
        primaryAction={{
          label: 'Vérifier l’état des stocks',
          to: '/etat-des-stocks',
          icon: Boxes,
        }}
        secondaryAction={{
          label: 'Voir les fournisseurs',
          to: '/fournisseurs',
          icon: Truck,
        }}
      />
    </PageShell>
  )
}
