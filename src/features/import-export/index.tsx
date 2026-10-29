import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  Upload,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { repository } from '@/data'
import { invalidateDashboardAnalyticsCache } from '@/data/analytics'
import type { VatConvention } from '@/data/types'
import { triggerManualBackupDownload } from '@/lib/backup-export'
import { useNavigate } from '@tanstack/react-router'
import {
  type DataQualityCategory,
  type ImportSheetKey,
  type ImportUserDecisions,
  type IssueSeverity,
  type ParsedWorkbookResult,
  type ReconciliationReport,
  buildReconciliationCsv,
  computeDatabaseQualityReport,
  executeWorkbookImport,
  exportCollectionFile,
  exportDataQualityReportFile,
  exportFullWorkbookMirror,
  parseAndValidateWorkbook,
} from '@/lib/excel-import-engine'
import { formatDateTimeFR, formatMAD } from '@/lib/format'
import { canRunExcelImport } from '@/lib/rbac'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageShell } from '@/components/layout/page-shell'

const WIZARD_STEPS = [
  { step: 1, title: '1. Fichier Excel' },
  { step: 2, title: '2. Aperçu des feuilles' },
  { step: 3, title: '3. Validation & Règles' },
  { step: 4, title: '4. Décisions' },
  { step: 5, title: '5. Import / Simulation' },
  { step: 6, title: '6. Réconciliation' },
] as const

const PREVIEW_PAGE_SIZE = 15

export function ImportExport() {
  const { auth } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const allowedToImport = canRunExcelImport(auth.user?.role)

  const [activeTab, setActiveTab] = useState<'wizard' | 'export' | 'quality'>('wizard')
  const [qualityFilter, setQualityFilter] = useState<DataQualityCategory | 'ALL'>('ALL')
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [parsingFile, setParsingFile] = useState(false)
  const [parsedWorkbook, setParsedWorkbook] =
    useState<ParsedWorkbookResult | null>(null)

  // Step 2 Preview state
  const [previewSheet, setPreviewSheet] =
    useState<ImportSheetKey>('Base Produits')
  const [previewSearch, setPreviewSearch] = useState('')
  const [previewPage, setPreviewPage] = useState(1)

  // Step 3 Validation filter state
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | 'ALL'>(
    'ALL'
  )
  const [sheetFilter, setSheetFilter] = useState<ImportSheetKey | 'ALL'>('ALL')

  // Step 3 & 4 Decisions state
  const [decisions, setDecisions] = useState<ImportUserDecisions>({
    vatConvention: 'TTC',
    vatConfirmed: true,
    categoryMapping: {},
    supplierChoices: {},
    duplicateDecisions: {},
    updateExistingProducts: false,
    updateExistingSuppliers: false,
    fallbackInventoryDate: new Date().toISOString().slice(0, 10),
  })

  // Step 5 Execution progress state
  const [isRunningImport, setIsRunningImport] = useState(false)
  const [progressPct, setProgressPct] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')

  // Step 6 Reconciliation report state
  const [reconciliationReport, setReconciliationReport] =
    useState<ReconciliationReport | null>(null)

  // Batch reversal confirmation modal
  const [batchToReverse, setBatchToReverse] = useState<string | null>(null)
  const [reversingBatch, setReversingBatch] = useState(false)

  const { data: importBatches = [], refetch: refetchBatches } = useQuery({
    queryKey: ['import_batches'],
    queryFn: () => repository.listImportBatches(),
  })

  const { data: qualityReport } = useQuery({
    queryKey: ['data-quality-report'],
    queryFn: () => computeDatabaseQualityReport(repository),
  })

  async function handleFileSelected(file: File) {
    if (!file.name.match(/\.(xlsx|xlsm)$/i)) {
      toast.error(
        'Format non pris en charge. Veuillez sélectionner un classeur .xlsx ou .xlsm.'
      )
      return
    }
    setParsingFile(true)
    try {
      const buffer = await file.arrayBuffer()
      // Yield to UI before parsing large sheets
      await new Promise((r) => setTimeout(r, 20))
      const result = parseAndValidateWorkbook(buffer, file.name, file.size)
      setParsedWorkbook(result)
      setDecisions({
        vatConvention: 'TTC',
        vatConfirmed: true,
        categoryMapping: { ...result.defaultCategoryMapping },
        supplierChoices: { ...result.defaultSupplierChoices },
        duplicateDecisions: { ...result.defaultDuplicateDecisions },
        updateExistingProducts: false,
        updateExistingSuppliers: false,
        fallbackInventoryDate:
          result.distinctInventoryDates[0] ||
          new Date().toISOString().slice(0, 10),
      })
      setReconciliationReport(null)
      setPreviewPage(1)
      toast.success(`Fichier « ${file.name} » analysé avec succès.`)
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Impossible de lire ce classeur Excel.'
      )
    } finally {
      setParsingFile(false)
    }
  }

  async function handleRunImport(dryRun: boolean) {
    if (!parsedWorkbook) return
    if (!decisions.vatConfirmed) {
      toast.error(
        'Veuillez confirmer la convention de prix (TTC / HT) à l’étape 4 avant de continuer.'
      )
      setCurrentStep(4)
      return
    }

    setIsRunningImport(true)
    setProgressPct(5)
    setProgressLabel(
      dryRun
        ? 'Simulation à blanc en cours...'
        : 'Importation transactionnelle en cours...'
    )

    try {
      // Allow UI to render progress bar
      await new Promise((r) => setTimeout(r, 30))
      const report = await executeWorkbookImport(
        parsedWorkbook,
        decisions,
        repository,
        {
          dryRun,
          onProgress: (pct, label) => {
            setProgressPct(pct)
            setProgressLabel(label)
          },
        }
      )

      setReconciliationReport(report)
      setCurrentStep(6)

      if (!dryRun) {
        invalidateDashboardAnalyticsCache()
        await queryClient.invalidateQueries()
        await refetchBatches()
        toast.success('Importation Excel terminée', {
          description: `${report.totalProductsInDb} produits et ${report.totalPurchaseAmountImported.toFixed(2)} DH d’achats réconciliés.`,
        })
      } else {
        toast.info('Simulation terminée (aucune écriture en base)', {
          description:
            'Consultez le rapport de réconciliation simulé à l’étape 6.',
        })
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Erreur lors de l’exécution de l’importation.'
      )
    } finally {
      setIsRunningImport(false)
    }
  }

  function handleDownloadReconciliationCsv() {
    if (!reconciliationReport) return
    const csv = buildReconciliationCsv(reconciliationReport)
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rapport-reconciliation-${reconciliationReport.sourceId}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleConfirmReverseBatch() {
    if (!batchToReverse) return
    setReversingBatch(true)
    try {
      await repository.reverseImportBatch(
        batchToReverse,
        'Annulation complète du lot via l’assistant Import / Export'
      )
      invalidateDashboardAnalyticsCache()
      await queryClient.invalidateQueries()
      await refetchBatches()
      toast.success(
        'Lot d’importation annulé par écritures de contre-passation (aucune suppression physique).'
      )
      setBatchToReverse(null)
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Impossible d’annuler ce lot d’importation.'
      )
    } finally {
      setReversingBatch(false)
    }
  }

  async function handleExportCollection(
    col: 'products' | 'suppliers' | 'purchases' | 'exits' | 'inventories',
    fmt: 'xlsx' | 'csv'
  ) {
    try {
      await exportCollectionFile(repository, col, fmt)
      toast.success(`Export ${col} (.${fmt}) téléchargé.`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erreur lors de l’export.'
      )
    }
  }

  // Filter issues for Step 3
  const filteredIssues = (parsedWorkbook?.issues ?? []).filter((iss) => {
    if (severityFilter !== 'ALL' && iss.severity !== severityFilter)
      return false
    if (sheetFilter !== 'ALL' && iss.sheet !== sheetFilter) return false
    return true
  })

  const blockingCount =
    parsedWorkbook?.issues.filter((i) => i.severity === 'BLOQUANT').length ?? 0
  const warningCount =
    parsedWorkbook?.issues.filter((i) => i.severity === 'À VÉRIFIER').length ??
    0
  const infoCount =
    parsedWorkbook?.issues.filter((i) => i.severity === 'INFO').length ?? 0

  const duplicateCandidates = [
    ...(parsedWorkbook?.purchases
      .filter((p) => p.isDuplicateCandidate)
      .map((p) => ({
        sheet: 'Entrées Stock' as const,
        rowNumber: p.rowNumber,
        sourceRowId: p.sourceRowId,
        date: p.date ?? p.rawDate,
        ref: p.canonicalRef,
        name: p.productName,
        qty: p.qty ?? 0,
        partner: p.rawSupplier,
      })) ?? []),
    ...(parsedWorkbook?.exits
      .filter((x) => x.isDuplicateCandidate)
      .map((x) => ({
        sheet: 'Sorties Stock' as const,
        rowNumber: x.rowNumber,
        sourceRowId: x.sourceRowId,
        date: x.date ?? x.rawDate,
        ref: x.canonicalRef,
        name: x.productName,
        qty: x.qtyConsumed + x.qtyWasted,
        partner: x.destination,
      })) ?? []),
  ]

  return (
    <PageShell
      section='SYSTÈME'
      title='Import / Export'
      description='Assistant de migration idempotent du classeur MONARQ_ECONOMAT (.xlsx/.xlsm), réconciliation financière et export multi-format.'
      primaryAction={{
        label: 'Exporter une sauvegarde JSON',
        onClick: () => void triggerManualBackupDownload(),
        icon: Download,
      }}
    >
      {!allowedToImport ? (
        <Card className='p-6'>
          <div className='flex items-center gap-3 text-[#D72C0D]'>
            <ShieldAlert className='h-5 w-5' />
            <p className='text-sm font-semibold'>
              Accès réservé aux rôles Administrateur et Manager.
            </p>
          </div>
        </Card>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'wizard' | 'export' | 'quality')}
          className='space-y-4'
        >
          <TabsList>
            <TabsTrigger value='wizard'>
              Assistant d’importation Excel (6 étapes)
            </TabsTrigger>
            <TabsTrigger value='quality'>
              À corriger — Qualité des données ({qualityReport?.counts.total ?? 0})
            </TabsTrigger>
            <TabsTrigger value='export'>
              Export (.xlsx / .csv) & Lots importés ({importBatches.length})
            </TabsTrigger>
          </TabsList>

          {/* ================================================================
              TAB 1: 6-STEP EXCEL IMPORT WIZARD
             ================================================================ */}
          <TabsContent value='wizard' className='space-y-4'>
            {/* Stepper Header */}
            <Card className='gap-0 py-3 px-4 shadow-none'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div className='flex flex-wrap items-center gap-1.5'>
                  {WIZARD_STEPS.map((s) => {
                    const isActive = currentStep === s.step
                    const isCompleted =
                      parsedWorkbook !== null && currentStep > s.step
                    const isDisabled = !parsedWorkbook && s.step > 1
                    return (
                      <Button
                        key={s.step}
                        type='button'
                        size='sm'
                        variant={
                          isActive
                            ? 'default'
                            : isCompleted
                              ? 'secondary'
                              : 'outline'
                        }
                        className='h-8 text-xs'
                        disabled={isDisabled}
                        onClick={() => setCurrentStep(s.step)}
                      >
                        {s.title}
                      </Button>
                    )
                  })}
                </div>

                <div className='flex items-center gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    className='h-8 text-xs'
                    disabled={currentStep <= 1}
                    onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
                  >
                    <ArrowLeft className='mr-1 h-3.5 w-3.5' />
                    Précédent
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    className='h-8 text-xs'
                    disabled={!parsedWorkbook || currentStep >= 6}
                    onClick={() => setCurrentStep((prev) => Math.min(6, prev + 1))}
                  >
                    Suivant
                    <ArrowRight className='ml-1 h-3.5 w-3.5' />
                  </Button>
                </div>
              </div>
            </Card>

            {/* STEP 1: UPLOAD */}
            {currentStep === 1 && (
              <div className='space-y-4'>
                <Card className='gap-0 py-0 shadow-none'>
                  <CardHeader className='border-b border-border px-4 py-3'>
                    <CardTitle className='text-sm font-semibold'>
                      Étape 1 — Chargement du classeur Excel (.xlsx / .xlsm)
                    </CardTitle>
                    <CardDescription className='text-xs'>
                      Le fichier est analysé en lecture seule (aucune
                      modification du fichier d’origine). Les valeurs calculées
                      des formules (ex. =35*1.2 → 42 DH) sont extraites et les
                      lignes vides de modèle ainsi que JOURNAL STOCK / Macro1
                      sont ignorées.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='p-6'>
                    <input
                      ref={fileInputRef}
                      type='file'
                      accept='.xlsx,.xlsm'
                      className='hidden'
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void handleFileSelected(f)
                      }}
                    />
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        const f = e.dataTransfer.files?.[0]
                        if (f) void handleFileSelected(f)
                      }}
                      className='flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-8 text-center'
                    >
                      <FileSpreadsheet className='mb-3 h-8 w-8 text-muted-foreground' />
                      <p className='text-sm font-semibold'>
                        Sélectionnez ou glissez votre fichier MONARQ_ECONOMAT
                        (.xlsx ou .xlsm)
                      </p>
                      <p className='mt-1 max-w-lg text-xs text-muted-foreground'>
                        Feuilles lues : Base Produits, Entrées Stock, Sorties
                        Stock, Inventaire, fournisseur, Parametres. Feuilles
                        ignorées : JOURNAL STOCK, Macro1, Dashboard, Etat Stock,
                        Guide.
                      </p>
                      <Button
                        type='button'
                        size='sm'
                        className='mt-4'
                        disabled={parsingFile}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {parsingFile ? (
                          <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
                        ) : (
                          <Upload className='mr-1.5 h-4 w-4' />
                        )}
                        Choisir un fichier .xlsx / .xlsm
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {parsedWorkbook && (
                  <Card className='gap-0 py-0 shadow-none'>
                    <CardHeader className='border-b border-border px-4 py-3'>
                      <div className='flex flex-wrap items-center justify-between gap-2'>
                        <div>
                          <CardTitle className='text-sm font-semibold'>
                            Diagnostic du classeur : {parsedWorkbook.fileName}
                          </CardTitle>
                          <CardDescription className='text-xs'>
                            {parsedWorkbook.sheetsFound.length} feuilles
                            détectées —{' '}
                            {parsedWorkbook.ignoredSheetsFound.length > 0
                              ? `Feuilles ignorées : ${parsedWorkbook.ignoredSheetsFound.join(', ')}`
                              : 'Aucune feuille archivée ignorée'}
                          </CardDescription>
                        </div>
                        <Button
                          size='sm'
                          onClick={() => setCurrentStep(2)}
                          className='h-8 text-xs'
                        >
                          Passer à l’aperçu (Étape 2)
                          <ArrowRight className='ml-1 h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className='space-y-3 p-0'>
                      {parsedWorkbook.missingExpectedSheets.length > 0 && (
                        <div className='mx-4 mt-3 flex items-center gap-2 rounded-md border border-[#B98900]/40 bg-[#B98900]/10 p-3 text-xs text-[#B98900]'>
                          <AlertTriangle className='h-4 w-4 shrink-0' />
                          <span>
                            Feuille(s) attendue(s) absente(s) du classeur :{' '}
                            <strong>
                              {parsedWorkbook.missingExpectedSheets.join(', ')}
                            </strong>
                          </span>
                        </div>
                      )}

                      <Table>
                        <TableHeader>
                          <TableRow className='bg-muted/40'>
                            <TableHead className='px-4'>
                              Nom de la feuille
                            </TableHead>
                            <TableHead>Classification</TableHead>
                            <TableHead className='text-right'>
                              Lignes totales (avec modèle vide)
                            </TableHead>
                            <TableHead className='text-right'>
                              Lignes réelles retenues
                            </TableHead>
                            <TableHead className='px-4'>
                              Colonnes / Statut
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parsedWorkbook.sheetSummaries.map((s) => (
                            <TableRow key={s.sheetName}>
                              <TableCell className='px-4 font-medium text-xs'>
                                {s.sheetName}
                              </TableCell>
                              <TableCell>
                                {s.recognizedAs === 'IGNORED' ? (
                                  <Badge variant='outline' className='text-xs'>
                                    Ignorée (Archive / Formules)
                                  </Badge>
                                ) : s.recognizedAs === 'UNKNOWN' ? (
                                  <Badge variant='outline' className='text-xs'>
                                    Non utilisée
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant='secondary'
                                    className='text-xs'
                                  >
                                    {s.recognizedAs}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className='text-right tabular-nums text-xs text-muted-foreground'>
                                {s.totalSheetRows}
                              </TableCell>
                              <TableCell className='text-right tabular-nums text-xs font-semibold'>
                                {s.realDataRows}
                              </TableCell>
                              <TableCell className='px-4 text-xs'>
                                {s.missingColumns.length > 0 ? (
                                  <span className='text-[#D72C0D]'>
                                    Colonnes manquantes :{' '}
                                    {s.missingColumns.join(', ')}
                                  </span>
                                ) : s.recognizedAs === 'IGNORED' ? (
                                  <span className='text-muted-foreground'>
                                    Exclue pour éviter tout double comptage
                                  </span>
                                ) : (
                                  <span className='text-[#008060]'>
                                    Structure conforme
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* STEP 2: PREVIEW */}
            {currentStep === 2 && parsedWorkbook && (
              <Card className='gap-0 py-0 shadow-none'>
                <CardHeader className='border-b border-border px-4 py-3'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <div>
                      <CardTitle className='text-sm font-semibold'>
                        Étape 2 — Aperçu des données détectées par feuille
                      </CardTitle>
                      <CardDescription className='text-xs'>
                        Vérifiez les valeurs extraites (les lignes de modèle
                        vides en bas de feuille ont été automatiquement
                        filtrées).
                      </CardDescription>
                    </div>
                    <div className='flex items-center gap-2'>
                      <div className='relative w-60'>
                        <Search className='absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground' />
                        <Input
                          placeholder='Rechercher réf, produit, fournisseur...'
                          value={previewSearch}
                          onChange={(e) => {
                            setPreviewSearch(e.target.value)
                            setPreviewPage(1)
                          }}
                          className='h-8 pl-8 text-xs'
                        />
                      </div>
                    </div>
                  </div>

                  <div className='mt-3 flex flex-wrap gap-1.5'>
                    {(
                      [
                        [
                          'Base Produits',
                          parsedWorkbook.products.length,
                        ] as const,
                        [
                          'Entrées Stock',
                          parsedWorkbook.purchases.length,
                        ] as const,
                        ['Sorties Stock', parsedWorkbook.exits.length] as const,
                        [
                          'Inventaire',
                          parsedWorkbook.inventories.length,
                        ] as const,
                        [
                          'fournisseur',
                          parsedWorkbook.suppliers.length,
                        ] as const,
                      ]
                    ).map(([sheetKey, count]) => (
                      <Button
                        key={sheetKey}
                        type='button'
                        size='sm'
                        variant={
                          previewSheet === sheetKey ? 'default' : 'outline'
                        }
                        className='h-7 text-xs'
                        onClick={() => {
                          setPreviewSheet(sheetKey)
                          setPreviewPage(1)
                        }}
                      >
                        {sheetKey} ({count})
                      </Button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className='p-0'>
                  <PreviewSheetTable
                    parsed={parsedWorkbook}
                    sheet={previewSheet}
                    search={previewSearch}
                    page={previewPage}
                    onPageChange={setPreviewPage}
                  />
                </CardContent>
              </Card>
            )}

            {/* STEP 3: VALIDATION & MAPPING */}
            {currentStep === 3 && parsedWorkbook && (
              <div className='space-y-4'>
                {/* Summary KPI row */}
                <div className='grid gap-3 sm:grid-cols-3'>
                  <Card className='gap-1 p-3 shadow-none'>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs font-medium text-muted-foreground'>
                        BLOQUANT (lignes non importables)
                      </span>
                      <XCircle className='h-4 w-4 text-[#D72C0D]' />
                    </div>
                    <p className='text-xl font-bold tabular-nums text-[#D72C0D]'>
                      {blockingCount}
                    </p>
                  </Card>
                  <Card className='gap-1 p-3 shadow-none'>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs font-medium text-muted-foreground'>
                        À VÉRIFIER (importées avec signalement)
                      </span>
                      <AlertTriangle className='h-4 w-4 text-[#B98900]' />
                    </div>
                    <p className='text-xl font-bold tabular-nums text-[#B98900]'>
                      {warningCount}
                    </p>
                  </Card>
                  <Card className='gap-1 p-3 shadow-none'>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs font-medium text-muted-foreground'>
                        INFO (seuils « À définir » & rapprochements)
                      </span>
                      <Info className='h-4 w-4 text-muted-foreground' />
                    </div>
                    <p className='text-xl font-bold tabular-nums'>
                      {infoCount}
                    </p>
                  </Card>
                </div>

                {/* Category Mapping Table */}
                <Card className='gap-0 py-0 shadow-none'>
                  <CardHeader className='border-b border-border px-4 py-3'>
                    <CardTitle className='text-sm font-semibold'>
                       harmonisation des catégories ({parsedWorkbook.distinctProductCategories.length} catégories distinctes)
                    </CardTitle>
                    <CardDescription className='text-xs'>
                      Aucune catégorie n’est renommée silencieusement. Vous
                      pouvez fusionner ou corriger les libellés ci-dessous avant
                      l’importation.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='p-4'>
                    <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                      {parsedWorkbook.distinctProductCategories.map((rawCat) => (
                        <div
                          key={rawCat}
                          className='flex items-center gap-2 rounded-md border border-border p-2 text-xs'
                        >
                          <span className='w-1/2 truncate font-medium'>
                            {rawCat}
                          </span>
                          <span className='text-muted-foreground'>→</span>
                          <Input
                            value={decisions.categoryMapping[rawCat] ?? rawCat}
                            onChange={(e) =>
                              setDecisions((prev) => ({
                                ...prev,
                                categoryMapping: {
                                  ...prev.categoryMapping,
                                  [rawCat]: e.target.value,
                                },
                              }))
                            }
                            className='h-7 text-xs'
                          />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Supplier Resolution Table */}
                <Card className='gap-0 py-0 shadow-none'>
                  <CardHeader className='border-b border-border px-4 py-3'>
                    <CardTitle className='text-sm font-semibold'>
                      Rapprochement des fournisseurs dans « Entrées Stock »
                    </CardTitle>
                    <CardDescription className='text-xs'>
                      Vérifiez la correspondance entre les noms saisis dans
                      Entrées Stock et la feuille fournisseur.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='p-0'>
                    <Table>
                      <TableHeader>
                        <TableRow className='bg-muted/40'>
                          <TableHead className='px-4'>
                            Fournisseur dans Entrées Stock
                          </TableHead>
                          <TableHead>Diagnostic</TableHead>
                          <TableHead className='px-4'>
                            Nom cible confirmé en base
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.values(decisions.supplierChoices).map(
                          (choice) => (
                            <TableRow key={choice.rawPurchaseSupplier}>
                              <TableCell className='px-4 text-xs font-medium'>
                                {choice.rawPurchaseSupplier}
                              </TableCell>
                              <TableCell className='text-xs'>
                                {choice.matchType === 'exact' ? (
                                  <Badge
                                    variant='secondary'
                                    className='text-[11px]'
                                  >
                                    Correspondance exacte
                                  </Badge>
                                ) : choice.matchType === 'case_or_space' ? (
                                  <Badge
                                    variant='outline'
                                    className='text-[11px]'
                                  >
                                    Casse / espace rapproché (
                                    {choice.proposedSupplierName})
                                  </Badge>
                                ) : (
                                  <Badge className='border-0 bg-[#B98900]/15 text-[#B98900]'>
                                    Nouveau fournisseur à créer
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className='px-4'>
                                <Input
                                  value={choice.targetSupplierName}
                                  onChange={(e) =>
                                    setDecisions((prev) => ({
                                      ...prev,
                                      supplierChoices: {
                                        ...prev.supplierChoices,
                                        [choice.rawPurchaseSupplier]: {
                                          ...choice,
                                          targetSupplierName: e.target.value,
                                        },
                                      },
                                    }))
                                  }
                                  className='h-7 max-w-xs text-xs'
                                />
                              </TableCell>
                            </TableRow>
                          )
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Duplicate candidates table */}
                {duplicateCandidates.length > 0 && (
                  <Card className='gap-0 py-0 shadow-none'>
                    <CardHeader className='border-b border-border px-4 py-3'>
                      <CardTitle className='text-sm font-semibold'>
                        Doublons potentiels détectés ({duplicateCandidates.length})
                      </CardTitle>
                      <CardDescription className='text-xs'>
                        Lignes ayant la même date, le même produit, la même
                        quantité et le même fournisseur/destination. Choisissez
                        « Garder » ou « Ignorer » pour chaque ligne.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className='p-0'>
                      <Table>
                        <TableHeader>
                          <TableRow className='bg-muted/40'>
                            <TableHead className='px-4'>Feuille</TableHead>
                            <TableHead>Ligne</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Produit</TableHead>
                            <TableHead className='text-right'>Qté</TableHead>
                            <TableHead>Fournisseur / Dest.</TableHead>
                            <TableHead className='px-4 text-right'>
                              Décision
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {duplicateCandidates.map((dup) => {
                            const decision =
                              decisions.duplicateDecisions[dup.sourceRowId] ??
                              'keep'
                            return (
                              <TableRow key={dup.sourceRowId}>
                                <TableCell className='px-4 text-xs'>
                                  {dup.sheet}
                                </TableCell>
                                <TableCell className='tabular-nums text-xs'>
                                  #{dup.rowNumber}
                                </TableCell>
                                <TableCell className='tabular-nums text-xs'>
                                  {dup.date}
                                </TableCell>
                                <TableCell className='text-xs font-medium'>
                                  {dup.ref} — {dup.name}
                                </TableCell>
                                <TableCell className='text-right tabular-nums text-xs'>
                                  {dup.qty}
                                </TableCell>
                                <TableCell className='text-xs'>
                                  {dup.partner}
                                </TableCell>
                                <TableCell className='px-4 text-right'>
                                  <Select
                                    value={decision}
                                    onValueChange={(v) =>
                                      setDecisions((prev) => ({
                                        ...prev,
                                        duplicateDecisions: {
                                          ...prev.duplicateDecisions,
                                          [dup.sourceRowId]: v as
                                            | 'keep'
                                            | 'skip',
                                        },
                                      }))
                                    }
                                  >
                                    <SelectTrigger className='ml-auto h-7 w-28 text-xs'>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value='keep'>
                                        Garder
                                      </SelectItem>
                                      <SelectItem value='skip'>
                                        Ignorer
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {/* Full Validation Issues List */}
                <Card className='gap-0 py-0 shadow-none'>
                  <CardHeader className='border-b border-border px-4 py-3'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <div>
                        <CardTitle className='text-sm font-semibold'>
                          Journal détaillé des contrôles ({filteredIssues.length}{' '}
                          signalements)
                        </CardTitle>
                        <CardDescription className='text-xs'>
                          Chaque anomalie indique la feuille, le numéro de
                          ligne, le champ et le motif.
                        </CardDescription>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Select
                          value={severityFilter}
                          onValueChange={(v) =>
                            setSeverityFilter(v as IssueSeverity | 'ALL')
                          }
                        >
                          <SelectTrigger className='h-8 w-40 text-xs'>
                            <SelectValue placeholder='Sévérité' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='ALL'>
                              Toutes sévérités
                            </SelectItem>
                            <SelectItem value='BLOQUANT'>BLOQUANT</SelectItem>
                            <SelectItem value='À VÉRIFIER'>
                              À VÉRIFIER
                            </SelectItem>
                            <SelectItem value='INFO'>INFO</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={sheetFilter}
                          onValueChange={(v) =>
                            setSheetFilter(v as ImportSheetKey | 'ALL')
                          }
                        >
                          <SelectTrigger className='h-8 w-44 text-xs'>
                            <SelectValue placeholder='Feuille' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='ALL'>
                              Toutes les feuilles
                            </SelectItem>
                            <SelectItem value='Base Produits'>
                              Base Produits
                            </SelectItem>
                            <SelectItem value='Entrées Stock'>
                              Entrées Stock
                            </SelectItem>
                            <SelectItem value='Sorties Stock'>
                              Sorties Stock
                            </SelectItem>
                            <SelectItem value='Inventaire'>
                              Inventaire
                            </SelectItem>
                            <SelectItem value='fournisseur'>
                              fournisseur
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className='p-0'>
                    <Table>
                      <TableHeader>
                        <TableRow className='bg-muted/40'>
                          <TableHead className='px-4'>Sévérité</TableHead>
                          <TableHead>Feuille</TableHead>
                          <TableHead>Ligne</TableHead>
                          <TableHead>Champ</TableHead>
                          <TableHead className='px-4'>Motif</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredIssues.slice(0, 100).map((iss) => (
                          <TableRow key={iss.id}>
                            <TableCell className='px-4'>
                              {iss.severity === 'BLOQUANT' ? (
                                <Badge className='border-0 bg-[#D72C0D]/15 text-[#D72C0D]'>
                                  BLOQUANT
                                </Badge>
                              ) : iss.severity === 'À VÉRIFIER' ? (
                                <Badge className='border-0 bg-[#B98900]/15 text-[#B98900]'>
                                  À VÉRIFIER
                                </Badge>
                              ) : (
                                <Badge variant='outline' className='text-xs'>
                                  INFO
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className='text-xs font-medium'>
                              {iss.sheet}
                            </TableCell>
                            <TableCell className='tabular-nums text-xs'>
                              Ligne {iss.rowNumber}
                            </TableCell>
                            <TableCell className='text-xs'>
                              {iss.field}
                            </TableCell>
                            <TableCell className='px-4 text-xs text-muted-foreground'>
                              {iss.reason}
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredIssues.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className='py-6 text-center text-xs text-muted-foreground'
                            >
                              Aucune anomalie pour ce filtre.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* STEP 4: DECISIONS */}
            {currentStep === 4 && parsedWorkbook && (
              <Card className='gap-0 py-0 shadow-none'>
                <CardHeader className='border-b border-border px-4 py-3'>
                  <CardTitle className='text-sm font-semibold'>
                    Étape 4 — Décisions de gestion à confirmer avant import
                  </CardTitle>
                  <CardDescription className='text-xs'>
                    Vérifiez et validez les conventions appliquées lors de la
                    migration.
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-5 p-4 text-xs'>
                  {/* 1. VAT convention */}
                  <div className='rounded-md border border-border p-3 space-y-2.5'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <div>
                        <p className='font-semibold text-foreground'>
                          1. Convention TVA sur les prix unitaires
                        </p>
                        <p className='text-muted-foreground'>
                          De nombreux prix du fichier Excel sont saisis sous
                          forme de formules incluant 20 % de TVA (ex. =35*1.2).
                          La convention choisie sera enregistrée dans settings
                          et affichée à côté des prix.
                        </p>
                      </div>
                      <Select
                        value={decisions.vatConvention}
                        onValueChange={(v) =>
                          setDecisions((prev) => ({
                            ...prev,
                            vatConvention: v as VatConvention,
                          }))
                        }
                      >
                        <SelectTrigger className='h-8 w-64 text-xs'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='TTC'>
                            Prix TTC (incluent 20 % de TVA) — Recommandé
                          </SelectItem>
                          <SelectItem value='HT'>
                            Prix HT (Hors Taxes)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='flex items-center gap-2 pt-1'>
                      <Checkbox
                        id='confirm-vat'
                        checked={decisions.vatConfirmed}
                        onCheckedChange={(checked) =>
                          setDecisions((prev) => ({
                            ...prev,
                            vatConfirmed: Boolean(checked),
                          }))
                        }
                      />
                      <Label htmlFor='confirm-vat' className='text-xs'>
                        Je confirme que les prix importés sont exprimés en{' '}
                        <strong>{decisions.vatConvention}</strong>.
                      </Label>
                    </div>
                  </div>

                  {/* 2. Payment mapping */}
                  <div className='rounded-md border border-border p-3 space-y-1'>
                    <p className='font-semibold text-foreground'>
                      2. Correspondance des statuts de paiement
                    </p>
                    <p className='text-muted-foreground'>
                      <strong>OUI</strong> → « Payé » (`paid`) |{' '}
                      <strong>NON / Vide</strong> → « Impayé » (`unpaid`). Les
                      dates de paiement sont conservées lorsqu’elles sont
                      présentes ; aucun numéro de facture fictif n’est généré.
                    </p>
                  </div>

                  {/* 3. Initial stock */}
                  <div className='rounded-md border border-border p-3 space-y-1'>
                    <p className='font-semibold text-foreground'>
                      3. Stock initial & Seuils minimums (« Base Produits »)
                    </p>
                    <p className='text-muted-foreground'>
                      Le « Stock initial » est importé tel quel sur{' '}
                      <strong>{parsedWorkbook.products.length}</strong> produits
                      : <strong>{parsedWorkbook.zeroInitialStockCount}</strong>{' '}
                      produits ont un stock initial à `0`, et{' '}
                      <strong>{parsedWorkbook.missingMinStockCount}</strong>{' '}
                      produits n’ont pas de stock minimum (statut « À définir
                      »).
                    </p>
                  </div>

                  {/* 4. Confirmed inventory counts */}
                  <div className='rounded-md border border-border p-3 space-y-2'>
                    <p className='font-semibold text-foreground'>
                      4. Comptages d’inventaire confirmés (« Inventaire »)
                    </p>
                    <p className='text-muted-foreground'>
                      Seules les <strong>{parsedWorkbook.inventories.length}</strong>{' '}
                      lignes où la colonne E (Stock réel) comporte une valeur
                      sont importées, regroupées en{' '}
                      <strong>
                        une session d’inventaire confirmée par date distincte
                      </strong>{' '}
                      (`status = confirmed`, `confirmed_by = "Import Excel"`).
                      Dates détectées :{' '}
                      {parsedWorkbook.distinctInventoryDates.length > 0
                        ? parsedWorkbook.distinctInventoryDates.join(', ')
                        : 'Aucune date explicite (utilisera la date par défaut ci-dessous)'}
                      .
                    </p>
                    <div className='flex items-center gap-2'>
                      <Label className='text-xs'>
                        Date de session par défaut (si une ligne Inventaire n’a
                        pas de date) :
                      </Label>
                      <Input
                        type='date'
                        value={decisions.fallbackInventoryDate}
                        onChange={(e) =>
                          setDecisions((prev) => ({
                            ...prev,
                            fallbackInventoryDate: e.target.value,
                          }))
                        }
                        className='h-7 w-40 text-xs'
                      />
                    </div>
                  </div>

                  {/* 5. Idempotency & Existing records overwrite toggles */}
                  <div className='rounded-md border border-border p-3 space-y-2'>
                    <p className='font-semibold text-foreground'>
                      5. Idempotence & Protection des enregistrements existants
                    </p>
                    <p className='text-muted-foreground'>
                      Chaque ligne reçoit un identifiant stable `source_row_id`
                      (feuille + numéro de ligne + empreinte). Relancer l’import
                      n’ajoute jamais de doublon. Par défaut, les produits et
                      fournisseurs déjà présents ne sont pas écrasés :
                    </p>
                    <div className='flex flex-wrap gap-6 pt-1'>
                      <div className='flex items-center gap-2'>
                        <Checkbox
                          id='upd-prd'
                          checked={decisions.updateExistingProducts}
                          onCheckedChange={(c) =>
                            setDecisions((prev) => ({
                              ...prev,
                              updateExistingProducts: Boolean(c),
                            }))
                          }
                        />
                        <Label htmlFor='upd-prd' className='text-xs'>
                          Mettre à jour les fiches Produits existantes
                        </Label>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Checkbox
                          id='upd-sup'
                          checked={decisions.updateExistingSuppliers}
                          onCheckedChange={(c) =>
                            setDecisions((prev) => ({
                              ...prev,
                              updateExistingSuppliers: Boolean(c),
                            }))
                          }
                        />
                        <Label htmlFor='upd-sup' className='text-xs'>
                          Mettre à jour les fiches Fournisseurs existantes
                        </Label>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* STEP 5: IMPORT OR DRY RUN */}
            {currentStep === 5 && parsedWorkbook && (
              <Card className='gap-0 py-0 shadow-none'>
                <CardHeader className='border-b border-border px-4 py-3'>
                  <CardTitle className='text-sm font-semibold'>
                    Étape 5 — Exécution de l’importation ou Simulation à blanc
                  </CardTitle>
                  <CardDescription className='text-xs'>
                    Vous pouvez d’abord lancer une simulation sans écriture
                    (Dry Run) pour vérifier le rapport de réconciliation, ou
                    exécuter l’importation réelle dans la base.
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-4 p-6'>
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <div className='rounded-md border border-border p-4 space-y-2'>
                      <p className='text-sm font-semibold'>
                        Mode 1 — Simuler sans importer (Dry Run)
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        Exécute tous les calculs, rapprochements et contrôles
                        financiers sans modifier la base de données.
                      </p>
                      <Button
                        type='button'
                        variant='outline'
                        disabled={isRunningImport}
                        onClick={() => void handleRunImport(true)}
                      >
                        <Play className='mr-1.5 h-4 w-4' />
                        Simuler sans importer
                      </Button>
                    </div>

                    <div className='rounded-md border border-border bg-muted/20 p-4 space-y-2'>
                      <p className='text-sm font-semibold'>
                        Mode 2 — Importer dans la base ({repository.adapterName})
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        Enregistre les produits, fournisseurs, entrées, sorties,
                        sessions d’inventaire confirmées et crée le lot
                        d’importation idempotent.
                      </p>
                      <Button
                        type='button'
                        disabled={isRunningImport}
                        onClick={() => void handleRunImport(false)}
                      >
                        {isRunningImport ? (
                          <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
                        ) : (
                          <CheckCircle2 className='mr-1.5 h-4 w-4' />
                        )}
                        Lancer l’importation réelle
                      </Button>
                    </div>
                  </div>

                  {isRunningImport && (
                    <div className='space-y-2 rounded-md border border-border p-4'>
                      <div className='flex items-center justify-between text-xs font-medium'>
                        <span>{progressLabel}</span>
                        <span className='tabular-nums'>{progressPct} %</span>
                      </div>
                      <div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
                        <div
                          className='h-full bg-primary transition-all duration-200'
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* STEP 6: RECONCILIATION REPORT */}
            {currentStep === 6 && reconciliationReport && (
              <div className='space-y-4'>
                {/* Verdict Banner */}
                <Card
                  className={
                    reconciliationReport.verdict === 'GREEN'
                      ? 'border-[#008060]/40 bg-[#008060]/5 p-4 shadow-none'
                      : 'border-[#D72C0D]/40 bg-[#D72C0D]/5 p-4 shadow-none'
                  }
                >
                  <div className='flex flex-wrap items-center justify-between gap-3'>
                    <div className='flex items-center gap-2.5'>
                      {reconciliationReport.verdict === 'GREEN' ? (
                        <CheckCircle2 className='h-5 w-5 text-[#008060]' />
                      ) : (
                        <AlertTriangle className='h-5 w-5 text-[#D72C0D]' />
                      )}
                      <div>
                        <div className='flex items-center gap-2'>
                          <p className='text-sm font-semibold'>
                            Verdict de réconciliation :{' '}
                            {reconciliationReport.verdict === 'GREEN'
                              ? 'CONFORME (VERT)'
                              : 'ÉCART OU ANOMALIES BLOQUANTES (ROUGE)'}
                          </p>
                          <Badge variant='outline' className='text-xs'>
                            {reconciliationReport.dryRun
                              ? 'Simulation (Dry Run)'
                              : `Lot ${reconciliationReport.sourceId}`}
                          </Badge>
                        </div>
                        <p className='text-xs text-muted-foreground'>
                          {reconciliationReport.verdictMessage}
                        </p>
                      </div>
                    </div>

                    <div className='flex items-center gap-2'>
                      <Button
                        size='sm'
                        variant='outline'
                        className='h-8 text-xs'
                        onClick={handleDownloadReconciliationCsv}
                      >
                        <Download className='mr-1.5 h-3.5 w-3.5' />
                        Télécharger le rapport (CSV)
                      </Button>
                      {!reconciliationReport.dryRun && (
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-8 text-xs text-[#D72C0D]'
                          onClick={() =>
                            setBatchToReverse(reconciliationReport.batchId)
                          }
                        >
                          <RotateCcw className='mr-1.5 h-3.5 w-3.5' />
                          Annuler l’import
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Financial & Catalog KPIs */}
                <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                  <Card className='gap-1 p-3 shadow-none'>
                    <span className='text-xs text-muted-foreground'>
                      Total achats Excel vs Importé ({reconciliationReport.vatConvention})
                    </span>
                    <p className='text-base font-bold tabular-nums'>
                      {formatMAD(reconciliationReport.totalPurchaseAmountImported)}
                    </p>
                    <span className='text-[11px] text-muted-foreground'>
                      Excel :{' '}
                      {formatMAD(reconciliationReport.totalPurchaseAmountExcel)}{' '}
                      (Écart :{' '}
                      {formatMAD(reconciliationReport.amountDifference)})
                    </span>
                  </Card>

                  <Card className='gap-1 p-3 shadow-none'>
                    <span className='text-xs text-muted-foreground'>
                      Catalogue & Fournisseurs
                    </span>
                    <p className='text-base font-bold tabular-nums'>
                      {reconciliationReport.totalProductsInDb} produits /{' '}
                      {reconciliationReport.totalSuppliersInDb} fournisseurs
                    </p>
                    <span className='text-[11px] text-muted-foreground'>
                      Références canoniques uniques
                    </span>
                  </Card>

                  <Card className='gap-1 p-3 shadow-none'>
                    <span className='text-xs text-muted-foreground'>
                      Factures / Entrées impayées (NON)
                    </span>
                    <p className='text-base font-bold tabular-nums text-[#B98900]'>
                      {reconciliationReport.unpaidInvoicesCount} (
                      {formatMAD(reconciliationReport.unpaidInvoicesAmount)})
                    </p>
                    <span className='text-[11px] text-muted-foreground'>
                      Statut payment_status = unpaid
                    </span>
                  </Card>

                  <Card className='gap-1 p-3 shadow-none'>
                    <span className='text-xs text-muted-foreground'>
                      Statuts de stock recalculés (stock-engine)
                    </span>
                    <div className='flex flex-wrap gap-1.5 pt-1 text-xs'>
                      <Badge className='border-0 bg-[#D72C0D]/15 text-[#D72C0D]'>
                        Alerte : {reconciliationReport.stockStatusCounts.Alerte}
                      </Badge>
                      <Badge className='border-0 bg-[#B98900]/15 text-[#B98900]'>
                        À surveiller :{' '}
                        {reconciliationReport.stockStatusCounts['À surveiller']}
                      </Badge>
                      <Badge className='border-0 bg-[#008060]/15 text-[#008060]'>
                        OK : {reconciliationReport.stockStatusCounts.OK}
                      </Badge>
                      <Badge variant='outline'>
                        À définir :{' '}
                        {reconciliationReport.stockStatusCounts['À définir']}
                      </Badge>
                    </div>
                  </Card>
                </div>

                {/* Sheet-by-Sheet Reconciliation Table */}
                <Card className='gap-0 py-0 shadow-none'>
                  <CardHeader className='border-b border-border px-4 py-3'>
                    <CardTitle className='text-sm font-semibold'>
                      Récapitulatif par feuille
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='p-0'>
                    <Table>
                      <TableHeader>
                        <TableRow className='bg-muted/40'>
                          <TableHead className='px-4'>Feuille</TableHead>
                          <TableHead className='text-right'>
                            Lignes lues
                          </TableHead>
                          <TableHead className='text-right'>
                            Lignes importées
                          </TableHead>
                          <TableHead className='text-right'>
                            Lignes ignorées (doublons / déjà importées)
                          </TableHead>
                          <TableHead className='px-4 text-right'>
                            Lignes à vérifier
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reconciliationReport.sheetStats.map((st) => (
                          <TableRow key={st.sheet}>
                            <TableCell className='px-4 text-xs font-medium'>
                              {st.sheet}
                            </TableCell>
                            <TableCell className='text-right tabular-nums text-xs'>
                              {st.rowsRead}
                            </TableCell>
                            <TableCell className='text-right tabular-nums text-xs font-semibold text-[#008060]'>
                              {st.rowsImported}
                            </TableCell>
                            <TableCell className='text-right tabular-nums text-xs text-muted-foreground'>
                              {st.rowsSkipped}
                            </TableCell>
                            <TableCell className='px-4 text-right tabular-nums text-xs text-[#B98900]'>
                              {st.rowsFlagged}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* First 20 flagged rows */}
                <Card className='gap-0 py-0 shadow-none'>
                  <CardHeader className='border-b border-border px-4 py-3'>
                    <CardTitle className='text-sm font-semibold'>
                      20 premières lignes signalées
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='p-0'>
                    <Table>
                      <TableHeader>
                        <TableRow className='bg-muted/40'>
                          <TableHead className='px-4'>Sévérité</TableHead>
                          <TableHead>Feuille</TableHead>
                          <TableHead>Ligne</TableHead>
                          <TableHead>Champ</TableHead>
                          <TableHead className='px-4'>Motif</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reconciliationReport.first20FlaggedRows.map((iss) => (
                          <TableRow key={iss.id}>
                            <TableCell className='px-4'>
                              <Badge variant='outline' className='text-xs'>
                                {iss.severity}
                              </Badge>
                            </TableCell>
                            <TableCell className='text-xs font-medium'>
                              {iss.sheet}
                            </TableCell>
                            <TableCell className='tabular-nums text-xs'>
                              #{iss.rowNumber}
                            </TableCell>
                            <TableCell className='text-xs'>
                              {iss.field}
                            </TableCell>
                            <TableCell className='px-4 text-xs text-muted-foreground'>
                              {iss.reason}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* ================================================================
              TAB 2: EXPORT (.XLSX / .CSV) & IMPORT BATCHES HISTORY
             ================================================================ */}
          <TabsContent value='export' className='space-y-4'>
            <Card className='gap-0 py-0 shadow-none'>
              <CardHeader className='flex flex-row items-center justify-between border-b border-border px-4 py-3'>
                <div>
                  <CardTitle className='text-sm font-semibold'>
                    Exporter les collections (.xlsx & .csv) et Classeur complet
                  </CardTitle>
                  <CardDescription className='text-xs'>
                    Téléchargez à tout moment un classeur Excel multi-feuilles identique au modèle d’origine ou exportez chaque table séparément.
                  </CardDescription>
                </div>
                <Button
                  size='sm'
                  onClick={() =>
                    void exportFullWorkbookMirror(repository, {
                      hidePrices: auth.user?.role === 'cuisine',
                    }).then(() =>
                      toast.success(
                        'Classeur complet MONARQ_ECONOMAT (.xlsx) téléchargé.'
                      )
                    )
                  }
                >
                  <FileSpreadsheet className='mr-1.5 h-3.5 w-3.5' />
                  Exporter toutes les données (.xlsx)
                </Button>
              </CardHeader>
              <CardContent className='p-4'>
                <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                  {(
                    [
                      ['products', 'Catalogue Produits (Base Produits)'],
                      ['suppliers', 'Fournisseurs (fournisseur)'],
                      ['purchases', 'Entrées de stock (Achats)'],
                      ['exits', 'Sorties de stock & Pertes'],
                      ['inventories', 'Sessions & Lignes d’inventaire'],
                    ] as const
                  ).map(([colKey, label]) => (
                    <div
                      key={colKey}
                      className='flex items-center justify-between rounded-md border border-border p-3 text-xs'
                    >
                      <span className='font-medium'>{label}</span>
                      <div className='flex items-center gap-1.5'>
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-7 px-2 text-xs'
                          onClick={() =>
                            void handleExportCollection(colKey, 'xlsx')
                          }
                        >
                          .xlsx
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-7 px-2 text-xs'
                          onClick={() =>
                            void handleExportCollection(colKey, 'csv')
                          }
                        >
                          .csv
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Import Batches History + Reversal */}
            <Card className='gap-0 py-0 shadow-none'>
              <CardHeader className='border-b border-border px-4 py-3'>
                <CardTitle className='text-sm font-semibold'>
                  Historique des lots d’importation ({importBatches.length})
                </CardTitle>
                <CardDescription className='text-xs'>
                  L’annulation d’un lot crée des écritures de contre-passation
                  liées aux mouvements d’origine sans jamais supprimer
                  physiquement les lignes.
                </CardDescription>
              </CardHeader>
              <CardContent className='p-0'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-muted/40'>
                      <TableHead className='px-4'>Lot (source_id)</TableHead>
                      <TableHead>Fichier</TableHead>
                      <TableHead>Date d’import</TableHead>
                      <TableHead className='text-right'>Lues</TableHead>
                      <TableHead className='text-right'>Importées</TableHead>
                      <TableHead className='text-right'>Ignorées</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className='px-4 text-right'>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importBatches.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className='px-4 font-mono text-xs'>
                          {b.source_id}
                        </TableCell>
                        <TableCell className='text-xs font-medium'>
                          {b.filename}
                        </TableCell>
                        <TableCell className='tabular-nums text-xs text-muted-foreground'>
                          {formatDateTimeFR(b.created_at)}
                        </TableCell>
                        <TableCell className='text-right tabular-nums text-xs'>
                          {b.counts.rows_read}
                        </TableCell>
                        <TableCell className='text-right tabular-nums text-xs font-semibold'>
                          {b.counts.rows_imported}
                        </TableCell>
                        <TableCell className='text-right tabular-nums text-xs'>
                          {b.counts.rows_skipped}
                        </TableCell>
                        <TableCell>
                          {b.status === 'reversed' ? (
                            <Badge className='border-0 bg-[#D72C0D]/15 text-[#D72C0D]'>
                              Contre-passé
                            </Badge>
                          ) : (
                            <Badge className='border-0 bg-[#008060]/15 text-[#008060]'>
                              Actif
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className='px-4 text-right'>
                          <Button
                            size='sm'
                            variant='outline'
                            className='h-7 text-xs'
                            disabled={
                              b.status === 'reversed' || reversingBatch
                            }
                            onClick={() => setBatchToReverse(b.id)}
                          >
                            <RotateCcw className='mr-1 h-3 w-3' />
                            Annuler l’import
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {importBatches.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className='py-6 text-center text-xs text-muted-foreground'
                        >
                          Aucun lot d’importation enregistré pour le moment.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================================================================
              TAB 3: À CORRIGER — RAPPORT QUALITÉ DES DONNÉES
             ================================================================ */}
          <TabsContent value='quality' className='space-y-4'>
            <Card className='gap-0 py-0 shadow-none'>
              <CardHeader className='flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3'>
                <div>
                  <CardTitle className='text-sm font-semibold'>
                    Diagnostic de qualité des données (« À corriger »)
                  </CardTitle>
                  <CardDescription className='text-xs'>
                    Synthèse en temps réel des anomalies à corriger dans le catalogue et les mouvements : produits sans catégorie, catégories incohérentes, seuils minimums « À définir », prix manquants, doublons potentiels, fournisseurs incomplets et mentions « À vérifier ».
                  </CardDescription>
                </div>
                <div className='flex items-center gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-8 text-xs'
                    onClick={() =>
                      void exportDataQualityReportFile(repository, 'csv').then(() =>
                        toast.success('Liste « À corriger » exportée en .CSV.')
                      )
                    }
                  >
                    <Download className='mr-1.5 h-3.5 w-3.5' />
                    Exporter (.csv)
                  </Button>
                  <Button
                    size='sm'
                    className='h-8 text-xs'
                    onClick={() =>
                      void exportDataQualityReportFile(repository, 'xlsx').then(() =>
                        toast.success('Rapport « À corriger » exporté en .XLSX.')
                      )
                    }
                  >
                    <FileSpreadsheet className='mr-1.5 h-3.5 w-3.5' />
                    Exporter « À corriger » (.xlsx)
                  </Button>
                </div>
              </CardHeader>
              <CardContent className='space-y-4 p-4'>
                <div className='grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4'>
                  {(
                    [
                      ['ALL', 'Toutes les anomalies', qualityReport?.counts.total ?? 0],
                      ['sans_categorie', 'Sans catégorie', qualityReport?.counts.sans_categorie ?? 0],
                      ['categorie_incoherente', 'Catégories incohérentes', qualityReport?.counts.categorie_incoherente ?? 0],
                      ['sans_stock_min', 'Sans stock minimum', qualityReport?.counts.sans_stock_min ?? 0],
                      ['prix_manquant', 'Prix manquants / 0 DH', qualityReport?.counts.prix_manquant ?? 0],
                      ['doublon_potentiel', 'Doublons potentiels', qualityReport?.counts.doublon_potentiel ?? 0],
                      ['fournisseur_incomplet', 'Fournisseurs à compléter', qualityReport?.counts.fournisseur_incomplet ?? 0],
                      ['a_verifier', 'Notés « À vérifier »', qualityReport?.counts.a_verifier ?? 0],
                    ] as const
                  ).map(([key, label, count]) => (
                    <button
                      key={key}
                      type='button'
                      onClick={() => setQualityFilter(key)}
                      className={`flex items-center justify-between rounded-md border p-3 text-left text-xs transition-colors ${
                        qualityFilter === key
                          ? 'border-[#303030] bg-[#F6F6F7] font-semibold'
                          : 'border-border bg-white hover:bg-[#F6F6F7]/50'
                      }`}
                    >
                      <span className='truncate'>{label}</span>
                      <Badge
                        variant={count > 0 ? 'secondary' : 'outline'}
                        className='ml-2 tabular-nums'
                      >
                        {count}
                      </Badge>
                    </button>
                  ))}
                </div>

                <div className='overflow-hidden rounded-md border border-border'>
                  <Table>
                    <TableHeader>
                      <TableRow className='bg-muted/40'>
                        <TableHead className='px-4 text-xs'>Type d’anomalie</TableHead>
                        <TableHead className='text-xs'>Module</TableHead>
                        <TableHead className='text-xs'>Référence</TableHead>
                        <TableHead className='text-xs'>Élément</TableHead>
                        <TableHead className='text-xs'>Détail</TableHead>
                        <TableHead className='px-4 text-right text-xs'>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(qualityReport?.items ?? [])
                        .filter(
                          (item) =>
                            qualityFilter === 'ALL' || item.category === qualityFilter
                        )
                        .slice(0, 100)
                        .map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className='px-4 text-xs'>
                              <Badge
                                variant='outline'
                                className='border-[#B98900]/40 bg-[#B98900]/10 text-[11px] text-[#B98900]'
                              >
                                {item.categoryLabel}
                              </Badge>
                            </TableCell>
                            <TableCell className='text-xs'>{item.collection}</TableCell>
                            <TableCell className='font-mono text-xs font-medium'>
                              {item.reference}
                            </TableCell>
                            <TableCell className='text-xs font-medium'>
                              {item.label}
                            </TableCell>
                            <TableCell className='text-xs text-muted-foreground'>
                              {item.detail}
                            </TableCell>
                            <TableCell className='px-4 text-right'>
                              <Button
                                size='sm'
                                variant='outline'
                                className='h-7 text-xs'
                                onClick={() =>
                                  void navigate({ to: item.fixRoute as never })
                                }
                              >
                                {item.fixActionLabel} →
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      {(qualityReport?.items ?? []).filter(
                        (item) =>
                          qualityFilter === 'ALL' || item.category === qualityFilter
                      ).length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className='py-8 text-center text-xs text-[#008060]'
                          >
                            <CheckCircle2 className='mx-auto mb-1.5 h-5 w-5 text-[#008060]' />
                            Aucune anomalie « À corriger » détectée pour ce filtre.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <ConfirmDialog
        open={Boolean(batchToReverse)}
        onOpenChange={(open) => {
          if (!open) setBatchToReverse(null)
        }}
        title='Annuler ce lot d’importation ?'
        desc='Tous les achats et sorties créés par ce lot seront annulés par des écritures d’extourne (reversed_of) et les sessions d’inventaire associées seront désactivées. Aucun mouvement n’est supprimé physiquement.'
        cancelBtnText='Conserver'
        confirmText='Confirmer la contre-passation du lot'
        destructive
        handleConfirm={() => void handleConfirmReverseBatch()}
      />
    </PageShell>
  )
}

function PreviewSheetTable({
  parsed,
  sheet,
  search,
  page,
  onPageChange,
}: {
  parsed: ParsedWorkbookResult
  sheet: ImportSheetKey
  search: string
  page: number
  onPageChange: (p: number) => void
}) {
  const q = search.trim().toLowerCase()

  if (sheet === 'Base Produits') {
    const filtered = parsed.products.filter(
      (p) =>
        !q ||
        p.canonicalRef.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.rawCategory.toLowerCase().includes(q)
    )
    const totalPages = Math.max(1, Math.ceil(filtered.length / PREVIEW_PAGE_SIZE))
    const slice = filtered.slice(
      (page - 1) * PREVIEW_PAGE_SIZE,
      page * PREVIEW_PAGE_SIZE
    )

    return (
      <div>
        <Table>
          <TableHeader>
            <TableRow className='bg-muted/40'>
              <TableHead className='px-4'>Ligne</TableHead>
              <TableHead>Réf. canonique</TableHead>
              <TableHead>Produit</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead>Unité</TableHead>
              <TableHead className='text-right'>Stock initial</TableHead>
              <TableHead className='text-right'>Stock min.</TableHead>
              <TableHead className='px-4'>Emplacement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((p) => (
              <TableRow key={p.sourceRowId}>
                <TableCell className='px-4 tabular-nums text-xs text-muted-foreground'>
                  #{p.rowNumber}
                </TableCell>
                <TableCell className='font-mono text-xs font-semibold'>
                  {p.canonicalRef}
                </TableCell>
                <TableCell className='text-xs'>{p.name}</TableCell>
                <TableCell className='text-xs'>{p.rawCategory}</TableCell>
                <TableCell className='text-xs'>{p.unit}</TableCell>
                <TableCell className='text-right tabular-nums text-xs'>
                  {p.initialStock}
                </TableCell>
                <TableCell className='text-right tabular-nums text-xs'>
                  {p.minStock ?? 'À définir'}
                </TableCell>
                <TableCell className='px-4 text-xs text-muted-foreground'>
                  {p.location || '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalRows={filtered.length}
          onPageChange={onPageChange}
        />
      </div>
    )
  }

  if (sheet === 'Entrées Stock') {
    const filtered = parsed.purchases.filter(
      (p) =>
        !q ||
        p.canonicalRef.toLowerCase().includes(q) ||
        p.productName.toLowerCase().includes(q) ||
        p.rawSupplier.toLowerCase().includes(q)
    )
    const totalPages = Math.max(1, Math.ceil(filtered.length / PREVIEW_PAGE_SIZE))
    const slice = filtered.slice(
      (page - 1) * PREVIEW_PAGE_SIZE,
      page * PREVIEW_PAGE_SIZE
    )

    return (
      <div>
        <Table>
          <TableHeader>
            <TableRow className='bg-muted/40'>
              <TableHead className='px-4'>Ligne</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Réf.</TableHead>
              <TableHead>Produit</TableHead>
              <TableHead className='text-right'>Qté</TableHead>
              <TableHead className='text-right'>Prix U (DH)</TableHead>
              <TableHead className='text-right'>Montant recalculé</TableHead>
              <TableHead>Paiement</TableHead>
              <TableHead className='px-4'>Fournisseur</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((p) => (
              <TableRow key={p.sourceRowId}>
                <TableCell className='px-4 tabular-nums text-xs text-muted-foreground'>
                  #{p.rowNumber}
                </TableCell>
                <TableCell className='tabular-nums text-xs'>
                  {p.date ?? p.rawDate}
                </TableCell>
                <TableCell className='font-mono text-xs font-semibold'>
                  {p.canonicalRef}
                </TableCell>
                <TableCell className='text-xs'>{p.productName}</TableCell>
                <TableCell className='text-right tabular-nums text-xs'>
                  {p.qty ?? '—'}
                </TableCell>
                <TableCell className='text-right tabular-nums text-xs'>
                  {formatMAD(p.unitPrice)}
                </TableCell>
                <TableCell className='text-right tabular-nums text-xs font-medium'>
                  {formatMAD(p.computedAmount)}
                </TableCell>
                <TableCell className='text-xs'>
                  {p.paymentStatus === 'paid' ? 'Payé (OUI)' : 'Impayé (NON)'}
                </TableCell>
                <TableCell className='px-4 text-xs'>{p.rawSupplier}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalRows={filtered.length}
          onPageChange={onPageChange}
        />
      </div>
    )
  }

  if (sheet === 'Sorties Stock') {
    const filtered = parsed.exits.filter(
      (x) =>
        !q ||
        x.canonicalRef.toLowerCase().includes(q) ||
        x.productName.toLowerCase().includes(q) ||
        x.destination.toLowerCase().includes(q)
    )
    const totalPages = Math.max(1, Math.ceil(filtered.length / PREVIEW_PAGE_SIZE))
    const slice = filtered.slice(
      (page - 1) * PREVIEW_PAGE_SIZE,
      page * PREVIEW_PAGE_SIZE
    )

    return (
      <div>
        <Table>
          <TableHeader>
            <TableRow className='bg-muted/40'>
              <TableHead className='px-4'>Ligne</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Réf.</TableHead>
              <TableHead>Produit</TableHead>
              <TableHead className='text-right'>Qté sortie</TableHead>
              <TableHead className='text-right'>Pertes</TableHead>
              <TableHead className='px-4'>Destination</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((x) => (
              <TableRow key={x.sourceRowId}>
                <TableCell className='px-4 tabular-nums text-xs text-muted-foreground'>
                  #{x.rowNumber}
                </TableCell>
                <TableCell className='tabular-nums text-xs'>
                  {x.date ?? x.rawDate}
                </TableCell>
                <TableCell className='font-mono text-xs font-semibold'>
                  {x.canonicalRef}
                </TableCell>
                <TableCell className='text-xs'>{x.productName}</TableCell>
                <TableCell className='text-right tabular-nums text-xs'>
                  {x.qtyConsumed}
                </TableCell>
                <TableCell className='text-right tabular-nums text-xs'>
                  {x.qtyWasted}
                </TableCell>
                <TableCell className='px-4 text-xs'>{x.destination}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalRows={filtered.length}
          onPageChange={onPageChange}
        />
      </div>
    )
  }

  if (sheet === 'Inventaire') {
    const filtered = parsed.inventories.filter(
      (i) =>
        !q ||
        i.canonicalRef.toLowerCase().includes(q) ||
        i.productName.toLowerCase().includes(q)
    )
    const totalPages = Math.max(1, Math.ceil(filtered.length / PREVIEW_PAGE_SIZE))
    const slice = filtered.slice(
      (page - 1) * PREVIEW_PAGE_SIZE,
      page * PREVIEW_PAGE_SIZE
    )

    return (
      <div>
        <Table>
          <TableHeader>
            <TableRow className='bg-muted/40'>
              <TableHead className='px-4'>Ligne</TableHead>
              <TableHead>Réf.</TableHead>
              <TableHead>Produit</TableHead>
              <TableHead>Unité</TableHead>
              <TableHead className='text-right'>
                Stock réel compté (Col. E)
              </TableHead>
              <TableHead className='px-4'>Date inventaire</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((inv) => (
              <TableRow key={inv.sourceRowId}>
                <TableCell className='px-4 tabular-nums text-xs text-muted-foreground'>
                  #{inv.rowNumber}
                </TableCell>
                <TableCell className='font-mono text-xs font-semibold'>
                  {inv.canonicalRef}
                </TableCell>
                <TableCell className='text-xs'>{inv.productName}</TableCell>
                <TableCell className='text-xs'>{inv.unit}</TableCell>
                <TableCell className='text-right tabular-nums text-xs font-semibold'>
                  {inv.counted}
                </TableCell>
                <TableCell className='px-4 tabular-nums text-xs'>
                  {inv.date ?? (inv.rawDate || 'Session par défaut')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalRows={filtered.length}
          onPageChange={onPageChange}
        />
      </div>
    )
  }

  // fournisseur
  const filteredSups = parsed.suppliers.filter(
    (s) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.contact.toLowerCase().includes(q)
  )
  const totalPages = Math.max(
    1,
    Math.ceil(filteredSups.length / PREVIEW_PAGE_SIZE)
  )
  const slice = filteredSups.slice(
    (page - 1) * PREVIEW_PAGE_SIZE,
    page * PREVIEW_PAGE_SIZE
  )

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow className='bg-muted/40'>
            <TableHead className='px-4'>Ligne</TableHead>
            <TableHead>Fournisseur</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Téléphone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className='px-4'>Conditions paiement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {slice.map((s) => (
            <TableRow key={s.sourceRowId}>
              <TableCell className='px-4 tabular-nums text-xs text-muted-foreground'>
                #{s.rowNumber}
              </TableCell>
              <TableCell className='text-xs font-medium'>{s.name}</TableCell>
              <TableCell className='text-xs'>{s.contact || '—'}</TableCell>
              <TableCell className='text-xs'>{s.phone || '—'}</TableCell>
              <TableCell className='text-xs'>{s.email || '—'}</TableCell>
              <TableCell className='px-4 text-xs'>
                {s.paymentTerms || '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PaginationBar
        page={page}
        totalPages={totalPages}
        totalRows={filteredSups.length}
        onPageChange={onPageChange}
      />
    </div>
  )
}

function PaginationBar({
  page,
  totalPages,
  totalRows,
  onPageChange,
}: {
  page: number
  totalPages: number
  totalRows: number
  onPageChange: (p: number) => void
}) {
  return (
    <div className='flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground'>
      <span>{totalRows} ligne(s) réelle(s)</span>
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          size='sm'
          variant='outline'
          className='h-7 px-2 text-xs'
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Précédent
        </Button>
        <span className='tabular-nums'>
          Page {page} / {totalPages}
        </span>
        <Button
          type='button'
          size='sm'
          variant='outline'
          className='h-7 px-2 text-xs'
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Suivant
        </Button>
      </div>
    </div>
  )
}
