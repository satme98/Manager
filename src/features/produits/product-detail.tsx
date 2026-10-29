import { useMemo, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Calendar,
  Edit3,
  MapPin,
  Package,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  AuditLogRecord,
  ExitLineRecord,
  ExitRecord,
  InventoryLineRecord,
  InventorySessionRecord,
  ProductRecord,
  PurchaseLineRecord,
  PurchaseRecord,
  StockStatusLabel,
  SupplierRecord,
  VatConvention,
} from '@/data/types'
import { formatDateFR, formatDateTimeFR, formatMAD, formatQty } from '@/lib/format'
import {
  computeProductDetailLedger,
  getPaymentStatusLabel,
} from '@/lib/stock-engine'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function StockStatusBadge({ status }: { status: StockStatusLabel }) {
  if (status === 'Alerte') {
    return (
      <Badge className='border-transparent bg-[#FBEAE5] font-medium text-[#D72C0D] hover:bg-[#FBEAE5]'>
        Alerte
      </Badge>
    )
  }
  if (status === 'À surveiller') {
    return (
      <Badge className='border-transparent bg-[#FFF5EA] font-medium text-[#B98900] hover:bg-[#FFF5EA]'>
        À surveiller
      </Badge>
    )
  }
  if (status === 'OK') {
    return (
      <Badge className='border-transparent bg-[#E3F1DF] font-medium text-[#008060] hover:bg-[#E3F1DF]'>
        OK
      </Badge>
    )
  }
  return (
    <Badge
      variant='secondary'
      className='border-transparent bg-[#F1F2F3] font-medium text-[#6D7175]'
    >
      À définir
    </Badge>
  )
}

interface ProductDetailViewProps {
  product: ProductRecord
  purchases: PurchaseRecord[]
  purchaseLines: PurchaseLineRecord[]
  exits: ExitRecord[]
  exitLines: ExitLineRecord[]
  inventorySessions: InventorySessionRecord[]
  inventoryLines: InventoryLineRecord[]
  suppliers: SupplierRecord[]
  auditLogs: AuditLogRecord[]
  vatConvention: VatConvention
  canEdit: boolean
  canSeePrices: boolean
  onBack: () => void
  onEdit: (product: ProductRecord) => void
  onToggleArchive: (product: ProductRecord) => void
}

export function ProductDetailView({
  product,
  purchases,
  purchaseLines,
  exits,
  exitLines,
  inventorySessions,
  inventoryLines,
  suppliers,
  auditLogs,
  vatConvention,
  canEdit,
  canSeePrices,
  onBack,
  onEdit,
  onToggleArchive,
}: ProductDetailViewProps) {
  const [activeTab, setActiveTab] = useState('mouvements')

  const ledger = useMemo(
    () =>
      computeProductDetailLedger({
        product,
        purchases,
        purchaseLines,
        exits,
        exitLines,
        inventorySessions,
        inventoryLines,
        suppliers,
      }),
    [
      product,
      purchases,
      purchaseLines,
      exits,
      exitLines,
      inventorySessions,
      inventoryLines,
      suppliers,
    ]
  )

  const productAuditLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      if (log.record_id === product.id) return true
      const details = log.details ?? {}
      if (details.ref === product.ref) return true
      if (
        Array.isArray(details.product_ids) &&
        details.product_ids.includes(product.id)
      ) {
        return true
      }
      return false
    })
  }, [auditLogs, product.id, product.ref])

  const { stockResult, lastPurchase, lastInventory } = ledger

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex flex-col gap-4 rounded-lg border border-[#E1E3E5] bg-white p-5 sm:flex-row sm:items-center sm:justify-between'>
        <div className='space-y-1.5'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={onBack}
              className='-ml-2 h-8 px-2 text-xs text-[#6D7175] hover:text-[#202223]'
            >
              <ArrowLeft className='mr-1 h-4 w-4' />
              Retour aux produits
            </Button>
            <Badge
              variant='outline'
              className='border-[#E1E3E5] font-mono text-xs text-[#202223]'
            >
              {product.ref}
            </Badge>
            <Badge
              variant='secondary'
              className='bg-[#F1F2F3] text-xs font-normal text-[#202223]'
            >
              {product.category || 'Sans catégorie'}
            </Badge>
            <StockStatusBadge status={stockResult.status} />
            {product.archived && (
              <Badge className='bg-neutral-800 text-xs text-white'>
                Archivé
              </Badge>
            )}
          </div>
          <h1 className='text-xl font-semibold text-[#202223]'>
            {product.name}
          </h1>
          <div className='flex flex-wrap items-center gap-4 text-xs text-[#6D7175]'>
            <span className='inline-flex items-center gap-1'>
              <Package className='h-3.5 w-3.5' />
              Unité : <strong className='text-[#202223]'>{product.unit}</strong>
            </span>
            {product.location && (
              <span className='inline-flex items-center gap-1'>
                <MapPin className='h-3.5 w-3.5' />
                Emplacement :{' '}
                <strong className='text-[#202223]'>{product.location}</strong>
              </span>
            )}
            <span className='inline-flex items-center gap-1'>
              <Calendar className='h-3.5 w-3.5' />
              Mis à jour le {formatDateFR(product.updated_at)}
            </span>
          </div>
        </div>

        {canEdit && (
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => onToggleArchive(product)}
              className='border-[#E1E3E5]'
            >
              {product.archived ? (
                <>
                  <ArchiveRestore className='mr-1.5 h-4 w-4 text-[#008060]' />
                  Restaurer
                </>
              ) : (
                <>
                  <Archive className='mr-1.5 h-4 w-4 text-[#6D7175]' />
                  Archiver
                </>
              )}
            </Button>
            <Button
              size='sm'
              onClick={() => onEdit(product)}
              className='bg-[#008060] text-white hover:bg-[#006e52]'
            >
              <Edit3 className='mr-1.5 h-4 w-4' />
              Modifier la fiche
            </Button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div
        className={`grid gap-4 sm:grid-cols-2 ${
          canSeePrices ? 'lg:grid-cols-6' : 'lg:grid-cols-4'
        }`}
      >
        <Card className='border-[#E1E3E5] bg-white shadow-none'>
          <CardHeader className='pb-1.5'>
            <CardTitle className='text-xs font-medium text-[#6D7175]'>
              Stock actuel
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-lg font-semibold text-[#202223]'>
              {formatQty(stockResult.stock)} {product.unit}
            </div>
            <p className='mt-1 text-[11px] text-[#6D7175]'>
              {stockResult.baselineType === 'inventory'
                ? `Base inventaire du ${formatDateFR(stockResult.baselineDate)} (${formatQty(stockResult.baselineValue)})`
                : `Stock initial : ${formatQty(product.initial_stock)} ${product.unit}`}
            </p>
          </CardContent>
        </Card>

        <Card className='border-[#E1E3E5] bg-white shadow-none'>
          <CardHeader className='pb-1.5'>
            <CardTitle className='text-xs font-medium text-[#6D7175]'>
              Stock minimum
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-lg font-semibold text-[#202223]'>
              {product.min_stock && product.min_stock > 0
                ? `${formatQty(product.min_stock)} ${product.unit}`
                : 'Non défini'}
            </div>
            <div className='mt-1'>
              <StockStatusBadge status={stockResult.status} />
            </div>
          </CardContent>
        </Card>

        {canSeePrices && (
          <Card className='border-[#E1E3E5] bg-white shadow-none'>
            <CardHeader className='pb-1.5'>
              <CardTitle className='text-xs font-medium text-[#6D7175]'>
                Prix moyen pondéré ({vatConvention})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stockResult.averagePrice !== null ? (
                <div className='text-lg font-semibold text-[#202223]'>
                  {formatMAD(stockResult.averagePrice)}
                </div>
              ) : (
                <Badge className='border-transparent bg-[#FFF5EA] text-xs font-medium text-[#B98900]'>
                  Prix manquant
                </Badge>
              )}
              <p className='mt-1 text-[11px] text-[#6D7175]'>
                Par {product.unit} ({vatConvention})
              </p>
            </CardContent>
          </Card>
        )}

        {canSeePrices && (
          <Card className='border-[#E1E3E5] bg-white shadow-none'>
            <CardHeader className='pb-1.5'>
              <CardTitle className='text-xs font-medium text-[#6D7175]'>
                Valeur du stock ({vatConvention})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stockResult.stockValue !== null ? (
                <div className='text-lg font-semibold text-[#202223]'>
                  {formatMAD(stockResult.stockValue)}
                </div>
              ) : (
                <Badge className='border-transparent bg-[#FFF5EA] text-xs font-medium text-[#B98900]'>
                  Prix manquant
                </Badge>
              )}
              <p className='mt-1 text-[11px] text-[#6D7175]'>
                Quantité × PMP
              </p>
            </CardContent>
          </Card>
        )}

        <Card className='border-[#E1E3E5] bg-white shadow-none'>
          <CardHeader className='pb-1.5'>
            <CardTitle className='text-xs font-medium text-[#6D7175]'>
              Dernier achat
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lastPurchase ? (
              <>
                <div className='text-sm font-semibold text-[#202223]'>
                  {formatDateFR(lastPurchase.date)}
                </div>
                <p className='mt-0.5 truncate text-xs text-[#6D7175]'>
                  {lastPurchase.supplierName}
                </p>
                {canSeePrices && (
                  <p className='mt-0.5 text-xs font-medium text-[#202223]'>
                    {lastPurchase.unitPrice > 0
                      ? formatMAD(lastPurchase.unitPrice)
                      : 'Prix non renseigné'}
                  </p>
                )}
              </>
            ) : (
              <div className='text-sm text-[#6D7175]'>Aucun achat</div>
            )}
          </CardContent>
        </Card>

        <Card className='border-[#E1E3E5] bg-white shadow-none'>
          <CardHeader className='pb-1.5'>
            <CardTitle className='text-xs font-medium text-[#6D7175]'>
              Dernier inventaire
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lastInventory ? (
              <>
                <div className='text-sm font-semibold text-[#202223]'>
                  {formatDateFR(lastInventory.date)}
                </div>
                <p className='mt-0.5 text-xs text-[#6D7175]'>
                  Compté : {formatQty(lastInventory.counted)} {product.unit}
                </p>
                <p
                  className={`mt-0.5 text-xs font-medium ${
                    lastInventory.diff < 0
                      ? 'text-[#D72C0D]'
                      : lastInventory.diff > 0
                        ? 'text-[#008060]'
                        : 'text-[#6D7175]'
                  }`}
                >
                  Écart :{' '}
                  {lastInventory.diff > 0
                    ? `+${formatQty(lastInventory.diff)}`
                    : formatQty(lastInventory.diff)}{' '}
                  {product.unit}
                </p>
              </>
            ) : (
              <div className='text-sm text-[#6D7175]'>Aucun comptage</div>
            )}
          </CardContent>
        </Card>
      </div>

      {product.notes && (
        <div className='rounded-md border border-[#E1E3E5] bg-white px-4 py-3 text-sm text-[#202223]'>
          <span className='font-medium text-[#6D7175]'>Notes : </span>
          {product.notes}
        </div>
      )}

      {/* Detail Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className='w-full'>
        <TabsList className='flex h-auto flex-wrap justify-start gap-1 border-b border-[#E1E3E5] bg-transparent p-0 pb-2'>
          <TabsTrigger value='mouvements' className='text-xs sm:text-sm'>
            Mouvements ({ledger.movements.length})
          </TabsTrigger>
          {canSeePrices && (
            <TabsTrigger value='achats' className='text-xs sm:text-sm'>
              Achats récents ({ledger.recentPurchases.length})
            </TabsTrigger>
          )}
          <TabsTrigger value='consommation' className='text-xs sm:text-sm'>
            Consommation
          </TabsTrigger>
          <TabsTrigger value='pertes' className='text-xs sm:text-sm'>
            Pertes ({ledger.losses.length})
          </TabsTrigger>
          {canSeePrices && (
            <TabsTrigger value='prix' className='text-xs sm:text-sm'>
              Prix ({ledger.priceHistory.length})
            </TabsTrigger>
          )}
          <TabsTrigger value='inventaires' className='text-xs sm:text-sm'>
            Inventaires ({ledger.inventories.length})
          </TabsTrigger>
          <TabsTrigger value='activite' className='text-xs sm:text-sm'>
            Activité ({productAuditLogs.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Mouvements */}
        <TabsContent value='mouvements' className='mt-4'>
          <Card className='border-[#E1E3E5] bg-white shadow-none'>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7] hover:bg-[#F6F6F7]'>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Date
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Type de mouvement
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Tiers / Destination
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Document
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Variation ({product.unit})
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Stock cumulé
                    </TableHead>
                    {canSeePrices && (
                      <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                        Prix U.
                      </TableHead>
                    )}
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Notes
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.movements.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={canSeePrices ? 8 : 7}
                        className='h-24 text-center text-sm text-[#6D7175]'
                      >
                        Aucun mouvement enregistré pour ce produit.
                      </TableCell>
                    </TableRow>
                  ) : (
                    ledger.movements.map((mv) => (
                      <TableRow key={mv.id} className='hover:bg-[#F6F6F7]/60'>
                        <TableCell className='whitespace-nowrap text-xs text-[#202223]'>
                          {formatDateFR(mv.date)}
                        </TableCell>
                        <TableCell className='text-xs font-medium text-[#202223]'>
                          {mv.label}
                        </TableCell>
                        <TableCell className='text-xs text-[#6D7175]'>
                          {mv.counterparty}
                        </TableCell>
                        <TableCell className='font-mono text-xs text-[#6D7175]'>
                          {mv.referenceDoc}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-xs font-semibold ${
                            mv.qtyDelta > 0
                              ? 'text-[#008060]'
                              : mv.qtyDelta < 0
                                ? 'text-[#D72C0D]'
                                : 'text-[#6D7175]'
                          }`}
                        >
                          {mv.qtyDelta > 0
                            ? `+${formatQty(mv.qtyDelta)}`
                            : formatQty(mv.qtyDelta)}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs font-semibold text-[#202223]'>
                          {formatQty(mv.runningStock)} {product.unit}
                        </TableCell>
                        {canSeePrices && (
                          <TableCell className='text-right text-xs text-[#6D7175]'>
                            {mv.unitPrice && mv.unitPrice > 0
                              ? formatMAD(mv.unitPrice)
                              : '—'}
                          </TableCell>
                        )}
                        <TableCell className='max-w-xs truncate text-xs text-[#6D7175]'>
                          {mv.notes || '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Achats récents */}
        {canSeePrices && (
          <TabsContent value='achats' className='mt-4'>
            <Card className='border-[#E1E3E5] bg-white shadow-none'>
              <CardContent className='p-0'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-[#F6F6F7] hover:bg-[#F6F6F7]'>
                      <TableHead className='text-xs font-semibold text-[#6D7175]'>
                        Date
                      </TableHead>
                      <TableHead className='text-xs font-semibold text-[#6D7175]'>
                        Fournisseur
                      </TableHead>
                      <TableHead className='text-xs font-semibold text-[#6D7175]'>
                        N° Facture / BL
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                        Quantité
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                        Prix U. ({vatConvention})
                      </TableHead>
                      <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                        Montant
                      </TableHead>
                      <TableHead className='text-xs font-semibold text-[#6D7175]'>
                        Paiement
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.recentPurchases.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className='h-24 text-center text-sm text-[#6D7175]'
                        >
                          Aucun achat enregistré pour ce produit.
                        </TableCell>
                      </TableRow>
                    ) : (
                      ledger.recentPurchases.map((rp) => (
                        <TableRow
                          key={rp.lineId}
                          className='hover:bg-[#F6F6F7]/60'
                        >
                          <TableCell className='text-xs text-[#202223]'>
                            {formatDateFR(rp.date)}
                          </TableCell>
                          <TableCell className='text-xs font-medium text-[#202223]'>
                            {rp.supplierName}
                          </TableCell>
                          <TableCell className='font-mono text-xs text-[#6D7175]'>
                            {rp.invoiceNo}
                          </TableCell>
                          <TableCell className='text-right font-mono text-xs text-[#202223]'>
                            {formatQty(rp.qty)} {product.unit}
                          </TableCell>
                          <TableCell className='text-right text-xs text-[#202223]'>
                            {rp.unitPrice > 0 ? (
                              formatMAD(rp.unitPrice)
                            ) : (
                              <Badge className='bg-[#FFF5EA] text-[11px] font-normal text-[#B98900]'>
                                Prix manquant
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className='text-right font-medium text-xs text-[#202223]'>
                            {formatMAD(rp.amount)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                rp.paymentStatus === 'paid'
                                  ? 'bg-[#E3F1DF] text-xs font-normal text-[#008060]'
                                  : 'bg-[#FFF5EA] text-xs font-normal text-[#B98900]'
                              }
                            >
                              {getPaymentStatusLabel(rp.paymentStatus)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Tab 3: Consommation (Chart) */}
        <TabsContent value='consommation' className='mt-4'>
          <Card className='border-[#E1E3E5] bg-white shadow-none'>
            <CardHeader>
              <CardTitle className='text-sm font-semibold text-[#202223]'>
                Consommation et pertes mensuelles ({product.unit})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ledger.monthlyConsumption.length === 0 ? (
                <div className='flex h-56 items-center justify-center text-sm text-[#6D7175]'>
                  Aucune sortie enregistrée pour générer le graphique de
                  consommation.
                </div>
              ) : (
                <div className='h-72 w-full'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart data={ledger.monthlyConsumption}>
                      <CartesianGrid strokeDasharray='3 3' stroke='#E1E3E5' />
                      <XAxis dataKey='monthLabel' tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey='consumed'
                        name={`Consommation (${product.unit})`}
                        fill='#008060'
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey='wasted'
                        name={`Pertes (${product.unit})`}
                        fill='#D72C0D'
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Pertes */}
        <TabsContent value='pertes' className='mt-4'>
          <Card className='border-[#E1E3E5] bg-white shadow-none'>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7] hover:bg-[#F6F6F7]'>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Date
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Destination
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Quantité perdue
                    </TableHead>
                    {canSeePrices && (
                      <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                        Coût estimé
                      </TableHead>
                    )}
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Notes
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.losses.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={canSeePrices ? 5 : 4}
                        className='h-24 text-center text-sm text-[#6D7175]'
                      >
                        Aucune perte enregistrée pour ce produit.
                      </TableCell>
                    </TableRow>
                  ) : (
                    ledger.losses.map((loss) => (
                      <TableRow
                        key={loss.lineId}
                        className='hover:bg-[#F6F6F7]/60'
                      >
                        <TableCell className='text-xs text-[#202223]'>
                          {formatDateFR(loss.date)}
                        </TableCell>
                        <TableCell className='text-xs text-[#202223]'>
                          {loss.destination}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs font-semibold text-[#D72C0D]'>
                          {formatQty(loss.qtyWasted)} {product.unit}
                        </TableCell>
                        {canSeePrices && (
                          <TableCell className='text-right text-xs text-[#202223]'>
                            {loss.estimatedLossValue !== null
                              ? formatMAD(loss.estimatedLossValue)
                              : '—'}
                          </TableCell>
                        )}
                        <TableCell className='text-xs text-[#6D7175]'>
                          {loss.notes || '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 5: Prix (Price History Chart) */}
        {canSeePrices && (
          <TabsContent value='prix' className='mt-4'>
            <Card className='border-[#E1E3E5] bg-white shadow-none'>
              <CardHeader>
                <CardTitle className='text-sm font-semibold text-[#202223]'>
                  Évolution du prix d’achat unitaire ({vatConvention} en MAD)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ledger.priceHistory.length === 0 ? (
                  <div className='flex h-56 items-center justify-center text-sm text-[#6D7175]'>
                    Aucun achat chiffré disponible pour afficher l’évolution du
                    prix.
                  </div>
                ) : (
                  <div className='h-72 w-full'>
                    <ResponsiveContainer width='100%' height='100%'>
                      <LineChart data={ledger.priceHistory}>
                        <CartesianGrid strokeDasharray='3 3' stroke='#E1E3E5' />
                        <XAxis dataKey='dateLabel' tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        <Line
                          type='monotone'
                          dataKey='unitPrice'
                          name={`Prix U. (${vatConvention} DH)`}
                          stroke='#008060'
                          strokeWidth={2}
                          dot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Tab 6: Inventaires */}
        <TabsContent value='inventaires' className='mt-4'>
          <Card className='border-[#E1E3E5] bg-white shadow-none'>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7] hover:bg-[#F6F6F7]'>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Date inventaire
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Stock théorique
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Stock réel compté
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Écart ({product.unit})
                    </TableHead>
                    {canSeePrices && (
                      <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                        Valeur de l’écart
                      </TableHead>
                    )}
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Validé par
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.inventories.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={canSeePrices ? 6 : 5}
                        className='h-24 text-center text-sm text-[#6D7175]'
                      >
                        Aucun comptage d’inventaire enregistré pour ce produit.
                      </TableCell>
                    </TableRow>
                  ) : (
                    ledger.inventories.map((inv) => (
                      <TableRow
                        key={inv.lineId}
                        className='hover:bg-[#F6F6F7]/60'
                      >
                        <TableCell className='text-xs text-[#202223]'>
                          {formatDateFR(inv.date)}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs text-[#6D7175]'>
                          {formatQty(inv.theoretical)} {product.unit}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs font-semibold text-[#202223]'>
                          {formatQty(inv.counted)} {product.unit}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-xs font-semibold ${
                            inv.diff < 0
                              ? 'text-[#D72C0D]'
                              : inv.diff > 0
                                ? 'text-[#008060]'
                                : 'text-[#6D7175]'
                          }`}
                        >
                          {inv.diff > 0
                            ? `+${formatQty(inv.diff)}`
                            : formatQty(inv.diff)}
                        </TableCell>
                        {canSeePrices && (
                          <TableCell className='text-right text-xs text-[#202223]'>
                            {inv.valueDiff !== null
                              ? formatMAD(inv.valueDiff)
                              : '—'}
                          </TableCell>
                        )}
                        <TableCell className='text-xs text-[#6D7175]'>
                          {inv.confirmedBy || '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 7: Activité (Audit Log) */}
        <TabsContent value='activite' className='mt-4'>
          <Card className='border-[#E1E3E5] bg-white shadow-none'>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7] hover:bg-[#F6F6F7]'>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Date & Heure
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Utilisateur
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Action
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Détails
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productAuditLogs.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className='h-24 text-center text-sm text-[#6D7175]'
                      >
                        Aucune activité d’audit pour ce produit.
                      </TableCell>
                    </TableRow>
                  ) : (
                    productAuditLogs.map((log) => (
                      <TableRow key={log.id} className='hover:bg-[#F6F6F7]/60'>
                        <TableCell className='whitespace-nowrap text-xs text-[#202223]'>
                          {formatDateTimeFR(log.timestamp)}
                        </TableCell>
                        <TableCell className='text-xs text-[#202223]'>
                          {log.user_email}
                        </TableCell>
                        <TableCell className='text-xs font-medium text-[#202223]'>
                          {log.action}
                        </TableCell>
                        <TableCell className='font-mono text-xs text-[#6D7175]'>
                          {JSON.stringify(log.details)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
