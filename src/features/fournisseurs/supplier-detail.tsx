import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  Building2,
  Calendar,
  Edit3,
  GitMerge,
  Mail,
  Phone,
  TrendingDown,
  TrendingUp,
  User,
} from 'lucide-react'
import type {
  ProductRecord,
  PurchaseLineRecord,
  PurchaseRecord,
  SupplierRecord,
  VatConvention,
} from '@/data/types'
import { formatDateFR, formatMAD, formatQty } from '@/lib/format'
import {
  computeSupplierDetail,
  getPaymentStatusLabel,
} from '@/lib/stock-engine'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface SupplierDetailViewProps {
  supplier: SupplierRecord
  purchases: PurchaseRecord[]
  purchaseLines: PurchaseLineRecord[]
  products: ProductRecord[]
  vatConvention: VatConvention
  canEdit: boolean
  onBack: () => void
  onEdit: (supplier: SupplierRecord) => void
  onOpenMerge: (sourceSupplier: SupplierRecord) => void
  onNavigateToProduct: (productId: string) => void
}

export function SupplierDetailView({
  supplier,
  purchases,
  purchaseLines,
  products,
  vatConvention,
  canEdit,
  onBack,
  onEdit,
  onOpenMerge,
  onNavigateToProduct,
}: SupplierDetailViewProps) {
  const [activeTab, setActiveTab] = useState('achats')
  const [periodStart, setPeriodStart] = useState<string>('')
  const [periodEnd, setPeriodEnd] = useState<string>('')

  const detail = useMemo(
    () =>
      computeSupplierDetail({
        supplierId: supplier.id,
        purchases,
        purchaseLines,
        products,
        periodStartDate: periodStart || null,
        periodEndDate: periodEnd || null,
      }),
    [supplier.id, purchases, purchaseLines, products, periodStart, periodEnd]
  )

  const hasPeriodFilter = Boolean(periodStart || periodEnd)

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
              Retour aux fournisseurs
            </Button>
            {supplier.payment_terms && (
              <Badge
                variant='secondary'
                className='bg-[#F1F2F3] text-xs font-normal text-[#202223]'
              >
                Conditions : {supplier.payment_terms}
              </Badge>
            )}
            {supplier.archived && (
              <Badge className='bg-neutral-800 text-xs text-white'>
                Archivé / Fusionné
              </Badge>
            )}
          </div>
          <h1 className='text-xl font-semibold text-[#202223]'>
            {supplier.name}
          </h1>
          <div className='flex flex-wrap items-center gap-4 text-xs text-[#6D7175]'>
            {supplier.contact && (
              <span className='inline-flex items-center gap-1'>
                <User className='h-3.5 w-3.5' />
                Contact :{' '}
                <strong className='text-[#202223]'>{supplier.contact}</strong>
              </span>
            )}
            {supplier.phone && (
              <span className='inline-flex items-center gap-1'>
                <Phone className='h-3.5 w-3.5' />
                <strong className='text-[#202223]'>{supplier.phone}</strong>
              </span>
            )}
            {supplier.email && (
              <span className='inline-flex items-center gap-1'>
                <Mail className='h-3.5 w-3.5' />
                <strong className='text-[#202223]'>{supplier.email}</strong>
              </span>
            )}
          </div>
        </div>

        {canEdit && (
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => onOpenMerge(supplier)}
              className='border-[#E1E3E5]'
            >
              <GitMerge className='mr-1.5 h-4 w-4 text-[#6D7175]' />
              Fusionner un doublon
            </Button>
            <Button
              size='sm'
              onClick={() => onEdit(supplier)}
              className='bg-[#008060] text-white hover:bg-[#006e52]'
            >
              <Edit3 className='mr-1.5 h-4 w-4' />
              Modifier la fiche
            </Button>
          </div>
        )}
      </div>

      {/* Period Filter Bar */}
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E1E3E5] bg-white px-4 py-3'>
        <div className='flex flex-wrap items-center gap-3 text-xs'>
          <span className='font-medium text-[#202223]'>
            Période d’analyse des achats :
          </span>
          <div className='flex items-center gap-1.5'>
            <Label className='text-xs text-[#6D7175]'>Du</Label>
            <Input
              type='date'
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className='h-8 w-36 text-xs'
            />
          </div>
          <div className='flex items-center gap-1.5'>
            <Label className='text-xs text-[#6D7175]'>Au</Label>
            <Input
              type='date'
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className='h-8 w-36 text-xs'
            />
          </div>
          {hasPeriodFilter && (
            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-xs text-[#008060]'
              onClick={() => {
                setPeriodStart('')
                setPeriodEnd('')
              }}
            >
              Toutes les dates
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <Card className='border-[#E1E3E5] bg-white shadow-none'>
          <CardHeader className='pb-1.5'>
            <CardTitle className='text-xs font-medium text-[#6D7175]'>
              Total des achats ({vatConvention})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-lg font-semibold text-[#202223]'>
              {formatMAD(detail.totalAllTime)}
            </div>
            <p className='mt-1 text-[11px] text-[#6D7175]'>
              {hasPeriodFilter
                ? `Période sélectionnée : ${formatMAD(detail.totalSelectedPeriod)}`
                : 'Cumul global toutes périodes'}
            </p>
          </CardContent>
        </Card>

        <Card className='border-[#E1E3E5] bg-white shadow-none'>
          <CardHeader className='pb-1.5'>
            <CardTitle className='text-xs font-medium text-[#6D7175]'>
              Solde impayé
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-lg font-semibold ${
                detail.unpaidBalance > 0 ? 'text-[#D72C0D]' : 'text-[#008060]'
              }`}
            >
              {formatMAD(detail.unpaidBalance)}
            </div>
            <p className='mt-1 text-[11px] text-[#6D7175]'>
              {detail.unpaidInvoicesCount > 0
                ? `${detail.unpaidInvoicesCount} facture(s) en attente de règlement`
                : 'Aucun impayé en cours'}
            </p>
          </CardContent>
        </Card>

        <Card className='border-[#E1E3E5] bg-white shadow-none'>
          <CardHeader className='pb-1.5'>
            <CardTitle className='text-xs font-medium text-[#6D7175]'>
              Nombre de factures / BL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-lg font-semibold text-[#202223]'>
              {detail.invoicesCount}
            </div>
            <p className='mt-1 text-[11px] text-[#6D7175]'>
              {detail.purchasedProducts.length} produit(s) référencé(s)
            </p>
          </CardContent>
        </Card>

        <Card className='border-[#E1E3E5] bg-white shadow-none'>
          <CardHeader className='pb-1.5'>
            <CardTitle className='text-xs font-medium text-[#6D7175]'>
              Dernier achat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-lg font-semibold text-[#202223]'>
              {detail.lastPurchaseDate
                ? formatDateFR(detail.lastPurchaseDate)
                : 'Aucun achat'}
            </div>
            <p className='mt-1 text-[11px] text-[#6D7175]'>
              Date de dernière réception
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className='w-full'>
        <TabsList className='flex h-auto flex-wrap justify-start gap-1 border-b border-[#E1E3E5] bg-transparent p-0 pb-2'>
          <TabsTrigger value='achats' className='text-xs sm:text-sm'>
            Historique des achats ({detail.purchaseDocuments.length})
          </TabsTrigger>
          <TabsTrigger value='impayes' className='text-xs sm:text-sm'>
            Factures impayées ({detail.unpaidDocuments.length})
          </TabsTrigger>
          <TabsTrigger value='produits' className='text-xs sm:text-sm'>
            Produits achetés ({detail.purchasedProducts.length})
          </TabsTrigger>
          <TabsTrigger value='notes' className='text-xs sm:text-sm'>
            Notes & Conditions
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Historique des achats */}
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
                      N° Facture / BL
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Lignes
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Montant ({vatConvention})
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Statut paiement
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Date règlement
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Notes
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.purchaseDocuments.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className='h-24 text-center text-sm text-[#6D7175]'
                      >
                        Aucun bon d’entrée enregistré pour ce fournisseur.
                      </TableCell>
                    </TableRow>
                  ) : (
                    detail.purchaseDocuments.map((doc) => (
                      <TableRow key={doc.id} className='hover:bg-[#F6F6F7]/60'>
                        <TableCell className='text-xs text-[#202223]'>
                          {formatDateFR(doc.date)}
                        </TableCell>
                        <TableCell className='font-mono text-xs text-[#202223]'>
                          {doc.invoiceNo}
                          {doc.isReversal && (
                            <Badge
                              variant='secondary'
                              className='ml-1.5 text-[10px]'
                            >
                              Contre-passation
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs text-[#6D7175]'>
                          {doc.linesCount}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs font-semibold text-[#202223]'>
                          {formatMAD(doc.totalAmount)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              doc.paymentStatus === 'paid'
                                ? 'bg-[#E3F1DF] text-xs font-normal text-[#008060]'
                                : 'bg-[#FBEAE5] text-xs font-normal text-[#D72C0D]'
                            }
                          >
                            {getPaymentStatusLabel(doc.paymentStatus)}
                          </Badge>
                        </TableCell>
                        <TableCell className='text-xs text-[#6D7175]'>
                          {doc.paymentDate
                            ? formatDateFR(doc.paymentDate)
                            : '—'}
                        </TableCell>
                        <TableCell className='max-w-xs truncate text-xs text-[#6D7175]'>
                          {doc.notes || '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Factures impayées */}
        <TabsContent value='impayes' className='mt-4'>
          <Card className='border-[#E1E3E5] bg-white shadow-none'>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7] hover:bg-[#F6F6F7]'>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Date réception
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      N° Facture / BL
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Lignes
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Montant dû
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Notes
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.unpaidDocuments.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className='h-24 text-center text-sm text-[#008060]'
                      >
                        Aucune facture impayée pour ce fournisseur.
                      </TableCell>
                    </TableRow>
                  ) : (
                    detail.unpaidDocuments.map((doc) => (
                      <TableRow key={doc.id} className='hover:bg-[#F6F6F7]/60'>
                        <TableCell className='text-xs text-[#202223]'>
                          {formatDateFR(doc.date)}
                        </TableCell>
                        <TableCell className='font-mono text-xs font-medium text-[#202223]'>
                          {doc.invoiceNo}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs text-[#6D7175]'>
                          {doc.linesCount}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs font-semibold text-[#D72C0D]'>
                          {formatMAD(doc.totalAmount)}
                        </TableCell>
                        <TableCell className='text-xs text-[#6D7175]'>
                          {doc.notes || '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Produits achetés */}
        <TabsContent value='produits' className='mt-4'>
          <Card className='border-[#E1E3E5] bg-white shadow-none'>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow className='bg-[#F6F6F7] hover:bg-[#F6F6F7]'>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Référence
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Produit
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Catégorie
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Quantité totale
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Dernier prix U.
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Variation prix
                    </TableHead>
                    <TableHead className='text-right text-xs font-semibold text-[#6D7175]'>
                      Cumul achats
                    </TableHead>
                    <TableHead className='text-xs font-semibold text-[#6D7175]'>
                      Dernier achat
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.purchasedProducts.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className='h-24 text-center text-sm text-[#6D7175]'
                      >
                        Aucun produit acheté auprès de ce fournisseur.
                      </TableCell>
                    </TableRow>
                  ) : (
                    detail.purchasedProducts.map((item) => (
                      <TableRow
                        key={item.productId}
                        className='cursor-pointer hover:bg-[#F6F6F7]/60'
                        onClick={() => onNavigateToProduct(item.productId)}
                      >
                        <TableCell className='font-mono text-xs font-medium text-[#202223]'>
                          {item.ref}
                        </TableCell>
                        <TableCell className='text-xs font-medium text-[#202223]'>
                          {item.name}
                        </TableCell>
                        <TableCell className='text-xs text-[#6D7175]'>
                          {item.category}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs text-[#202223]'>
                          {formatQty(item.totalQty)} {item.unit}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs text-[#202223]'>
                          {item.lastPrice > 0 ? (
                            formatMAD(item.lastPrice)
                          ) : (
                            <Badge className='bg-[#FFF5EA] text-[11px] font-normal text-[#B98900]'>
                              Prix manquant
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className='text-right text-xs'>
                          {item.priceVariationPct === null ? (
                            <span className='text-[#6D7175]'>—</span>
                          ) : item.priceVariationPct === 0 ? (
                            <Badge
                              variant='secondary'
                              className='bg-[#F1F2F3] text-xs font-normal text-[#6D7175]'
                            >
                              0%
                            </Badge>
                          ) : item.priceVariationPct > 0 ? (
                            <Badge className='bg-[#FBEAE5] text-xs font-normal text-[#D72C0D]'>
                              <TrendingUp className='mr-1 h-3 w-3' />+
                              {item.priceVariationPct}%
                            </Badge>
                          ) : (
                            <Badge className='bg-[#E3F1DF] text-xs font-normal text-[#008060]'>
                              <TrendingDown className='mr-1 h-3 w-3' />
                              {item.priceVariationPct}%
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs font-semibold text-[#202223]'>
                          {formatMAD(item.totalAmount)}
                        </TableCell>
                        <TableCell className='text-xs text-[#6D7175]'>
                          {formatDateFR(item.lastPurchaseDate)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Notes & Conditions */}
        <TabsContent value='notes' className='mt-4'>
          <Card className='border-[#E1E3E5] bg-white shadow-none'>
            <CardHeader className='flex flex-row items-center justify-between'>
              <CardTitle className='text-sm font-semibold text-[#202223]'>
                Coordonnées, conditions de règlement et notes
              </CardTitle>
              {canEdit && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => onEdit(supplier)}
                >
                  <Edit3 className='mr-1.5 h-3.5 w-3.5' />
                  Modifier
                </Button>
              )}
            </CardHeader>
            <CardContent className='grid gap-4 text-sm sm:grid-cols-2'>
              <div className='space-y-1'>
                <span className='text-xs text-[#6D7175]'> Raison sociale</span>
                <p className='font-medium text-[#202223]'>
                  <Building2 className='mr-1.5 inline h-4 w-4 text-[#6D7175]' />
                  {supplier.name}
                </p>
              </div>
              <div className='space-y-1'>
                <span className='text-xs text-[#6D7175]'>
                  Conditions de paiement
                </span>
                <p className='font-medium text-[#202223]'>
                  {supplier.payment_terms || 'Non renseignées'}
                </p>
              </div>
              <div className='space-y-1'>
                <span className='text-xs text-[#6D7175]'>Interlocuteur</span>
                <p className='text-[#202223]'>{supplier.contact || '—'}</p>
              </div>
              <div className='space-y-1'>
                <span className='text-xs text-[#6D7175]'>
                  Téléphone / E-mail
                </span>
                <p className='text-[#202223]'>
                  {[supplier.phone, supplier.email].filter(Boolean).join(' • ') ||
                    '—'}
                </p>
              </div>
              <div className='space-y-1 sm:col-span-2'>
                <span className='text-xs text-[#6D7175]'>Notes internes</span>
                <div className='rounded-md border border-[#E1E3E5] bg-[#F6F6F7]/50 p-3 text-xs text-[#202223]'>
                  {supplier.notes || 'Aucune note enregistrée.'}
                </div>
              </div>
              <div className='space-y-1 sm:col-span-2'>
                <span className='inline-flex items-center gap-1 text-xs text-[#6D7175]'>
                  <Calendar className='h-3.5 w-3.5' />
                  Fiche créée le {formatDateFR(supplier.created_at)} • Dernière
                  mise à jour le {formatDateFR(supplier.updated_at)}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
