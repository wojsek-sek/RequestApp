'use strict'

/**
 * Integration tests for the CapEx Request workflow.
 *
 * How these tests work:
 *   cds.test.in() starts the full CAP server in-process (SQLite :memory: via the [test]
 *   profile in .cdsrc.json). Every test speaks to the service over HTTP — the same calls
 *   that Fiori or curl would make. Mock auth from .cdsrc.json is active (basic auth).
 *
 * What is covered:
 *   1. Field validation  — title length, negative amount, justification threshold
 *   2. Submit action     — attachment required, status guard, AI auto-approve/review paths
 *   3. Approve / Reject  — SoD enforcement, status guard, reason storage
 *   4. Cancel / Withdraw — allowed status transitions
 *   5. Authorization     — Viewer read-only, RegionalManager region filter
 */

const cds = require('@sap/cds')

// cds.test.in() starts the server in beforeAll and tears it down in afterAll.
// The destructured HTTP helpers work like axios: { data, status } on success,
// throw with err.response.{ status, data } on non-2xx.
const { GET, POST, PATCH, expect } = cds.test(__dirname + '/..')

// ── Service base path ─────────────────────────────────────────────────────────
const SRV = '/service/request'

// ── Authenticated callers (match .cdsrc.json mock users) ─────────────────────
// EU manager: RegionalManager role, Region = [EU, PL, EN]
const EU_MGR = { auth: { username: 'admin-eu',      password: 'test'  } }
// US manager: RegionalManager role, Region = [US] — different user for SoD tests
const US_MGR = { auth: { username: 'admin-us',      password: 'test2' } }
// Viewer: read-only, no region restriction, no create/update rights
const VIEWER  = { auth: { username: 'readonly-user', password: ''      } }

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a draft and immediately activate it → returns the active entity ID.
 *
 * CAP draft lifecycle recap:
 *   POST /Requests                      → creates a draft (IsActiveEntity=false)
 *   POST /Requests(...)/draftActivate   → runs before('SAVE') validations, then writes
 *                                         the draft fields to the active entity row
 *                                         (IsActiveEntity=true, status N)
 */
async function createRequest(overrides = {}, auth = EU_MGR) {
  const { data: draft } = await POST(`${SRV}/Requests`, {
    title: 'Test CapEx Request',
    currency: 'USD',
    ...overrides
  }, auth)

  await POST(
    `${SRV}/Requests(ID='${draft.ID}',IsActiveEntity=false)/draftActivate`,
    {}, auth
  )

  return draft.ID
}

/**
 * Add a minimal attachment row directly to the DB.
 *
 * submitRequest only checks that ≥1 attachment row exists — it does not read
 * content. Inserting via cds.db bypasses the HTTP layer so we avoid multipart
 * upload complexity in tests.
 */
async function seedAttachment(requestId) {
  const { INSERT } = cds.ql
  await cds.db.run(
    INSERT.into('RequestService.Requests.attachments').entries({
      ID:       cds.utils.uuid(),
      up__ID:   requestId,
      filename: 'invoice.pdf',
      mimeType: 'application/pdf'
    })
  )
}

/**
 * Helper that submits a request and returns the new state.
 * Low-value requests (<= 5000) are auto-approved by the AI mock (status A).
 * Use this in tests that need a specific post-submit status.
 */
async function submitRequest(id, auth = EU_MGR) {
  const { data } = await POST(
    `${SRV}/Requests(ID='${id}',IsActiveEntity=true)/submitRequest`,
    {}, auth
  )
  return data
}

/**
 * Create a Submitted request (totalAmount > 5000 → AI mock returns REVIEW_REQUIRED → status S).
 * Used in Approve/Reject tests that need a request waiting for a human decision.
 */
async function createSubmittedRequest(auth = EU_MGR) {
  const id = await createRequest({ title: 'Large capital purchase' }, auth)
  await seedAttachment(id)

  // Set totalAmount > 5000 directly so the AI mock's REVIEW_REQUIRED branch fires.
  // The [test] DB is SQLite :memory:, so this UPDATE targets only this test's data.
  await cds.db.run(
    cds.ql.UPDATE('RequestService.Requests')
      .set({ totalAmount: 10000, justification: 'Board-approved investment' })
      .where({ ID: id })
  )

  await submitRequest(id, auth)
  return id
}

/**
 * Reusable assertion for expected error responses.
 * @cap-js/cds-test throws on non-2xx; the error carries err.response.{ status, data }.
 */
async function expectError(promiseFn, expectedStatus) {
  try {
    await promiseFn()
    expect.fail(`Expected HTTP ${expectedStatus} but request succeeded`)
  } catch (err) {
    const actual = err.response?.status ?? err.status
    expect(actual).to.equal(expectedStatus)
    return err.response?.data
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 1. FIELD VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Field Validation', () => {

  it('rejects a title shorter than 5 characters on draft activation', async () => {
    // beforeSave fires on draftActivate — the title check runs there.
    // The draft itself is created without issue (CAP does not validate on POST to /Requests),
    // but activating the draft (= "Save" button in Fiori) triggers the guard.
    const { data: draft } = await POST(`${SRV}/Requests`, { title: 'Hi', currency: 'USD' }, EU_MGR)

    await expectError(
      () => POST(`${SRV}/Requests(ID='${draft.ID}',IsActiveEntity=false)/draftActivate`, {}, EU_MGR),
      400
    )
  })

  it('rejects a title shorter than 5 chars on direct PATCH (bypass mode)', async () => {
    // @odata.draft.bypass lets Fiori PATCH active entities directly.
    // validateOnWrite fires via before('UPDATE', 'Requests').
    // Note: totalAmount is @readonly — CAP strips it from req.data, so it cannot be
    // validated at the OData layer. Title is the correct field to test this path.
    const id = await createRequest()

    await expectError(
      () => PATCH(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)`, { title: 'Hi' }, EU_MGR),
      400
    )
  })

  it('rejects submit when justification is missing and totalAmount > 1000', async () => {
    const id = await createRequest()
    await seedAttachment(id)

    // Boost the stored amount above the threshold without justification.
    // This DB write bypasses service hooks intentionally — it simulates an edge case
    // where a high amount was reached via items but justification was not filled.
    await cds.db.run(
      cds.ql.UPDATE('RequestService.Requests')
        .set({ totalAmount: 2000, justification: null })
        .where({ ID: id })
    )

    const errData = await expectError(
      () => submitRequest(id),
      400
    )
    expect(errData.error.message).to.include('Justification')
  })

})


// ─────────────────────────────────────────────────────────────────────────────
// 2. SUBMIT ACTION
// ─────────────────────────────────────────────────────────────────────────────
describe('Submit Action', () => {

  it('rejects submit when no attachment is present', async () => {
    const id = await createRequest()
    // Intentionally skip seedAttachment — verify the guard fires.

    await expectError(() => submitRequest(id), 400)
  })

  it('rejects submitting a request that is already Submitted', async () => {
    // After the first submit, status is either S or A.
    // Either way, the second submit must fail — only N is allowed.
    const id = await createRequest()
    await seedAttachment(id)
    await submitRequest(id)

    await expectError(() => submitRequest(id), 400)
  })

  it('AI mock auto-approves low-value requests (totalAmount <= 5000) on submit', async () => {
    // verifyCompliance: amount <= 5000 → decision=APPROVED → status=A, approver=AI_COMPLIANCE_AGENT
    // This tests that the AI agent is correctly recorded as approver (not the submitter),
    // which was a bug fixed during the code review (approver was always set to req.user.id).
    const id = await createRequest({ title: 'Office chair purchase' })
    await seedAttachment(id)

    const result = await submitRequest(id)

    expect(result.status_code).to.equal('A')
    expect(result.approver).to.equal('AI_COMPLIANCE_AGENT')
    expect(result.approvalDate).to.not.be.null
    expect(result.aiComplianceScore).to.be.at.least(70)
    expect(result.submittedAt).to.not.be.null
  })

  it('high-value request (totalAmount > 5000) stays Submitted awaiting human review', async () => {
    // verifyCompliance: amount > 5000 → decision=REVIEW_REQUIRED → handler maps to status=S
    // approver and approvalDate must remain null — no human decision has been made yet.
    const id = await createRequest({ title: 'Server infrastructure' })
    await seedAttachment(id)

    await cds.db.run(
      cds.ql.UPDATE('RequestService.Requests')
        .set({ totalAmount: 50000, justification: 'Required for Q4 data center build-out' })
        .where({ ID: id })
    )

    const result = await submitRequest(id)

    expect(result.status_code).to.equal('S')
    expect(result.approver).to.be.null     // no decision yet
    expect(result.approvalDate).to.be.null
    expect(result.submittedAt).to.not.be.null
    expect(result.aiComplianceScore).to.equal(50)
  })

})


// ─────────────────────────────────────────────────────────────────────────────
// 3. APPROVE / REJECT
// ─────────────────────────────────────────────────────────────────────────────
describe('Approve / Reject', () => {

  it('SoD: creator cannot approve their own request', async () => {
    // Both create and approve attempt use admin-eu → Segregation of Duties violation.
    // The server re-checks createdBy === currentUserId even if the UI hides the button.
    const id = await createSubmittedRequest(EU_MGR)

    await expectError(
      () => POST(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)/approveRequest`, {}, EU_MGR),
      403
    )
  })

  it('a different RegionalManager can approve a Submitted request', async () => {
    // EU manager creates → US manager approves (different user, SoD passes).
    const id = await createSubmittedRequest(EU_MGR)

    const { data } = await POST(
      `${SRV}/Requests(ID='${id}',IsActiveEntity=true)/approveRequest`,
      {}, US_MGR
    )

    expect(data.status_code).to.equal('A')
    expect(data.approver).to.equal('admin-us')
    expect(data.approvalDate).to.not.be.null
  })

  it('cannot approve a request that is still in New (N) status', async () => {
    const id = await createRequest()   // never submitted — stays N

    await expectError(
      () => POST(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)/approveRequest`, {}, US_MGR),
      400
    )
  })

  it('reject stores the reason and stamps the approver', async () => {
    const id = await createSubmittedRequest(EU_MGR)

    const { data } = await POST(
      `${SRV}/Requests(ID='${id}',IsActiveEntity=true)/rejectRequest`,
      { reason: 'Budget reallocated to Q1.' },
      US_MGR
    )

    expect(data.status_code).to.equal('R')
    expect(data.rejectReason).to.equal('Budget reallocated to Q1.')
    expect(data.approver).to.equal('admin-us')
  })

  it('SoD: creator cannot reject their own request', async () => {
    const id = await createSubmittedRequest(EU_MGR)

    await expectError(
      () => POST(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)/rejectRequest`,
        { reason: 'Self-rejection attempt' }, EU_MGR),
      403
    )
  })

})


// ─────────────────────────────────────────────────────────────────────────────
// 4. CANCEL / WITHDRAW
// ─────────────────────────────────────────────────────────────────────────────
describe('Cancel / Withdraw', () => {

  it('can cancel a New (N) request and stores the reason', async () => {
    const id = await createRequest()

    const { data } = await POST(
      `${SRV}/Requests(ID='${id}',IsActiveEntity=true)/cancelRequest`,
      { reason: 'Project scope changed.' },
      EU_MGR
    )

    expect(data.status_code).to.equal('C')
    expect(data.cancelReason).to.equal('Project scope changed.')
  })

  it('can cancel a Submitted (S) request', async () => {
    const id = await createSubmittedRequest(EU_MGR)

    const { data } = await POST(
      `${SRV}/Requests(ID='${id}',IsActiveEntity=true)/cancelRequest`,
      { reason: 'No longer required.' },
      EU_MGR
    )

    expect(data.status_code).to.equal('C')
  })

  it('cannot cancel an Approved (A) request', async () => {
    // Low-value → AI auto-approves → status A
    const id = await createRequest({ title: 'Small tool purchase' })
    await seedAttachment(id)
    await submitRequest(id)

    // Verify the AI approval happened before trying to cancel
    const { data: current } = await GET(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)`, EU_MGR)
    expect(current.status_code).to.equal('A')

    await expectError(
      () => POST(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)/cancelRequest`, {}, EU_MGR),
      400
    )
  })

  it('withdraw moves a Submitted request back to New and clears all approval fields', async () => {
    const id = await createSubmittedRequest(EU_MGR)

    const { data } = await POST(
      `${SRV}/Requests(ID='${id}',IsActiveEntity=true)/withdrawRequest`,
      {}, EU_MGR
    )

    expect(data.status_code).to.equal('N')
    expect(data.approver).to.be.null
    expect(data.approvalDate).to.be.null
    expect(data.aiComplianceScore).to.be.null
    expect(data.aiAuditNotes).to.be.null
    // withdrawnAt should be stamped so the timeline can show the Withdrawn event
    expect(data.withdrawnAt).to.not.be.null
  })

  it('cannot withdraw a New (N) request — only Submitted is eligible', async () => {
    const id = await createRequest()

    await expectError(
      () => POST(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)/withdrawRequest`, {}, EU_MGR),
      400
    )
  })

  it('cannot withdraw an already-Approved request', async () => {
    const id = await createRequest({ title: 'Cheap item' })
    await seedAttachment(id)
    await submitRequest(id)  // AI auto-approves → status A

    const { data: current } = await GET(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)`, EU_MGR)
    expect(current.status_code).to.equal('A')

    await expectError(
      () => POST(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)/withdrawRequest`, {}, EU_MGR),
      400
    )
  })

})


// ─────────────────────────────────────────────────────────────────────────────
// 5. AUTHORIZATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Authorization', () => {

  it('Viewer cannot create a request', async () => {
    await expectError(
      () => POST(`${SRV}/Requests`, { title: 'Viewer attempt', currency: 'USD' }, VIEWER),
      403
    )
  })

  it('Viewer can read the list of requests', async () => {
    await createRequest({ title: 'Visible to viewer' }, EU_MGR)

    const { status, data } = await GET(`${SRV}/Requests`, VIEWER)

    expect(status).to.equal(200)
    expect(data.value).to.be.an('array')
  })

  it('RegionalManager only sees requests from their own region', async () => {
    // US manager creates a request — defaultRegionOnCreate stamps region='US'
    const usId = await createRequest({ title: 'US server purchase' }, US_MGR)

    // US manager's own GET must include the US request
    const { data: usView } = await GET(`${SRV}/Requests`, US_MGR)
    expect(usView.value.map(r => r.ID)).to.include(usId)

    // EU manager's GET must NOT include the US request (region filter: region = $user.Region)
    const { data: euView } = await GET(`${SRV}/Requests`, EU_MGR)
    expect(euView.value.map(r => r.ID)).to.not.include(usId)
  })

  it('Viewer cannot edit (PATCH) a request', async () => {
    const id = await createRequest({ title: 'Protected request' }, EU_MGR)

    await expectError(
      () => PATCH(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)`, { title: 'Hacked' }, VIEWER),
      403
    )
  })

  it('cannot edit a Submitted request even as its owner (status guard)', async () => {
    // beforeUpdate blocks PATCH to non-N active entities.
    // This covers @odata.draft.bypass inline edits that skip the draft lifecycle.
    const id = await createSubmittedRequest(EU_MGR)

    await expectError(
      () => PATCH(`${SRV}/Requests(ID='${id}',IsActiveEntity=true)`, { title: 'New title' }, EU_MGR),
      400
    )
  })

})
