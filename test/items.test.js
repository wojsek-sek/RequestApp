'use strict'

/**
 * Integration tests for item-level calculations.
 *
 * Covers:
 *   - itemTotal = quantity × price on creation
 *   - itemTotal recalculates on PATCH (quantity or price change)
 *   - parent request totalAmount recalculates after every item CUD operation
 *
 * All operations happen on draft items (IsActiveEntity=false) because the edit
 * flow in Fiori lives entirely in the draft — items are only moved to the active
 * table when the user saves (draftActivate).
 */

const cds = require('@sap/cds')
const { GET, POST, PATCH, DELETE, expect } = cds.test(__dirname + '/..')

const SRV    = '/service/request'
const EU_MGR = { auth: { username: 'admin-eu', password: 'test' } }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fresh draft request and return its ID. */
async function createDraft(title = 'Items test draft') {
  const { data } = await POST(`${SRV}/Requests`, { title, currency: 'USD' }, EU_MGR)
  return data.ID
}

/** Add a line item to a draft request; returns the created item. */
async function addItem(draftId, fields) {
  const { data } = await POST(
    `${SRV}/Requests(ID='${draftId}',IsActiveEntity=false)/items`,
    fields,
    EU_MGR
  )
  return data
}

/** Read back a single draft item. */
async function getItem(draftId, itemId) {
  const { data } = await GET(
    `${SRV}/Requests(ID='${draftId}',IsActiveEntity=false)/items(ID='${itemId}',IsActiveEntity=false)`,
    EU_MGR
  )
  return data
}

/** Read back the draft request header (to check totalAmount). */
async function getDraftHeader(draftId) {
  const { data } = await GET(
    `${SRV}/Requests(ID='${draftId}',IsActiveEntity=false)`,
    EU_MGR
  )
  return data
}


// ─────────────────────────────────────────────────────────────────────────────
// ITEM TOTALS
// ─────────────────────────────────────────────────────────────────────────────
describe('Item Totals — Creation', () => {

  it('itemTotal = quantity × price when item is first created', async () => {
    const draftId = await createDraft()
    const item = await addItem(draftId, { description: 'Laptop', quantity: 3, price: 1500.00 })

    // patchRecalculateItemTotal fires in before('PATCH', 'Items.drafts') and
    // recalculateRequestTotalAfterDraftChange fires in after('CREATE', 'Items.drafts')
    expect(item.itemTotal).to.equal(4500.00)
  })

  it('header totalAmount equals the sum of all item totals after adding one item', async () => {
    const draftId = await createDraft()
    await addItem(draftId, { description: 'Chair', quantity: 5, price: 200.00 })

    const header = await getDraftHeader(draftId)
    expect(header.totalAmount).to.equal(1000.00)  // 5 × 200
  })

  it('totalAmount sums correctly across multiple items', async () => {
    const draftId = await createDraft()
    await addItem(draftId, { description: 'Keyboard', quantity: 10, price: 100.00 }) // 1000
    await addItem(draftId, { description: 'Mouse',    quantity: 10, price:  50.00 }) //  500

    const header = await getDraftHeader(draftId)
    expect(header.totalAmount).to.equal(1500.00)
  })

})

describe('Item Totals — PATCH (delta updates)', () => {

  it('itemTotal recalculates when quantity is PATCHed (price kept from server)', async () => {
    // Fiori sends delta PATCHes — only the changed field is in the body.
    // patchRecalculateItemTotal merges the delta with the server-side value:
    //   newItemTotal = patchedQty × serverPrice
    const draftId = await createDraft()
    const item = await addItem(draftId, { description: 'Monitor', quantity: 2, price: 800.00 })
    expect(item.itemTotal).to.equal(1600.00)

    await PATCH(
      `${SRV}/Requests(ID='${draftId}',IsActiveEntity=false)/items(ID='${item.ID}',IsActiveEntity=false)`,
      { quantity: 4 },   // only quantity in the delta
      EU_MGR
    )

    const updated = await getItem(draftId, item.ID)
    expect(updated.itemTotal).to.equal(3200.00)  // 4 × 800 (price read from server)
    expect(updated.quantity).to.equal(4)
    expect(updated.price).to.equal(800.00)
  })

  it('itemTotal recalculates when price is PATCHed (quantity kept from server)', async () => {
    const draftId = await createDraft()
    const item = await addItem(draftId, { description: 'Desk lamp', quantity: 5, price: 60.00 })

    await PATCH(
      `${SRV}/Requests(ID='${draftId}',IsActiveEntity=false)/items(ID='${item.ID}',IsActiveEntity=false)`,
      { price: 80.00 },  // only price in the delta
      EU_MGR
    )

    const updated = await getItem(draftId, item.ID)
    expect(updated.itemTotal).to.equal(400.00)   // 5 × 80
  })

  it('header totalAmount updates after a quantity PATCH', async () => {
    const draftId = await createDraft()
    const item = await addItem(draftId, { description: 'Cable', quantity: 1, price: 50.00 })

    await PATCH(
      `${SRV}/Requests(ID='${draftId}',IsActiveEntity=false)/items(ID='${item.ID}',IsActiveEntity=false)`,
      { quantity: 10 },
      EU_MGR
    )

    const header = await getDraftHeader(draftId)
    expect(header.totalAmount).to.equal(500.00)  // 10 × 50
  })

})

describe('Item Totals — DELETE', () => {

  it('header totalAmount decreases after an item is deleted', async () => {
    const draftId = await createDraft()
    const keep   = await addItem(draftId, { description: 'Server',  quantity: 1, price: 5000.00 })
    const remove = await addItem(draftId, { description: 'Monitor', quantity: 2, price:  500.00 })

    let header = await getDraftHeader(draftId)
    expect(header.totalAmount).to.equal(6000.00) // 5000 + 1000

    await DELETE(
      `${SRV}/Requests(ID='${draftId}',IsActiveEntity=false)/items(ID='${remove.ID}',IsActiveEntity=false)`,
      EU_MGR
    )

    header = await getDraftHeader(draftId)
    expect(header.totalAmount).to.equal(5000.00) // only the server remains
  })

  it('totalAmount becomes 0 after all items are deleted', async () => {
    const draftId = await createDraft()
    const item = await addItem(draftId, { description: 'Tablet', quantity: 2, price: 300.00 })

    await DELETE(
      `${SRV}/Requests(ID='${draftId}',IsActiveEntity=false)/items(ID='${item.ID}',IsActiveEntity=false)`,
      EU_MGR
    )

    const header = await getDraftHeader(draftId)
    expect(header.totalAmount).to.equal(0)
  })

})
