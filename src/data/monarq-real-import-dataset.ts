import * as XLSX from 'xlsx'
import {
  GOLDEN_REFERENCE_DASHBOARD_KPIS,
  parseGoldenReferenceRows,
} from './monarq-reference-golden-csv'

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

function round6(val: number): number {
  return Math.round((val + Number.EPSILON) * 100000000) / 100000000
}

/**
 * The 19 official suppliers in the `fournisseur` sheet of MONARQ_ECONOMAT_import_propre.xlsx.
 */
export const MONARQ_CLEAN_SUPPLIERS_SHEET = [
  {
    Fournisseur: 'Boucherie Atlas Prestige',
    Contact: 'Youssef El Amrani',
    Téléphone: '0661-234501',
    Email: 'contact@atlasprestige.ma',
    'Conditions paiement': '30 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Marée Bleue Océan',
    Contact: 'Karim Bennani',
    Téléphone: '0661-234502',
    Email: 'commandes@mareebleue.ma',
    'Conditions paiement': 'Comptant',
    Observation: '',
  },
  {
    Fournisseur: 'Primeurs du Souss',
    Contact: 'Hassan Ouhammou',
    Téléphone: '0661-234503',
    Email: 'primeurs.souss@gmail.com',
    'Conditions paiement': '15 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Fromagerie & Crèmerie du Nord',
    Contact: 'Nadia Tazi',
    Téléphone: '0661-234504',
    Email: 'service@cremeriedunord.ma',
    'Conditions paiement': '30 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Medina Distribution Épicerie',
    Contact: 'Omar Chraibi',
    Téléphone: '0661-234505',
    Email: 'omar@medinadistrib.ma',
    'Conditions paiement': '30 jours',
    Observation: '',
  },
  {
    Fournisseur: 'PackPro Emballages Maroc',
    Contact: 'Salma Berrada',
    Téléphone: '0661-234506',
    Email: 'ventes@packpro.ma',
    'Conditions paiement': '30 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Hygiène Plus Professionnel',
    Contact: 'Mehdi Kettani',
    Téléphone: '0661-234507',
    Email: 'info@hygieneplus.ma',
    'Conditions paiement': '15 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Les Domaines Avicoles',
    Contact: 'Rachid Fassi',
    Téléphone: '0661-234508',
    Email: 'rfassi@avicoles.ma',
    'Conditions paiement': 'Comptant',
    Observation: '',
  },
  {
    Fournisseur: 'Moulins & Pâtes d’Or',
    Contact: 'Driss Alaoui',
    Téléphone: '0661-234509',
    Email: 'commercial@patesdor.ma',
    'Conditions paiement': '30 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Casa Boissons & Eaux',
    Contact: 'Samir Mansouri',
    Téléphone: '0661-234510',
    Email: 'commandes@casaboissons.ma',
    'Conditions paiement': 'Comptant',
    Observation: '',
  },
  {
    Fournisseur: 'Saveurs d’Orient Épices',
    Contact: 'Abdelilah Touzani',
    Téléphone: '0661-234511',
    Email: 'contact@saveursorient.ma',
    'Conditions paiement': '15 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Gourmet Import Italia',
    Contact: 'Marco Rossi',
    Téléphone: '0661-234512',
    Email: 'marco@gourmetitalia.ma',
    'Conditions paiement': '30 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Boulangerie Artisanale Anfa',
    Contact: 'amine@boulangerieanfa.ma',
    Téléphone: '0661-234513',
    Email: 'amine@boulangerieanfa.ma',
    'Conditions paiement': 'Fin de mois',
    Observation: '',
  },
  {
    Fournisseur: 'Torréfaction Rida Café',
    Contact: 'Rida Benjelloun',
    Téléphone: '0661-234514',
    Email: 'contact@ridacafe.ma',
    'Conditions paiement': 'Comptant',
    Observation: '',
  },
  {
    Fournisseur: 'Comptoir des Thés Maroc',
    Contact: 'Lahcen Idrissi',
    Téléphone: '0661-234515',
    Email: 'contact@comptoirdesthes.ma',
    'Conditions paiement': '15 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Souss Olives & Huiles',
    Contact: 'Brahim Agnaou',
    Téléphone: '0661-234516',
    Email: 'brahim@soussolives.ma',
    'Conditions paiement': '30 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Fruits Secs Impérial',
    Contact: 'Zineb Iraqi',
    Téléphone: '0661-234517',
    Email: 'ziraqi@fruitssecs.ma',
    'Conditions paiement': '15 jours',
    Observation: '',
  },
  {
    Fournisseur: 'Pâtisserie Pro Fournitures',
    Contact: 'Soufiane Lahlou',
    Téléphone: '0661-234518',
    Email: 'pro@patisseriepro.ma',
    'Conditions paiement': '30 jours',
    Observation: '',
  },
  {
    Fournisseur: 'SOKHRA Express',
    Contact: 'Mourad',
    Téléphone: '0661-234519',
    Email: '',
    'Conditions paiement': 'Comptant',
    Observation: '',
  },
] as const

/**
 * 14 suppliers used in `Entrées Stock` that are missing from the `fournisseur` sheet.
 */
export const MISSING_SUPPLIERS_IN_PURCHASES = [
  'CASH MAKRO',
  'MARJANE PRO',
  'BIM',
  'ATACADAO',
  'MARCHÉ CENTRAL',
  'FOURNISSEUR DIVERS',
  'DEPANNAGE SOKHRA',
  ' grossiste derb omar ',
  'Boucherie Rahal',
  'Pêcherie du Port',
  'Laiterie Centrale',
  'Emballage Express',
  'Épicerie Al Baraka',
  'Cash & Carry Anfa',
] as const

/**
 * 10 priced products that ALSO have 1 unpriced purchase row (total unpriced rows = 9 + 10 = 19),
 * so that total purchase amount across all 247 purchase rows equals exact 95 989,05 DH.
 */
const UNPRICED_PARTIAL_QTY_BY_REF: Record<string, number> = {
  P098: 4, // 4 * 17.92 = 71.68
  P123: 2, // 2 * 132.00 = 264.00
  P005: 2, // 2 * 110.00 = 220.00
  P014: 2, // 2 * 115.00 = 230.00
  P019: 4, // 4 * 65.00 = 260.00
  P035: 1, // 1 * 90.00 = 90.00
  P101: 1, // 1 * 225.00 = 225.00
  P102: 5, // 5 * 82.00 = 410.00
  P103: 1, // 1 * 165.00 = 165.00
  P212: 5, // 5 * 10.00 = 50.00
}

/**
 * 27 products whose priced purchase rows are unpaid (sum = exact 26 938,55 DH).
 * The first 14 of these have non-OUI/NON payment values (ambiguous payments = 14),
 * and the remaining 13 have "NON".
 */
const UNPAID_PRICED_REFS = new Set([
  'P002',
  'P005',
  'P013',
  'P014',
  'P015',
  'P054',
  'P056',
  'P057',
  'P058',
  'P064',
  'P065',
  'P066',
  'P067',
  'P068',
  'P073',
  'P074',
  'P092',
  'P093',
  'P095',
  'P102',
  'P111',
  'P107',
  'P105',
  'P098',
  'P072',
  'P071',
  'P048',
])

const AMBIGUOUS_PAYMENT_LABELS_BY_REF: Record<string, string> = {
  P002: 'EN ATTENTE',
  P005: 'CRÉDIT',
  P013: 'À VÉRIFIER',
  P014: 'EN ATTENTE',
  P015: 'CHÈQUE',
  P054: 'EN ATTENTE',
  P056: 'CRÉDIT',
  P057: 'EN ATTENTE',
  P058: 'CHÈQUE',
  P064: 'EN ATTENTE',
  P065: 'CRÉDIT',
  P066: 'À VÉRIFIER',
  P067: 'EN ATTENTE',
  P068: 'CRÉDIT',
}

/**
 * 12 products whose purchase split uses two identical lines on the same date
 * so the import engine detects exact 12 duplicate candidates (`doublon_potentiel = 12`).
 */
const DUPLICATE_CANDIDATE_PURCHASE_REFS = new Set([
  'P010', // 2 -> 1 + 1 on 05/10/2026
  'P060', // 2 -> 1 + 1 on 05/10/2026
  'P062', // 4 -> 2 + 2 on 05/10/2026
  'P115', // 2 -> 1 + 1 on 06/10/2026
  'P120', // 2 -> 1 + 1 on 06/10/2026
  'P128', // 2 -> 1 + 1 on 06/10/2026
  'P131', // 4 -> 2 + 2 on 07/10/2026
  'P158', // 2 -> 1 + 1 on 07/10/2026
  'P186', // 2 -> 1 + 1 on 08/10/2026
  'P187', // 4 -> 2 + 2 on 08/10/2026
  'P188', // 4 -> 2 + 2 on 08/10/2026
  'P189', // 2 -> 1 + 1 on 08/10/2026
])

export interface GeneratedCleanWorkbookData {
  baseProduitsRows: Record<string, unknown>[]
  fournisseurRows: Record<string, unknown>[]
  entreesRows: Record<string, unknown>[]
  sortiesRows: Record<string, unknown>[]
  inventaireRows: Record<string, unknown>[]
  parametresRows: Record<string, unknown>[]
  aVerifierRows: Record<string, unknown>[]
}

/**
 * Builds the deterministic clean workbook data (`MONARQ_ECONOMAT_import_propre.xlsx`)
 * with exact counts:
 * - 345 products (`Base Produits`)
 * - 247 purchases (`Entrées Stock`)
 * - 143 exits (`Sorties Stock`)
 * - 119 physical counts (`Inventaire`: 118 on 13/10/2026 + 1 on 22/10/2026)
 * - 19 suppliers (`fournisseur`)
 * - `À vérifier` review sheet (not imported as data)
 */
export function buildMonarqCleanImportWorkbookData(): GeneratedCleanWorkbookData {
  const goldenRows = parseGoldenReferenceRows()

  // 1. Base Produits (345 rows)
  // First 243 products (P001..p243) have Stock minimum > 0 so that:
  // - 197 products are in ALERTE (stockFinal <= minStock)
  // - 6 products are À SURVEILLER (minStock < stockFinal <= 1.5 * minStock)
  // - 40 products are OK (stockFinal > 1.5 * minStock)
  // Last 102 products (p244..p345) have Stock minimum = "" (À définir).
  const baseProduitsRows: Record<string, unknown>[] = []
  let alerteAssigned = 0
  let surveillerAssigned = 0

  for (let i = 0; i < goldenRows.length; i++) {
    const r = goldenRows[i]
    let minStockCell: number | string = ''
    if (i < 243) {
      // Determine min_stock so exact counts are 197 Alerte, 6 À surveiller, 40 OK
      if (alerteAssigned < 197) {
        minStockCell = Math.max(5, Math.ceil(Math.max(0, r.stockFinal) + 2))
        alerteAssigned++
      } else if (surveillerAssigned < 6) {
        // Need stockFinal > minStock and stockFinal <= 1.5 * minStock
        // Since r.stockFinal might be 0 on some rows, pick rows or set minStock
        minStockCell = r.stockFinal > 0 ? round2(r.stockFinal * 0.8) : 5
        surveillerAssigned++
      } else {
        minStockCell = 2
      }
    }

    baseProduitsRows.push({
      Référence: r.ref,
      Produit: r.name,
      Catégorie: r.category,
      Unité: r.unit,
      'Stock initial': r.initialStock,
      'Stock minimum': minStockCell,
      Emplacement: 'Économat Principal',
      Observation: '',
    })
  }

  // Re-adjust min_stock on the first 243 products so that with their actual stockFinal,
  // exact status counts are: 197 Alerte, 6 À surveiller, 40 OK, 102 À définir.
  // Among indices 0..242, let's check how many have stockFinal > 0:
  const indicesWithPositiveStock: number[] = []
  const indicesWithZeroOrNegStock: number[] = []
  for (let i = 0; i < 243; i++) {
    if (goldenRows[i].stockFinal >= 2) {
      indicesWithPositiveStock.push(i)
    } else {
      indicesWithZeroOrNegStock.push(i)
    }
  }
  // There are 78 products in 0..242 with stockFinal >= 2, and 165 with stockFinal < 2.
  // All 165 with stockFinal < 2 with min_stock >= 2 will be ALERTE (165).
  // We need 197 - 165 = 32 of the positive-stock products to be ALERTE (min_stock = stockFinal + 2),
  // 6 of the positive-stock products to be À SURVEILLER (min_stock = round2(stockFinal / 1.25)),
  // and 78 - 32 - 6 = 40 of the positive-stock products to be OK (min_stock = round2(stockFinal / 2.5))!
  for (const idx of indicesWithZeroOrNegStock) {
    baseProduitsRows[idx]['Stock minimum'] = 5
  }
  const neededPositiveAlerts = 197 - indicesWithZeroOrNegStock.length
  for (let k = 0; k < indicesWithPositiveStock.length; k++) {
    const idx = indicesWithPositiveStock[k]
    const sf = goldenRows[idx].stockFinal
    if (k < neededPositiveAlerts) {
      // ALERTE: stockFinal <= min_stock
      baseProduitsRows[idx]['Stock minimum'] = Math.ceil(sf + 2)
    } else if (k < neededPositiveAlerts + 6) {
      // À SURVEILLER: min_stock < stockFinal <= 1.5 * min_stock
      baseProduitsRows[idx]['Stock minimum'] = round2(sf * 0.8)
    } else {
      // OK: stockFinal > 1.5 * min_stock
      baseProduitsRows[idx]['Stock minimum'] = Math.max(0.5, round2(sf * 0.4))
    }
  }

  // 2. Determine which products have a physical count in `Inventaire` (119 rows: 118 on 13/10/2026 + 1 on 22/10/2026)
  // Every product where Stock final != Stock initial + Entrées - Sorties - Pertes MUST be in Inventaire (there are 68 such products).
  // Plus 51 products where Stock final == Stock initial + Entrées - Sorties - Pertes (so 68 + 51 = 119).
  const mustHaveCountRefs = new Set<string>()
  for (const r of goldenRows) {
    const effectiveSorties = r.canonicalRef === 'P217' ? 1 : r.sorties
    const noCountFinal = round2(
      r.initialStock + r.entrees - effectiveSorties - r.pertes
    )
    if (Math.abs(r.stockFinal - noCountFinal) > 0.0001) {
      mustHaveCountRefs.add(r.canonicalRef)
    }
  }

  const countedProductRefs = new Set<string>(mustHaveCountRefs)
  for (const r of goldenRows) {
    if (countedProductRefs.size >= 119) break
    if (!countedProductRefs.has(r.canonicalRef) && (r.entrees > 0 || r.sorties > 0)) {
      countedProductRefs.add(r.canonicalRef)
    }
  }
  for (const r of goldenRows) {
    if (countedProductRefs.size >= 119) break
    if (!countedProductRefs.has(r.canonicalRef)) {
      countedProductRefs.add(r.canonicalRef)
    }
  }

  // Pick 1 product for the 22/10/2026 count (e.g. P001) and the other 118 for 13/10/2026
  const lateCountCanonicalRef = 'P001'

  // 3. Build `Entrées Stock` (exact 247 rows across all products with entrees > 0)
  const productsWithEntrees = goldenRows.filter((r) => r.entrees > 0)
  // 10 products have 1 unpriced row + 1 priced row (+10 rows).
  // 12 products in DUPLICATE_CANDIDATE_PURCHASE_REFS have 2 identical priced rows (+12 rows).
  // P059 (`Yaourt`) has 2 priced rows (+1 row).
  // To reach exact 247 rows, we split `neededSplits` other products into 2 purchase rows.
  const neededSplits = Math.max(
    0,
    247 -
      (productsWithEntrees.length +
        Object.keys(UNPRICED_PARTIAL_QTY_BY_REF).length +
        DUPLICATE_CANDIDATE_PURCHASE_REFS.size +
        1)
  )
  const entreesRows: Record<string, unknown>[] = []

  // First, determine which `neededSplits` products get split into 2 deliveries without any centime rounding drift
  const splittableRefs = new Set<string>()
  for (const r of productsWithEntrees) {
    if (splittableRefs.size >= neededSplits) break
    if (
      r.prixMoyen > 0 &&
      !UNPRICED_PARTIAL_QTY_BY_REF[r.canonicalRef] &&
      !DUPLICATE_CANDIDATE_PURCHASE_REFS.has(r.canonicalRef) &&
      !UNPAID_PRICED_REFS.has(r.canonicalRef) &&
      r.canonicalRef !== 'P059' &&
      r.canonicalRef !== 'P099' &&
      r.entrees >= 2
    ) {
      const unitP =
        r.stockFinal !== 0
          ? round6(r.valeurStock / r.stockFinal)
          : r.prixMoyen
      const q1 = round2(Math.floor(r.entrees / 2))
      const q2 = round2(r.entrees - q1)
      if (
        round2(round2(q1 * unitP) + round2(q2 * unitP)) ===
        round2(r.entrees * unitP)
      ) {
        splittableRefs.add(r.canonicalRef)
      }
    }
  }

  let missingSupplierCursor = 0
  let officialSupplierCursor = 0
  let aVerifierNotesAssigned = 0

  for (const r of productsWithEntrees) {
    const cRef = r.canonicalRef
    const isUnpaid = UNPAID_PRICED_REFS.has(cRef)
    const paymentCell = isUnpaid
      ? AMBIGUOUS_PAYMENT_LABELS_BY_REF[cRef] || 'NON'
      : 'OUI'
    const paymentDateCell = paymentCell === 'OUI' ? '08/10/2026' : ''

    // Assign supplier: first 14 paid non-unpaid single-row products get one of the 14 missing suppliers
    let supplierName: string
    if (
      !isUnpaid &&
      missingSupplierCursor < MISSING_SUPPLIERS_IN_PURCHASES.length &&
      !splittableRefs.has(cRef) &&
      !DUPLICATE_CANDIDATE_PURCHASE_REFS.has(cRef)
    ) {
      supplierName = MISSING_SUPPLIERS_IN_PURCHASES[missingSupplierCursor++]
    } else {
      supplierName =
        MONARQ_CLEAN_SUPPLIERS_SHEET[
          officialSupplierCursor++ % MONARQ_CLEAN_SUPPLIERS_SHEET.length
        ].Fournisseur
    }

    // Exact unit price so that Stock final * rawAveragePrice == Valeur stock
    const exactUnitPrice =
      cRef === 'P099'
        ? 108.004
        : cRef === 'P100'
          ? 360.004
          : cRef === 'P121'
            ? 90.004
            : r.prixMoyen > 0 && r.stockFinal !== 0
              ? round6(r.valeurStock / r.stockFinal)
              : r.prixMoyen

    const observationNote =
      aVerifierNotesAssigned < 2 && cRef !== 'P013' && cRef !== 'P066'
        ? (++aVerifierNotesAssigned, 'Quantité et facture à vérifier avec le chef')
        : ''

    if (r.prixMoyen === 0) {
      // Unpriced product (9 products) -> 1 row with price 0
      entreesRows.push({
        Date: '05/10/2026',
        Référence: r.ref,
        Produit: r.name,
        'Quantité entrée': r.entrees,
        'Prix U (MAD)': '',
        'Montant achat': 0,
        'Paiement facturé': 'OUI',
        Fournisseur: supplierName,
        'Date paiement': '05/10/2026',
        'N° BL/Facture': `BL-${cRef}-01`,
        'Saisi par': 'Karim (Économat)',
        Observation: observationNote,
      })
    } else if (cRef === 'P059') {
      // Yaourt: 72 units, total purchase amount = 152.77 DH (70 * 2.121857 + 2 * 2.12 = 148.53 + 4.24 = 152.77)
      entreesRows.push({
        Date: '05/10/2026',
        Référence: r.ref,
        Produit: r.name,
        'Quantité entrée': 70,
        'Prix U (MAD)': 2.121857,
        'Montant achat': 148.53,
        'Paiement facturé': 'OUI',
        Fournisseur: supplierName,
        'Date paiement': '05/10/2026',
        'N° BL/Facture': `BL-${cRef}-01`,
        'Saisi par': 'Karim (Économat)',
        Observation: observationNote,
      })
      entreesRows.push({
        Date: '09/10/2026',
        Référence: r.ref,
        Produit: r.name,
        'Quantité entrée': 2,
        'Prix U (MAD)': 2.12,
        'Montant achat': 4.24,
        'Paiement facturé': 'OUI',
        Fournisseur: supplierName,
        'Date paiement': '09/10/2026',
        'N° BL/Facture': `BL-${cRef}-02`,
        'Saisi par': 'Karim (Économat)',
        Observation: '',
      })
    } else if (UNPRICED_PARTIAL_QTY_BY_REF[cRef] !== undefined) {
      // 10 products that have 1 priced row + 1 unpriced row
      const unpricedQty = UNPRICED_PARTIAL_QTY_BY_REF[cRef]
      const pricedQty = round2(r.entrees - unpricedQty)
      const amt = round2(pricedQty * exactUnitPrice)
      entreesRows.push({
        Date: '06/10/2026',
        Référence: r.ref,
        Produit: r.name,
        'Quantité entrée': pricedQty,
        'Prix U (MAD)': exactUnitPrice,
        'Montant achat': amt,
        'Paiement facturé': paymentCell,
        Fournisseur: supplierName,
        'Date paiement': paymentDateCell,
        'N° BL/Facture': `BL-${cRef}-01`,
        'Saisi par': 'Karim (Économat)',
        Observation: observationNote,
      })
      entreesRows.push({
        Date: '07/10/2026',
        Référence: r.ref,
        Produit: r.name,
        'Quantité entrée': unpricedQty,
        'Prix U (MAD)': '',
        'Montant achat': 0,
        'Paiement facturé': 'OUI',
        Fournisseur: supplierName,
        'Date paiement': '07/10/2026',
        'N° BL/Facture': `BL-${cRef}-02`,
        'Saisi par': 'Karim (Économat)',
        Observation: '',
      })
    } else if (DUPLICATE_CANDIDATE_PURCHASE_REFS.has(cRef)) {
      // 12 products split into two identical rows on the same date (08/10/2026) -> flagged as duplicate candidates
      const halfQty = round2(r.entrees / 2)
      const amt = round2(halfQty * exactUnitPrice)
      entreesRows.push({
        Date: '08/10/2026',
        Référence: r.ref,
        Produit: r.name,
        'Quantité entrée': halfQty,
        'Prix U (MAD)': exactUnitPrice,
        'Montant achat': amt,
        'Paiement facturé': paymentCell,
        Fournisseur: supplierName,
        'Date paiement': paymentDateCell,
        'N° BL/Facture': `BL-${cRef}-01`,
        'Saisi par': 'Karim (Économat)',
        Observation: observationNote,
      })
      entreesRows.push({
        Date: '08/10/2026',
        Référence: r.ref,
        Produit: r.name,
        'Quantité entrée': halfQty,
        'Prix U (MAD)': exactUnitPrice,
        'Montant achat': amt,
        'Paiement facturé': paymentCell,
        Fournisseur: supplierName,
        'Date paiement': paymentDateCell,
        'N° BL/Facture': `BL-${cRef}-02`,
        'Saisi par': 'Karim (Économat)',
        Observation: '',
      })
    } else if (splittableRefs.has(cRef)) {
      // Split into 2 deliveries on different dates (04/10/2026 and 11/10/2026)
      const q1 = round2(Math.floor(r.entrees / 2))
      const q2 = round2(r.entrees - q1)
      entreesRows.push({
        Date: '04/10/2026',
        Référence: r.ref,
        Produit: r.name,
        'Quantité entrée': q1,
        'Prix U (MAD)': exactUnitPrice,
        'Montant achat': round2(q1 * exactUnitPrice),
        'Paiement facturé': paymentCell,
        Fournisseur: supplierName,
        'Date paiement': paymentDateCell,
        'N° BL/Facture': `BL-${cRef}-01`,
        'Saisi par': 'Karim (Économat)',
        Observation: observationNote,
      })
      entreesRows.push({
        Date: '11/10/2026',
        Référence: r.ref,
        Produit: r.name,
        'Quantité entrée': q2,
        'Prix U (MAD)': exactUnitPrice,
        'Montant achat': round2(q2 * exactUnitPrice),
        'Paiement facturé': paymentCell,
        Fournisseur: supplierName,
        'Date paiement': paymentDateCell,
        'N° BL/Facture': `BL-${cRef}-02`,
        'Saisi par': 'Karim (Économat)',
        Observation: '',
      })
    } else {
      // Single purchase row
      entreesRows.push({
        Date: '06/10/2026',
        Référence: r.ref,
        Produit: r.name,
        'Quantité entrée': r.entrees,
        'Prix U (MAD)': exactUnitPrice,
        'Montant achat': round2(r.entrees * exactUnitPrice),
        'Paiement facturé': paymentCell,
        Fournisseur: supplierName,
        'Date paiement': paymentDateCell,
        'N° BL/Facture': `BL-${cRef}-01`,
        'Saisi par': 'Karim (Économat)',
        Observation: observationNote,
      })
    }
  }

  // 4. Build `Sorties Stock` (exact 143 rows)
  // Products with sorties > 0 in Golden Reference (59 products) + p217 (1 unit sortie on 10/10/2026) = 60 products.
  // Note: P262 (total sorties = 4, stockFinal = -1) and P264 (total sorties = 13, stockFinal = -10)
  // have physical count = 0 on 13/10/2026, and a post-count exit on 15/10/2026 (1 unit for P262, 10 units for P264),
  // which produces their exact negative Stock final (-1 and -10) while keeping Stock réel >= 0!
  const productsWithSorties = goldenRows.filter(
    (r) => r.sorties > 0 || r.canonicalRef === 'P217'
  )

  interface TempExitItem {
    ref: string
    canonicalRef: string
    name: string
    qty: number
    date: string
    locked?: boolean
  }
  const tempExits: TempExitItem[] = []
  for (const r of productsWithSorties) {
    if (r.canonicalRef === 'P262') {
      // 3 units before count + 1 unit strictly after count (15/10/2026) = 4 total sorties, stockFinal = 0 - 1 = -1
      tempExits.push({
        ref: r.ref,
        canonicalRef: r.canonicalRef,
        name: r.name,
        qty: 3,
        date: '10/10/2026',
        locked: true,
      })
      tempExits.push({
        ref: r.ref,
        canonicalRef: r.canonicalRef,
        name: r.name,
        qty: 1,
        date: '15/10/2026',
        locked: true,
      })
    } else if (r.canonicalRef === 'P264') {
      // 3 units before count + 10 units strictly after count (15/10/2026) = 13 total sorties, stockFinal = 0 - 10 = -10
      tempExits.push({
        ref: r.ref,
        canonicalRef: r.canonicalRef,
        name: r.name,
        qty: 3,
        date: '10/10/2026',
        locked: true,
      })
      tempExits.push({
        ref: r.ref,
        canonicalRef: r.canonicalRef,
        name: r.name,
        qty: 10,
        date: '15/10/2026',
        locked: true,
      })
    } else {
      const totalQty = r.canonicalRef === 'P217' ? 1 : r.sorties
      tempExits.push({
        ref: r.ref,
        canonicalRef: r.canonicalRef,
        name: r.name,
        qty: totalQty,
        date: '10/10/2026',
      })
    }
  }

  // Split larger exits (on dates <= 13/10/2026) until tempExits.length === 143
  let splitIdx = 0
  const exitDates = [
    '05/10/2026',
    '07/10/2026',
    '09/10/2026',
    '11/10/2026',
    '12/10/2026',
    '13/10/2026',
  ]
  while (tempExits.length < 143) {
    const item = tempExits[splitIdx % tempExits.length]
    if (!item.locked && item.qty >= 2) {
      const splitQty = Math.max(1, Math.floor(item.qty / 2))
      const remQty = round2(item.qty - splitQty)
      item.qty = splitQty
      item.date = exitDates[tempExits.length % exitDates.length]
      tempExits.push({
        ref: item.ref,
        canonicalRef: item.canonicalRef,
        name: item.name,
        qty: remQty,
        date: exitDates[(tempExits.length + 1) % exitDates.length],
      })
    }
    splitIdx++
    if (splitIdx > 2000) break
  }

  const destinations = ['Cuisine Chaude', 'Cuisine Froide', 'Pâtisserie', 'Bar']
  const sortiesRows: Record<string, unknown>[] = tempExits.map((x, idx) => ({
    Date: x.date,
    Référence: x.ref,
    Produit: x.name,
    'Quantité sortie': x.qty,
    Pertes: 0,
    Destination: destinations[idx % destinations.length],
    'Saisi par': 'Chef Mehdi',
    Observation: '',
  }))

  // 5. Build `Inventaire` (exact 119 rows: 118 on 13/10/2026 and 1 on 22/10/2026)
  // For P262 and P264, Stock réel on 13/10/2026 is 0 (non-negative), and their post-count exit on 15/10/2026 brings Stock final to -1 and -10.
  const inventaireRows: Record<string, unknown>[] = []
  for (const r of goldenRows) {
    if (!countedProductRefs.has(r.canonicalRef)) continue
    const effectiveSorties = r.canonicalRef === 'P217' ? 1 : r.sorties
    const theoretical = round2(
      r.initialStock + r.entrees - effectiveSorties - r.pertes
    )
    const counted =
      r.canonicalRef === 'P262' || r.canonicalRef === 'P264' ? 0 : r.stockFinal
    const diff = round2(counted - theoretical)
    const status =
      Math.abs(diff) < 0.0001 ? 'OK' : diff < 0 ? 'MANQUANT' : 'EXCÉDENT'
    const invDate =
      r.canonicalRef === lateCountCanonicalRef ? '22/10/2026' : '13/10/2026'

    inventaireRows.push({
      Référence: r.ref,
      Produit: r.name,
      Unité: r.unit,
      'Stock théorique': theoretical,
      'Stock réel': counted,
      Écart: diff,
      'Valeur écart': round2(diff * r.prixMoyen),
      Statut: status,
      'Date inventaire': invDate,
    })
  }

  // 6. Build `Parametres`
  const parametresRows: Record<string, unknown>[] = [
    {
      Unité: 'kg',
      Catégorie: 'Viandes & Charcuterie',
      Destination: 'Cuisine Chaude',
    },
    {
      Unité: 'L',
      Catégorie: 'Poissons & Fruits de mer',
      Destination: 'Cuisine Froide',
    },
    {
      Unité: 'unité',
      Catégorie: 'Fruits & Légumes',
      Destination: 'Pâtisserie',
    },
    {
      Unité: 'ps',
      Catégorie: 'Produits laitiers & Fromages',
      Destination: 'Bar',
    },
    { Unité: '', Catégorie: 'Œufs', Destination: '' },
    { Unité: '', Catégorie: 'Boulangerie', Destination: '' },
    { Unité: '', Catégorie: 'Pâtes & Féculents', Destination: '' },
    { Unité: '', Catégorie: 'Épicerie', Destination: '' },
    { Unité: '', Catégorie: 'Épices & Assaisonnements', Destination: '' },
    { Unité: '', Catégorie: 'Préparations / Bases', Destination: '' },
    { Unité: '', Catégorie: 'Pâtisserie & Desserts', Destination: '' },
    { Unité: '', Catégorie: 'Emballages & Jetables', Destination: '' },
    { Unité: '', Catégorie: 'Hygiène & Entretien', Destination: '' },
    { Unité: '', Catégorie: 'Boissons & Eaux', Destination: '' },
  ]

  // 7. Build `À vérifier` review sheet (253 rows)
  const aVerifierRows: Record<string, unknown>[] = []
  for (const r of goldenRows) {
    if (!r.category || r.category === '0') {
      aVerifierRows.push({
        'Catégorie anomalie': 'Produit sans catégorie',
        Feuille: 'Base Produits',
        Référence: r.ref,
        Élément: r.name,
        Détail: `Catégorie brute = "${r.category || 'Vide'}"`,
        'Action suggérée': 'Affecter une catégorie officielle',
      })
    }
  }
  for (let i = 243; i < goldenRows.length; i++) {
    const r = goldenRows[i]
    aVerifierRows.push({
      'Catégorie anomalie': 'Produit sans stock minimum',
      Feuille: 'Base Produits',
      Référence: r.ref,
      Élément: r.name,
      Détail: 'Stock minimum non renseigné (statut À définir)',
      'Action suggérée': 'Saisir le seuil d’alerte minimum',
    })
  }
  for (const row of entreesRows) {
    if (row['Prix U (MAD)'] === '' || Number(row['Prix U (MAD)']) <= 0) {
      aVerifierRows.push({
        'Catégorie anomalie': 'Achat sans prix',
        Feuille: 'Entrées Stock',
        Référence: String(row['Référence']),
        Élément: String(row['Produit']),
        Détail: `Entrée du ${row['Date']} (Qté: ${row['Quantité entrée']}) sans prix unitaire`,
        'Action suggérée': 'Renseigner le prix unitaire TTC/HT',
      })
    }
  }
  for (const row of entreesRows) {
    const pay = String(row['Paiement facturé'])
    if (pay !== 'OUI' && pay !== 'NON') {
      aVerifierRows.push({
        'Catégorie anomalie': 'Paiement ni OUI ni NON',
        Feuille: 'Entrées Stock',
        Référence: String(row['Référence']),
        Élément: String(row['Produit']),
        Détail: `Valeur paiement = "${pay}" (Fournisseur: ${row['Fournisseur']})`,
        'Action suggérée': 'Confirmer Payé (OUI) ou Impayé (NON)',
      })
    }
  }
  for (const supName of MISSING_SUPPLIERS_IN_PURCHASES) {
    aVerifierRows.push({
      'Catégorie anomalie': 'Fournisseur absent de la feuille fournisseur',
      Feuille: 'Entrées Stock',
      Référence: supName.trim(),
      Élément: supName.trim(),
      Détail: 'Présent dans Entrées Stock mais absent de la feuille fournisseur',
      'Action suggérée': 'Créer ou rattacher à un fournisseur officiel',
    })
  }
  for (const cRef of DUPLICATE_CANDIDATE_PURCHASE_REFS) {
    const r = goldenRows.find((g) => g.canonicalRef === cRef)
    if (r) {
      aVerifierRows.push({
        'Catégorie anomalie': 'Doublon potentiel',
        Feuille: 'Entrées Stock',
        Référence: r.ref,
        Élément: r.name,
        Détail: `2 lignes identiques le 08/10/2026 (Qté: ${round2(r.entrees / 2)})`,
        'Action suggérée': 'Vérifier s’il s’agit d’une double saisie',
      })
    }
  }
  for (const row of entreesRows) {
    if (String(row['Observation'] || '').toLowerCase().includes('vérifier')) {
      aVerifierRows.push({
        'Catégorie anomalie': 'Mention à vérifier',
        Feuille: 'Entrées Stock',
        Référence: String(row['Référence']),
        Élément: String(row['Produit']),
        Détail: String(row['Observation']),
        'Action suggérée': 'Contrôler le bon de livraison physique',
      })
    }
  }

  return {
    baseProduitsRows,
    fournisseurRows: [...MONARQ_CLEAN_SUPPLIERS_SHEET],
    entreesRows,
    sortiesRows,
    inventaireRows,
    parametresRows,
    aVerifierRows,
  }
}

/**
 * Generates an XLSX ArrayBuffer for `MONARQ_ECONOMAT_import_propre.xlsx`.
 */
export function buildMonarqCleanImportWorkbookBuffer(): ArrayBuffer {
  const data = buildMonarqCleanImportWorkbookData()
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data.baseProduitsRows),
    'Base Produits'
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data.entreesRows),
    'Entrées Stock'
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data.sortiesRows),
    'Sorties Stock'
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data.inventaireRows),
    'Inventaire'
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data.fournisseurRows),
    'fournisseur'
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data.parametresRows),
    'Parametres'
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data.aVerifierRows),
    'À vérifier'
  )

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return out as ArrayBuffer
}

export { GOLDEN_REFERENCE_DASHBOARD_KPIS }
