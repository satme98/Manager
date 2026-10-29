import * as XLSX from 'xlsx'
import type {
  BackupPayload,
  DataRepository,
  PaymentStatus,
  VatConvention,
} from '@/data/types'
import {
  computeInventoryExcelTheoretical,
  computeProductStock,
  computePurchaseLineAmount,
  computeRawWeightedAveragePrice,
  normalizeProductRef,
  normalizeSupplierName,
} from './stock-engine'

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

export type IssueSeverity = 'BLOQUANT' | 'À VÉRIFIER' | 'INFO'

export type ImportSheetKey =
  | 'Base Produits'
  | 'Entrées Stock'
  | 'Sorties Stock'
  | 'Inventaire'
  | 'fournisseur'
  | 'Parametres'
  | 'À vérifier'

export const IGNORED_SHEET_NAMES = [
  'JOURNAL STOCK',
  'Macro1',
  'Dashboard',
  'Etat Stock',
  'Guide',
] as const

export interface AVerifierSheetRow {
  rowNumber: number
  category: string
  sheetOrigin: string
  reference: string
  label: string
  detail: string
  suggestedAction: string
}

export interface ValidationIssue {
  id: string
  sheet: ImportSheetKey
  rowNumber: number
  field: string
  severity: IssueSeverity
  reason: string
  rawValue?: string
  sourceRowId?: string
}

export interface ParsedProductRow {
  rowNumber: number
  sourceRowId: string
  rawRef: string
  canonicalRef: string
  name: string
  rawCategory: string
  unit: string
  initialStock: number
  minStock: number | null
  location: string
  blocking: boolean
  flags: string[]
}

export interface ParsedSupplierRow {
  rowNumber: number
  sourceRowId: string
  name: string
  normalizedName: string
  contact: string
  phone: string
  email: string
  paymentTerms: string
  notes: string
  blocking: boolean
}

export interface ParsedPurchaseRow {
  rowNumber: number
  orderIndex: number
  sourceRowId: string
  rawDate: string
  date: string | null
  rawRef: string
  canonicalRef: string
  productName: string
  qty: number | null
  unitPrice: number | null
  computedAmount: number
  excelAmountValue: number | null
  rawPaymentStatus: string
  paymentStatus: PaymentStatus
  isAmbiguousPayment: boolean
  rawPaymentDate: string
  paymentDate: string | null
  rawSupplier: string
  invoiceNo: string
  recordedByName: string
  notes: string
  isMigratedJournalNote: boolean
  isDuplicateCandidate: boolean
  duplicateSignature: string
  blocking: boolean
  flags: string[]
}

export interface ParsedExitRow {
  rowNumber: number
  orderIndex: number
  sourceRowId: string
  rawDate: string
  date: string | null
  rawRef: string
  canonicalRef: string
  productName: string
  qtyConsumed: number
  qtyWasted: number
  destination: string
  recordedByName: string
  notes: string
  isMigratedJournalNote: boolean
  isDuplicateCandidate: boolean
  duplicateSignature: string
  blocking: boolean
  flags: string[]
}

export interface ParsedInventoryRow {
  rowNumber: number
  orderIndex: number
  sourceRowId: string
  rawRef: string
  canonicalRef: string
  productName: string
  unit: string
  counted: number
  rawDate: string
  date: string | null
  blocking: boolean
  flags: string[]
}

export interface SupplierResolutionChoice {
  rawPurchaseSupplier: string
  proposedSupplierName: string
  matchType: 'exact' | 'case_or_space' | 'new'
  action: 'map' | 'create'
  targetSupplierName: string
}

export interface SheetMetadataSummary {
  sheetName: string
  recognizedAs: ImportSheetKey | 'IGNORED' | 'UNKNOWN'
  totalSheetRows: number
  realDataRows: number
  missingColumns: string[]
}

export interface ParsedWorkbookResult {
  fileName: string
  fileSize: number
  sheetsFound: string[]
  ignoredSheetsFound: string[]
  missingExpectedSheets: ImportSheetKey[]
  sheetSummaries: SheetMetadataSummary[]
  products: ParsedProductRow[]
  suppliers: ParsedSupplierRow[]
  purchases: ParsedPurchaseRow[]
  exits: ParsedExitRow[]
  inventories: ParsedInventoryRow[]
  aVerifierItems: AVerifierSheetRow[]
  aVerifierRows: AVerifierSheetRow[]
  ambiguousPaymentCount: number
  parametres: {
    units: string[]
    categories: string[]
    destinations: string[]
  }
  issues: ValidationIssue[]
  distinctProductCategories: string[]
  defaultCategoryMapping: Record<string, string>
  defaultSupplierChoices: Record<string, SupplierResolutionChoice>
  defaultDuplicateDecisions: Record<string, 'keep' | 'skip'>
  zeroInitialStockCount: number
  missingMinStockCount: number
  distinctInventoryDates: string[]
}

export interface ImportUserDecisions {
  vatConvention: VatConvention
  vatConfirmed: boolean
  ambiguousPaymentDecision?: 'paid' | 'unpaid'
  categoryMapping: Record<string, string>
  supplierChoices: Record<string, SupplierResolutionChoice>
  duplicateDecisions: Record<string, 'keep' | 'skip'>
  updateExistingProducts: boolean
  updateExistingSuppliers: boolean
  fallbackInventoryDate: string
}

export interface SheetReconciliationStats {
  sheet: ImportSheetKey
  rowsRead: number
  rowsImported: number
  rowsSkipped: number
  rowsFlagged: number
}

export interface ReconciliationReport {
  batchId: string
  sourceId: string
  fileName: string
  executedAt: string
  dryRun: boolean
  vatConvention: VatConvention
  ambiguousPaymentDecision?: 'paid' | 'unpaid'
  autoBackupLocation?: string
  autoBackupCreatedAt?: string
  verdict: 'GREEN' | 'RED'
  verdictMessage: string
  sheetStats: SheetReconciliationStats[]
  totalPurchaseAmountExcel: number
  totalPurchaseAmountImported: number
  amountDifference: number
  totalProductsInDb: number
  totalSuppliersInDb: number
  unpaidInvoicesCount: number
  unpaidInvoicesAmount: number
  stockStatusCounts: {
    Alerte: number
    'À surveiller': number
    OK: number
    'À définir': number
  }
  first20FlaggedRows: ValidationIssue[]
}

function simpleHash(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Safely evaluates simple arithmetic formulas like "=35*1.2" or "=(100+20)/2"
 * when a synthetic or uncached cell stores a formula without a cached numeric value.
 */
export function evaluateSimpleArithmeticFormula(formula: string): number | null {
  const cleaned = formula.trim().replace(/^=/, '').replace(/,/g, '.').trim()
  if (!/^[0-9+\-*/().\s]+$/.test(cleaned)) {
    return null
  }
  try {
    // Tokenize numbers and operators (+, -, *, /, parentheses)
    const tokens = cleaned.match(/(\d+(?:\.\d+)?|\.\d+|[+\-*/()])/g)
    if (!tokens || tokens.length === 0) return null
    let pos = 0

    function parseExpr(): number {
      let val = parseTerm()
      while (pos < tokens!.length && (tokens![pos] === '+' || tokens![pos] === '-')) {
        const op = tokens![pos++]
        const right = parseTerm()
        val = op === '+' ? val + right : val - right
      }
      return val
    }

    function parseTerm(): number {
      let val = parseFactor()
      while (pos < tokens!.length && (tokens![pos] === '*' || tokens![pos] === '/')) {
        const op = tokens![pos++]
        const right = parseFactor()
        val = op === '*' ? val * right : right !== 0 ? val / right : NaN
      }
      return val
    }

    function parseFactor(): number {
      const tok = tokens![pos]
      if (tok === '+') {
        pos++
        return parseFactor()
      }
      if (tok === '-') {
        pos++
        return -parseFactor()
      }
      if (tok === '(') {
        pos++
        const val = parseExpr()
        if (tokens![pos] === ')') pos++
        return val
      }
      pos++
      return Number(tok)
    }

    const result = parseExpr()
    return Number.isFinite(result) ? result : null
  } catch {
    return null
  }
}

/**
 * Reads the computed cell VALUE (not formula string) from a SheetJS worksheet.
 * If a cell contains a formula (e.g. =35*1.2) and its cached value is present, returns cell.v.
 * If cell.v is missing on a formula cell, evaluates the arithmetic formula.
 */
function getCellValue(
  sheet: XLSX.WorkSheet,
  colIdx: number,
  rowIdx0: number
): unknown {
  const addr = XLSX.utils.encode_cell({ c: colIdx, r: rowIdx0 })
  const cell = sheet[addr] as XLSX.CellObject | undefined
  if (!cell) return ''

  if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
    if (typeof cell.v === 'string' && cell.v.trim().startsWith('=')) {
      const evaluated = evaluateSimpleArithmeticFormula(cell.v)
      return evaluated !== null ? evaluated : cell.v
    }
    return cell.v
  }

  if (cell.f) {
    const evaluated = evaluateSimpleArithmeticFormula(cell.f)
    if (evaluated !== null) return evaluated
  }

  return ''
}

function toCleanString(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val).trim()
}

export function parseNumericCell(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null
  }
  const str = String(val)
    .trim()
    .replace(/\s+/g, '')
    .replace(/DH|MAD/gi, '')
    .replace(',', '.')
  if (!str) return null
  if (str.startsWith('=')) {
    return evaluateSimpleArithmeticFormula(str)
  }
  const num = Number(str)
  return Number.isFinite(num) ? num : null
}

/**
 * Converts Excel serial numbers (e.g. 45412), Date objects, DD/MM/YYYY strings,
 * or YYYY-MM-DD strings into a canonical YYYY-MM-DD date string.
 */
export function parseExcelDateToISO(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null

  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10)
  }

  if (typeof val === 'number' && Number.isFinite(val)) {
    // Valid Excel serial range (between year 1990 and 2100)
    if (val < 30000 || val > 75000) return null
    // Excel epoch 1899-12-30 UTC
    const utcDays = Math.floor(val - 25569)
    const utcMs = utcDays * 86400 * 1000
    const d = new Date(utcMs)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  }

  const str = String(val).trim()
  if (!str) return null

  // Match DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(str)
  if (dmyMatch) {
    const day = Number(dmyMatch[1])
    const month = Number(dmyMatch[2])
    const year = Number(dmyMatch[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990) {
      const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const check = new Date(`${iso}T00:00:00Z`)
      if (
        !Number.isNaN(check.getTime()) &&
        check.getUTCDate() === day &&
        check.getUTCMonth() + 1 === month
      ) {
        return iso
      }
    }
    return null
  }

  // Match YYYY-MM-DD
  const ymdMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str)
  if (ymdMatch) {
    const year = Number(ymdMatch[1])
    const month = Number(ymdMatch[2])
    const day = Number(ymdMatch[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
    return null
  }

  // Numeric string representing Excel serial
  if (/^\d{5}(?:\.\d+)?$/.test(str)) {
    return parseExcelDateToISO(Number(str))
  }

  return null
}

function normalizeSheetLookupName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function classifySheetName(
  rawName: string
): ImportSheetKey | 'IGNORED' | 'UNKNOWN' {
  const norm = normalizeSheetLookupName(rawName)
  if (norm === 'base produits' || norm === 'base produit') return 'Base Produits'
  if (norm === 'entrees stock' || norm === 'entree stock') return 'Entrées Stock'
  if (norm === 'sorties stock' || norm === 'sortie stock') return 'Sorties Stock'
  if (norm === 'inventaire' || norm === 'inventaires') return 'Inventaire'
  if (norm === 'fournisseur' || norm === 'fournisseurs') return 'fournisseur'
  if (norm === 'parametres' || norm === 'parametre') return 'Parametres'
  if (norm === 'a verifier' || norm === 'a corriger') return 'À vérifier'

  if (
    norm === 'journal stock' ||
    norm === 'macro1' ||
    norm === 'dashboard' ||
    norm === 'etat stock' ||
    norm === 'guide'
  ) {
    return 'IGNORED'
  }
  return 'UNKNOWN'
}

function getSheetRowCount(sheet: XLSX.WorkSheet): number {
  const ref = sheet['!ref']
  if (!ref) return 0
  const range = XLSX.utils.decode_range(ref)
  return range.e.r + 1
}

/**
 * Parses and validates an uploaded MONARQ_ECONOMAT workbook (.xlsx / .xlsm).
 */
export function parseAndValidateWorkbook(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string,
  fileSize = 0
): ParsedWorkbookResult {
  const wb = XLSX.read(buffer, {
    type: 'array',
    cellFormula: true,
    cellNF: false,
    cellDates: false,
  })

  const sheetsFound = wb.SheetNames
  const ignoredSheetsFound: string[] = []
  const sheetMap = new Map<ImportSheetKey, XLSX.WorkSheet>()
  const sheetSummaries: SheetMetadataSummary[] = []

  const expectedSheets: ImportSheetKey[] = [
    'Base Produits',
    'Entrées Stock',
    'Sorties Stock',
    'Inventaire',
    'fournisseur',
    'Parametres',
  ]

  for (const rawName of sheetsFound) {
    const kind = classifySheetName(rawName)
    if (kind === 'IGNORED') {
      ignoredSheetsFound.push(rawName)
      const ws = wb.Sheets[rawName]
      sheetSummaries.push({
        sheetName: rawName,
        recognizedAs: 'IGNORED',
        totalSheetRows: ws ? getSheetRowCount(ws) : 0,
        realDataRows: 0,
        missingColumns: [],
      })
    } else if (kind !== 'UNKNOWN') {
      const ws = wb.Sheets[rawName]
      if (ws) {
        sheetMap.set(kind, ws)
      }
    } else {
      const ws = wb.Sheets[rawName]
      sheetSummaries.push({
        sheetName: rawName,
        recognizedAs: 'UNKNOWN',
        totalSheetRows: ws ? getSheetRowCount(ws) : 0,
        realDataRows: 0,
        missingColumns: [],
      })
    }
  }

  const missingExpectedSheets = expectedSheets.filter(
    (s) => !sheetMap.has(s) && s !== 'Parametres'
  )

  const issues: ValidationIssue[] = []
  const products: ParsedProductRow[] = []
  const suppliers: ParsedSupplierRow[] = []
  const purchases: ParsedPurchaseRow[] = []
  const exits: ParsedExitRow[] = []
  const inventories: ParsedInventoryRow[] = []
  const aVerifierItems: AVerifierSheetRow[] = []
  const parametres = {
    units: [] as string[],
    categories: [] as string[],
    destinations: [] as string[],
  }

  // 0. Parse "À vérifier" review sheet if present (DO NOT import as movement data; show as review list in wizard)
  const aVerifierSheet = sheetMap.get('À vérifier')
  if (aVerifierSheet) {
    const maxR = getSheetRowCount(aVerifierSheet)
    for (let r = 1; r < maxR; r++) {
      const category = toCleanString(getCellValue(aVerifierSheet, 0, r))
      const sheetOrigin = toCleanString(getCellValue(aVerifierSheet, 1, r))
      const reference = toCleanString(getCellValue(aVerifierSheet, 2, r))
      const label = toCleanString(getCellValue(aVerifierSheet, 3, r))
      const detail = toCleanString(getCellValue(aVerifierSheet, 4, r))
      const suggestedAction = toCleanString(getCellValue(aVerifierSheet, 5, r))
      if (!category && !reference && !label && !detail) continue
      aVerifierItems.push({
        rowNumber: r + 1,
        category: category || 'À vérifier',
        sheetOrigin: sheetOrigin || 'Workbook',
        reference,
        label,
        detail,
        suggestedAction: suggestedAction || 'Vérifier dans l’écran À corriger',
      })
    }
    sheetSummaries.push({
      sheetName: 'À vérifier',
      recognizedAs: 'À vérifier',
      totalSheetRows: maxR,
      realDataRows: aVerifierItems.length,
      missingColumns: [],
    })
  }

  // 1. Parse "Parametres" if present
  const paramSheet = sheetMap.get('Parametres')
  if (paramSheet) {
    const maxR = getSheetRowCount(paramSheet)
    for (let r = 1; r < maxR; r++) {
      const u = toCleanString(getCellValue(paramSheet, 0, r))
      const c = toCleanString(getCellValue(paramSheet, 1, r))
      const d = toCleanString(getCellValue(paramSheet, 2, r))
      if (u && !parametres.units.includes(u)) parametres.units.push(u)
      if (c && !parametres.categories.includes(c)) parametres.categories.push(c)
      if (d && !parametres.destinations.includes(d))
        parametres.destinations.push(d)
    }
    sheetSummaries.push({
      sheetName: 'Parametres',
      recognizedAs: 'Parametres',
      totalSheetRows: maxR,
      realDataRows: Math.max(
        parametres.units.length,
        parametres.categories.length,
        parametres.destinations.length
      ),
      missingColumns: [],
    })
  }

  // 2. Parse "Base Produits"
  // Columns: A Référence, B Produit, C Catégorie, D Unité, E Stock initial, F Stock minimum, G Prix U moyen (IGNORE), H Emplacement
  const prodSheet = sheetMap.get('Base Produits')
  const productRefLookup = new Map<string, ParsedProductRow>()
  if (prodSheet) {
    const maxR = getSheetRowCount(prodSheet)
    const missingCols: string[] = []
    const hA = toCleanString(getCellValue(prodSheet, 0, 0))
    const hB = toCleanString(getCellValue(prodSheet, 1, 0))
    if (!hA) missingCols.push('A (Référence)')
    if (!hB) missingCols.push('B (Produit)')

    for (let r = 1; r < maxR; r++) {
      const rowNumber = r + 1
      const rawRef = toCleanString(getCellValue(prodSheet, 0, r))
      const name = toCleanString(getCellValue(prodSheet, 1, r))
      const rawCategory = toCleanString(getCellValue(prodSheet, 2, r))
      const unit = toCleanString(getCellValue(prodSheet, 3, r))
      const rawInitStock = getCellValue(prodSheet, 4, r)
      const rawMinStock = getCellValue(prodSheet, 5, r)
      // Col 6 (G) is Prix U moyen formula -> intentionally ignored!
      const location = toCleanString(getCellValue(prodSheet, 7, r))

      // Skip empty template rows at the bottom of the sheet
      if (!rawRef && !name) {
        continue
      }

      const canonicalRef = normalizeProductRef(rawRef)
      const sourceRowId = `Base Produits:R${rowNumber}:${simpleHash(`${canonicalRef}|${name}`)}`
      const flags: string[] = []
      let blocking = false

      if (!canonicalRef) {
        blocking = true
        issues.push({
          id: `iss-prd-ref-${rowNumber}`,
          sheet: 'Base Produits',
          rowNumber,
          field: 'Référence',
          severity: 'BLOQUANT',
          reason: 'Référence produit manquante.',
          rawValue: rawRef,
          sourceRowId,
        })
      } else if (productRefLookup.has(canonicalRef)) {
        blocking = true
        issues.push({
          id: `iss-prd-dup-${rowNumber}`,
          sheet: 'Base Produits',
          rowNumber,
          field: 'Référence',
          severity: 'BLOQUANT',
          reason: `Référence produit en doublon dans Base Produits (${canonicalRef}).`,
          rawValue: rawRef,
          sourceRowId,
        })
      }

      if (!name) {
        blocking = true
        issues.push({
          id: `iss-prd-name-${rowNumber}`,
          sheet: 'Base Produits',
          rowNumber,
          field: 'Produit',
          severity: 'BLOQUANT',
          reason: 'Nom du produit manquant.',
          sourceRowId,
        })
      }

      if (!rawCategory || rawCategory === '0') {
        flags.push('Catégorie manquante')
        issues.push({
          id: `iss-prd-cat-${rowNumber}`,
          sheet: 'Base Produits',
          rowNumber,
          field: 'Catégorie',
          severity: 'À VÉRIFIER',
          reason: 'Produit sans catégorie renseignée.',
          rawValue: rawCategory,
          sourceRowId,
        })
      }

      const parsedInit = parseNumericCell(rawInitStock)
      const initialStock = parsedInit !== null ? parsedInit : 0
      if (parsedInit !== null && parsedInit < 0) {
        blocking = true
        issues.push({
          id: `iss-prd-init-${rowNumber}`,
          sheet: 'Base Produits',
          rowNumber,
          field: 'Stock initial',
          severity: 'BLOQUANT',
          reason: 'Stock initial négatif.',
          rawValue: String(rawInitStock),
          sourceRowId,
        })
      }

      const parsedMin = parseNumericCell(rawMinStock)
      const minStock =
        parsedMin !== null && parsedMin >= 0 ? parsedMin : null
      if (minStock === null) {
        issues.push({
          id: `iss-prd-min-${rowNumber}`,
          sheet: 'Base Produits',
          rowNumber,
          field: 'Stock minimum',
          severity: 'INFO',
          reason: 'Seuil minimum non défini (statut « À définir »).',
          sourceRowId,
        })
      }

      const rowObj: ParsedProductRow = {
        rowNumber,
        sourceRowId,
        rawRef: rawRef.trim(),
        canonicalRef,
        name,
        rawCategory:
          !rawCategory || rawCategory === '0' ? 'Non classé' : rawCategory,
        unit: unit || 'u',
        initialStock,
        minStock,
        location,
        blocking,
        flags,
      }
      products.push(rowObj)
      if (canonicalRef && !productRefLookup.has(canonicalRef)) {
        productRefLookup.set(canonicalRef, rowObj)
      }
    }

    sheetSummaries.push({
      sheetName: 'Base Produits',
      recognizedAs: 'Base Produits',
      totalSheetRows: maxR,
      realDataRows: products.length,
      missingColumns: missingCols,
    })
  }

  // 3. Parse "fournisseur"
  // Columns: A Fournisseur, B Contact, C Téléphone, D Email, E Conditions paiement, F Notes
  const supSheet = sheetMap.get('fournisseur')
  const supplierByNormalized = new Map<string, ParsedSupplierRow>()
  if (supSheet) {
    const maxR = getSheetRowCount(supSheet)
    for (let r = 1; r < maxR; r++) {
      const rowNumber = r + 1
      const name = toCleanString(getCellValue(supSheet, 0, r))
      const contact = toCleanString(getCellValue(supSheet, 1, r))
      const phone = toCleanString(getCellValue(supSheet, 2, r))
      const email = toCleanString(getCellValue(supSheet, 3, r))
      const paymentTerms = toCleanString(getCellValue(supSheet, 4, r))
      const notes = toCleanString(getCellValue(supSheet, 5, r))

      if (!name && !contact && !phone && !email) continue

      const normalizedName = normalizeSupplierName(name)
      const sourceRowId = `fournisseur:R${rowNumber}:${simpleHash(normalizedName)}`
      let blocking = false
      if (!normalizedName) {
        blocking = true
        issues.push({
          id: `iss-sup-name-${rowNumber}`,
          sheet: 'fournisseur',
          rowNumber,
          field: 'Fournisseur',
          severity: 'BLOQUANT',
          reason: 'Nom du fournisseur manquant.',
          sourceRowId,
        })
      }

      const supObj: ParsedSupplierRow = {
        rowNumber,
        sourceRowId,
        name,
        normalizedName,
        contact,
        phone,
        email,
        paymentTerms,
        notes,
        blocking,
      }
      suppliers.push(supObj)
      if (normalizedName && !supplierByNormalized.has(normalizedName)) {
        supplierByNormalized.set(normalizedName, supObj)
      }
    }

    sheetSummaries.push({
      sheetName: 'fournisseur',
      recognizedAs: 'fournisseur',
      totalSheetRows: maxR,
      realDataRows: suppliers.length,
      missingColumns: [],
    })
  }

  // 4. Parse "Entrées Stock"
  // Columns: A Date, B Référence, C Produit, D Quantité entrée, E Prix U (MAD), F Montant achat (formula, recompute), G Paiement facturé (OUI/NON), H Fournisseur, I Date paiement, L-Q extra notes
  const purSheet = sheetMap.get('Entrées Stock')
  const seenPurchaseSignatures = new Map<string, number>()
  const defaultSupplierChoices: Record<string, SupplierResolutionChoice> = {}
  const defaultDuplicateDecisions: Record<string, 'keep' | 'skip'> = {}

  if (purSheet) {
    const maxR = getSheetRowCount(purSheet)
    // Detect optional columns J..Q headers (e.g. N° BL/Facture, Saisi par, Observation)
    let invoiceColIdx = -1
    let recordedByColIdx = -1
    let observationColIdx = -1
    for (let c = 9; c <= 16; c++) {
      const h = normalizeSheetLookupName(toCleanString(getCellValue(purSheet, c, 0)))
      if (h.includes('facture') || h.includes('bl') || h.includes('bon')) {
        invoiceColIdx = c
      } else if (h.includes('saisi') || h.includes('enregistre') || h.includes('operateur')) {
        recordedByColIdx = c
      } else if (h.includes('observation') || h.includes('note') || h.includes('remarque')) {
        observationColIdx = c
      }
    }

    for (let r = 1; r < maxR; r++) {
      const rowNumber = r + 1
      const rawDateVal = getCellValue(purSheet, 0, r)
      const rawRef = toCleanString(getCellValue(purSheet, 1, r))
      const productName = toCleanString(getCellValue(purSheet, 2, r))
      const rawQtyVal = getCellValue(purSheet, 3, r)
      const rawPriceVal = getCellValue(purSheet, 4, r)
      const rawAmountVal = getCellValue(purSheet, 5, r)
      const rawPayment = toCleanString(getCellValue(purSheet, 6, r))
      const rawSupplier = toCleanString(getCellValue(purSheet, 7, r))
      const rawPaymentDateVal = getCellValue(purSheet, 8, r)

      const invoiceNo =
        invoiceColIdx >= 0
          ? toCleanString(getCellValue(purSheet, invoiceColIdx, r))
          : ''
      const recordedByName =
        recordedByColIdx >= 0
          ? toCleanString(getCellValue(purSheet, recordedByColIdx, r))
          : ''

      const noteParts: string[] = []
      if (observationColIdx >= 0) {
        const obs = toCleanString(getCellValue(purSheet, observationColIdx, r))
        if (obs && !/^(0|FAUX|VRAI|FALSE|TRUE)$/i.test(obs)) {
          noteParts.push(obs)
        }
      }
      for (let c = 9; c <= 16; c++) {
        if (c === invoiceColIdx || c === recordedByColIdx || c === observationColIdx) {
          continue
        }
        const val = toCleanString(getCellValue(purSheet, c, r))
        if (val && !/^(0|FAUX|VRAI|FALSE|TRUE)$/i.test(val)) {
          noteParts.push(val)
        }
      }
      const extraNotes = noteParts.join(' | ')

      // Skip empty template rows (up to row 5000)
      if (
        !toCleanString(rawDateVal) &&
        !rawRef &&
        !productName &&
        !toCleanString(rawQtyVal)
      ) {
        continue
      }

      const canonicalRef = normalizeProductRef(rawRef)
      const date = parseExcelDateToISO(rawDateVal)
      const qty = parseNumericCell(rawQtyVal)
      const unitPrice = parseNumericCell(rawPriceVal)
      const excelAmountValue = parseNumericCell(rawAmountVal)
      const paymentDate = parseExcelDateToISO(rawPaymentDateVal)

      const sourceRowId = `Entrées Stock:R${rowNumber}:${simpleHash(
        `${date ?? rawDateVal}|${canonicalRef}|${qty ?? ''}|${unitPrice ?? ''}|${rawSupplier}`
      )}`

      const flags: string[] = []
      let blocking = false

      if (!canonicalRef || !productRefLookup.has(canonicalRef)) {
        blocking = true
        issues.push({
          id: `iss-pur-ref-${rowNumber}`,
          sheet: 'Entrées Stock',
          rowNumber,
          field: 'Référence',
          severity: 'BLOQUANT',
          reason: !canonicalRef
            ? 'Référence produit manquante.'
            : `Référence « ${rawRef} » introuvable dans Base Produits.`,
          rawValue: rawRef,
          sourceRowId,
        })
      }

      if (!date) {
        blocking = true
        issues.push({
          id: `iss-pur-date-${rowNumber}`,
          sheet: 'Entrées Stock',
          rowNumber,
          field: 'Date',
          severity: 'BLOQUANT',
          reason: 'Date d’entrée manquante ou invalide.',
          rawValue: toCleanString(rawDateVal),
          sourceRowId,
        })
      }

      if (qty === null || qty <= 0) {
        blocking = true
        issues.push({
          id: `iss-pur-qty-${rowNumber}`,
          sheet: 'Entrées Stock',
          rowNumber,
          field: 'Quantité entrée',
          severity: 'BLOQUANT',
          reason:
            qty === null
              ? 'Quantité manquante ou non numérique.'
              : 'La quantité d’entrée doit être strictement positive.',
          rawValue: toCleanString(rawQtyVal),
          sourceRowId,
        })
      }

      if (unitPrice !== null && unitPrice < 0) {
        blocking = true
        issues.push({
          id: `iss-pur-price-neg-${rowNumber}`,
          sheet: 'Entrées Stock',
          rowNumber,
          field: 'Prix U (MAD)',
          severity: 'BLOQUANT',
          reason: 'Prix unitaire négatif.',
          rawValue: toCleanString(rawPriceVal),
          sourceRowId,
        })
      } else if (unitPrice === null || unitPrice === 0) {
        flags.push('Prix manquant')
        issues.push({
          id: `iss-pur-price-zero-${rowNumber}`,
          sheet: 'Entrées Stock',
          rowNumber,
          field: 'Prix U (MAD)',
          severity: 'À VÉRIFIER',
          reason: 'Prix manquant ou égal à 0 DH (aucun prix fictif inventé).',
          rawValue: toCleanString(rawPriceVal),
          sourceRowId,
        })
      }

      // Payment status OUI/NON check
      const upperPay = rawPayment.toUpperCase()
      let paymentStatus: PaymentStatus = 'unpaid'
      let isAmbiguousPayment = false
      if (upperPay === 'OUI' || upperPay === 'RÉGLÉ' || upperPay === 'REGLE') {
        paymentStatus = 'paid'
      } else if (
        upperPay === 'NON' ||
        upperPay === 'NON RÉGLÉ' ||
        upperPay === 'NON REGLE'
      ) {
        paymentStatus = 'unpaid'
      } else {
        isAmbiguousPayment = true
        paymentStatus = 'unpaid'
        const displayPay = rawPayment || '(Vide)'
        flags.push(`Paiement: ${displayPay}`)
        issues.push({
          id: `iss-pur-pay-${rowNumber}`,
          sheet: 'Entrées Stock',
          rowNumber,
          field: 'Paiement facturé',
          severity: 'À VÉRIFIER',
          reason: `Valeur de paiement autre que OUI/NON (« ${displayPay} »), mappée selon votre choix de confirmation.`,
          rawValue: displayPay,
          sourceRowId,
        })
      }

      // Check supplier matching against "fournisseur" sheet
      const supplierKey = rawSupplier || 'Fournisseur non renseigné'
      if (!defaultSupplierChoices[supplierKey]) {
        const normSup = normalizeSupplierName(supplierKey)
        const exactFound = suppliers.find((s) => s.name === supplierKey)
        const normFound = supplierByNormalized.get(normSup)
        if (exactFound) {
          defaultSupplierChoices[supplierKey] = {
            rawPurchaseSupplier: supplierKey,
            proposedSupplierName: exactFound.name,
            matchType: 'exact',
            action: 'map',
            targetSupplierName: exactFound.name,
          }
        } else if (normFound) {
          defaultSupplierChoices[supplierKey] = {
            rawPurchaseSupplier: supplierKey,
            proposedSupplierName: normFound.name,
            matchType: 'case_or_space',
            action: 'map',
            targetSupplierName: normFound.name,
          }
          issues.push({
            id: `iss-pur-sup-case-${rowNumber}`,
            sheet: 'Entrées Stock',
            rowNumber,
            field: 'Fournisseur',
            severity: 'INFO',
            reason: `Fournisseur « ${supplierKey} » rapproché de « ${normFound.name} » (casse/espaces).`,
            rawValue: supplierKey,
            sourceRowId,
          })
        } else {
          defaultSupplierChoices[supplierKey] = {
            rawPurchaseSupplier: supplierKey,
            proposedSupplierName: supplierKey,
            matchType: 'new',
            action: 'create',
            targetSupplierName: supplierKey,
          }
          issues.push({
            id: `iss-pur-sup-new-${rowNumber}`,
            sheet: 'Entrées Stock',
            rowNumber,
            field: 'Fournisseur',
            severity: 'À VÉRIFIER',
            reason: `Fournisseur « ${supplierKey} » absent de la feuille fournisseur (création proposée).`,
            rawValue: supplierKey,
            sourceRowId,
          })
        }
      }

      // Check migrated JOURNAL STOCK note
      const isMigratedJournalNote =
        /migr[eé]\s+journal\s+stock|[aà]\s+v[eé]rifier/i.test(extraNotes)
      if (isMigratedJournalNote) {
        flags.push('Migré JOURNAL STOCK ; à vérifier')
        issues.push({
          id: `iss-pur-mig-${rowNumber}`,
          sheet: 'Entrées Stock',
          rowNumber,
          field: 'Notes (L-Q)',
          severity: 'À VÉRIFIER',
          reason: `Note de migration détectée : « ${extraNotes} ».`,
          rawValue: extraNotes,
          sourceRowId,
        })
      }

      // Check duplicate candidate (same date + canonicalRef + qty + normalized supplier)
      const duplicateSignature = `PUR|${date ?? ''}|${canonicalRef}|${qty ?? ''}|${normalizeSupplierName(supplierKey)}`
      const firstRowWithSig = seenPurchaseSignatures.get(duplicateSignature)
      const isDuplicateCandidate = firstRowWithSig !== undefined
      if (isDuplicateCandidate) {
        flags.push(`Doublon potentiel (ligne ${firstRowWithSig})`)
        defaultDuplicateDecisions[sourceRowId] = 'keep'
        issues.push({
          id: `iss-pur-dup-${rowNumber}`,
          sheet: 'Entrées Stock',
          rowNumber,
          field: 'Ligne complète',
          severity: 'À VÉRIFIER',
          reason: `Ligne d’achat semblable à la ligne ${firstRowWithSig} (même date, produit, quantité et fournisseur). Choisissez Garder ou Ignorer.`,
          sourceRowId,
        })
      } else {
        seenPurchaseSignatures.set(duplicateSignature, rowNumber)
      }

      const computedAmount = computePurchaseLineAmount(
        qty ?? 0,
        unitPrice ?? 0
      )

      purchases.push({
        rowNumber,
        orderIndex: purchases.length + 1,
        sourceRowId,
        rawDate: toCleanString(rawDateVal),
        date,
        rawRef: rawRef.trim(),
        canonicalRef,
        productName:
          productName || productRefLookup.get(canonicalRef)?.name || '',
        qty,
        unitPrice,
        computedAmount,
        excelAmountValue,
        rawPaymentStatus: rawPayment,
        paymentStatus,
        isAmbiguousPayment,
        rawPaymentDate: toCleanString(rawPaymentDateVal),
        paymentDate,
        rawSupplier: supplierKey,
        invoiceNo,
        recordedByName,
        notes: extraNotes,
        isMigratedJournalNote,
        isDuplicateCandidate,
        duplicateSignature,
        blocking,
        flags,
      })
    }

    sheetSummaries.push({
      sheetName: 'Entrées Stock',
      recognizedAs: 'Entrées Stock',
      totalSheetRows: maxR,
      realDataRows: purchases.length,
      missingColumns: [],
    })
  }

  // 5. Parse "Sorties Stock"
  // Columns: A Date, B Référence, C Produit, D Quantité sortie, E Pertes, F-H formulas (ignore), I Destination, J-Q notes
  const extSheet = sheetMap.get('Sorties Stock')
  const seenExitSignatures = new Map<string, number>()
  if (extSheet) {
    const maxR = getSheetRowCount(extSheet)
    let recordedByColIdx = -1
    let observationColIdx = -1
    for (let c = 9; c <= 16; c++) {
      const h = normalizeSheetLookupName(toCleanString(getCellValue(extSheet, c, 0)))
      if (h.includes('saisi') || h.includes('enregistre') || h.includes('operateur')) {
        recordedByColIdx = c
      } else if (h.includes('observation') || h.includes('note') || h.includes('remarque')) {
        observationColIdx = c
      }
    }

    for (let r = 1; r < maxR; r++) {
      const rowNumber = r + 1
      const rawDateVal = getCellValue(extSheet, 0, r)
      const rawRef = toCleanString(getCellValue(extSheet, 1, r))
      const productName = toCleanString(getCellValue(extSheet, 2, r))
      const rawQtyConsumed = getCellValue(extSheet, 3, r)
      const rawQtyWasted = getCellValue(extSheet, 4, r)
      // F (col 5), G (col 6), H (col 7) are formulas -> ignore!
      const destination =
        toCleanString(getCellValue(extSheet, 8, r)) || 'Cuisine'
      const recordedByName =
        recordedByColIdx >= 0
          ? toCleanString(getCellValue(extSheet, recordedByColIdx, r))
          : ''
      const noteParts: string[] = []
      if (observationColIdx >= 0) {
        const obs = toCleanString(getCellValue(extSheet, observationColIdx, r))
        if (obs && !/^(0|FAUX|VRAI|FALSE|TRUE)$/i.test(obs)) {
          noteParts.push(obs)
        }
      }
      for (let c = 9; c <= 16; c++) {
        if (c === recordedByColIdx || c === observationColIdx) continue
        const val = toCleanString(getCellValue(extSheet, c, r))
        if (val && !/^(0|FAUX|VRAI|FALSE|TRUE)$/i.test(val)) {
          noteParts.push(val)
        }
      }
      const extraNotes = noteParts.join(' | ')

      if (
        !toCleanString(rawDateVal) &&
        !rawRef &&
        !productName &&
        !toCleanString(rawQtyConsumed) &&
        !toCleanString(rawQtyWasted)
      ) {
        continue
      }

      const canonicalRef = normalizeProductRef(rawRef)
      const date = parseExcelDateToISO(rawDateVal)
      const parsedConsumed = parseNumericCell(rawQtyConsumed)
      const parsedWasted = parseNumericCell(rawQtyWasted)
      const qtyConsumed = parsedConsumed ?? 0
      const qtyWasted = parsedWasted ?? 0

      const sourceRowId = `Sorties Stock:R${rowNumber}:${simpleHash(
        `${date ?? rawDateVal}|${canonicalRef}|${qtyConsumed}|${qtyWasted}|${destination}`
      )}`

      const flags: string[] = []
      let blocking = false

      if (!canonicalRef || !productRefLookup.has(canonicalRef)) {
        blocking = true
        issues.push({
          id: `iss-ext-ref-${rowNumber}`,
          sheet: 'Sorties Stock',
          rowNumber,
          field: 'Référence',
          severity: 'BLOQUANT',
          reason: !canonicalRef
            ? 'Référence produit manquante.'
            : `Référence « ${rawRef} » introuvable dans Base Produits.`,
          rawValue: rawRef,
          sourceRowId,
        })
      }

      if (!date) {
        blocking = true
        issues.push({
          id: `iss-ext-date-${rowNumber}`,
          sheet: 'Sorties Stock',
          rowNumber,
          field: 'Date',
          severity: 'BLOQUANT',
          reason: 'Date de sortie manquante ou invalide.',
          rawValue: toCleanString(rawDateVal),
          sourceRowId,
        })
      }

      if (
        qtyConsumed < 0 ||
        qtyWasted < 0 ||
        (qtyConsumed === 0 && qtyWasted === 0)
      ) {
        blocking = true
        issues.push({
          id: `iss-ext-qty-${rowNumber}`,
          sheet: 'Sorties Stock',
          rowNumber,
          field: 'Quantité sortie / Pertes',
          severity: 'BLOQUANT',
          reason:
            'Quantité de sortie ou perte invalide (négative ou nulle sur les deux colonnes).',
          rawValue: `${toCleanString(rawQtyConsumed)} / ${toCleanString(rawQtyWasted)}`,
          sourceRowId,
        })
      }

      const isMigratedJournalNote =
        /migr[eé]\s+journal\s+stock|[aà]\s+v[eé]rifier/i.test(extraNotes)
      if (isMigratedJournalNote) {
        flags.push('Migré JOURNAL STOCK ; à vérifier')
        issues.push({
          id: `iss-ext-mig-${rowNumber}`,
          sheet: 'Sorties Stock',
          rowNumber,
          field: 'Notes',
          severity: 'À VÉRIFIER',
          reason: `Note de migration détectée : « ${extraNotes} ».`,
          rawValue: extraNotes,
          sourceRowId,
        })
      }

      const duplicateSignature = `EXT|${date ?? ''}|${canonicalRef}|${qtyConsumed}|${qtyWasted}|${destination.toLowerCase()}`
      const firstRow = seenExitSignatures.get(duplicateSignature)
      const isDuplicateCandidate = firstRow !== undefined
      if (isDuplicateCandidate) {
        flags.push(`Doublon potentiel (ligne ${firstRow})`)
        defaultDuplicateDecisions[sourceRowId] = 'keep'
        issues.push({
          id: `iss-ext-dup-${rowNumber}`,
          sheet: 'Sorties Stock',
          rowNumber,
          field: 'Ligne complète',
          severity: 'À VÉRIFIER',
          reason: `Ligne de sortie semblable à la ligne ${firstRow} (même date, produit, quantité et destination).`,
          sourceRowId,
        })
      } else {
        seenExitSignatures.set(duplicateSignature, rowNumber)
      }

      exits.push({
        rowNumber,
        orderIndex: exits.length + 1,
        sourceRowId,
        rawDate: toCleanString(rawDateVal),
        date,
        rawRef: rawRef.trim(),
        canonicalRef,
        productName:
          productName || productRefLookup.get(canonicalRef)?.name || '',
        qtyConsumed,
        qtyWasted,
        destination,
        recordedByName,
        notes: extraNotes,
        isMigratedJournalNote,
        isDuplicateCandidate,
        duplicateSignature,
        blocking,
        flags,
      })
    }

    sheetSummaries.push({
      sheetName: 'Sorties Stock',
      recognizedAs: 'Sorties Stock',
      totalSheetRows: maxR,
      realDataRows: exits.length,
      missingColumns: [],
    })
  }

  // 6. Parse "Inventaire"
  // Columns: A Référence, B Produit, C Unité, D Stock théorique (formula, ignore), E Stock réel (manual count), F-H formulas (ignore), I Date inventaire.
  // Rule: ONLY rows where E (Stock réel) has a value are real counts!
  const invSheet = sheetMap.get('Inventaire')
  if (invSheet) {
    const maxR = getSheetRowCount(invSheet)
    for (let r = 1; r < maxR; r++) {
      const rowNumber = r + 1
      const rawCountedVal = getCellValue(invSheet, 4, r) // Column E: Stock réel
      if (
        rawCountedVal === null ||
        rawCountedVal === undefined ||
        toCleanString(rawCountedVal) === ''
      ) {
        continue
      }

      const counted = parseNumericCell(rawCountedVal)
      if (counted === null) continue

      const rawRef = toCleanString(getCellValue(invSheet, 0, r))
      const productName = toCleanString(getCellValue(invSheet, 1, r))
      const unit = toCleanString(getCellValue(invSheet, 2, r))
      const colI = getCellValue(invSheet, 8, r)
      const colG = getCellValue(invSheet, 6, r)
      const rawDateVal =
        parseExcelDateToISO(colI) !== null
          ? colI
          : parseExcelDateToISO(colG) !== null
            ? colG
            : colI || colG

      const canonicalRef = normalizeProductRef(rawRef)
      const date = parseExcelDateToISO(rawDateVal)
      const sourceRowId = `Inventaire:R${rowNumber}:${simpleHash(
        `${canonicalRef}|${counted}|${date ?? rawDateVal}`
      )}`

      const flags: string[] = []
      let blocking = false

      if (!canonicalRef || !productRefLookup.has(canonicalRef)) {
        blocking = true
        issues.push({
          id: `iss-inv-ref-${rowNumber}`,
          sheet: 'Inventaire',
          rowNumber,
          field: 'Référence',
          severity: 'BLOQUANT',
          reason: !canonicalRef
            ? 'Référence produit manquante sur le comptage.'
            : `Référence « ${rawRef} » introuvable dans Base Produits.`,
          rawValue: rawRef,
          sourceRowId,
        })
      }

      if (counted < 0) {
        blocking = true
        issues.push({
          id: `iss-inv-neg-${rowNumber}`,
          sheet: 'Inventaire',
          rowNumber,
          field: 'Stock réel',
          severity: 'BLOQUANT',
          reason: 'Le stock réel compté ne peut pas être négatif.',
          rawValue: String(rawCountedVal),
          sourceRowId,
        })
      }

      if (!date) {
        flags.push('Date inventaire manquante (date de session par défaut)')
        issues.push({
          id: `iss-inv-date-${rowNumber}`,
          sheet: 'Inventaire',
          rowNumber,
          field: 'Date inventaire',
          severity: 'À VÉRIFIER',
          reason:
            'Date d’inventaire non précisée sur la ligne ; utilisera la date de session confirmée.',
          rawValue: toCleanString(rawDateVal),
          sourceRowId,
        })
      }

      inventories.push({
        rowNumber,
        orderIndex: inventories.length + 1,
        sourceRowId,
        rawRef,
        canonicalRef,
        productName:
          productName || productRefLookup.get(canonicalRef)?.name || '',
        unit: unit || productRefLookup.get(canonicalRef)?.unit || 'u',
        counted,
        rawDate: toCleanString(rawDateVal),
        date,
        blocking,
        flags,
      })
    }

    sheetSummaries.push({
      sheetName: 'Inventaire',
      recognizedAs: 'Inventaire',
      totalSheetRows: maxR,
      realDataRows: inventories.length,
      missingColumns: [],
    })
  }

  // Build distinct categories and default mapping
  const distinctProductCategories = Array.from(
    new Set(products.map((p) => p.rawCategory).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'fr'))

  const defaultCategoryMapping: Record<string, string> = {}
  for (const cat of distinctProductCategories) {
    defaultCategoryMapping[cat] = cat
  }

  const zeroInitialStockCount = products.filter(
    (p) => p.initialStock === 0
  ).length
  const missingMinStockCount = products.filter(
    (p) => p.minStock === null
  ).length
  const distinctInventoryDates = Array.from(
    new Set(inventories.map((i) => i.date).filter((d): d is string => Boolean(d)))
  ).sort()
  const ambiguousPaymentCount = purchases.filter(
    (p) => p.isAmbiguousPayment
  ).length

  return {
    fileName,
    fileSize,
    sheetsFound,
    ignoredSheetsFound,
    missingExpectedSheets,
    sheetSummaries,
    products,
    suppliers,
    purchases,
    exits,
    inventories,
    aVerifierItems,
    aVerifierRows: aVerifierItems,
    ambiguousPaymentCount,
    parametres,
    issues,
    distinctProductCategories,
    defaultCategoryMapping,
    defaultSupplierChoices,
    defaultDuplicateDecisions,
    zeroInitialStockCount,
    missingMinStockCount,
    distinctInventoryDates,
  }
}

export const parseWorkbookBuffer = parseAndValidateWorkbook

export function buildDefaultImportDecisions(
  parsed: ParsedWorkbookResult
): ImportUserDecisions {
  return {
    vatConvention: 'TTC',
    vatConfirmed: true,
    ambiguousPaymentDecision: 'unpaid',
    categoryMapping: { ...parsed.defaultCategoryMapping },
    supplierChoices: { ...parsed.defaultSupplierChoices },
    duplicateDecisions: { ...parsed.defaultDuplicateDecisions },
    updateExistingProducts: false,
    updateExistingSuppliers: false,
    fallbackInventoryDate: parsed.distinctInventoryDates[0] || '2026-10-13',
  }
}

const PRE_IMPORT_BACKUP_STORAGE_KEY = 'monarq_pre_import_backup_latest'
let latestPreImportBackupMemory: {
  location: string
  createdAt: string
  fileName: string
  payload: BackupPayload
} | null = null

export function getLatestPreImportBackup(): {
  location: string
  createdAt: string
  fileName: string
  payload: BackupPayload
} | null {
  if (latestPreImportBackupMemory) return latestPreImportBackupMemory
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(PRE_IMPORT_BACKUP_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && parsed.payload) {
          latestPreImportBackupMemory = parsed
          return parsed
        }
      }
    }
  } catch {
    // Ignore storage read error
  }
  return null
}

export async function restorePreImportBackup(
  repo: DataRepository
): Promise<boolean> {
  const backup = getLatestPreImportBackup()
  if (!backup) {
    const settings = await repo.listSettings()
    const saved = settings.find((s) => s.key === 'last_pre_import_backup')
    if (saved && saved.value && typeof saved.value === 'object') {
      const obj = saved.value as { payload?: BackupPayload }
      if (obj.payload) {
        await repo.restoreBackup(obj.payload)
        return true
      }
    }
    return false
  }
  await repo.restoreBackup(backup.payload)
  return true
}

/**
 * Executes either a dry-run simulation or a real transactional idempotent import
 * into the active DataRepository, returning the full ReconciliationReport.
 */
export async function executeWorkbookImport(
  parsed: ParsedWorkbookResult,
  decisions: ImportUserDecisions,
  repo: DataRepository,
  options: {
    dryRun: boolean
    onProgress?: (percent: number, stageLabel: string) => void
  }
): Promise<ReconciliationReport> {
  const { dryRun, onProgress } = options
  const reportProgress = (pct: number, label: string) => {
    if (onProgress) onProgress(pct, label)
  }

  reportProgress(5, 'Lecture de l’état actuel de la base...')

  const [
    existingProducts,
    existingSuppliers,
    existingPurchases,
    existingExits,
    existingInventories,
  ] = await Promise.all([
    repo.listProducts(),
    repo.listSuppliers(),
    repo.listPurchases(),
    repo.listExits(),
    repo.listInventories(),
  ])

  const batchSourceId = `excel-${simpleHash(
    `${parsed.fileName}|${parsed.products.length}|${parsed.purchases.length}|${parsed.exits.length}|${parsed.inventories.length}`
  )}`

  // Track existing IDs and source_row_id sets for idempotency
  const productByRef = new Map(
    existingProducts.map((p) => [normalizeProductRef(p.ref), p])
  )
  const supplierByNormName = new Map(
    existingSuppliers.map((s) => [normalizeSupplierName(s.name), s])
  )

  const reversedPurchaseIds = new Set(
    existingPurchases.headers
      .map((h) => h.reversed_of)
      .filter((id): id is string => Boolean(id))
  )
  const activePurchaseSourceRowIds = new Set(
    existingPurchases.lines
      .filter((l) => !reversedPurchaseIds.has(l.purchase))
      .map((l) => l.source_row_id)
      .filter((id): id is string => Boolean(id))
  )

  const reversedExitIds = new Set(
    existingExits.headers
      .map((h) => h.reversed_of)
      .filter((id): id is string => Boolean(id))
  )
  const activeExitSourceRowIds = new Set(
    existingExits.lines
      .filter((l) => !reversedExitIds.has(l.exit))
      .map((l) => l.source_row_id)
      .filter((id): id is string => Boolean(id))
  )

  const activeSessionIds = new Set(
    existingInventories.sessions
      .filter((s) => s.status === 'confirmed')
      .map((s) => s.id)
  )
  const activeInventorySourceRowIds = new Set(
    existingInventories.lines
      .filter((l) => activeSessionIds.has(l.session))
      .map((l) => l.source_row_id)
      .filter((id): id is string => Boolean(id))
  )

  // Counters per sheet
  const statsMap: Record<ImportSheetKey, SheetReconciliationStats> = {
    'Base Produits': {
      sheet: 'Base Produits',
      rowsRead: parsed.products.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsFlagged: parsed.products.filter((p) => p.flags.length > 0).length,
    },
    fournisseur: {
      sheet: 'fournisseur',
      rowsRead: parsed.suppliers.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsFlagged: 0,
    },
    'Entrées Stock': {
      sheet: 'Entrées Stock',
      rowsRead: parsed.purchases.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsFlagged: parsed.purchases.filter((p) => p.flags.length > 0).length,
    },
    'Sorties Stock': {
      sheet: 'Sorties Stock',
      rowsRead: parsed.exits.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsFlagged: parsed.exits.filter((x) => x.flags.length > 0).length,
    },
    Inventaire: {
      sheet: 'Inventaire',
      rowsRead: parsed.inventories.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsFlagged: parsed.inventories.filter((i) => i.flags.length > 0).length,
    },
    Parametres: {
      sheet: 'Parametres',
      rowsRead:
        parsed.parametres.units.length +
        parsed.parametres.categories.length +
        parsed.parametres.destinations.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsFlagged: 0,
    },
    'À vérifier': {
      sheet: 'À vérifier',
      rowsRead: parsed.aVerifierRows.length,
      rowsImported: 0,
      rowsSkipped: parsed.aVerifierRows.length,
      rowsFlagged: parsed.aVerifierRows.length,
    },
  }

  let autoBackupLocation: string | undefined
  let autoBackupCreatedAt: string | undefined

  if (!dryRun) {
    reportProgress(10, 'Création de la sauvegarde automatique pré-import...')
    const backup = await repo.exportBackup()
    autoBackupCreatedAt = backup.exported_at
    autoBackupLocation = `localStorage["monarq_pre_import_backup_latest"] + settings["last_pre_import_backup"] (${backup.exported_at})`
    latestPreImportBackupMemory = {
      location: autoBackupLocation,
      createdAt: autoBackupCreatedAt,
      fileName: parsed.fileName,
      payload: backup,
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          'monarq_pre_import_backup_latest',
          JSON.stringify(backup)
        )
      } catch {
        // Ignore storage quota warning
      }
    }
    await repo.upsertSetting('last_pre_import_backup', {
      created_at: backup.exported_at,
      location: 'localStorage["monarq_pre_import_backup_latest"]',
      counts: {
        products: backup.collections.products.length,
        suppliers: backup.collections.suppliers.length,
        purchases: backup.collections.purchases.length,
        exits: backup.collections.exits.length,
        inventories: backup.collections.inventory_sessions.length,
      },
    })
  }

  // 1. Settings (VAT convention + Parametres lists)
  reportProgress(15, 'Configuration des paramètres (TVA, unités, catégories)...')
  const finalCategories = Array.from(
    new Set([
      ...parsed.parametres.categories,
      ...Object.values(decisions.categoryMapping),
    ])
  ).filter(Boolean)
  const finalUnits = Array.from(
    new Set([
      ...parsed.parametres.units,
      ...parsed.products.map((p) => p.unit),
    ])
  ).filter(Boolean)
  const finalDestinations = Array.from(
    new Set([
      ...parsed.parametres.destinations,
      ...parsed.exits.map((x) => x.destination),
    ])
  ).filter(Boolean)

  if (!dryRun) {
    await repo.upsertSetting('vat_convention', decisions.vatConvention)
    await repo.upsertSetting('categories_list', finalCategories)
    await repo.upsertSetting('units_list', finalUnits)
    await repo.upsertSetting('destinations_list', finalDestinations)
  }
  statsMap.Parametres.rowsImported = statsMap.Parametres.rowsRead

  // 2. Suppliers ("fournisseur" + any new suppliers confirmed in supplierChoices)
  reportProgress(25, 'Traitement des fournisseurs...')
  for (const sup of parsed.suppliers) {
    if (sup.blocking) {
      statsMap.fournisseur.rowsSkipped++
      continue
    }
    const existing = supplierByNormName.get(sup.normalizedName)
    if (existing) {
      if (decisions.updateExistingSuppliers) {
        if (!dryRun) {
          const updated = await repo.updateSupplier(existing.id, {
            contact: sup.contact || existing.contact,
            phone: sup.phone || existing.phone,
            email: sup.email || existing.email,
            payment_terms: sup.paymentTerms || existing.payment_terms,
            notes: sup.notes || existing.notes,
          })
          supplierByNormName.set(sup.normalizedName, updated)
        }
        statsMap.fournisseur.rowsImported++
      } else {
        statsMap.fournisseur.rowsSkipped++
      }
    } else {
      if (!dryRun) {
        const created = await repo.createSupplier({
          name: sup.name,
          contact: sup.contact,
          phone: sup.phone,
          email: sup.email,
          payment_terms: sup.paymentTerms,
          notes: sup.notes,
          source_row_id: sup.sourceRowId,
          import_batch_id: batchSourceId,
        })
        supplierByNormName.set(sup.normalizedName, created)
      } else {
        supplierByNormName.set(sup.normalizedName, {
          id: `sim-sup-${sup.rowNumber}`,
          name: sup.name,
          contact: sup.contact,
          phone: sup.phone,
          email: sup.email,
          payment_terms: sup.paymentTerms,
          notes: sup.notes,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
      statsMap.fournisseur.rowsImported++
    }
  }

  // Ensure any supplier referenced in purchases via supplierChoices exists
  for (const choice of Object.values(decisions.supplierChoices)) {
    const targetName = choice.targetSupplierName.trim()
    const normTarget = normalizeSupplierName(targetName)
    if (normTarget && !supplierByNormName.has(normTarget)) {
      if (!dryRun) {
        const created = await repo.createSupplier({
          name: targetName,
          contact: '',
          phone: '',
          email: '',
          payment_terms: '',
          notes: 'Créé automatiquement lors de l’import des Entrées Stock',
          missing_from_supplier_sheet: true,
          import_batch_id: batchSourceId,
        })
        supplierByNormName.set(normTarget, created)
      } else {
        supplierByNormName.set(normTarget, {
          id: `sim-sup-auto-${normTarget}`,
          name: targetName,
          contact: '',
          phone: '',
          email: '',
          payment_terms: '',
          notes: '',
          missing_from_supplier_sheet: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
    }
  }

  // 3. Products ("Base Produits")
  reportProgress(40, 'Traitement du catalogue Base Produits...')
  for (let i = 0; i < parsed.products.length; i++) {
    const prd = parsed.products[i]
    if (prd.blocking) {
      statsMap['Base Produits'].rowsSkipped++
      continue
    }
    const mappedCategory =
      decisions.categoryMapping[prd.rawCategory] || prd.rawCategory
    const existing = productByRef.get(prd.canonicalRef)
    if (existing) {
      if (decisions.updateExistingProducts) {
        if (!dryRun) {
          const updated = await repo.updateProduct(existing.id, {
            name: prd.name,
            category: mappedCategory,
            unit: prd.unit,
            initial_stock: prd.initialStock,
            min_stock: prd.minStock,
            location: prd.location,
          })
          productByRef.set(prd.canonicalRef, updated)
        }
        statsMap['Base Produits'].rowsImported++
      } else {
        statsMap['Base Produits'].rowsSkipped++
      }
    } else {
      const preservedRef = prd.rawRef.trim() || prd.canonicalRef
      if (!dryRun) {
        const created = await repo.createProduct({
          ref: preservedRef,
          name: prd.name,
          category: mappedCategory,
          unit: prd.unit,
          initial_stock: prd.initialStock,
          min_stock: prd.minStock,
          location: prd.location,
          archived: false,
          source_row_id: prd.sourceRowId,
          import_batch_id: batchSourceId,
        })
        productByRef.set(prd.canonicalRef, created)
      } else {
        productByRef.set(prd.canonicalRef, {
          id: `sim-prd-${prd.canonicalRef}`,
          ref: preservedRef,
          name: prd.name,
          category: mappedCategory,
          unit: prd.unit,
          initial_stock: prd.initialStock,
          min_stock: prd.minStock,
          location: prd.location,
          archived: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
      statsMap['Base Produits'].rowsImported++
    }
  }

  // 4. Purchases ("Entrées Stock")
  reportProgress(60, 'Importation des Entrées Stock...')
  let totalPurchaseAmountExcel = 0
  let totalPurchaseAmountImported = 0

  const resolvedAmbiguousPaymentStatus: PaymentStatus =
    decisions.ambiguousPaymentDecision === 'paid' ? 'paid' : 'unpaid'

  for (const pur of parsed.purchases) {
    totalPurchaseAmountExcel = round2(
      totalPurchaseAmountExcel + pur.computedAmount
    )

    if (pur.blocking) {
      statsMap['Entrées Stock'].rowsSkipped++
      continue
    }
    if (
      pur.isDuplicateCandidate &&
      decisions.duplicateDecisions[pur.sourceRowId] === 'skip'
    ) {
      statsMap['Entrées Stock'].rowsSkipped++
      continue
    }
    if (activePurchaseSourceRowIds.has(pur.sourceRowId)) {
      statsMap['Entrées Stock'].rowsSkipped++
      continue
    }

    const product = productByRef.get(pur.canonicalRef)
    if (!product || !pur.date || pur.qty === null) {
      statsMap['Entrées Stock'].rowsSkipped++
      continue
    }

    const supChoice = decisions.supplierChoices[pur.rawSupplier]
    const targetSupplierName =
      supChoice?.targetSupplierName || pur.rawSupplier
    const supplier = supplierByNormName.get(
      normalizeSupplierName(targetSupplierName)
    )

    const effectivePaymentStatus: PaymentStatus = pur.isAmbiguousPayment
      ? resolvedAmbiguousPaymentStatus
      : pur.paymentStatus

    if (!dryRun) {
      await repo.createPurchaseDocument({
        date: pur.date,
        supplier: supplier?.id ?? targetSupplierName,
        invoice_no: pur.invoiceNo || '',
        payment_status: effectivePaymentStatus,
        payment_date:
          effectivePaymentStatus === 'paid'
            ? pur.paymentDate || pur.date
            : null,
        notes: pur.notes,
        raw_payment_status: pur.rawPaymentStatus,
        is_ambiguous_payment: pur.isAmbiguousPayment,
        recorded_by_name: pur.recordedByName,
        import_batch_id: batchSourceId,
        order_index: pur.orderIndex,
        lines: [
          {
            product: product.id,
            qty: pur.qty,
            unit_price: pur.unitPrice ?? 0,
            source_row_id: pur.sourceRowId,
            order_index: pur.orderIndex,
            is_duplicate_candidate: pur.isDuplicateCandidate,
          },
        ],
      })
    }

    activePurchaseSourceRowIds.add(pur.sourceRowId)
    totalPurchaseAmountImported = round2(
      totalPurchaseAmountImported + pur.computedAmount
    )
    statsMap['Entrées Stock'].rowsImported++
  }

  // 5. Exits ("Sorties Stock")
  reportProgress(75, 'Importation des Sorties Stock...')
  for (const ext of parsed.exits) {
    if (ext.blocking) {
      statsMap['Sorties Stock'].rowsSkipped++
      continue
    }
    if (
      ext.isDuplicateCandidate &&
      decisions.duplicateDecisions[ext.sourceRowId] === 'skip'
    ) {
      statsMap['Sorties Stock'].rowsSkipped++
      continue
    }
    if (activeExitSourceRowIds.has(ext.sourceRowId)) {
      statsMap['Sorties Stock'].rowsSkipped++
      continue
    }

    const product = productByRef.get(ext.canonicalRef)
    if (!product || !ext.date) {
      statsMap['Sorties Stock'].rowsSkipped++
      continue
    }

    if (!dryRun) {
      await repo.createExitDocument({
        date: ext.date,
        destination: ext.destination,
        notes: ext.notes,
        recorded_by_name: ext.recordedByName,
        skipNegativeStockGuard: true,
        import_batch_id: batchSourceId,
        order_index: ext.orderIndex,
        lines: [
          {
            product: product.id,
            qty_consumed: ext.qtyConsumed,
            qty_wasted: ext.qtyWasted,
            source_row_id: ext.sourceRowId,
            order_index: ext.orderIndex,
            is_duplicate_candidate: ext.isDuplicateCandidate,
          },
        ],
      })
    }

    activeExitSourceRowIds.add(ext.sourceRowId)
    statsMap['Sorties Stock'].rowsImported++
  }

  // 6. Inventories ("Inventaire") -> ONE confirmed inventory session per distinct date
  reportProgress(88, 'Création des sessions d’inventaire confirmées...')
  const invByDate = new Map<string, ParsedInventoryRow[]>()
  for (const inv of parsed.inventories) {
    if (inv.blocking) {
      statsMap.Inventaire.rowsSkipped++
      continue
    }
    if (activeInventorySourceRowIds.has(inv.sourceRowId)) {
      statsMap.Inventaire.rowsSkipped++
      continue
    }
    const sessionDate = inv.date || decisions.fallbackInventoryDate
    if (!sessionDate) {
      statsMap.Inventaire.rowsSkipped++
      continue
    }
    const list = invByDate.get(sessionDate) ?? []
    list.push(inv)
    invByDate.set(sessionDate, list)
  }

  // Prepare movements for Rule 2h theoretical calculation on imported inventories
  const allEntriesForInv = parsed.purchases
    .filter((p) => !p.blocking && p.qty !== null && p.date)
    .map((p) => {
      const prd = productByRef.get(p.canonicalRef)
      return {
        id: p.sourceRowId,
        productId: prd?.id ?? p.canonicalRef,
        date: p.date!,
        qty: p.qty!,
        unitPrice: p.unitPrice ?? 0,
        amount: p.computedAmount,
      }
    })
  const allExitsForInv = parsed.exits
    .filter((x) => !x.blocking && x.date)
    .map((x) => {
      const prd = productByRef.get(x.canonicalRef)
      return {
        id: x.sourceRowId,
        productId: prd?.id ?? x.canonicalRef,
        date: x.date!,
        qtyConsumed: x.qtyConsumed,
        qtyWasted: x.qtyWasted,
      }
    })

  for (const [sessionDate, rows] of invByDate.entries()) {
    const validLines: Array<{
      product: string
      theoretical: number
      counted: number
      diff: number
      value_diff: number | null
      source_row_id: string
      order_index: number
    }> = []

    for (const r of rows) {
      const product = productByRef.get(r.canonicalRef)
      if (!product) {
        statsMap.Inventaire.rowsSkipped++
        continue
      }
      const rawAvg = computeRawWeightedAveragePrice(
        product.id,
        allEntriesForInv
      )
      const prodEntriesTotal = allEntriesForInv
        .filter((e) => e.productId === product.id)
        .reduce((acc, e) => acc + e.qty, 0)
      const prodConsumedTotal = allExitsForInv
        .filter((x) => x.productId === product.id)
        .reduce((acc, x) => acc + x.qtyConsumed, 0)
      const prodWastedTotal = allExitsForInv
        .filter((x) => x.productId === product.id)
        .reduce((acc, x) => acc + x.qtyWasted, 0)

      const calc = computeInventoryExcelTheoretical({
        initialStock: product.initial_stock,
        totalEntries: prodEntriesTotal,
        totalConsumed: prodConsumedTotal,
        totalWasted: prodWastedTotal,
        counted: r.counted,
        rawAveragePrice: rawAvg,
      })

      validLines.push({
        product: product.id,
        theoretical: calc.theoretical,
        counted: r.counted,
        diff: calc.diff,
        value_diff: calc.valueDiff,
        source_row_id: r.sourceRowId,
        order_index: r.orderIndex,
      })
      activeInventorySourceRowIds.add(r.sourceRowId)
      statsMap.Inventaire.rowsImported++
    }

    if (validLines.length > 0 && !dryRun) {
      await repo.createImportedInventorySession({
        date: sessionDate,
        confirmed_by: 'Import Excel',
        notes: `Import Excel (${parsed.fileName}) — ${validLines.length} produits comptés`,
        import_batch_id: batchSourceId,
        lines: validLines,
      })
    }
  }

  // 7. Record import_batches entry if not dryRun
  const sheetStats = [
    statsMap['Base Produits'],
    statsMap.fournisseur,
    statsMap['Entrées Stock'],
    statsMap['Sorties Stock'],
    statsMap.Inventaire,
    statsMap.Parametres,
    ...(parsed.aVerifierRows.length > 0 ? [statsMap['À vérifier']] : []),
  ]

  const totalRowsRead = sheetStats.reduce((s, x) => s + x.rowsRead, 0)
  const totalRowsImported = sheetStats.reduce((s, x) => s + x.rowsImported, 0)
  const totalRowsSkipped = sheetStats.reduce((s, x) => s + x.rowsSkipped, 0)
  const totalRowsFlagged = sheetStats.reduce((s, x) => s + x.rowsFlagged, 0)

  let createdBatchId = `dryrun-${batchSourceId}`
  if (!dryRun) {
    const batch = await repo.createImportBatch({
      source_id: batchSourceId,
      filename: parsed.fileName,
      status: 'completed',
      counts: {
        rows_read: totalRowsRead,
        rows_imported: totalRowsImported,
        rows_skipped: totalRowsSkipped,
        rows_flagged: totalRowsFlagged,
      },
    })
    createdBatchId = batch.id
  }

  // 8. Compute post-import Stock Status breakdown and unpaid invoices summary
  reportProgress(96, 'Calcul de la réconciliation et des statuts de stock...')

  const finalProducts = dryRun
    ? Array.from(productByRef.values())
    : await repo.listProducts()
  const finalSuppliers = dryRun
    ? Array.from(supplierByNormName.values())
    : await repo.listSuppliers()

  let allPurchaseHeaders = existingPurchases.headers
  let allPurchaseLines = existingPurchases.lines
  let allExitHeaders = existingExits.headers
  let allExitLines = existingExits.lines
  let allInvSessions = existingInventories.sessions
  let allInvLines = existingInventories.lines

  if (!dryRun) {
    const [p, x, inv] = await Promise.all([
      repo.listPurchases(),
      repo.listExits(),
      repo.listInventories(),
    ])
    allPurchaseHeaders = p.headers
    allPurchaseLines = p.lines
    allExitHeaders = x.headers
    allExitLines = x.lines
    allInvSessions = inv.sessions
    allInvLines = inv.lines
  }

  // Calculate stock statuses via stock-engine
  const stockStatusCounts: ReconciliationReport['stockStatusCounts'] = {
    Alerte: 0,
    'À surveiller': 0,
    OK: 0,
    'À définir': 0,
  }

  const engineEntries = allPurchaseLines.map((pl) => {
    const h = allPurchaseHeaders.find((p) => p.id === pl.purchase)
    return {
      id: pl.id,
      productId: pl.product,
      date: h?.date ?? pl.created_at,
      qty: pl.qty,
      unitPrice: pl.unit_price,
      amount: pl.amount,
      reversedOfId: h?.reversed_of ?? null,
    }
  })

  const engineExits = allExitLines.map((xl) => {
    const h = allExitHeaders.find((x) => x.id === xl.exit)
    return {
      id: xl.id,
      productId: xl.product,
      date: h?.date ?? xl.created_at,
      qtyConsumed: xl.qty_consumed,
      qtyWasted: xl.qty_wasted,
    }
  })

  const engineCounts = allInvLines
    .map((il) => {
      const s = allInvSessions.find(
        (sess) => sess.id === il.session && sess.status === 'confirmed'
      )
      if (!s) return null
      return {
        id: il.id,
        sessionId: s.id,
        productId: il.product,
        date: s.confirmed_at || s.date,
        counted: il.counted,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  for (const prod of finalProducts) {
    const res = computeProductStock(
      {
        id: prod.id,
        ref: prod.ref,
        name: prod.name,
        initialStock: prod.initial_stock,
        minStock: prod.min_stock,
      },
      engineEntries,
      engineExits,
      engineCounts
    )
    stockStatusCounts[res.status]++
  }

  // Unpaid invoices count & amount
  let unpaidInvoicesCount = 0
  let unpaidInvoicesAmount = 0

  if (dryRun) {
    for (const p of parsed.purchases) {
      const effectivePay = p.isAmbiguousPayment
        ? resolvedAmbiguousPaymentStatus
        : p.paymentStatus
      if (!p.blocking && effectivePay === 'unpaid') {
        unpaidInvoicesCount++
        unpaidInvoicesAmount = round2(unpaidInvoicesAmount + p.computedAmount)
      }
    }
  } else {
    const reversedSet = new Set(
      allPurchaseHeaders
        .map((h) => h.reversed_of)
        .filter((id): id is string => Boolean(id))
    )
    for (const h of allPurchaseHeaders) {
      if (h.reversed_of || reversedSet.has(h.id)) continue
      if (h.payment_status === 'unpaid') {
        unpaidInvoicesCount++
        const linesAmt = allPurchaseLines
          .filter((l) => l.purchase === h.id)
          .reduce((acc, l) => acc + l.amount, 0)
        unpaidInvoicesAmount = round2(unpaidInvoicesAmount + linesAmt)
      }
    }
  }

  const amountDifference = round2(
    Math.abs(totalPurchaseAmountExcel - totalPurchaseAmountImported)
  )
  const blockingCount = parsed.issues.filter(
    (i) => i.severity === 'BLOQUANT'
  ).length
  const verdict: 'GREEN' | 'RED' =
    blockingCount === 0 && amountDifference < 0.05 ? 'GREEN' : 'RED'
  const verdictMessage =
    verdict === 'GREEN'
      ? 'Réconciliation conforme : 0 anomalie bloquante et concordance exacte des montants d’achats.'
      : `${blockingCount} ligne(s) bloquante(s) ou écart de ${amountDifference.toFixed(2)} DH entre le total Excel et les lignes importées.`

  reportProgress(100, 'Terminé')

  return {
    batchId: createdBatchId,
    sourceId: batchSourceId,
    fileName: parsed.fileName,
    executedAt: new Date().toISOString(),
    dryRun,
    vatConvention: decisions.vatConvention,
    verdict,
    verdictMessage,
    sheetStats,
    totalPurchaseAmountExcel,
    totalPurchaseAmountImported,
    amountDifference,
    totalProductsInDb: finalProducts.length,
    totalSuppliersInDb: finalSuppliers.length,
    unpaidInvoicesCount,
    unpaidInvoicesAmount,
    stockStatusCounts,
    first20FlaggedRows: parsed.issues.slice(0, 20),
    autoBackupLocation,
    autoBackupCreatedAt,
  }
}

/**
 * Generates a CSV string for the reconciliation report download button.
 */
export function buildReconciliationCsv(report: ReconciliationReport): string {
  const lines: string[] = [
    'Section;Indicateur;Valeur',
    `Lot;ID Lot;${report.sourceId}`,
    `Lot;Fichier;${report.fileName}`,
    `Lot;Mode;${report.dryRun ? 'Simulation (Dry Run)' : 'Import réel'}`,
    `Lot;Verdict;${report.verdict} - ${report.verdictMessage}`,
    `Lot;Convention prix;${report.vatConvention}`,
    `Finances;Total achats Excel (DH);${report.totalPurchaseAmountExcel.toFixed(2)}`,
    `Finances;Total achats importés (DH);${report.totalPurchaseAmountImported.toFixed(2)}`,
    `Finances;Écart (DH);${report.amountDifference.toFixed(2)}`,
    `Finances;Factures impayées (nombre);${report.unpaidInvoicesCount}`,
    `Finances;Factures impayées (montant DH);${report.unpaidInvoicesAmount.toFixed(2)}`,
    `Base;Produits en base;${report.totalProductsInDb}`,
    `Base;Fournisseurs en base;${report.totalSuppliersInDb}`,
    `Statuts Stock;Alerte;${report.stockStatusCounts.Alerte}`,
    `Statuts Stock;À surveiller;${report.stockStatusCounts['À surveiller']}`,
    `Statuts Stock;OK;${report.stockStatusCounts.OK}`,
    `Statuts Stock;À définir;${report.stockStatusCounts['À définir']}`,
    '',
    'Feuille;Lignes lues;Lignes importées;Lignes ignorées;Lignes à vérifier',
  ]

  for (const s of report.sheetStats) {
    lines.push(
      `${s.sheet};${s.rowsRead};${s.rowsImported};${s.rowsSkipped};${s.rowsFlagged}`
    )
  }

  lines.push('')
  lines.push('Sévérité;Feuille;Ligne;Champ;Motif;Valeur brute')
  for (const iss of report.first20FlaggedRows) {
    lines.push(
      `${iss.severity};${iss.sheet};${iss.rowNumber};${iss.field};"${iss.reason.replace(/"/g, '""')}";"${(iss.rawValue ?? '').replace(/"/g, '""')}"`
    )
  }

  return lines.join('\n')
}

/**
 * Exports a collection from the repository to .xlsx or .csv in the browser.
 */
export async function exportCollectionFile(
  repo: DataRepository,
  collection:
    | 'products'
    | 'suppliers'
    | 'purchases'
    | 'exits'
    | 'inventories',
  format: 'xlsx' | 'csv'
): Promise<void> {
  let rows: Record<string, unknown>[] = []
  let sheetTitle = 'Export'

  if (collection === 'products') {
    const list = await repo.listProducts()
    sheetTitle = 'Base Produits'
    rows = list.map((p) => ({
      Référence: p.ref,
      Produit: p.name,
      Catégorie: p.category,
      Unité: p.unit,
      'Stock initial': p.initial_stock,
      'Stock minimum': p.min_stock ?? '',
      Emplacement: p.location,
      Archivé: p.archived ? 'OUI' : 'NON',
    }))
  } else if (collection === 'suppliers') {
    const list = await repo.listSuppliers()
    sheetTitle = 'fournisseur'
    rows = list.map((s) => ({
      Fournisseur: s.name,
      Contact: s.contact,
      Téléphone: s.phone,
      Email: s.email,
      'Conditions paiement': s.payment_terms,
      Notes: s.notes,
    }))
  } else if (collection === 'purchases') {
    const [pur, prds, sups] = await Promise.all([
      repo.listPurchases(),
      repo.listProducts(),
      repo.listSuppliers(),
    ])
    const prdMap = new Map(prds.map((p) => [p.id, p]))
    const supMap = new Map(sups.map((s) => [s.id, s]))
    const hdrMap = new Map(pur.headers.map((h) => [h.id, h]))
    sheetTitle = 'Entrées Stock'
    rows = pur.lines.map((l) => {
      const h = hdrMap.get(l.purchase)
      const p = prdMap.get(l.product)
      const s = h ? supMap.get(h.supplier) : undefined
      return {
        Date: h?.date ?? '',
        Référence: p?.ref ?? l.product,
        Produit: p?.name ?? '',
        'Quantité entrée': l.qty,
        'Prix U (MAD)': l.unit_price,
        'Montant achat (MAD)': l.amount,
        'Paiement facturé': h?.payment_status === 'paid' ? 'OUI' : 'NON',
        Fournisseur: s?.name ?? h?.supplier ?? '',
        'Date paiement': h?.payment_date ?? '',
        Notes: h?.notes ?? '',
      }
    })
  } else if (collection === 'exits') {
    const [ext, prds] = await Promise.all([
      repo.listExits(),
      repo.listProducts(),
    ])
    const prdMap = new Map(prds.map((p) => [p.id, p]))
    const hdrMap = new Map(ext.headers.map((h) => [h.id, h]))
    sheetTitle = 'Sorties Stock'
    rows = ext.lines.map((l) => {
      const h = hdrMap.get(l.exit)
      const p = prdMap.get(l.product)
      return {
        Date: h?.date ?? '',
        Référence: p?.ref ?? l.product,
        Produit: p?.name ?? '',
        'Quantité sortie': l.qty_consumed,
        Pertes: l.qty_wasted,
        'Coût unitaire snapshot': l.unit_cost_snapshot ?? '',
        Destination: h?.destination ?? '',
        Notes: h?.notes ?? '',
      }
    })
  } else if (collection === 'inventories') {
    const [inv, prds] = await Promise.all([
      repo.listInventories(),
      repo.listProducts(),
    ])
    const prdMap = new Map(prds.map((p) => [p.id, p]))
    const sessMap = new Map(inv.sessions.map((s) => [s.id, s]))
    sheetTitle = 'Inventaire'
    rows = inv.lines.map((l) => {
      const s = sessMap.get(l.session)
      const p = prdMap.get(l.product)
      return {
        Référence: p?.ref ?? l.product,
        Produit: p?.name ?? '',
        Unité: p?.unit ?? '',
        'Stock théorique': l.theoretical,
        'Stock réel': l.counted,
        Écart: l.diff,
        'Date inventaire': s?.date ?? '',
        Statut: s?.status ?? '',
      }
    })
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetTitle)
  const dateStamp = new Date().toISOString().slice(0, 10)
  const filename = `monarq-${collection}-${dateStamp}.${format}`
  XLSX.writeFile(wb, filename, {
    bookType: format === 'csv' ? 'csv' : 'xlsx',
  })
}

/**
 * Exports all data into a single multi-sheet .xlsx file mirroring the original
 * MONARQ_ECONOMAT workbook structure:
 * - Base Produits
 * - Entrées Stock
 * - Sorties Stock
 * - Inventaire
 * - fournisseur
 * - Parametres
 */
export async function exportFullWorkbookMirror(
  repo: DataRepository,
  options?: { hidePrices?: boolean }
): Promise<void> {
  const hidePrices = Boolean(options?.hidePrices)
  const [products, suppliers, pur, ext, inv, settings] = await Promise.all([
    repo.listProducts(),
    repo.listSuppliers(),
    repo.listPurchases(),
    repo.listExits(),
    repo.listInventories(),
    repo.listSettings(),
  ])

  const prdMap = new Map(products.map((p) => [p.id, p]))
  const supMap = new Map(suppliers.map((s) => [s.id, s]))
  const purMap = new Map(pur.headers.map((h) => [h.id, h]))
  const extMap = new Map(ext.headers.map((h) => [h.id, h]))
  const sessMap = new Map(inv.sessions.map((s) => [s.id, s]))

  const wb = XLSX.utils.book_new()

  // 1. Base Produits
  const baseProduitsRows = products.map((p) => ({
    Référence: p.ref,
    Produit: p.name,
    Catégorie: p.category,
    Unité: p.unit,
    'Stock initial': p.initial_stock,
    'Stock minimum': p.min_stock ?? '',
    Emplacement: p.location,
  }))
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(baseProduitsRows),
    'Base Produits'
  )

  // 2. Entrées Stock
  const entreesRows = pur.lines.map((l) => {
    const h = purMap.get(l.purchase)
    const p = prdMap.get(l.product)
    const s = h ? supMap.get(h.supplier) : undefined
    const row: Record<string, unknown> = {
      Date: h?.date ?? '',
      Référence: p?.ref ?? l.product,
      Produit: p?.name ?? '',
      'Quantité entrée': l.qty,
    }
    if (!hidePrices) {
      row['Prix U (MAD)'] = l.unit_price
      row['Montant achat'] = l.amount
    }
    row['Paiement facturé'] = h?.payment_status === 'paid' ? 'OUI' : 'NON'
    row['Fournisseur'] = s?.name ?? h?.supplier ?? ''
    row['Date paiement'] = h?.payment_date ?? ''
    row['N° Facture'] = h?.invoice_no ?? ''
    row['Notes'] = h?.notes ?? ''
    return row
  })
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(entreesRows),
    'Entrées Stock'
  )

  // 3. Sorties Stock
  const sortiesRows = ext.lines.map((l) => {
    const h = extMap.get(l.exit)
    const p = prdMap.get(l.product)
    return {
      Date: h?.date ?? '',
      Référence: p?.ref ?? l.product,
      Produit: p?.name ?? '',
      'Quantité sortie': l.qty_consumed,
      Pertes: l.qty_wasted,
      Destination: h?.destination || '',
      Motif: l.loss_reason || h?.notes || '',
    }
  })
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sortiesRows),
    'Sorties Stock'
  )

  // 4. Inventaire
  const inventaireRows = inv.lines.map((l) => {
    const s = sessMap.get(l.session)
    const p = prdMap.get(l.product)
    return {
      Référence: p?.ref ?? l.product,
      Produit: p?.name ?? '',
      Unité: p?.unit ?? '',
      'Stock théorique': l.theoretical,
      'Stock réel': l.counted,
      Écart: l.diff,
      'Date inventaire': s?.date ?? '',
      Statut: s?.status ?? '',
    }
  })
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(inventaireRows),
    'Inventaire'
  )

  // 5. fournisseur
  const fournisseurRows = suppliers.map((s) => ({
    Fournisseur: s.name,
    Contact: s.contact,
    Téléphone: s.phone,
    Email: s.email,
    'Conditions paiement': s.payment_terms,
    Notes: s.notes,
  }))
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(fournisseurRows),
    'fournisseur'
  )

  // 6. Parametres
  const parametresRows = settings.map((s) => ({
    Clé: s.key,
    Valeur:
      typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value),
  }))
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(parametresRows),
    'Parametres'
  )

  const dateStamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `MONARQ_ECONOMAT_COMPLET_${dateStamp}.xlsx`, {
    bookType: 'xlsx',
  })
}

export type DataQualityCategory =
  | 'sans_categorie'
  | 'categorie_incoherente'
  | 'sans_stock_min'
  | 'prix_manquant'
  | 'paiement_ambigu'
  | 'fournisseur_manquant'
  | 'doublon_potentiel'
  | 'fournisseur_incomplet'
  | 'a_verifier'

export interface DataQualityItem {
  id: string
  category: DataQualityCategory
  categoryLabel: string
  collection: string
  reference: string
  label: string
  detail: string
  fixRoute: string
  fixActionLabel: string
  recordId?: string
  secondaryId?: string
  currentValue?: string | number | null
}

export interface DatabaseQualityReport {
  generatedAt: string
  counts: {
    sans_categorie: number
    categorie_incoherente: number
    sans_stock_min: number
    prix_manquant: number
    paiement_ambigu: number
    fournisseur_manquant: number
    doublon_potentiel: number
    fournisseur_incomplet: number
    a_verifier: number
    total: number
  }
  items: DataQualityItem[]
}

export async function computeDatabaseQualityReport(
  repo: DataRepository
): Promise<DatabaseQualityReport> {
  const [products, suppliers, pur, ext] = await Promise.all([
    repo.listProducts(),
    repo.listSuppliers(),
    repo.listPurchases(),
    repo.listExits(),
  ])

  const items: DataQualityItem[] = []
  const activeProducts = products.filter((p) => !p.archived)

  // 1. Products without category (or category === '0' / 'Sans catégorie')
  for (const p of activeProducts) {
    const cat = (p.category ?? '').trim()
    const lowerCat = cat.toLowerCase()
    if (
      !cat ||
      cat === '0' ||
      lowerCat === 'sans catégorie' ||
      lowerCat === 'non classé'
    ) {
      items.push({
        id: `qc-cat-${p.id}`,
        category: 'sans_categorie',
        categoryLabel: 'Produit sans catégorie',
        collection: 'Produits',
        reference: p.ref,
        label: p.name,
        detail: `Catégorie actuelle : « ${cat || 'Vide'} »`,
        fixRoute: '/a-corriger',
        fixActionLabel: 'Affecter une catégorie',
        recordId: p.id,
        currentValue: cat,
      })
    }
  }

  // 2. Inconsistent categories (case / accent variants)
  const byNormCat = new Map<string, Set<string>>()
  for (const p of activeProducts) {
    const raw = (p.category ?? '').trim()
    if (!raw || raw === '0') continue
    const norm = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
    const set = byNormCat.get(norm) ?? new Set<string>()
    set.add(raw)
    byNormCat.set(norm, set)
  }
  for (const [norm, variants] of byNormCat.entries()) {
    if (variants.size > 1) {
      const list = Array.from(variants)
      items.push({
        id: `qc-incat-${norm}`,
        category: 'categorie_incoherente',
        categoryLabel: 'Catégories incohérentes',
        collection: 'Produits',
        reference: norm.toUpperCase(),
        label: list.join(' / '),
        detail: `${list.length} variantes d’écriture pour la même famille (${list.join(', ')})`,
        fixRoute: '/produits',
        fixActionLabel: 'Fusionner les catégories',
      })
    }
  }

  // 3. Products without minimum stock ("À définir")
  for (const p of activeProducts) {
    if (p.min_stock === null || p.min_stock === undefined || p.min_stock <= 0) {
      items.push({
        id: `qc-min-${p.id}`,
        category: 'sans_stock_min',
        categoryLabel: 'Seuil minimum « À définir »',
        collection: 'Produits',
        reference: p.ref,
        label: p.name,
        detail: `Unité : ${p.unit} — Aucun seuil minimum configuré`,
        fixRoute: '/a-corriger',
        fixActionLabel: 'Définir le seuil min.',
        recordId: p.id,
        currentValue: p.min_stock,
      })
    }
  }

  const purHeaderMap = new Map(pur.headers.map((h) => [h.id, h]))
  const prdMap = new Map(products.map((p) => [p.id, p]))
  const supMap = new Map(suppliers.map((s) => [s.id, s]))

  // 4. Purchases without price (purchase lines with unit_price <= 0)
  let unpricedLinesFound = 0
  for (const line of pur.lines) {
    const h = purHeaderMap.get(line.purchase)
    if (!h || h.reversed_of || h.correction_status === 'reversed') continue
    if (!line.unit_price || line.unit_price <= 0) {
      unpricedLinesFound++
      const p = prdMap.get(line.product)
      items.push({
        id: `qc-prc-line-${line.id}`,
        category: 'prix_manquant',
        categoryLabel: 'Achat sans prix unitaire',
        collection: 'Entrées Stock',
        reference: p?.ref || h.invoice_no || h.date.slice(0, 10),
        label: p ? `${p.ref} — ${p.name}` : line.product,
        detail: `Entrée du ${h.date.slice(0, 10)} (Qté : ${line.qty} ${p?.unit ?? ''}) à 0,00 DH`,
        fixRoute: '/a-corriger',
        fixActionLabel: 'Saisir le prix unitaire',
        recordId: line.id,
        secondaryId: h.id,
        currentValue: line.unit_price,
      })
    }
  }
  if (unpricedLinesFound === 0) {
    const pricedProductIds = new Set(
      pur.lines
        .filter((l) => {
          const h = purHeaderMap.get(l.purchase)
          return (
            h &&
            !h.reversed_of &&
            h.correction_status !== 'reversed' &&
            l.unit_price > 0
          )
        })
        .map((l) => l.product)
    )
    for (const p of activeProducts) {
      if (!pricedProductIds.has(p.id)) {
        items.push({
          id: `qc-prc-prd-${p.id}`,
          category: 'prix_manquant',
          categoryLabel: 'Produit sans prix d’achat',
          collection: 'Produits',
          reference: p.ref,
          label: `${p.ref} — ${p.name}`,
          detail: 'Aucun achat valorisé enregistré pour ce produit',
          fixRoute: '/entrees-de-stock',
          fixActionLabel: 'Enregistrer une entrée valorisée',
          recordId: p.id,
        })
      }
    }
  }

  // 5. Payments not OUI/NON (is_ambiguous_payment === true)
  for (const h of pur.headers) {
    if (h.reversed_of || h.correction_status === 'reversed') continue
    if (h.is_ambiguous_payment) {
      const supName = supMap.get(h.supplier)?.name || h.supplier
      const firstLine = pur.lines.find((l) => l.purchase === h.id)
      const p = firstLine ? prdMap.get(firstLine.product) : undefined
      items.push({
        id: `qc-pay-${h.id}`,
        category: 'paiement_ambigu',
        categoryLabel: 'Paiement ni OUI ni NON',
        collection: 'Entrées Stock',
        reference: p?.ref || h.invoice_no || h.date.slice(0, 10),
        label: p ? `${p.ref} — ${p.name} (${supName})` : supName,
        detail: `Valeur brute Excel : « ${h.raw_payment_status || 'Vide'} » — Statut actuel : ${h.payment_status === 'paid' ? 'Payé' : 'Impayé'}`,
        fixRoute: '/a-corriger',
        fixActionLabel: 'Confirmer Payé / Impayé',
        recordId: h.id,
        currentValue: h.payment_status,
      })
    }
  }

  // 6. Suppliers missing from the supplier sheet (missing_from_supplier_sheet === true or unmatched supplier on purchase)
  for (const s of suppliers) {
    if (s.archived) continue
    if (s.missing_from_supplier_sheet) {
      items.push({
        id: `qc-sup-missing-${s.id}`,
        category: 'fournisseur_manquant',
        categoryLabel: 'Fournisseur absent de la feuille fournisseur',
        collection: 'Fournisseurs',
        reference: s.name,
        label: s.name,
        detail: 'Utilisé dans Entrées Stock mais absent de la feuille « fournisseur » lors de l’import',
        fixRoute: '/a-corriger',
        fixActionLabel: 'Valider / Compléter la fiche',
        recordId: s.id,
        currentValue: s.phone,
      })
    } else if (!s.phone.trim() && !s.contact.trim()) {
      items.push({
        id: `qc-sup-inc-${s.id}`,
        category: 'fournisseur_incomplet',
        categoryLabel: 'Fournisseur incomplet',
        collection: 'Fournisseurs',
        reference: s.name,
        label: s.name,
        detail: 'Téléphone et nom du contact non renseignés',
        fixRoute: '/fournisseurs',
        fixActionLabel: 'Compléter la fiche',
        recordId: s.id,
      })
    }
  }

  for (const h of pur.headers) {
    if (h.reversed_of || h.correction_status === 'reversed') continue
    if (!supMap.has(h.supplier)) {
      items.push({
        id: `qc-sup-unmatched-${h.id}`,
        category: 'fournisseur_manquant',
        categoryLabel: 'Fournisseur absent de la feuille fournisseur',
        collection: 'Entrées Stock',
        reference: h.invoice_no || h.date.slice(0, 10),
        label: h.supplier || 'Inconnu',
        detail: `Bon d’entrée du ${h.date.slice(0, 10)} rattaché à un fournisseur hors liste`,
        fixRoute: '/a-corriger',
        fixActionLabel: 'Rattacher au fournisseur',
        recordId: h.id,
      })
    }
  }

  // 7. Possible duplicates (lines flagged is_duplicate_candidate && !duplicate_verified, or identical signature)
  const seenDupLineIds = new Set<string>()
  for (const line of pur.lines) {
    const h = purHeaderMap.get(line.purchase)
    if (!h || h.reversed_of || h.correction_status === 'reversed') continue
    if (line.is_duplicate_candidate && !line.duplicate_verified) {
      seenDupLineIds.add(line.id)
      const p = prdMap.get(line.product)
      items.push({
        id: `qc-dup-pur-line-${line.id}`,
        category: 'doublon_potentiel',
        categoryLabel: 'Doublon potentiel (Entrée)',
        collection: 'Entrées Stock',
        reference: p?.ref || h.date.slice(0, 10),
        label: p ? `${p.ref} — ${p.name}` : line.product,
        detail: `Même date (${h.date.slice(0, 10)}), même produit et même quantité (${line.qty})`,
        fixRoute: '/a-corriger',
        fixActionLabel: 'Conserver ou Contre-passer',
        recordId: h.id,
        secondaryId: line.id,
      })
    }
  }

  const extHeaderMap = new Map(ext.headers.map((h) => [h.id, h]))
  for (const line of ext.lines) {
    const h = extHeaderMap.get(line.exit)
    if (!h || h.reversed_of || h.correction_status === 'reversed') continue
    if (line.is_duplicate_candidate && !line.duplicate_verified) {
      seenDupLineIds.add(line.id)
      const p = prdMap.get(line.product)
      items.push({
        id: `qc-dup-ext-line-${line.id}`,
        category: 'doublon_potentiel',
        categoryLabel: 'Doublon potentiel (Sortie)',
        collection: 'Sorties Stock',
        reference: p?.ref || h.date.slice(0, 10),
        label: p ? `${p.ref} — ${p.name}` : line.product,
        detail: `Même date (${h.date.slice(0, 10)}), même produit et même quantité sortie (${line.qty_consumed})`,
        fixRoute: '/a-corriger',
        fixActionLabel: 'Conserver ou Contre-passer',
        recordId: h.id,
        secondaryId: line.id,
      })
    }
  }

  // 8. Rows noted "à vérifier" in products, purchases, exits, or suppliers
  for (const p of activeProducts) {
    const n = (p.notes ?? '').toLowerCase()
    if (n.includes('vérifier') || n.includes('verifier')) {
      items.push({
        id: `qc-ver-prd-${p.id}`,
        category: 'a_verifier',
        categoryLabel: 'Mention « À vérifier »',
        collection: 'Produits',
        reference: p.ref,
        label: p.name,
        detail: p.notes || 'Signalé à vérifier lors de l’import',
        fixRoute: '/a-corriger',
        fixActionLabel: 'Marquer comme vérifié',
        recordId: p.id,
        secondaryId: 'product',
      })
    }
  }
  for (const h of pur.headers) {
    if (h.reversed_of || h.correction_status === 'reversed') continue
    const n = (h.notes ?? '').toLowerCase()
    if (n.includes('vérifier') || n.includes('verifier')) {
      const firstLine = pur.lines.find((l) => l.purchase === h.id)
      const p = firstLine ? prdMap.get(firstLine.product) : undefined
      items.push({
        id: `qc-ver-pur-${h.id}`,
        category: 'a_verifier',
        categoryLabel: 'Mention « À vérifier »',
        collection: 'Entrées Stock',
        reference: p?.ref || h.invoice_no || h.date.slice(0, 10),
        label: p
          ? `${p.ref} — ${p.name}`
          : supMap.get(h.supplier)?.name || h.supplier,
        detail: h.notes,
        fixRoute: '/a-corriger',
        fixActionLabel: 'Marquer comme vérifié',
        recordId: h.id,
        secondaryId: 'purchase',
      })
    }
  }
  for (const h of ext.headers) {
    if (h.reversed_of || h.correction_status === 'reversed') continue
    const n = (h.notes ?? '').toLowerCase()
    if (n.includes('vérifier') || n.includes('verifier')) {
      const firstLine = ext.lines.find((l) => l.exit === h.id)
      const p = firstLine ? prdMap.get(firstLine.product) : undefined
      items.push({
        id: `qc-ver-ext-${h.id}`,
        category: 'a_verifier',
        categoryLabel: 'Mention « À vérifier »',
        collection: 'Sorties Stock',
        reference: p?.ref || h.date.slice(0, 10),
        label: p ? `${p.ref} — ${p.name}` : h.destination,
        detail: h.notes,
        fixRoute: '/a-corriger',
        fixActionLabel: 'Marquer comme vérifié',
        recordId: h.id,
        secondaryId: 'exit',
      })
    }
  }
  for (const s of suppliers.filter((sup) => !sup.archived)) {
    const n = (s.notes ?? '').toLowerCase()
    if (n.includes('vérifier') || n.includes('verifier')) {
      items.push({
        id: `qc-ver-sup-${s.id}`,
        category: 'a_verifier',
        categoryLabel: 'Mention « À vérifier »',
        collection: 'Fournisseurs',
        reference: s.name,
        label: s.name,
        detail: s.notes,
        fixRoute: '/a-corriger',
        fixActionLabel: 'Marquer comme vérifié',
        recordId: s.id,
        secondaryId: 'supplier',
      })
    }
  }

  const counts = {
    sans_categorie: items.filter((i) => i.category === 'sans_categorie').length,
    categorie_incoherente: items.filter(
      (i) => i.category === 'categorie_incoherente'
    ).length,
    sans_stock_min: items.filter((i) => i.category === 'sans_stock_min').length,
    prix_manquant: items.filter((i) => i.category === 'prix_manquant').length,
    paiement_ambigu: items.filter((i) => i.category === 'paiement_ambigu')
      .length,
    fournisseur_manquant: items.filter(
      (i) => i.category === 'fournisseur_manquant'
    ).length,
    doublon_potentiel: items.filter((i) => i.category === 'doublon_potentiel')
      .length,
    fournisseur_incomplet: items.filter(
      (i) => i.category === 'fournisseur_incomplet'
    ).length,
    a_verifier: items.filter((i) => i.category === 'a_verifier').length,
    total: items.length,
  }

  return {
    generatedAt: new Date().toISOString(),
    counts,
    items,
  }
}

export async function exportDataQualityReportFile(
  repo: DataRepository,
  fmt: 'xlsx' | 'csv' = 'xlsx'
): Promise<DatabaseQualityReport> {
  const report = await computeDatabaseQualityReport(repo)
  const rows = report.items.map((item) => ({
    Catégorie_Anomalie: item.categoryLabel,
    Module: item.collection,
    Référence: item.reference,
    Élément: item.label,
    Détail: item.detail,
    Action_Recommandée: item.fixActionLabel,
    Écran_Cible: item.fixRoute,
  }))

  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0
      ? rows
      : [
          {
            Catégorie_Anomalie: 'Aucune anomalie',
            Module: 'Tous',
            Référence: '—',
            Élément: 'Base saine',
            Détail: 'Aucun élément signalé à corriger',
            Action_Recommandée: '—',
            Écran_Cible: '—',
          },
        ]
  )
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'A_Corriger')
  const stamp = new Date().toISOString().slice(0, 10)
  if (fmt === 'csv') {
    XLSX.writeFile(wb, `MONARQ_A_CORRIGER_${stamp}.csv`, { bookType: 'csv' })
  } else {
    XLSX.writeFile(wb, `MONARQ_A_CORRIGER_${stamp}.xlsx`, { bookType: 'xlsx' })
  }
  return report
}


