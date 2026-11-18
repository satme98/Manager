import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PocketBase from 'pocketbase'
import { createServer } from 'vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

const SUPERUSER_EMAIL =
  process.env.PB_SUPERUSER_EMAIL || 'direction@monarq.ma'
const SUPERUSER_PASSWORD =
  process.env.PB_SUPERUSER_PASSWORD || 'VotreMotDePasseSolide2026!'
const PB_PORT = process.env.PB_SEED_PORT || '8095'
const PB_URL = process.env.PB_SEED_URL || `http://127.0.0.1:${PB_PORT}`

async function waitForPocketBase(url, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`)
      if (res.ok) return
    } catch {
      // Waiting for PocketBase to start listening
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`PocketBase did not respond at ${url} within ${timeoutMs}ms`)
}

async function main() {
  console.log('[MONARQ Seed] Loading permanent seed dataset...')
  const vite = await createServer({
    root: ROOT_DIR,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  })

  let state
  let backupPayload
  try {
    const seedMod = await vite.ssrLoadModule('/src/data/monarq-permanent-seed.ts')
    state = seedMod.buildPermanentMonarqDatabaseState()
    backupPayload = seedMod.buildPermanentMonarqBackupPayload('pocketbase')
  } finally {
    await vite.close()
  }

  // Write static backup JSON in public/ for offline restore or download
  const publicDir = path.join(ROOT_DIR, 'public')
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true })
  }
  const backupPath = path.join(publicDir, 'monarq-permanent-backup.json')
  fs.writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2), 'utf8')
  console.log(`[MONARQ Seed] Wrote ${backupPath}`)

  const pbBinary = path.join(
    ROOT_DIR,
    process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase'
  )
  if (!fs.existsSync(pbBinary)) {
    throw new Error(`PocketBase binary not found at ${pbBinary}`)
  }

  // Check if a PocketBase instance is already listening at PB_URL
  let pbChild = null
  let alreadyRunning = false
  try {
    const health = await fetch(`${PB_URL}/api/health`)
    alreadyRunning = health.ok
  } catch {
    alreadyRunning = false
  }

  if (!alreadyRunning) {
    console.log(`[MONARQ Seed] Starting temporary PocketBase at ${PB_URL}...`)
    pbChild = spawn(
      pbBinary,
      [
        'serve',
        `--http=127.0.0.1:${PB_PORT}`,
        `--dir=${path.join(ROOT_DIR, 'pb_data')}`,
        `--migrationsDir=${path.join(ROOT_DIR, 'pb_migrations')}`,
        `--hooksDir=${path.join(ROOT_DIR, 'pb_hooks')}`,
      ],
      {
        cwd: ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    await waitForPocketBase(PB_URL)
  }

  try {
    const pb = new PocketBase(PB_URL)
    pb.autoCancellation(false)

    // 1. Authenticate as _superusers and upsert all 5 users
    await pb
      .collection('_superusers')
      .authWithPassword(SUPERUSER_EMAIL, SUPERUSER_PASSWORD)

    const existingUsers = await pb.collection('users').getFullList({
      fields: 'id,email',
    })
    const existingUserByEmail = new Map(
      existingUsers.map((u) => [String(u.email).toLowerCase(), u])
    )

    for (const u of state.users) {
      const found = existingUserByEmail.get(u.email.toLowerCase())
      if (!found) {
        await pb.collection('users').create({
          id: u.id,
          email: u.email,
          emailVisibility: true,
          name: u.name,
          role: u.role,
          active: u.active,
          verified: true,
          password: u.passwordHash,
          passwordConfirm: u.passwordHash,
        })
      }
    }
    console.log(`[MONARQ Seed] Users ensured: ${state.users.length}`)

    // 2. Authenticate as the seeded admin user (in users collection) so audit_log relations are valid
    pb.authStore.clear()
    await pb
      .collection('users')
      .authWithPassword('admin@monarq.ma', 'admin1234')

    async function seedCollection(collectionName, records, mapper) {
      const existing = await pb
        .collection(collectionName)
        .getFullList({ fields: 'id' })
      const existingIds = new Set(existing.map((r) => r.id))

      let created = 0
      for (const rec of records) {
        if (existingIds.has(rec.id)) continue
        try {
          await pb.collection(collectionName).create(mapper(rec))
          created++
        } catch (err) {
          const msg = err?.response?.message || err?.message || String(err)
          console.warn(
            `[MONARQ Seed] Skipped ${collectionName}/${rec.id}: ${msg}`
          )
        }
      }
      const total = existingIds.size + created
      console.log(
        `[MONARQ Seed] ${collectionName}: +${created} created (total: ${total})`
      )
    }

    await seedCollection('settings', state.settings, (s) => ({
      id: s.id,
      key: s.key,
      value: s.value,
    }))

    await seedCollection('suppliers', state.suppliers, (s) => ({
      id: s.id,
      name: s.name,
      contact: s.contact || '',
      phone: s.phone || '',
      email: s.email || '',
      payment_terms: s.payment_terms || '',
      notes: s.notes || '',
      archived: Boolean(s.archived),
      missing_from_supplier_sheet: Boolean(s.missing_from_supplier_sheet),
      source_row_id: s.source_row_id || '',
      import_batch_id: s.import_batch_id || '',
    }))

    await seedCollection('products', state.products, (p) => ({
      id: p.id,
      ref: p.ref,
      name: p.name,
      category: p.category || '',
      unit: p.unit,
      initial_stock: p.initial_stock ?? 0,
      min_stock: p.min_stock ?? 0,
      location: p.location || '',
      notes: p.notes || '',
      archived: Boolean(p.archived),
      source_row_id: p.source_row_id || '',
      import_batch_id: p.import_batch_id || '',
    }))

    await seedCollection('purchases', state.purchases, (p) => ({
      id: p.id,
      date: p.date,
      supplier: p.supplier,
      invoice_no: p.invoice_no || '',
      payment_status: p.payment_status,
      payment_date: p.payment_date || '',
      raw_payment_status: p.raw_payment_status || '',
      is_ambiguous_payment: Boolean(p.is_ambiguous_payment),
      recorded_by: p.recorded_by || '',
      recorded_by_name: p.recorded_by_name || '',
      notes: p.notes || '',
      correction_status: p.correction_status || 'none',
      import_batch_id: p.import_batch_id || '',
      order_index: p.order_index ?? 0,
    }))

    await seedCollection('purchase_lines', state.purchase_lines, (l) => ({
      id: l.id,
      purchase: l.purchase,
      product: l.product,
      qty: l.qty,
      unit_price: l.unit_price ?? 0,
      amount: l.amount ?? 0,
      is_duplicate_candidate: Boolean(l.is_duplicate_candidate),
      duplicate_verified: Boolean(l.duplicate_verified),
      source_row_id: l.source_row_id || '',
      import_batch_id: l.import_batch_id || '',
      order_index: l.order_index ?? 0,
    }))

    await seedCollection('exits', state.exits, (x) => ({
      id: x.id,
      date: x.date,
      destination: x.destination,
      recorded_by: x.recorded_by || '',
      recorded_by_name: x.recorded_by_name || '',
      notes: x.notes || '',
      negative_stock_reason: x.negative_stock_reason || '',
      correction_status: x.correction_status || 'none',
      import_batch_id: x.import_batch_id || '',
      order_index: x.order_index ?? 0,
    }))

    await seedCollection('exit_lines', state.exit_lines, (l) => ({
      id: l.id,
      exit: l.exit,
      product: l.product,
      qty_consumed: l.qty_consumed ?? 0,
      qty_wasted: l.qty_wasted ?? 0,
      loss_reason: l.loss_reason || '',
      unit_cost_snapshot: l.unit_cost_snapshot ?? 0,
      is_duplicate_candidate: Boolean(l.is_duplicate_candidate),
      duplicate_verified: Boolean(l.duplicate_verified),
      source_row_id: l.source_row_id || '',
      import_batch_id: l.import_batch_id || '',
      order_index: l.order_index ?? 0,
    }))

    await seedCollection(
      'inventory_sessions',
      state.inventory_sessions,
      (s) => ({
        id: s.id,
        date: s.date,
        scope: s.scope,
        category: s.category || '',
        categories: s.categories,
        location: s.location || '',
        status: s.status,
        created_by: s.created_by || '',
        created_by_name: s.created_by_name || '',
        confirmed_by: s.confirmed_by || '',
        confirmed_by_name: s.confirmed_by_name || '',
        confirmed_at: s.confirmed_at || '',
        notes: s.notes || '',
        import_batch_id: s.import_batch_id || '',
      })
    )

    await seedCollection('inventory_lines', state.inventory_lines, (l) => ({
      id: l.id,
      session: l.session,
      product: l.product,
      theoretical: l.theoretical ?? 0,
      counted: l.counted ?? 0,
      diff: l.diff ?? 0,
      value_diff: l.value_diff ?? 0,
      comment: l.comment || '',
      source_row_id: l.source_row_id || '',
      import_batch_id: l.import_batch_id || '',
      order_index: l.order_index ?? 0,
    }))

    await seedCollection('import_batches', state.import_batches, (b) => ({
      id: b.id,
      source_id: b.source_id,
      filename: b.filename,
      status: b.status,
      counts: b.counts,
      created_at: b.created_at,
    }))

    console.log('[MONARQ Seed] PocketBase database seeded successfully!')
  } finally {
    if (pbChild) {
      pbChild.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 400))
      if (!pbChild.killed) {
        pbChild.kill('SIGKILL')
      }
    }
  }
}

main().catch((err) => {
  console.error('[MONARQ Seed] Failed:', err)
  process.exit(1)
})
