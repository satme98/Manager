import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  Package,
  Receipt,
  RefreshCw,
  Settings,
  Trash2,
  Truck,
  Users,
} from 'lucide-react'
import { Logo } from '@/assets/logo'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Économat Monarq',
    email: 'Session non connectée',
    avatar: '',
  },
  teams: [
    {
      name: 'MONARQ ÉCONOMAT',
      logo: Logo,
      plan: 'Gestion de stock & achats',
    },
  ],
  navGroups: [
    {
      title: 'PRINCIPAL',
      items: [
        {
          title: 'Tableau de bord',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'Produits',
          url: '/produits',
          icon: Package,
        },
        {
          title: 'État des stocks',
          url: '/etat-des-stocks',
          icon: Boxes,
        },
        {
          title: 'Entrées de stock',
          url: '/entrees-de-stock',
          icon: ArrowDownToLine,
        },
        {
          title: 'Sorties de stock',
          url: '/sorties-de-stock',
          icon: ArrowUpFromLine,
        },
        {
          title: 'Inventaires',
          url: '/inventaires',
          icon: ClipboardCheck,
        },
      ],
    },
    {
      title: 'GESTION',
      items: [
        {
          title: 'Réapprovisionnement',
          url: '/reapprovisionnement',
          icon: RefreshCw,
        },
        {
          title: 'Fournisseurs',
          url: '/fournisseurs',
          icon: Truck,
        },
        {
          title: 'Factures & Paiements',
          url: '/factures-paiements',
          icon: Receipt,
        },
        {
          title: 'Pertes & Gaspillage',
          url: '/pertes-gaspillage',
          icon: Trash2,
        },
      ],
    },
    {
      title: 'ANALYSE',
      items: [
        {
          title: 'Rapports',
          url: '/rapports',
          icon: BarChart3,
        },
        {
          title: 'Historique des mouvements',
          url: '/historique-mouvements',
          icon: History,
        },
      ],
    },
    {
      title: 'SYSTÈME',
      items: [
        {
          title: 'Import / Export',
          url: '/import-export',
          icon: FileSpreadsheet,
        },
        {
          title: 'Utilisateurs',
          url: '/utilisateurs',
          icon: Users,
        },
        {
          title: 'Paramètres',
          url: '/parametres',
          icon: Settings,
        },
      ],
    },
  ],
}
