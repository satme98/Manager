import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Download,
  RefreshCw,
  Search,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository as repo } from '@/data'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  computeDatabaseQualityReport,
  type DataQualityCategory,
  type DataQualityItem,
  exportDataQualityReportFile,
} from '@/lib/excel-import-engine'

const CATEGORY_TABS: Array<{
  key: 'all' | DataQualityCategory
  label: string
}> = [
  { key: 'all', label: 'Toutes les anomalies' },
  { key: 'sans_categorie', label: 'Produits sans catégorie' },
  { key: 'sans_stock_min', label: 'Produits sans stock min.' },
  { key: 'prix_manquant', label: 'Achats sans prix' },
  { key: 'paiement_ambigu', label: 'Paiements ni OUI ni NON' },
  { key: 'fournisseur_manquant', label: 'Fournisseurs hors liste' },
  { key: 'doublon_potentiel', label: 'Doublons potentiels' },
  { key: 'a_verifier', label: 'Mentions « à vérifier »' },
]

const OFFICIAL_CATEGORIES = [
  'Viandes & Charcuterie',
  'Poissons & Fruits de mer',
  'Fruits & Légumes',
  'Œufs',
  'Produits laitiers & Fromages',
  'Boulangerie',
  'Pâtes & Féculents',
  'Épicerie',
  'Épices & Assaisonnements',
  'Préparations / Bases',
  'Pâtisserie & Desserts',
  'Emballages & Jetables',
  'Hygiène & Entretien',
  'Boissons & Eaux',
]

export function ACorrigerPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'all' | DataQualityCategory>('all')
  const [search, setSearch] = useState('')
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const {
    data: report,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['data-quality-report'],
    queryFn: () => computeDatabaseQualityReport(repo),
  })

  const filteredItems = useMemo(() => {
    if (!report) return []
    const q = search.trim().toLowerCase()
    return report.items.filter((item) => {
      if (activeTab !== 'all' && item.category !== activeTab) return false
      if (!q) return true
      return (
        item.reference.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q)
      )
    })
  }, [report, activeTab, search])

  const handleInlineFix = async (item: DataQualityItem, customAction?: string) => {
    if (!item.recordId) return
    setSavingId(item.id)
    try {
      const val = (draftValues[item.id] ?? '').trim()

      if (item.category === 'sans_categorie') {
        const chosenCat = val || 'Épicerie'
        await repo.updateProduct(item.recordId, { category: chosenCat })
        toast.success(`Catégorie « ${chosenCat} » affectée à ${item.reference}.`)
      } else if (item.category === 'sans_stock_min') {
        const minNum = Number(val || '5')
        if (!Number.isFinite(minNum) || minNum <= 0) {
          toast.error('Veuillez saisir un seuil minimum strictement positif.')
          setSavingId(null)
          return
        }
        await repo.updateProduct(item.recordId, { min_stock: minNum })
        toast.success(`Seuil minimum (${minNum}) enregistré pour ${item.reference}.`)
      } else if (item.category === 'prix_manquant') {
        const priceNum = Number(val || '10')
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
          toast.error('Veuillez saisir un prix unitaire strictement positif.')
          setSavingId(null)
          return
        }
        await repo.updatePurchaseLinePrice(item.recordId, priceNum, {
          reason: 'Correction rapide depuis l’écran À corriger',
        })
        toast.success(`Prix unitaire (${priceNum.toFixed(2)} DH) enregistré.`)
      } else if (item.category === 'paiement_ambigu') {
        const targetStatus = customAction === 'paid' ? 'paid' : 'unpaid'
        await repo.updatePurchaseHeader(
          item.recordId,
          {
            payment_status: targetStatus,
            payment_date:
              targetStatus === 'paid'
                ? new Date().toISOString().slice(0, 10)
                : null,
            is_ambiguous_payment: false,
          },
          'Confirmation du statut de paiement ambigu depuis À corriger'
        )
        toast.success(
          `Statut de paiement confirmé (${targetStatus === 'paid' ? 'Payé' : 'Impayé'}) et journalisé.`
        )
      } else if (item.category === 'fournisseur_manquant') {
        await repo.updateSupplier(item.recordId, {
          phone: val || '0600-000000',
          missing_from_supplier_sheet: false,
        })
        toast.success(`Fournisseur « ${item.label} » validé dans le référentiel.`)
      } else if (item.category === 'doublon_potentiel') {
        if (customAction === 'reverse') {
          await repo.reversePurchaseDocument(
            item.recordId,
            'Doublon d’import annulé depuis l’écran À corriger'
          )
          toast.success('Bon en doublon contre-passé et journalisé.')
        } else if (item.secondaryId) {
          const pur = await repo.listPurchases()
          const line = pur.lines.find((l) => l.id === item.secondaryId)
          await repo.updatePurchaseLinePrice(
            item.secondaryId,
            line?.unit_price ?? 0,
            {
              duplicate_verified: true,
              reason: 'Doublon potentiel vérifié et conservé depuis À corriger',
            }
          )
          toast.success('Ligne conservée et marquée comme vérifiée.')
        }
      } else if (item.category === 'a_verifier') {
        if (item.secondaryId === 'product') {
          await repo.updateProduct(item.recordId, {
            notes: 'Vérifié',
          })
        } else if (item.secondaryId === 'supplier') {
          await repo.updateSupplier(item.recordId, {
            notes: 'Vérifié',
          })
        } else {
          await repo.updatePurchaseHeader(item.recordId, {
            notes: 'Vérifié',
          })
        }
        toast.success('Mention « à vérifier » levée et inscrite au journal d’audit.')
      }

      await queryClient.invalidateQueries()
      await refetch()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erreur lors de la correction'
      )
    } finally {
      setSavingId(null)
    }
  }

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2'>
          <Wrench className='size-4 text-[#B98900]' />
          <span className='text-[13px] font-medium text-[#202223]'>
            À corriger — Nettoyage des données importées
          </span>
        </div>
        <div className='ms-auto flex items-center space-x-3'>
          <ProfileDropdown />
        </div>
      </Header>

      <Main className='bg-[#F6F6F7] pb-12'>
        <div className='mb-5 flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h1 className='text-[20px] font-semibold tracking-tight text-[#202223]'>
              À corriger ({report?.counts.total ?? 0} éléments)
            </h1>
            <p className='text-[13px] text-[#6D7175]'>
              Corrigez directement en ligne les anomalies détectées dans le
              fichier importé. Chaque correction met à jour la base et écrit une
              trace dans le journal d’audit.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => refetch()}
              className='h-8 border-[#E1E3E5] bg-white text-[12px] text-[#202223]'
            >
              <RefreshCw className='mr-1.5 size-3.5' />
              Actualiser
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => exportDataQualityReportFile(repo, 'xlsx')}
              className='h-8 border-[#E1E3E5] bg-white text-[12px] text-[#202223]'
            >
              <Download className='mr-1.5 size-3.5' />
              Exporter (.xlsx)
            </Button>
          </div>
        </div>

        {/* Summary Cards for the 7 Step 4 Categories */}
        {report && (
          <div className='mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7'>
            <button
              type='button'
              onClick={() => setActiveTab('sans_categorie')}
              className={`rounded-lg border p-3 text-left transition ${
                activeTab === 'sans_categorie'
                  ? 'border-[#303030] bg-white ring-1 ring-[#303030]'
                  : 'border-[#E1E3E5] bg-white hover:border-[#6D7175]'
              }`}
            >
              <div className='text-[11px] text-[#6D7175]'>Sans catégorie</div>
              <div className='mt-1 text-[18px] font-semibold text-[#202223]'>
                {report.counts.sans_categorie}
              </div>
            </button>
            <button
              type='button'
              onClick={() => setActiveTab('sans_stock_min')}
              className={`rounded-lg border p-3 text-left transition ${
                activeTab === 'sans_stock_min'
                  ? 'border-[#303030] bg-white ring-1 ring-[#303030]'
                  : 'border-[#E1E3E5] bg-white hover:border-[#6D7175]'
              }`}
            >
              <div className='text-[11px] text-[#6D7175]'>Sans stock min.</div>
              <div className='mt-1 text-[18px] font-semibold text-[#202223]'>
                {report.counts.sans_stock_min}
              </div>
            </button>
            <button
              type='button'
              onClick={() => setActiveTab('prix_manquant')}
              className={`rounded-lg border p-3 text-left transition ${
                activeTab === 'prix_manquant'
                  ? 'border-[#303030] bg-white ring-1 ring-[#303030]'
                  : 'border-[#E1E3E5] bg-white hover:border-[#6D7175]'
              }`}
            >
              <div className='text-[11px] text-[#6D7175]'>Achats sans prix</div>
              <div className='mt-1 text-[18px] font-semibold text-[#B98900]'>
                {report.counts.prix_manquant}
              </div>
            </button>
            <button
              type='button'
              onClick={() => setActiveTab('paiement_ambigu')}
              className={`rounded-lg border p-3 text-left transition ${
                activeTab === 'paiement_ambigu'
                  ? 'border-[#303030] bg-white ring-1 ring-[#303030]'
                  : 'border-[#E1E3E5] bg-white hover:border-[#6D7175]'
              }`}
            >
              <div className='text-[11px] text-[#6D7175]'>
                Paiements ≠ OUI/NON
              </div>
              <div className='mt-1 text-[18px] font-semibold text-[#B98900]'>
                {report.counts.paiement_ambigu}
              </div>
            </button>
            <button
              type='button'
              onClick={() => setActiveTab('fournisseur_manquant')}
              className={`rounded-lg border p-3 text-left transition ${
                activeTab === 'fournisseur_manquant'
                  ? 'border-[#303030] bg-white ring-1 ring-[#303030]'
                  : 'border-[#E1E3E5] bg-white hover:border-[#6D7175]'
              }`}
            >
              <div className='text-[11px] text-[#6D7175]'>
                Fournisseurs hors liste
              </div>
              <div className='mt-1 text-[18px] font-semibold text-[#202223]'>
                {report.counts.fournisseur_manquant}
              </div>
            </button>
            <button
              type='button'
              onClick={() => setActiveTab('doublon_potentiel')}
              className={`rounded-lg border p-3 text-left transition ${
                activeTab === 'doublon_potentiel'
                  ? 'border-[#303030] bg-white ring-1 ring-[#303030]'
                  : 'border-[#E1E3E5] bg-white hover:border-[#6D7175]'
              }`}
            >
              <div className='text-[11px] text-[#6D7175]'>
                Doublons potentiels
              </div>
              <div className='mt-1 text-[18px] font-semibold text-[#D72C0D]'>
                {report.counts.doublon_potentiel}
              </div>
            </button>
            <button
              type='button'
              onClick={() => setActiveTab('a_verifier')}
              className={`rounded-lg border p-3 text-left transition ${
                activeTab === 'a_verifier'
                  ? 'border-[#303030] bg-white ring-1 ring-[#303030]'
                  : 'border-[#E1E3E5] bg-white hover:border-[#6D7175]'
              }`}
            >
              <div className='text-[11px] text-[#6D7175]'>
                Notés « à vérifier »
              </div>
              <div className='mt-1 text-[18px] font-semibold text-[#D72C0D]'>
                {report.counts.a_verifier}
              </div>
            </button>
          </div>
        )}

        {/* Filter bar + Table */}
        <div className='rounded-lg border border-[#E1E3E5] bg-white p-4'>
          <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
            <div className='flex flex-wrap gap-1.5'>
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type='button'
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded px-2.5 py-1 text-[12px] font-medium transition ${
                    activeTab === tab.key
                      ? 'bg-[#303030] text-white'
                      : 'bg-[#F6F6F7] text-[#6D7175] hover:text-[#202223]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className='relative w-64'>
              <Search className='pointer-events-none absolute top-2 left-2.5 size-3.5 text-[#6D7175]' />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder='Rechercher réf., produit...'
                className='h-8 pl-8 text-[12px]'
              />
            </div>
          </div>

          {isLoading ? (
            <div className='py-10 text-center text-[13px] text-[#6D7175]'>
              Analyse de la qualité des données en cours...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-10 text-center'>
              <CheckCircle2 className='mb-2 size-7 text-[#008060]' />
              <div className='text-[14px] font-semibold text-[#202223]'>
                Aucune anomalie dans cette catégorie
              </div>
              <p className='mt-0.5 text-[12px] text-[#6D7175]'>
                Toutes les lignes correspondantes ont été corrigées ou la base
                est vide.
              </p>
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full border-collapse text-left text-[12px]'>
                <thead>
                  <tr className='border-b border-[#E1E3E5] bg-[#F6F6F7] text-[#6D7175]'>
                    <th className='px-3 py-2 font-medium'>Type d’anomalie</th>
                    <th className='px-3 py-2 font-medium'>Module</th>
                    <th className='px-3 py-2 font-medium'>Référence</th>
                    <th className='px-3 py-2 font-medium'>Élément</th>
                    <th className='px-3 py-2 font-medium'>Détail</th>
                    <th className='px-3 py-2 font-medium'>
                      Correction rapide en ligne
                    </th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-[#E1E3E5]'>
                  {filteredItems.map((item) => (
                    <tr key={item.id} className='hover:bg-[#F6F6F7]/50'>
                      <td className='px-3 py-2.5'>
                        <span className='inline-flex items-center gap-1 rounded bg-[#B98900]/10 px-2 py-0.5 text-[11px] font-medium text-[#B98900]'>
                          <AlertCircle className='size-3' />
                          {item.categoryLabel}
                        </span>
                      </td>
                      <td className='px-3 py-2.5 text-[#6D7175]'>
                        {item.collection}
                      </td>
                      <td className='px-3 py-2.5 font-mono font-semibold text-[#202223]'>
                        {item.reference}
                      </td>
                      <td className='px-3 py-2.5 font-medium text-[#202223]'>
                        {item.label}
                      </td>
                      <td className='px-3 py-2.5 text-[#6D7175]'>
                        {item.detail}
                      </td>
                      <td className='px-3 py-2.5'>
                        {item.category === 'sans_categorie' && (
                          <div className='flex items-center gap-1.5'>
                            <select
                              value={draftValues[item.id] ?? 'Épicerie'}
                              onChange={(e) =>
                                setDraftValues((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              className='h-7 rounded border border-[#E1E3E5] bg-white px-2 text-[11px] text-[#202223]'
                            >
                              {OFFICIAL_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                            <Button
                              size='sm'
                              disabled={savingId === item.id}
                              onClick={() => handleInlineFix(item)}
                              className='h-7 bg-[#008060] px-2.5 text-[11px] text-white hover:bg-[#006e52]'
                            >
                              <Check className='mr-1 size-3' />
                              Valider
                            </Button>
                          </div>
                        )}

                        {item.category === 'sans_stock_min' && (
                          <div className='flex items-center gap-1.5'>
                            <Input
                              type='number'
                              min='0.1'
                              step='1'
                              placeholder='Seuil min (ex: 5)'
                              value={draftValues[item.id] ?? '5'}
                              onChange={(e) =>
                                setDraftValues((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              className='h-7 w-24 text-[11px]'
                            />
                            <Button
                              size='sm'
                              disabled={savingId === item.id}
                              onClick={() => handleInlineFix(item)}
                              className='h-7 bg-[#008060] px-2.5 text-[11px] text-white hover:bg-[#006e52]'
                            >
                              <Check className='mr-1 size-3' />
                              Définir
                            </Button>
                          </div>
                        )}

                        {item.category === 'prix_manquant' && (
                          <div className='flex items-center gap-1.5'>
                            <Input
                              type='number'
                              min='0.01'
                              step='0.01'
                              placeholder='Prix DH'
                              value={draftValues[item.id] ?? ''}
                              onChange={(e) =>
                                setDraftValues((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              className='h-7 w-24 text-[11px]'
                            />
                            <Button
                              size='sm'
                              disabled={savingId === item.id}
                              onClick={() => handleInlineFix(item)}
                              className='h-7 bg-[#008060] px-2.5 text-[11px] text-white hover:bg-[#006e52]'
                            >
                              <Check className='mr-1 size-3' />
                              Enregistrer DH
                            </Button>
                          </div>
                        )}

                        {item.category === 'paiement_ambigu' && (
                          <div className='flex items-center gap-1.5'>
                            <Button
                              size='sm'
                              variant='outline'
                              disabled={savingId === item.id}
                              onClick={() => handleInlineFix(item, 'unpaid')}
                              className='h-7 border-[#E1E3E5] px-2 text-[11px]'
                            >
                              Confirmer Impayé
                            </Button>
                            <Button
                              size='sm'
                              disabled={savingId === item.id}
                              onClick={() => handleInlineFix(item, 'paid')}
                              className='h-7 bg-[#008060] px-2 text-[11px] text-white hover:bg-[#006e52]'
                            >
                              Marquer Payé
                            </Button>
                          </div>
                        )}

                        {item.category === 'fournisseur_manquant' && (
                          <div className='flex items-center gap-1.5'>
                            <Input
                              type='text'
                              placeholder='Tél. (optionnel)'
                              value={draftValues[item.id] ?? ''}
                              onChange={(e) =>
                                setDraftValues((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              className='h-7 w-28 text-[11px]'
                            />
                            <Button
                              size='sm'
                              disabled={savingId === item.id}
                              onClick={() => handleInlineFix(item)}
                              className='h-7 bg-[#008060] px-2.5 text-[11px] text-white hover:bg-[#006e52]'
                            >
                              <Check className='mr-1 size-3' />
                              Ajouter à la liste
                            </Button>
                          </div>
                        )}

                        {item.category === 'doublon_potentiel' && (
                          <div className='flex items-center gap-1.5'>
                            <Button
                              size='sm'
                              variant='outline'
                              disabled={savingId === item.id}
                              onClick={() => handleInlineFix(item, 'keep')}
                              className='h-7 border-[#E1E3E5] px-2 text-[11px]'
                            >
                              Conserver (Non-doublon)
                            </Button>
                            <Button
                              size='sm'
                              disabled={savingId === item.id}
                              onClick={() => handleInlineFix(item, 'reverse')}
                              className='h-7 bg-[#D72C0D] px-2 text-[11px] text-white hover:bg-[#b52309]'
                            >
                              Annuler doublon
                            </Button>
                          </div>
                        )}

                        {item.category === 'a_verifier' && (
                          <Button
                            size='sm'
                            disabled={savingId === item.id}
                            onClick={() => handleInlineFix(item)}
                            className='h-7 bg-[#008060] px-2.5 text-[11px] text-white hover:bg-[#006e52]'
                          >
                            <Check className='mr-1 size-3' />
                            Marquer comme vérifié
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Main>
    </>
  )
}
