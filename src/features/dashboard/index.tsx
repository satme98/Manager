import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  LayoutDashboard,
  Package,
} from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { PageShell } from '@/components/layout/page-shell'

export function Dashboard() {
  return (
    <PageShell
      section='PRINCIPAL'
      title='Tableau de bord'
      description="Vue d'ensemble de la valorisation du stock, des achats, des alertes de seuil et des écarts d'inventaire (en MAD)."
      primaryAction={{
        label: 'Importer un fichier Excel',
        to: '/import-export',
        icon: FileSpreadsheet,
      }}
      secondaryActions={[
        {
          label: 'Consulter les produits',
          to: '/produits',
          icon: Package,
        },
        {
          label: 'État des stocks',
          to: '/etat-des-stocks',
          icon: Boxes,
        },
        {
          label: 'Nouvelle entrée de stock',
          to: '/entrees-de-stock',
          icon: ArrowDownToLine,
        },
        {
          label: 'Nouvelle sortie de stock',
          to: '/sorties-de-stock',
          icon: ArrowUpFromLine,
        },
        {
          label: 'Sessions d’inventaire',
          to: '/inventaires',
          icon: ClipboardCheck,
        },
      ]}
    >
      <EmptyState
        icon={LayoutDashboard}
        title='Aucune donnée de stock ou d’achat disponible'
        description="La base de données ne contient encore aucun produit ni mouvement. Importez votre classeur Excel d'économat ou ajoutez vos premiers articles pour calculer les indicateurs en temps réel."
        primaryAction={{
          label: 'Ouvrir Import / Export',
          to: '/import-export',
          icon: FileSpreadsheet,
        }}
        secondaryAction={{
          label: 'Gérer le catalogue Produits',
          to: '/produits',
          icon: Package,
        }}
      />
    </PageShell>
  )
}
