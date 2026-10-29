import * as XLSX from 'xlsx'
import type {
  DataRepository,
  PaymentStatus,
  VatConvention,
} from '@/data/types'
import {
  computeProductStock,
  computePurchaseLineAmount,
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

export const IGNORED_SHEET_NAMES = [
  'JOURNAL STOCK',
  'Macro1',
  'Dashboard',
  'Etat Stock',
  'Guide',
] as const

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
  rawPaymentDate: string
  paymentDate: string | null
  rawSupplier: string
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

function collectExtraNotes(
  sheet: XLSX.WorkSheet,
  rowIdx0: number,
  startColIdx: number,
  endColIdx: number
): string {
  const parts: string[] = []
  for (let c = startColIdx; c <= endColIdx; c++) {
    const val = toCleanString(getCellValue(sheet, c, rowIdx0))
    if (val && !/^(0|FAUX|VRAI|FALSE|TRUE)$/i.test(val)) {
      parts.push(val)
    }
  }
  return parts.join(' | ')
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
  const parametres = {
    units: [] as string[],
    categories: [] as string[],
    destinations: [] as string[],
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

      if (!rawCategory) {
        flags.push('Catégorie manquante')
        issues.push({
          id: `iss-prd-cat-${rowNumber}`,
          sheet: 'Base Produits',
          rowNumber,
          field: 'Catégorie',
          severity: 'À VÉRIFIER',
          reason: 'Produit sans catégorie renseignée.',
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
        rawRef,
        canonicalRef,
        name,
        rawCategory: rawCategory || 'Non classé',
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
      const extraNotes = collectExtraNotes(purSheet, r, 9, 16)

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
      if (upperPay === 'OUI' || upperPay === 'RÉGLÉ' || upperPay === 'REGLE') {
        paymentStatus = 'paid'
      } else if (
        upperPay === 'NON' ||
        upperPay === 'NON RÉGLÉ' ||
        upperPay === 'NON REGLE' ||
        upperPay === ''
      ) {
        paymentStatus = 'unpaid'
      } else {
        flags.push(`Paiement: ${rawPayment}`)
        issues.push({
          id: `iss-pur-pay-${rowNumber}`,
          sheet: 'Entrées Stock',
          rowNumber,
          field: 'Paiement facturé',
          severity: 'À VÉRIFIER',
          reason: `Valeur de paiement autre que OUI/NON (« ${rawPayment} »), mappée sur Impayé par sécurité.`,
          rawValue: rawPayment,
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
        rawRef,
        canonicalRef,
        productName:
          productName || productRefLookup.get(canonicalRef)?.name || '',
        qty,
        unitPrice,
        computedAmount,
        excelAmountValue,
        rawPaymentStatus: rawPayment,
        paymentStatus,
        rawPaymentDate: toCleanString(rawPaymentDateVal),
        paymentDate,
        rawSupplier: supplierKey,
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
      const extraNotes = collectExtraNotes(extSheet, r, 9, 16)

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
        rawRef,
        canonicalRef,
        productName:
          productName || productRefLookup.get(canonicalRef)?.name || '',
        qtyConsumed,
        qtyWasted,
        destination,
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
      const rawDateVal = getCellValue(invSheet, 8, r) // Column I: Date inventaire

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
      if (!dryRun) {
        const created = await repo.createProduct({
          ref: prd.canonicalRef,
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
          ref: prd.canonicalRef,
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

    if (!dryRun) {
      await repo.createPurchaseDocument({
        date: pur.date,
        supplier: supplier?.id ?? targetSupplierName,
        invoice_no: '', // Do not invent invoice numbers
        payment_status: pur.paymentStatus,
        payment_date: pur.paymentDate,
        notes: pur.notes,
        import_batch_id: batchSourceId,
        order_index: pur.orderIndex,
        lines: [
          {
            product: product.id,
            qty: pur.qty,
            unit_price: pur.unitPrice ?? 0,
            source_row_id: pur.sourceRowId,
            order_index: pur.orderIndex,
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
      validLines.push({
        product: product.id,
        theoretical: 0,
        counted: r.counted,
        diff: 0,
        value_diff: null,
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
      if (!p.blocking && p.paymentStatus === 'unpaid') {
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
