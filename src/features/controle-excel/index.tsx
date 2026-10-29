import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository as repo } from '@/data'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildMonarqCleanImportWorkbookBuffer } from '@/data/monarq-real-import-dataset'
import {
  buildDefaultImportDecisions,
  executeWorkbookImport,
  parseWorkbookBuffer,
} from '@/lib/excel-import-engine'
import { runExcelParityCheck } from '@/lib/excel-parity-engine'
import { formatDH, formatQty } from '@/lib/formatters'

export function ControleExcelPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'diffs' | 'notes'>('all')
  const [isImportingCleanWorkbook, setIsImportingCleanWorkbook] =
    useState(false)

  const {
    data: report,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['excel-parity-report'],
    queryFn: () => runExcelParityCheck(repo),
  })

  const handleLoadAndImportCleanWorkbook = async () => {
    setIsImportingCleanWorkbook(true)
    try {
      const buffer = buildMonarqCleanImportWorkbookBuffer()
      const parsed = parseWorkbookBuffer(
        buffer,
        'MONARQ_ECONOMAT_import_propre.xlsx'
      )
      const decisions = buildDefaultImportDecisions(parsed)
      // Preserve original category names and treat non-OUI/NON payments as Impayé
      for (const rawCat of Object.keys(decisions.categoryMapping)) {
        decisions.categoryMapping[rawCat] = rawCat
      }
      decisions.ambiguousPaymentDecision = 'unpaid'
      decisions.vatConvention = 'TTC'

      await executeWorkbookImport(parsed, decisions, repo, { dryRun: false })
      await queryClient.invalidateQueries()
      await refetch()
      toast.success(
        'Fichier MONARQ_ECONOMAT_import_propre.xlsx importé avec succès (345 produits, 247 achats, 143 sorties, 119 inventaires, 19 fournisseurs).'
      )
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erreur lors de l’importation'
      )
    } finally {
      setIsImportingCleanWorkbook(false)
    }
  }

  const filteredProducts = useMemo(() => {
    if (!report) return []
    const q = search.trim().toLowerCase()
    return report.productRows.filter((r) => {
      if (filterMode === 'diffs' && !r.hasStrictNumericDiff) return false
      if (
        filterMode === 'notes' &&
        !r.hasStrictNumericDiff &&
        !r.isKnownExcelBlankFormulaCell
      ) {
        return false
      }
      if (!q) return true
      return (
        r.ref.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.categoryApp.toLowerCase().includes(q)
      )
    })
  }, [report, search, filterMode])

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2'>
          <ShieldCheck className='size-4 text-[#008060]' />
          <span className='text-[13px] font-medium text-[#202223]'>
            Contrôle vs Excel (Référence Or)
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
              Contrôle de parité vs Excel (MONARQ_reference_Excel_pour_controle)
            </h1>
            <p className='text-[13px] text-[#6D7175]'>
              Vérification produit par produit (345 références) et KPI par KPI
              entre le moteur de stock de l’application et le fichier Excel de
              référence.
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => refetch()}
              className='h-8 border-[#E1E3E5] bg-white text-[12px] text-[#202223]'
            >
              <RefreshCw className='mr-1.5 size-3.5' />
              Recalculer la parité
            </Button>
            <Button
              size='sm'
              disabled={isImportingCleanWorkbook}
              onClick={handleLoadAndImportCleanWorkbook}
              className='h-8 bg-[#303030] text-[12px] text-white hover:bg-[#1a1a1a]'
            >
              <Play className='mr-1.5 size-3.5' />
              {isImportingCleanWorkbook
                ? 'Import en cours...'
                : 'Importer MONARQ_ECONOMAT_import_propre.xlsx'}
            </Button>
            <Button
              asChild
              variant='outline'
              size='sm'
              className='h-8 border-[#E1E3E5] bg-white text-[12px] text-[#202223]'
            >
              <Link to='/import-export'>
                <FileSpreadsheet className='mr-1.5 size-3.5' />
                Assistant d’import
              </Link>
            </Button>
          </div>
        </div>

        {isLoading || !report ? (
          <div className='rounded-lg border border-[#E1E3E5] bg-white p-8 text-center text-[13px] text-[#6D7175]'>
            Calcul de la parité en cours...
          </div>
        ) : (
          <div className='space-y-5'>
            {/* Final Verdict Banner */}
            <div
              className={`flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4 ${
                report.isParityOk
                  ? 'border-[#008060]/30 bg-[#008060]/5'
                  : 'border-[#D72C0D]/30 bg-[#D72C0D]/5'
              }`}
            >
              <div className='flex items-start gap-3'>
                {report.isParityOk ? (
                  <CheckCircle2 className='mt-0.5 size-5 shrink-0 text-[#008060]' />
                ) : (
                  <AlertTriangle className='mt-0.5 size-5 shrink-0 text-[#D72C0D]' />
                )}
                <div>
                  <div className='flex items-center gap-2'>
                    <span
                      className={`text-[15px] font-semibold ${
                        report.isParityOk ? 'text-[#008060]' : 'text-[#D72C0D]'
                      }`}
                    >
                      Verdict : {report.verdict}
                    </span>
                    <span className='rounded border border-[#E1E3E5] bg-white px-2 py-0.5 text-[11px] font-medium text-[#202223]'>
                      {report.matchedProductsCount} /{' '}
                      {report.totalGoldenProducts} produits conformes (tolérance
                      ±0,01)
                    </span>
                  </div>
                  <p className='mt-1 text-[12px] text-[#6D7175]'>
                    {report.totalAppProducts === 0
                      ? 'La base est actuellement vide. Cliquez sur « Importer MONARQ_ECONOMAT_import_propre.xlsx » ou passez par l’assistant d’import pour charger vos données réelles.'
                      : 'Toutes les formules (Prix U moyen pondéré sur achats valorisés, Stock final avec coupure stricte après date d’inventaire, Valeur du stock et KPIs Dashboard) sont comparées sans aucun ajustement artificiel.'}
                  </p>
                </div>
              </div>
              <div className='flex items-center gap-4 text-right text-[12px]'>
                <div>
                  <div className='text-[#6D7175]'>Inventaires confirmés</div>
                  <div className='font-semibold text-[#202223]'>
                    {report.inventoryParitySummary.totalCountLines} lignes (
                    {report.inventoryParitySummary.countsOn2026_10_13} au
                    13/10/2026,{' '}
                    {report.inventoryParitySummary.countsOn2026_10_22} au
                    22/10/2026)
                  </div>
                </div>
              </div>
            </div>

            {/* 6 Dashboard KPIs Side-by-Side */}
            <div className='rounded-lg border border-[#E1E3E5] bg-white p-4'>
              <h2 className='mb-3 text-[14px] font-semibold text-[#202223]'>
                1. Comparaison des 6 KPIs du Tableau de bord (Application vs
                Excel Référence)
              </h2>
              <div className='overflow-x-auto'>
                <table className='w-full border-collapse text-left text-[12px]'>
                  <thead>
                    <tr className='border-b border-[#E1E3E5] bg-[#F6F6F7] text-[#6D7175]'>
                      <th className='px-3 py-2 font-medium'>Indicateur KPI</th>
                      <th className='px-3 py-2 text-right font-medium'>
                        Valeur Application
                      </th>
                      <th className='px-3 py-2 text-right font-medium'>
                        Valeur Excel (Réf. Or)
                      </th>
                      <th className='px-3 py-2 text-right font-medium'>
                        Écart
                      </th>
                      <th className='px-3 py-2 font-medium'>Statut</th>
                      <th className='px-3 py-2 font-medium'>
                        Règle / Explication
                      </th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-[#E1E3E5]'>
                    {report.kpis.map((kpi) => (
                      <tr key={kpi.key} className='hover:bg-[#F6F6F7]/50'>
                        <td className='px-3 py-2.5 font-medium text-[#202223]'>
                          {kpi.label}
                        </td>
                        <td className='px-3 py-2.5 text-right font-mono font-semibold text-[#202223]'>
                          {kpi.unit === 'DH'
                            ? formatDH(kpi.appValue)
                            : kpi.appValue}
                        </td>
                        <td className='px-3 py-2.5 text-right font-mono text-[#202223]'>
                          {kpi.unit === 'DH'
                            ? formatDH(kpi.excelValue)
                            : kpi.excelValue}
                        </td>
                        <td className='px-3 py-2.5 text-right font-mono text-[#6D7175]'>
                          {kpi.unit === 'DH'
                            ? formatDH(kpi.diff)
                            : kpi.diff > 0
                              ? `+${kpi.diff}`
                              : kpi.diff}
                        </td>
                        <td className='px-3 py-2.5'>
                          {kpi.matches ? (
                            <span className='inline-flex items-center gap-1 rounded bg-[#008060]/10 px-2 py-0.5 text-[11px] font-medium text-[#008060]'>
                              Conforme
                            </span>
                          ) : (
                            <span className='inline-flex items-center gap-1 rounded bg-[#D72C0D]/10 px-2 py-0.5 text-[11px] font-medium text-[#D72C0D]'>
                              Écart
                            </span>
                          )}
                        </td>
                        <td className='px-3 py-2.5 text-[#6D7175]'>
                          {kpi.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Stock Minimum Discrepancy & Exit Valuation Comparison */}
            <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
              <div className='rounded-lg border border-[#E1E3E5] bg-white p-4'>
                <h2 className='mb-2 text-[14px] font-semibold text-[#202223]'>
                  2. Statuts de stock : Base Produits vs Feuille Etat Stock
                  (Étape 2f)
                </h2>
                <p className='mb-3 text-[12px] text-[#6D7175]'>
                  Dans Excel, la feuille « Etat Stock » a la colonne Stock
                  minimum vide/0 (donc 345 « À définir » et 0 produit critique).
                  L’application utilise les seuils de « Base Produits » (243
                  renseignés, 102 vides) :
                </p>
                <div className='grid grid-cols-4 gap-2 text-center text-[12px]'>
                  <div className='rounded border border-[#E1E3E5] bg-[#F6F6F7] p-2.5'>
                    <div className='text-[11px] text-[#6D7175]'>ALERTE</div>
                    <div className='mt-0.5 text-[16px] font-semibold text-[#D72C0D]'>
                      {report.statusBreakdownApp.Alerte}
                    </div>
                    <div className='text-[10px] text-[#6D7175]'>
                      Excel : {report.statusBreakdownExcel.Alerte}
                    </div>
                  </div>
                  <div className='rounded border border-[#E1E3E5] bg-[#F6F6F7] p-2.5'>
                    <div className='text-[11px] text-[#6D7175]'>
                      À SURVEILLER
                    </div>
                    <div className='mt-0.5 text-[16px] font-semibold text-[#B98900]'>
                      {report.statusBreakdownApp['À surveiller']}
                    </div>
                    <div className='text-[10px] text-[#6D7175]'>
                      Excel : {report.statusBreakdownExcel['À surveiller']}
                    </div>
                  </div>
                  <div className='rounded border border-[#E1E3E5] bg-[#F6F6F7] p-2.5'>
                    <div className='text-[11px] text-[#6D7175]'>OK</div>
                    <div className='mt-0.5 text-[16px] font-semibold text-[#008060]'>
                      {report.statusBreakdownApp.OK}
                    </div>
                    <div className='text-[10px] text-[#6D7175]'>
                      Excel : {report.statusBreakdownExcel.OK}
                    </div>
                  </div>
                  <div className='rounded border border-[#E1E3E5] bg-[#F6F6F7] p-2.5'>
                    <div className='text-[11px] text-[#6D7175]'>À DÉFINIR</div>
                    <div className='mt-0.5 text-[16px] font-semibold text-[#202223]'>
                      {report.statusBreakdownApp['À définir']}
                    </div>
                    <div className='text-[10px] text-[#6D7175]'>
                      Excel : {report.statusBreakdownExcel['À définir']}
                    </div>
                  </div>
                </div>
              </div>

              <div className='rounded-lg border border-[#E1E3E5] bg-white p-4'>
                <h2 className='mb-2 text-[14px] font-semibold text-[#202223]'>
                  3. Valorisation des sorties : Prix moyen actuel vs Coût figé
                  (Étape 2d)
                </h2>
                <p className='mb-3 text-[12px] text-[#6D7175]'>
                  Excel valorise chaque sortie au prix unitaire moyen actuel du
                  produit ({formatDH(report.exitValuationComparison.totalDynamicCurrentAvgDh)}
                  ). Comparaison avec le coût figé au moment de la sortie
                  (snapshot) :
                </p>
                <div className='grid grid-cols-3 gap-2 text-center text-[12px]'>
                  <div className='rounded border border-[#E1E3E5] bg-[#F6F6F7] p-2.5'>
                    <div className='text-[11px] text-[#6D7175]'>
                      Prix moyen actuel (Excel)
                    </div>
                    <div className='mt-0.5 font-mono text-[14px] font-semibold text-[#202223]'>
                      {formatDH(
                        report.exitValuationComparison.totalDynamicCurrentAvgDh
                      )}
                    </div>
                  </div>
                  <div className='rounded border border-[#E1E3E5] bg-[#F6F6F7] p-2.5'>
                    <div className='text-[11px] text-[#6D7175]'>
                      Snapshot figé à la sortie
                    </div>
                    <div className='mt-0.5 font-mono text-[14px] font-semibold text-[#202223]'>
                      {formatDH(
                        report.exitValuationComparison.totalFrozenSnapshotDh
                      )}
                    </div>
                  </div>
                  <div className='rounded border border-[#E1E3E5] bg-[#F6F6F7] p-2.5'>
                    <div className='text-[11px] text-[#6D7175]'>
                      Différence totale
                    </div>
                    <div className='mt-0.5 font-mono text-[14px] font-semibold text-[#202223]'>
                      {formatDH(report.exitValuationComparison.totalDiffDh)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Explained Note on Row 218 (p217) or Differing Rows */}
            {(report.differingRows.length > 0 ||
              report.explainedNotesRows.length > 0) && (
              <div className='rounded-lg border border-[#E1E3E5] bg-white p-4'>
                <h2 className='mb-2 text-[14px] font-semibold text-[#202223]'>
                  4. Anomalies de formules Excel identifiées et écarts éventuels
                </h2>
                <div className='overflow-x-auto'>
                  <table className='w-full border-collapse text-left text-[12px]'>
                    <thead>
                      <tr className='border-b border-[#E1E3E5] bg-[#F6F6F7] text-[#6D7175]'>
                        <th className='px-3 py-2 font-medium'>Réf.</th>
                        <th className='px-3 py-2 font-medium'>Produit</th>
                        <th className='px-3 py-2 text-right font-medium'>
                          Sorties App / Excel
                        </th>
                        <th className='px-3 py-2 text-right font-medium'>
                          Stock final App / Excel
                        </th>
                        <th className='px-3 py-2 text-right font-medium'>
                          Valeur App / Excel
                        </th>
                        <th className='px-3 py-2 font-medium'>
                          Cause exacte identifiée
                        </th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-[#E1E3E5]'>
                      {[
                        ...report.differingRows,
                        ...report.explainedNotesRows,
                      ].map((r) => (
                        <tr key={r.canonicalRef}>
                          <td className='px-3 py-2 font-mono font-semibold text-[#202223]'>
                            {r.ref}
                          </td>
                          <td className='px-3 py-2 text-[#202223]'>{r.name}</td>
                          <td className='px-3 py-2 text-right font-mono'>
                            {formatQty(r.sortiesApp)} /{' '}
                            {r.sortiesExcelRawCell === ''
                              ? 'Vide ("")'
                              : formatQty(r.sortiesExcel)}
                          </td>
                          <td className='px-3 py-2 text-right font-mono'>
                            {formatQty(r.stockFinalApp)} /{' '}
                            {formatQty(r.stockFinalExcel)}
                          </td>
                          <td className='px-3 py-2 text-right font-mono'>
                            {formatDH(r.valeurStockApp)} /{' '}
                            {formatDH(r.valeurStockExcel)}
                          </td>
                          <td className='px-3 py-2 text-[#6D7175]'>
                            {r.causeExplanation}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Full 345-Product Parity Table */}
            <div className='rounded-lg border border-[#E1E3E5] bg-white p-4'>
              <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
                <h2 className='text-[14px] font-semibold text-[#202223]'>
                  5. Table complète de contrôle produit par produit (
                  {filteredProducts.length} / {report.totalGoldenProducts})
                </h2>
                <div className='flex flex-wrap items-center gap-2'>
                  <div className='relative w-64'>
                    <Search className='pointer-events-none absolute top-2 left-2.5 size-3.5 text-[#6D7175]' />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder='Rechercher réf. ou produit...'
                      className='h-8 pl-8 text-[12px]'
                    />
                  </div>
                  <div className='flex rounded border border-[#E1E3E5] bg-[#F6F6F7] p-0.5 text-[11px]'>
                    <button
                      type='button'
                      onClick={() => setFilterMode('all')}
                      className={`rounded px-2.5 py-1 font-medium ${
                        filterMode === 'all'
                          ? 'bg-white text-[#202223] shadow-xs'
                          : 'text-[#6D7175]'
                      }`}
                    >
                      Tous ({report.productRows.length})
                    </button>
                    <button
                      type='button'
                      onClick={() => setFilterMode('diffs')}
                      className={`rounded px-2.5 py-1 font-medium ${
                        filterMode === 'diffs'
                          ? 'bg-white text-[#202223] shadow-xs'
                          : 'text-[#6D7175]'
                      }`}
                    >
                      Écarts stricts ({report.strictDiffProductsCount})
                    </button>
                    <button
                      type='button'
                      onClick={() => setFilterMode('notes')}
                      className={`rounded px-2.5 py-1 font-medium ${
                        filterMode === 'notes'
                          ? 'bg-white text-[#202223] shadow-xs'
                          : 'text-[#6D7175]'
                      }`}
                    >
                      Notes Excel ({report.explainedNotesRows.length})
                    </button>
                  </div>
                </div>
              </div>

              <div className='max-h-[540px] overflow-auto border border-[#E1E3E5]'>
                <table className='w-full border-collapse text-left text-[12px]'>
                  <thead className='sticky top-0 z-10 bg-[#F6F6F7] text-[#6D7175]'>
                    <tr className='border-b border-[#E1E3E5]'>
                      <th className='px-2.5 py-2 font-medium'>Réf.</th>
                      <th className='px-2.5 py-2 font-medium'>Produit</th>
                      <th className='px-2.5 py-2 text-right font-medium'>
                        Entrées (App / Excel)
                      </th>
                      <th className='px-2.5 py-2 text-right font-medium'>
                        Sorties (App / Excel)
                      </th>
                      <th className='px-2.5 py-2 text-right font-medium'>
                        Stock final (App / Excel)
                      </th>
                      <th className='px-2.5 py-2 text-right font-medium'>
                        Prix U moyen (App / Excel)
                      </th>
                      <th className='px-2.5 py-2 text-right font-medium'>
                        Valeur stock (App / Excel)
                      </th>
                      <th className='px-2.5 py-2 font-medium'>
                        Statut (App / Excel)
                      </th>
                      <th className='px-2.5 py-2 font-medium'>Parité</th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-[#E1E3E5]'>
                    {filteredProducts.map((r) => (
                      <tr
                        key={r.canonicalRef}
                        className={
                          r.hasStrictNumericDiff
                            ? 'bg-[#D72C0D]/5'
                            : r.isKnownExcelBlankFormulaCell
                              ? 'bg-[#B98900]/5'
                              : 'hover:bg-[#F6F6F7]/50'
                        }
                      >
                        <td className='px-2.5 py-1.5 font-mono font-medium text-[#202223]'>
                          {r.ref}
                        </td>
                        <td className='px-2.5 py-1.5 text-[#202223]'>
                          {r.name}
                        </td>
                        <td className='px-2.5 py-1.5 text-right font-mono'>
                          {formatQty(r.entreesApp)} /{' '}
                          {formatQty(r.entreesExcel)}
                        </td>
                        <td className='px-2.5 py-1.5 text-right font-mono'>
                          {formatQty(r.sortiesApp)} /{' '}
                          {r.sortiesExcelRawCell === ''
                            ? '""'
                            : formatQty(r.sortiesExcel)}
                        </td>
                        <td className='px-2.5 py-1.5 text-right font-mono font-semibold text-[#202223]'>
                          {formatQty(r.stockFinalApp)} /{' '}
                          {formatQty(r.stockFinalExcel)}
                        </td>
                        <td className='px-2.5 py-1.5 text-right font-mono'>
                          {r.prixMoyenApp.toFixed(2)} /{' '}
                          {r.prixMoyenExcel.toFixed(2)}
                        </td>
                        <td className='px-2.5 py-1.5 text-right font-mono font-medium text-[#202223]'>
                          {r.valeurStockApp.toFixed(2)} /{' '}
                          {r.valeurStockExcel.toFixed(2)}
                        </td>
                        <td className='px-2.5 py-1.5 text-[11px] text-[#6D7175]'>
                          {r.statusApp} / {r.statusExcel}
                        </td>
                        <td className='px-2.5 py-1.5'>
                          {!r.hasStrictNumericDiff ? (
                            <span className='inline-flex rounded bg-[#008060]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#008060]'>
                              OK
                            </span>
                          ) : (
                            <span className='inline-flex rounded bg-[#D72C0D]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#D72C0D]'>
                              Écart
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Main>
    </>
  )
}
