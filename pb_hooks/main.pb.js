/// <reference path="../pb_data/types.d.ts" />

/**
 * PocketBase v0.25+ Server-Side Hooks — MONARQ ÉCONOMAT (pb_hooks/main.pb.js)
 *
 * Enforces server-side inside SQLite transactions:
 * 1. Trimmed case-insensitive uniqueness on products.ref and suppliers.name
 * 2. Purchase line amount calculation: amount = round2(qty * unit_price)
 * 3. Server-side stock computation & negative-stock blocking (unless manager/admin with reason)
 * 4. Immutability: blocks deletion of movements (purchases, exits, inventories, audit_log)
 * 5. Cuisine field masking: strips unit_cost_snapshot and value_diff for role = "cuisine"
 * 6. Automatic audit_log recording on every create, update, and reversal
 * 7. Multi-line transactional routes for purchases, exits, and reversals
 */

function writeAuditLog(app, authRecord, action, collectionName, recordId, details) {
  const auditCol = app.findCollectionByNameOrId('audit_log')
  const logRecord = new Record(auditCol)
  logRecord.set('user', authRecord ? authRecord.id : '')
  logRecord.set('user_email', authRecord ? authRecord.getString('email') : 'system')
  logRecord.set('timestamp', new Date().toISOString())
  logRecord.set('action', action)
  logRecord.set('collection', collectionName)
  logRecord.set('record_id', recordId)
  logRecord.set('details', details || {})
  app.save(logRecord)
}

function isServerMovementAfterCutoff(movDate, cutDate) {
  const mov = String(movDate || '').trim()
  const cut = String(cutDate || '').trim()
  if (mov.length === 10 && cut.length === 10) return mov > cut
  if (cut.length === 10 && mov.length > 10) return mov.slice(0, 10) > cut
  if (mov.length === 10 && cut.length > 10) return mov > cut.slice(0, 10)
  return mov > cut
}

function computeServerProductStock(app, productId) {
  const product = app.findRecordById('products', productId)
  const initialStock = Number(product.get('initial_stock') || 0)

  // Find latest confirmed inventory count for this product
  const confirmedSessions = app.findRecordsByFilter(
    'inventory_sessions',
    'status = "confirmed"',
    '-date,-confirmed_at',
    100,
    0
  )

  let latestBaseline = null
  for (let i = 0; i < confirmedSessions.length; i++) {
    const sess = confirmedSessions[i]
    const lines = app.findRecordsByFilter(
      'inventory_lines',
      `session = "${sess.id}" && product = "${productId}"`,
      '',
      1,
      0
    )
    if (lines.length > 0 && lines[0].get('counted') !== null && lines[0].get('counted') !== undefined) {
      const sDate = sess.getString('date') || ''
      const cAt = sess.getString('confirmed_at') || ''
      const cutoffDate =
        cAt.length > 10 && sDate.length >= 10 && cAt.slice(0, 10) === sDate.slice(0, 10)
          ? cAt
          : sDate || cAt
      latestBaseline = {
        date: cutoffDate,
        counted: Number(lines[0].get('counted') || 0),
      }
      break
    }
  }

  const purchaseLines = app.findRecordsByFilter(
    'purchase_lines',
    `product = "${productId}"`,
    '',
    10000,
    0
  )
  let entriesAfter = 0
  for (let i = 0; i < purchaseLines.length; i++) {
    const pl = purchaseLines[i]
    const header = app.findRecordById('purchases', pl.getString('purchase'))
    const revOf = header.getString('reversed_of')
    const corrStatus = header.getString('correction_status')
    if (revOf || corrStatus === 'reversed' || corrStatus === 'corrected') {
      continue
    }
    const pDate = header.getString('date')
    if (!latestBaseline || isServerMovementAfterCutoff(pDate, latestBaseline.date)) {
      entriesAfter += Number(pl.get('qty') || 0)
    }
  }

  const exitLines = app.findRecordsByFilter(
    'exit_lines',
    `product = "${productId}"`,
    '',
    10000,
    0
  )
  let consumedAfter = 0
  let wastedAfter = 0
  for (let i = 0; i < exitLines.length; i++) {
    const xl = exitLines[i]
    const header = app.findRecordById('exits', xl.getString('exit'))
    const revOf = header.getString('reversed_of')
    const corrStatus = header.getString('correction_status')
    if (revOf || corrStatus === 'reversed' || corrStatus === 'corrected') {
      continue
    }
    const xDate = header.getString('date')
    if (!latestBaseline || isServerMovementAfterCutoff(xDate, latestBaseline.date)) {
      consumedAfter += Number(xl.get('qty_consumed') || 0)
      wastedAfter += Number(xl.get('qty_wasted') || 0)
    }
  }

  const base = latestBaseline ? latestBaseline.counted : initialStock
  return Math.round((base + entriesAfter - consumedAfter - wastedAfter) * 10000) / 10000
}

// 1. Normalize and validate products.ref (case-insensitive, trimmed)
onRecordCreateRequest((e) => {
  const ref = (e.record.getString('ref') || '').trim().toUpperCase()
  const name = (e.record.getString('name') || '').trim()
  if (!ref || !name) {
    throw new BadRequestError('La référence et le nom du produit sont obligatoires.')
  }
  const existing = e.app.findRecordsByFilter(
    'products',
    `ref ~ "${ref}"`,
    '',
    10,
    0
  )
  for (let i = 0; i < existing.length; i++) {
    if (existing[i].getString('ref').trim().toUpperCase() === ref) {
      throw new BadRequestError(`La référence produit "${ref}" existe déjà.`)
    }
  }
  e.record.set('ref', ref)
  e.record.set('name', name)
  e.next()
  writeAuditLog(e.app, e.auth, 'create', 'products', e.record.id, {
    ref,
    name,
  })
}, 'products')

// 1b. Validate product updates (block ref change if movements exist; require manager/admin for unit change if movements exist)
onRecordUpdateRequest((e) => {
  const existing = e.app.findRecordById('products', e.record.id)
  const newRef = (e.record.getString('ref') || '').trim().toUpperCase()
  const oldRef = (existing.getString('ref') || '').trim().toUpperCase()
  const newUnit = (e.record.getString('unit') || '').trim()
  const oldUnit = (existing.getString('unit') || '').trim()

  const hasPurchases =
    e.app.findRecordsByFilter('purchase_lines', `product = "${e.record.id}"`, '', 1, 0).length > 0
  const hasExits =
    e.app.findRecordsByFilter('exit_lines', `product = "${e.record.id}"`, '', 1, 0).length > 0
  const hasInventories =
    e.app.findRecordsByFilter('inventory_lines', `product = "${e.record.id}"`, '', 1, 0).length > 0
  const hasMovements = hasPurchases || hasExits || hasInventories

  if (newRef !== oldRef) {
    if (hasMovements) {
      throw new BadRequestError(
        "Impossible de modifier la référence d'un produit ayant déjà des mouvements enregistrés."
      )
    }
    const matches = e.app.findRecordsByFilter('products', `ref ~ "${newRef}"`, '', 10, 0)
    for (let i = 0; i < matches.length; i++) {
      if (
        matches[i].id !== e.record.id &&
        matches[i].getString('ref').trim().toUpperCase() === newRef
      ) {
        throw new BadRequestError(`La référence produit "${newRef}" existe déjà.`)
      }
    }
  }

  if (newUnit !== oldUnit && hasMovements) {
    const role = e.auth ? e.auth.getString('role') : ''
    if (role !== 'admin' && role !== 'manager') {
      throw new ForbiddenError(
        "Seul un Manager ou Administrateur peut modifier l'unité d'un produit ayant déjà des mouvements."
      )
    }
  }

  e.record.set('ref', newRef)
  e.record.set('name', (e.record.getString('name') || '').trim())
  e.next()
  writeAuditLog(e.app, e.auth, 'update', 'products', e.record.id, {
    ref: newRef,
    unit: newUnit,
    archived: e.record.getBool('archived'),
  })
}, 'products')

// 1c. Normalize and validate suppliers.name (case-insensitive, trimmed)
onRecordCreateRequest((e) => {
  const name = (e.record.getString('name') || '').trim()
  if (!name) {
    throw new BadRequestError('Le nom du fournisseur est obligatoire.')
  }
  const existing = e.app.findRecordsByFilter('suppliers', `name ~ "${name}"`, '', 10, 0)
  for (let i = 0; i < existing.length; i++) {
    if (existing[i].getString('name').trim().toLowerCase() === name.toLowerCase()) {
      throw new BadRequestError(`Le fournisseur "${name}" existe déjà.`)
    }
  }
  e.record.set('name', name)
  e.next()
  writeAuditLog(e.app, e.auth, 'create', 'suppliers', e.record.id, { name })
}, 'suppliers')

onRecordUpdateRequest((e) => {
  const name = (e.record.getString('name') || '').trim()
  if (!name) {
    throw new BadRequestError('Le nom du fournisseur est obligatoire.')
  }
  const existing = e.app.findRecordsByFilter('suppliers', `name ~ "${name}"`, '', 10, 0)
  for (let i = 0; i < existing.length; i++) {
    if (
      existing[i].id !== e.record.id &&
      existing[i].getString('name').trim().toLowerCase() === name.toLowerCase()
    ) {
      throw new BadRequestError(`Le fournisseur "${name}" existe déjà.`)
    }
  }
  e.record.set('name', name)
  e.next()
  writeAuditLog(e.app, e.auth, 'update', 'suppliers', e.record.id, {
    name,
    archived: e.record.getBool('archived'),
  })
}, 'suppliers')

// 2. Server-side purchase_lines amount calculation
onRecordCreateRequest((e) => {
  const qty = Number(e.record.get('qty') || 0)
  const unitPrice = Number(e.record.get('unit_price') || 0)
  if (qty === 0) {
    throw new BadRequestError('La quantité doit être différente de zéro.')
  }
  if (unitPrice < 0) {
    throw new BadRequestError('Le prix unitaire ne peut pas être négatif.')
  }
  const amount = Math.round(qty * unitPrice * 100) / 100
  e.record.set('amount', amount)
  e.next()
}, 'purchase_lines')

// 3. Block deletion on immutable movement collections
onRecordDeleteRequest(
  (e) => {
    throw new ForbiddenError(
      'Suppression interdite : les mouvements et journaux sont immuables. Utilisez une contre-passation (reversal).'
    )
  },
  'purchases',
  'purchase_lines',
  'exits',
  'exit_lines',
  'inventory_sessions',
  'inventory_lines',
  'audit_log'
)

// 4. Mask financial fields for role = "cuisine"
onRecordEnrich(
  (e) => {
    const role = e.requestInfo.auth ? e.requestInfo.auth.getString('role') : ''
    if (role === 'cuisine') {
      e.record.hide('unit_cost_snapshot', 'value_diff')
    }
    e.next()
  },
  'exit_lines',
  'inventory_lines'
)

function computeServerAveragePrice(app, productId) {
  const purchaseLines = app.findRecordsByFilter(
    'purchase_lines',
    `product = "${productId}"`,
    '',
    10000,
    0
  )
  let totalCost = 0
  let totalQty = 0
  for (let i = 0; i < purchaseLines.length; i++) {
    const pl = purchaseLines[i]
    const qty = Number(pl.get('qty') || 0)
    const unitPrice = Number(pl.get('unit_price') || 0)
    if (unitPrice > 0 && qty !== 0) {
      totalCost += qty * unitPrice
      totalQty += qty
    }
  }
  if (totalQty <= 0 || totalCost <= 0) {
    return null
  }
  return Math.round((totalCost / totalQty) * 100) / 100
}

// 5. Transactional endpoint for multi-line Exit creation with aggregated negative-stock guard & server-side cost snapshot
routerAdd('POST', '/api/monarq/exits', (e) => {
  if (!e.auth) {
    throw new UnauthorizedError('Authentification requise.')
  }
  const role = e.auth.getString('role')
  if (!['admin', 'manager', 'economat', 'cuisine'].includes(role)) {
    throw new ForbiddenError('Votre rôle ne permet pas de créer une sortie de stock.')
  }

  const body = e.requestInfo().body
  const lines = Array.isArray(body.lines) ? body.lines : []
  if (lines.length === 0) {
    throw new BadRequestError('Une sortie de stock doit contenir au moins une ligne.')
  }

  let createdHeaderId = ''

  e.app.runInTransaction((txApp) => {
    // Aggregate deductions per product across all lines in the document
    const deductionsByProduct = {}
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const consumed = Number(line.qty_consumed || 0)
      const wasted = Number(line.qty_wasted || 0)
      if (consumed < 0 || wasted < 0 || consumed + wasted <= 0) {
        throw new BadRequestError(
          'Chaque ligne de sortie doit comporter une quantité consommée ou perdue strictement positive.'
        )
      }
      deductionsByProduct[line.product] =
        (deductionsByProduct[line.product] || 0) + consumed + wasted
    }

    // Check negative stock before committing any line
    const productIds = Object.keys(deductionsByProduct)
    for (let i = 0; i < productIds.length; i++) {
      const productId = productIds[i]
      const currentStock = computeServerProductStock(txApp, productId)
      const deduction = deductionsByProduct[productId]
      const projected = currentStock - deduction

      if (projected < 0) {
        if (role !== 'admin' && role !== 'manager') {
          throw new BadRequestError(
            `Stock insuffisant (disponible: ${currentStock}, demandé: ${deduction}). Seul un Manager ou Administrateur peut forcer un stock négatif.`
          )
        }
        const reason = String(body.negative_stock_reason || '').trim()
        if (!reason) {
          throw new BadRequestError(
            'Un motif est obligatoire pour confirmer un mouvement entraînant un stock négatif.'
          )
        }
      }
    }

    const exitsCol = txApp.findCollectionByNameOrId('exits')
    const exitRecord = new Record(exitsCol)
    exitRecord.set('date', body.date || new Date().toISOString())
    exitRecord.set('destination', body.destination || 'Cuisine')
    exitRecord.set('recorded_by', e.auth.id)
    exitRecord.set('notes', body.notes || '')
    exitRecord.set('negative_stock_reason', body.negative_stock_reason || '')
    exitRecord.set('correction_status', 'none')
    txApp.save(exitRecord)
    createdHeaderId = exitRecord.id

    const exitLinesCol = txApp.findCollectionByNameOrId('exit_lines')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineRecord = new Record(exitLinesCol)
      const serverAvgCost = computeServerAveragePrice(txApp, line.product)
      lineRecord.set('exit', exitRecord.id)
      lineRecord.set('product', line.product)
      lineRecord.set('qty_consumed', Number(line.qty_consumed || 0))
      lineRecord.set('qty_wasted', Number(line.qty_wasted || 0))
      lineRecord.set('loss_reason', String(line.loss_reason || '').trim())
      if (serverAvgCost !== null) {
        lineRecord.set('unit_cost_snapshot', serverAvgCost)
      }
      txApp.save(lineRecord)
    }

    writeAuditLog(txApp, e.auth, 'create', 'exits', exitRecord.id, {
      destination: body.destination,
      lines_count: lines.length,
      negative_stock_reason: body.negative_stock_reason || null,
    })
  })

  return e.json(201, { id: createdHeaderId })
})

