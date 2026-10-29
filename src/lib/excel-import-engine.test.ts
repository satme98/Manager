import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { MemoryDataRepository } from '@/data/memory-adapter'
import {
  evaluateSimpleArithmeticFormula,
  executeWorkbookImport,
  parseAndValidateWorkbook,
  parseExcelDateToISO,
} from './excel-import-engine'

function createFixtureWorkbookBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new()

  // 1. Base Produits (including lowercase ref p092, missing min_stock, and empty template rows at bottom)
  const baseProduitsAoA: unknown[][] = [
    [
      'Référence',
      'Produit',
      'Catégorie',
      'Unité',
      'Stock initial',
      'Stock minimum',
      'Prix U moyen',
      'Emplacement',
    ],
    [' p092 ', 'Filet de Bœuf', 'Viandes', 'kg', 10, 5, '=999*999', 'Frigo 1'],
    ['P010', 'Huile d’olive', 'Épicerie', 'L', 0, '', '=50*1.2', 'Réserve'],
    ['', '', '', '', '', '', '', ''], // Empty template row
    ['', '', '', '', '', '', '', ''], // Empty template row
  ]
  const wsProd = XLSX.utils.aoa_to_sheet(baseProduitsAoA)
  XLSX.utils.book_append_sheet(wb, wsProd, 'Base Produits')

  // 2. fournisseur
  const fournisseurAoA: unknown[][] = [
    [
      'Fournisseur',
      'Contact',
      'Téléphone',
      'Email',
      'Conditions paiement',
      'Notes',
    ],
    [
      'Atlas Viandes',
      'Youssef',
      '0600000001',
      'contact@atlas.ma',
      '30 jours',
      '',
    ],
    ['', '', '', '', '', ''], // Empty row
  ]
  const wsSup = XLSX.utils.aoa_to_sheet(fournisseurAoA)
  XLSX.utils.book_append_sheet(wb, wsSup, 'fournisseur')

  // 3. Entrées Stock (Excel serial date 45762 = 2025-04-15, formula price =35*1.2 = 42, duplicate rows, OUI/NON, JOURNAL STOCK note)
  const entreesAoA: unknown[][] = [
    [
      'Date',
      'Référence',
      'Produit',
      'Quantité entrée',
      'Prix U (MAD)',
      'Montant achat',
      'Paiement facturé',
      'Fournisseur',
      'Date paiement',
      'ColJ',
      'ColK',
      'NoteMigration',
    ],
    [
      45762,
      'p092',
      'Filet de Bœuf',
      5,
      '=35*1.2',
      '=D2*E2',
      'OUI',
      'atlas viandes',
      '20/04/2025',
      '',
      '',
      'Migré JOURNAL STOCK ligne 14 ; à vérifier',
    ],
    // Duplicate of row 2
    [
      '15/04/2025',
      'P092',
      'Filet de Bœuf',
      5,
      42,
      210,
      'NON',
      'Atlas Viandes',
      '',
      '',
      '',
      '',
    ],
    // Empty template row
    ['', '', '', '', '', '', '', '', '', '', '', ''],
  ]
  const wsPur = XLSX.utils.aoa_to_sheet(entreesAoA)
  // Also attach an actual sheet formula object on E2 to verify formula cell evaluation
  wsPur['E2'] = { t: 'n', f: '35*1.2', v: 42 }
  XLSX.utils.book_append_sheet(wb, wsPur, 'Entrées Stock')

  // 4. Sorties Stock
  const sortiesAoA: unknown[][] = [
    [
      'Date',
      'Référence',
      'Produit',
      'Quantité sortie',
      'Pertes',
      'Prix U',
      'FormG',
      'FormH',
      'Destination',
    ],
    ['16/04/2025', 'p092', 'Filet de Bœuf', 3, 1, '=42', '=126', '=42', 'Cuisine'],
    ['', '', '', '', '', '', '', '', ''], // Empty template row
  ]
  const wsExt = XLSX.utils.aoa_to_sheet(sortiesAoA)
  XLSX.utils.book_append_sheet(wb, wsExt, 'Sorties Stock')

  // 5. Inventaire (only rows where E Stock réel has a value are real counts)
  const invAoA: unknown[][] = [
    [
      'Référence',
      'Produit',
      'Unité',
      'Stock théorique',
      'Stock réel',
      'Ecart',
      'Val',
      'Statut',
      'Date inventaire',
    ],
    ['p092', 'Filet de Bœuf', 'kg', 16, 14, -2, -84, 'OK', '17/04/2025'],
    ['P010', 'Huile d’olive', 'L', 0, '', 0, 0, 'Alerte', '17/04/2025'], // Empty E -> must be skipped!
  ]
  const wsInv = XLSX.utils.aoa_to_sheet(invAoA)
  XLSX.utils.book_append_sheet(wb, wsInv, 'Inventaire')

  // 6. Ignored sheet "JOURNAL STOCK" and "Macro1" (must be completely ignored)
  const wsJournal = XLSX.utils.aoa_to_sheet([
    ['Date', 'Référence', 'Qté'],
    ['01/01/2025', 'P092', 999],
  ])
  XLSX.utils.book_append_sheet(wb, wsJournal, 'JOURNAL STOCK')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Macro']]), 'Macro1')

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return out
}

describe('Excel Import Wizard Engine (Stage 3)', () => {
  it('evaluates formula strings and parses Excel serial & DD/MM/YYYY dates', () => {
    expect(evaluateSimpleArithmeticFormula('=35*1.2')).toBeCloseTo(42, 5)
    expect(evaluateSimpleArithmeticFormula('=(100+20)/2')).toBeCloseTo(60, 5)
    expect(parseExcelDateToISO(45762)).toBe('2025-04-15')
    expect(parseExcelDateToISO('15/04/2025')).toBe('2025-04-15')
    expect(parseExcelDateToISO('invalid-date')).toBeNull()
  })

  it('parses fixture workbook, skips empty template rows & JOURNAL STOCK, detects duplicates, and maps OUI/NON', () => {
    const buffer = createFixtureWorkbookBuffer()
    const parsed = parseAndValidateWorkbook(buffer, 'MONARQ_FIXTURE.xlsx', 4096)

    // Ignored sheets detected and not imported
    expect(parsed.ignoredSheetsFound).toEqual(
      expect.arrayContaining(['JOURNAL STOCK', 'Macro1'])
    )

    // 2 real products (empty template rows skipped), canonical ref P092
    expect(parsed.products).toHaveLength(2)
    expect(parsed.products[0]?.canonicalRef).toBe('P092')
    expect(parsed.zeroInitialStockCount).toBe(1)
    expect(parsed.missingMinStockCount).toBe(1)

    // 1 real supplier
    expect(parsed.suppliers).toHaveLength(1)

    // 2 real purchase rows, formula price = 42, recomputed amount = 210, OUI->paid, NON->unpaid, duplicate flagged
    expect(parsed.purchases).toHaveLength(2)
    expect(parsed.purchases[0]?.date).toBe('2025-04-15')
    expect(parsed.purchases[0]?.unitPrice).toBe(42)
    expect(parsed.purchases[0]?.computedAmount).toBe(210)
    expect(parsed.purchases[0]?.paymentStatus).toBe('paid')
    expect(parsed.purchases[0]?.isMigratedJournalNote).toBe(true)

    expect(parsed.purchases[1]?.paymentStatus).toBe('unpaid')
    expect(parsed.purchases[1]?.isDuplicateCandidate).toBe(true)

    // 1 real exit row
    expect(parsed.exits).toHaveLength(1)
    expect(parsed.exits[0]?.qtyConsumed).toBe(3)
    expect(parsed.exits[0]?.qtyWasted).toBe(1)

    // Only 1 real inventory count (row where E Stock réel was empty was skipped!)
    expect(parsed.inventories).toHaveLength(1)
    expect(parsed.inventories[0]?.canonicalRef).toBe('P092')
    expect(parsed.inventories[0]?.counted).toBe(14)
  })

  it('runs idempotent import (second run imports 0 new rows) and supports whole-batch reversal', async () => {
    const repo = new MemoryDataRepository()
    await repo.login('admin@monarq.ma', 'admin1234')

    const buffer = createFixtureWorkbookBuffer()
    const parsed = parseAndValidateWorkbook(buffer, 'MONARQ_FIXTURE.xlsx', 4096)

    // Choose to skip the duplicate 2nd purchase row
    const dupRowId = parsed.purchases[1]!.sourceRowId
    const decisions = {
      vatConvention: 'TTC' as const,
      vatConfirmed: true,
      categoryMapping: parsed.defaultCategoryMapping,
      supplierChoices: parsed.defaultSupplierChoices,
      duplicateDecisions: {
        ...parsed.defaultDuplicateDecisions,
        [dupRowId]: 'skip' as const,
      },
      updateExistingProducts: false,
      updateExistingSuppliers: false,
      fallbackInventoryDate: '2025-04-17',
    }

    // 1. First real import
    const report1 = await executeWorkbookImport(parsed, decisions, repo, {
      dryRun: false,
    })

    expect(report1.totalProductsInDb).toBe(2)
    expect(report1.totalSuppliersInDb).toBe(1)
    expect(report1.totalPurchaseAmountImported).toBe(210)
    expect(
      report1.sheetStats.find((s) => s.sheet === 'Base Produits')?.rowsImported
    ).toBe(2)
    expect(
      report1.sheetStats.find((s) => s.sheet === 'Entrées Stock')?.rowsImported
    ).toBe(1)
    expect(
      report1.sheetStats.find((s) => s.sheet === 'Sorties Stock')?.rowsImported
    ).toBe(1)
    expect(
      report1.sheetStats.find((s) => s.sheet === 'Inventaire')?.rowsImported
    ).toBe(1)

    // 2. Second run on the exact same workbook -> IDEMPOTENT (0 new rows imported!)
    const report2 = await executeWorkbookImport(parsed, decisions, repo, {
      dryRun: false,
    })

    expect(
      report2.sheetStats.find((s) => s.sheet === 'Base Produits')?.rowsImported
    ).toBe(0)
    expect(
      report2.sheetStats.find((s) => s.sheet === 'fournisseur')?.rowsImported
    ).toBe(0)
    expect(
      report2.sheetStats.find((s) => s.sheet === 'Entrées Stock')?.rowsImported
    ).toBe(0)
    expect(
      report2.sheetStats.find((s) => s.sheet === 'Sorties Stock')?.rowsImported
    ).toBe(0)
    expect(
      report2.sheetStats.find((s) => s.sheet === 'Inventaire')?.rowsImported
    ).toBe(0)

    // 3. Reverse the first import batch ("Annuler l'import") -> marks records as reversed, never hard-deletes
    const reversedBatch = await repo.reverseImportBatch(
      report1.batchId,
      'Test annulation lot'
    )
    expect(reversedBatch.status).toBe('reversed')

    const purchasesAfterReversal = await repo.listPurchases()
    // Original purchase + its reversal record both exist (never hard-deleted)
    expect(purchasesAfterReversal.headers.length).toBe(2)
    expect(
      purchasesAfterReversal.headers.some((h) => h.reversed_of !== null)
    ).toBe(true)
  })
})
