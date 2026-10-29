/// <reference path="../pb_data/types.d.ts" />

/**
 * PocketBase v0.25.x Migration — MONARQ ÉCONOMAT Schema & API Rules
 *
 * Uses PocketBase v0.25+ "fields" syntax (NOT legacy "schema").
 * Superusers live in "_superusers".
 * Every collection creation is immediately followed by field-existence verification
 * via app.findCollectionByNameOrId() to guarantee all fields were persisted.
 */
migrate(
  (app) => {
    function verifyCollectionFields(collectionName, expectedFieldNames) {
      const saved = app.findCollectionByNameOrId(collectionName)
      if (!saved) {
        throw new Error(
          `[MONARQ Migration] Collection "${collectionName}" introuvable après sauvegarde.`
        )
      }
      const existingNames = saved.fields.map((f) => f.name)
      for (const fieldName of expectedFieldNames) {
        if (!existingNames.includes(fieldName)) {
          throw new Error(
            `[MONARQ Migration] Champ manquant "${fieldName}" sur la collection "${collectionName}". Champs trouvés: ${existingNames.join(', ')}`
          )
        }
      }
    }

    // 1. Update Auth Collection: users
    const users = app.findCollectionByNameOrId('users')
    users.listRule = '@request.auth.id != "" && @request.auth.role = "admin"'
    users.viewRule =
      '@request.auth.id != "" && (@request.auth.id = id || @request.auth.role = "admin")'
    users.createRule = '@request.auth.id != "" && @request.auth.role = "admin"'
    users.updateRule = '@request.auth.id != "" && @request.auth.role = "admin"'
    users.deleteRule = null

    users.fields.add(
      new SelectField({
        name: 'role',
        required: true,
        maxSelect: 1,
        values: ['admin', 'manager', 'economat', 'cuisine', 'consultation'],
      })
    )
    users.fields.add(
      new BoolField({
        name: 'active',
      })
    )
    app.save(users)
    verifyCollectionFields('users', ['name', 'role', 'active'])

    // 2. products
    const products = new Collection({
      type: 'base',
      name: 'products',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      deleteRule: '@request.auth.id != "" && @request.auth.role = "admin"',
      fields: [
        { name: 'ref', type: 'text', required: true },
        { name: 'name', type: 'text', required: true },
        { name: 'category', type: 'text', required: false },
        { name: 'unit', type: 'text', required: true },
        { name: 'initial_stock', type: 'number', required: false },
        { name: 'min_stock', type: 'number', required: false, min: 0 },
        { name: 'location', type: 'text', required: false },
        { name: 'notes', type: 'text', required: false },
        { name: 'archived', type: 'bool', required: false },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_products_ref_ci ON products (LOWER(TRIM(ref)))',
      ],
    })
    app.save(products)
    verifyCollectionFields('products', [
      'ref',
      'name',
      'category',
      'unit',
      'initial_stock',
      'min_stock',
      'location',
      'notes',
      'archived',
    ])

    // 3. suppliers (hidden from cuisine)
    const suppliers = new Collection({
      type: 'base',
      name: 'suppliers',
      listRule: '@request.auth.id != "" && @request.auth.role != "cuisine"',
      viewRule: '@request.auth.id != "" && @request.auth.role != "cuisine"',
      createRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      deleteRule: '@request.auth.id != "" && @request.auth.role = "admin"',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'contact', type: 'text', required: false },
        { name: 'phone', type: 'text', required: false },
        { name: 'email', type: 'email', required: false },
        { name: 'payment_terms', type: 'text', required: false },
        { name: 'notes', type: 'text', required: false },
        { name: 'archived', type: 'bool', required: false },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_suppliers_name_ci ON suppliers (LOWER(TRIM(name)))',
      ],
    })
    app.save(suppliers)
    verifyCollectionFields('suppliers', [
      'name',
      'contact',
      'phone',
      'email',
      'payment_terms',
      'notes',
      'archived',
    ])

    // 4. purchases (document header — hidden from cuisine, never deleted)
    const purchases = new Collection({
      type: 'base',
      name: 'purchases',
      listRule: '@request.auth.id != "" && @request.auth.role != "cuisine"',
      viewRule: '@request.auth.id != "" && @request.auth.role != "cuisine"',
      createRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      deleteRule: null,
      fields: [
        { name: 'date', type: 'text', required: true },
        {
          name: 'supplier',
          type: 'relation',
          required: true,
          collectionId: suppliers.id,
          maxSelect: 1,
        },
        { name: 'invoice_no', type: 'text', required: false },
        {
          name: 'payment_status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['paid', 'unpaid', 'partial'],
        },
        { name: 'payment_date', type: 'text', required: false },
        { name: 'payment_method', type: 'text', required: false },
        { name: 'payment_reference', type: 'text', required: false },
        { name: 'amount_paid', type: 'number', required: false, min: 0 },
        { name: 'payment_events', type: 'json', required: false },
        {
          name: 'recorded_by',
          type: 'relation',
          required: false,
          collectionId: users.id,
          maxSelect: 1,
        },
        { name: 'notes', type: 'text', required: false },
        { name: 'reversal_reason', type: 'text', required: false },
        {
          name: 'correction_status',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['none', 'pending_approval', 'reversed', 'corrected'],
        },
        { name: 'pending_reversal_reason', type: 'text', required: false },
        { name: 'pending_reversal_requested_by', type: 'text', required: false },
        { name: 'pending_reversal_at', type: 'text', required: false },
      ],
    })
    app.save(purchases)
    // Add self-relation reversed_of after purchases.id exists
    purchases.fields.add(
      new RelationField({
        name: 'reversed_of',
        required: false,
        collectionId: purchases.id,
        maxSelect: 1,
      })
    )
    app.save(purchases)
    verifyCollectionFields('purchases', [
      'date',
      'supplier',
      'invoice_no',
      'payment_status',
      'payment_date',
      'recorded_by',
      'notes',
      'reversed_of',
      'correction_status',
    ])

    // 5. purchase_lines (hidden from cuisine, never deleted, amount calculated server-side)
    const purchaseLines = new Collection({
      type: 'base',
      name: 'purchase_lines',
      listRule: '@request.auth.id != "" && @request.auth.role != "cuisine"',
      viewRule: '@request.auth.id != "" && @request.auth.role != "cuisine"',
      createRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager")',
      deleteRule: null,
      fields: [
        {
          name: 'purchase',
          type: 'relation',
          required: true,
          collectionId: purchases.id,
          maxSelect: 1,
        },
        {
          name: 'product',
          type: 'relation',
          required: true,
          collectionId: products.id,
          maxSelect: 1,
        },
        { name: 'qty', type: 'number', required: true },
        { name: 'unit_price', type: 'number', required: false, min: 0 },
        { name: 'amount', type: 'number', required: false },
        { name: 'source_row_id', type: 'text', required: false },
      ],
    })
    app.save(purchaseLines)
    verifyCollectionFields('purchase_lines', [
      'purchase',
      'product',
      'qty',
      'unit_price',
      'amount',
    ])

    // 6. exits (document header — cuisine can create, never deleted)
    const exits = new Collection({
      type: 'base',
      name: 'exits',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat" || @request.auth.role = "cuisine")',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      deleteRule: null,
      fields: [
        { name: 'date', type: 'text', required: true },
        { name: 'destination', type: 'text', required: true },
        {
          name: 'recorded_by',
          type: 'relation',
          required: false,
          collectionId: users.id,
          maxSelect: 1,
        },
        { name: 'notes', type: 'text', required: false },
        { name: 'reversal_reason', type: 'text', required: false },
        { name: 'negative_stock_reason', type: 'text', required: false },
        {
          name: 'correction_status',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['none', 'pending_approval', 'reversed', 'corrected'],
        },
        { name: 'pending_reversal_reason', type: 'text', required: false },
        { name: 'pending_reversal_requested_by', type: 'text', required: false },
        { name: 'pending_reversal_at', type: 'text', required: false },
      ],
    })
    app.save(exits)
    exits.fields.add(
      new RelationField({
        name: 'reversed_of',
        required: false,
        collectionId: exits.id,
        maxSelect: 1,
      })
    )
    app.save(exits)
    verifyCollectionFields('exits', [
      'date',
      'destination',
      'recorded_by',
      'notes',
      'reversed_of',
      'correction_status',
    ])

    // 7. exit_lines (cuisine can create, never deleted)
    const exitLines = new Collection({
      type: 'base',
      name: 'exit_lines',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat" || @request.auth.role = "cuisine")',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager")',
      deleteRule: null,
      fields: [
        {
          name: 'exit',
          type: 'relation',
          required: true,
          collectionId: exits.id,
          maxSelect: 1,
        },
        {
          name: 'product',
          type: 'relation',
          required: true,
          collectionId: products.id,
          maxSelect: 1,
        },
        { name: 'qty_consumed', type: 'number', required: false, min: 0 },
        { name: 'qty_wasted', type: 'number', required: false, min: 0 },
        { name: 'loss_reason', type: 'text', required: false },
        { name: 'unit_cost_snapshot', type: 'number', required: false, min: 0 },
        { name: 'source_row_id', type: 'text', required: false },
      ],
    })
    app.save(exitLines)
    verifyCollectionFields('exit_lines', [
      'exit',
      'product',
      'qty_consumed',
      'qty_wasted',
      'loss_reason',
      'unit_cost_snapshot',
    ])

    // 8. inventory_sessions (never deleted; consultation only sees non-draft sessions)
    const inventorySessions = new Collection({
      type: 'base',
      name: 'inventory_sessions',
      listRule:
        '@request.auth.id != "" && (@request.auth.role != "consultation" || status != "draft")',
      viewRule:
        '@request.auth.id != "" && (@request.auth.role != "consultation" || status != "draft")',
      createRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      deleteRule: null,
      fields: [
        { name: 'date', type: 'text', required: true },
        {
          name: 'scope',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['full', 'category'],
        },
        { name: 'category', type: 'text', required: false },
        { name: 'categories', type: 'json', required: false },
        { name: 'location', type: 'text', required: false },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['draft', 'confirmed', 'reversed'],
        },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: users.id,
          maxSelect: 1,
        },
        {
          name: 'confirmed_by',
          type: 'relation',
          required: false,
          collectionId: users.id,
          maxSelect: 1,
        },
        { name: 'confirmed_at', type: 'text', required: false },
        {
          name: 'reversed_by',
          type: 'relation',
          required: false,
          collectionId: users.id,
          maxSelect: 1,
        },
        { name: 'reversed_at', type: 'text', required: false },
        { name: 'reversal_reason', type: 'text', required: false },
        { name: 'notes', type: 'text', required: false },
      ],
    })
    app.save(inventorySessions)
    verifyCollectionFields('inventory_sessions', [
      'date',
      'scope',
      'category',
      'categories',
      'location',
      'status',
      'created_by',
      'confirmed_by',
      'confirmed_at',
      'reversed_by',
      'reversed_at',
      'reversal_reason',
    ])

    // 9. inventory_lines (never deleted)
    const inventoryLines = new Collection({
      type: 'base',
      name: 'inventory_lines',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      deleteRule: null,
      fields: [
        {
          name: 'session',
          type: 'relation',
          required: true,
          collectionId: inventorySessions.id,
          maxSelect: 1,
        },
        {
          name: 'product',
          type: 'relation',
          required: true,
          collectionId: products.id,
          maxSelect: 1,
        },
        { name: 'theoretical', type: 'number', required: false },
        { name: 'counted', type: 'number', required: false },
        { name: 'diff', type: 'number', required: false },
        { name: 'value_diff', type: 'number', required: false },
        { name: 'comment', type: 'text', required: false },
      ],
    })
    app.save(inventoryLines)
    verifyCollectionFields('inventory_lines', [
      'session',
      'product',
      'theoretical',
      'counted',
      'diff',
      'value_diff',
      'comment',
    ])

    // 10. audit_log (append-only via hooks; nobody can update or delete)
    const auditLog = new Collection({
      type: 'base',
      name: 'audit_log',
      listRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "consultation")',
      viewRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "consultation")',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: 'user',
          type: 'relation',
          required: false,
          collectionId: users.id,
          maxSelect: 1,
        },
        { name: 'user_email', type: 'text', required: false },
        { name: 'timestamp', type: 'text', required: true },
        { name: 'action', type: 'text', required: true },
        { name: 'collection', type: 'text', required: true },
        { name: 'record_id', type: 'text', required: true },
        { name: 'details', type: 'json', required: false },
      ],
    })
    app.save(auditLog)
    verifyCollectionFields('audit_log', [
      'user',
      'timestamp',
      'action',
      'collection',
      'record_id',
      'details',
    ])

    // 11. settings (cuisine cannot read replenishment_draft_lists or payment_methods_list)
    const settings = new Collection({
      type: 'base',
      name: 'settings',
      listRule:
        '@request.auth.id != "" && (@request.auth.role != "cuisine" || (key != "replenishment_draft_lists" && key != "payment_methods_list"))',
      viewRule:
        '@request.auth.id != "" && (@request.auth.role != "cuisine" || (key != "replenishment_draft_lists" && key != "payment_methods_list"))',
      createRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager")',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager")',
      deleteRule: null,
      fields: [
        { name: 'key', type: 'text', required: true },
        { name: 'value', type: 'json', required: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_settings_key ON settings (key)'],
    })
    app.save(settings)
    verifyCollectionFields('settings', ['key', 'value'])

    // 12. import_batches
    const importBatches = new Collection({
      type: 'base',
      name: 'import_batches',
      listRule: '@request.auth.id != "" && @request.auth.role != "cuisine"',
      viewRule: '@request.auth.id != "" && @request.auth.role != "cuisine"',
      createRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "economat")',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "manager")',
      deleteRule: null,
      fields: [
        { name: 'source_id', type: 'text', required: true },
        { name: 'filename', type: 'text', required: true },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['completed', 'partial', 'failed', 'reversed'],
        },
        { name: 'counts', type: 'json', required: true },
        { name: 'created_at', type: 'text', required: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_import_batches_source_id ON import_batches (source_id)',
      ],
    })
    app.save(importBatches)
    verifyCollectionFields('import_batches', [
      'source_id',
      'filename',
      'status',
      'counts',
      'created_at',
    ])
  },
  (app) => {
    const names = [
      'import_batches',
      'settings',
      'audit_log',
      'inventory_lines',
      'inventory_sessions',
      'exit_lines',
      'exits',
      'purchase_lines',
      'purchases',
      'suppliers',
      'products',
    ]
    for (const name of names) {
      try {
        const col = app.findCollectionByNameOrId(name)
        if (col) app.delete(col)
      } catch (_) {
        // Ignore if already deleted
      }
    }
  }
)
