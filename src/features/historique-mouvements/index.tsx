import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  History,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { repository } from '@/data'
import { formatDateTimeFR } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/empty-state'
import { PageShell } from '@/components/layout/page-shell'

export function HistoriqueMouvements() {
  const {
    data: logs = [],
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: ['audit_log'],
    queryFn: () => repository.listAuditLogs(),
  })

  return (
    <PageShell
      section='ANALYSE'
      title='Historique des mouvements'
      description='Journal d’audit immuable de toutes les créations, modifications, contre-passations et confirmations d’inventaire.'
      primaryAction={{
        label: 'Actualiser le journal',
        onClick: () => void refetch(),
        icon: RefreshCw,
      }}
      secondaryActions={[
        {
          label: 'Entrées de stock',
          to: '/entrees-de-stock',
          icon: ArrowDownToLine,
        },
        {
          label: 'Sorties de stock',
          to: '/sorties-de-stock',
          icon: ArrowUpFromLine,
        },
        {
          label: 'Inventaires',
          to: '/inventaires',
          icon: ClipboardCheck,
        },
      ]}
    >
      {loading ? (
        <Card className='p-8 text-center text-sm text-muted-foreground'>
          <Loader2 className='mx-auto mb-2 h-5 w-5 animate-spin' />
          Chargement du journal d’audit...
        </Card>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={History}
          title='Aucun mouvement ni événement d’audit'
          description='Les mouvements ne sont jamais supprimés : toute création, modification ou écriture d’extourne est tracée de manière immuable dans la collection audit_log.'
          columnsPreview={[
            'Horodatage (JJ/MM/AAAA HH:mm)',
            'Utilisateur',
            'Action',
            'Collection',
            'ID Enregistrement',
            'Détails JSON',
          ]}
          primaryAction={{
            label: 'Voir les entrées de stock',
            to: '/entrees-de-stock',
            icon: ArrowDownToLine,
          }}
          secondaryAction={{
            label: 'Voir les sorties de stock',
            to: '/sorties-de-stock',
            icon: ArrowUpFromLine,
          }}
        />
      ) : (
        <Card className='gap-0 py-0 shadow-none'>
          <CardHeader className='border-b border-border px-4 py-3'>
            <CardTitle className='text-sm font-semibold'>
              Journal d’audit immuable ({logs.length}{' '}
              {logs.length > 1 ? 'événements' : 'événement'})
            </CardTitle>
            <CardDescription className='text-xs'>
              Aucune entrée de ce journal ne peut être modifiée ni supprimée
              (règle PocketBase deleteRule = null, updateRule = null).
            </CardDescription>
          </CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow className='bg-muted/40'>
                  <TableHead className='px-4'>Horodatage</TableHead>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Collection</TableHead>
                  <TableHead>Réf. Enregistrement</TableHead>
                  <TableHead className='px-4'>Détails</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className='px-4 tabular-nums text-xs'>
                      {formatDateTimeFR(entry.timestamp)}
                    </TableCell>
                    <TableCell className='text-xs font-medium'>
                      {entry.user_email || entry.user || 'Système'}
                    </TableCell>
                    <TableCell>
                      <Badge variant='secondary' className='text-[11px]'>
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {entry.collection}
                    </TableCell>
                    <TableCell className='font-mono text-xs text-muted-foreground'>
                      {entry.record_id}
                    </TableCell>
                    <TableCell className='max-w-md truncate px-4 font-mono text-xs text-muted-foreground'>
                      {JSON.stringify(entry.details)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  )
}
