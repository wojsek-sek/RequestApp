'use strict'
const cds  = require('@sap/cds')
const fs   = require('fs')
const path = require('path')

async function main () {
    // Only deploy (create tables + load seed CSVs) when the DB file doesn't exist yet.
    // On subsequent runs we skip the deploy so previously added attachments are preserved.
    const dbFile = path.resolve(__dirname, '../db.sqlite')
    if (!fs.existsSync(dbFile)) {
        console.log('DB not found — deploying schema + seed data first...')
        const csn = await cds.load('*')
        await cds.deploy(csn)
    }

    // Connect to the local SQLite DB (reads .cdsrc.json automatically)
    const db = await cds.connect.to('db')

    const pdfPath = path.resolve(__dirname, '../test/fixtures/test_invoice.pdf')
    if (!fs.existsSync(pdfPath)) {
        console.error('ERROR: test PDF not found at', pdfPath)
        process.exit(1)
    }
    const pdfContent = fs.readFileSync(pdfPath)

    // Load all active requests (not draft shadow rows)
    const requests = await db.run(SELECT.from('capmap.db.Requests'))
    console.log(`Found ${requests.length} active request(s).`)

    let attached = 0
    let skipped  = 0

    for (const req of requests) {
        // Check for existing attachments via the service entity path
        const existing = await db.run(
            SELECT.from('RequestService.Requests.attachments')
                  .where({ up__ID: req.ID })
        )

        if (existing.length > 0) {
            console.log(`  – ${req.ID.slice(0, 8)}…  already has ${existing.length} attachment(s), skipping`)
            skipped++
            continue
        }

        const now = new Date().toISOString()
        await db.run(
            INSERT.into('RequestService.Requests.attachments').entries({
                ID:          cds.utils.uuid(),
                up__ID:      req.ID,
                filename:    'test_invoice.pdf',
                mimeType:    'application/pdf',
                content:     pdfContent,
                createdAt:   now,
                createdBy:   'seed-script',
                modifiedAt:  now,
                modifiedBy:  'seed-script',
            })
        )
        console.log(`  ✓ ${req.ID.slice(0, 8)}…  "${req.title}" — attached test_invoice.pdf`)
        attached++
    }

    console.log(`\nDone. Attached: ${attached}  Skipped (already had attachments): ${skipped}`)
}

main()
    .catch(err => { console.error('Seed failed:', err.message ?? err); process.exit(1) })
    .finally(() => process.exit(0))
