/**
 * AI Agent Hub — local development mock.
 *
 * Simulates a two-step document compliance pipeline without real BTP/AI Core costs:
 *   - analyzeDocument:  simulates extracting metadata (amount, validity) from the
 *                       uploaded attachment and returns a structured report.
 *   - verifyCompliance: scores the analyzeDocument result against policy thresholds
 *                       and returns APPROVED / REVIEW_REQUIRED / REJECTED.
 *
 * Usage from a CAP handler (see RequestHandler.submitRequest):
 *   const hub      = await cds.connect.to('AI_Agent_Hub')
 *   const analysis = await hub.send('analyzeDocument', { requestId, fileName, totalAmount })
 *   const comply   = await hub.send('verifyCompliance', analysis)
 */

const cds = require('@sap/cds')

class AiAgentHubMock extends cds.Service {

  async init () {
    // ── analyzeDocument ────────────────────────────────────────────────────
    // Simulates extracting metadata from an uploaded document (PDF scan).
    // Returns the extracted amount (mirrors totalAmount) and a short note.
    this.on('analyzeDocument', req => {
      const { requestId, fileName, totalAmount } = req.data

      return {
        requestId,
        fileName:        fileName || 'unknown.pdf',
        documentValid:   true,
        extractedAmount: totalAmount,
        notes:           `Document "${fileName || 'unknown.pdf'}" parsed successfully. ` +
                         `Extracted amount: ${totalAmount}.`
      }
    })

    // ── verifyCompliance ───────────────────────────────────────────────────
    // Evaluates the analyzeDocument result against policy thresholds.
    // Score tiers (based on extractedAmount):
    //   < 1000        → 90  (APPROVED, low risk)
    //   1000 – 5000   → 70  (APPROVED, moderate review)
    //   > 5000        → 50  (REVIEW_REQUIRED, high value)
    this.on('verifyCompliance', req => {
      const { extractedAmount, fileName, documentValid } = req.data

      let score, decision, notes

      if (!documentValid) {
        score    = 0
        decision = 'REJECTED'
        notes    = 'Document failed validation — cannot proceed.'
      } else if (extractedAmount < 1000) {
        score    = 90
        decision = 'APPROVED'
        notes    = `Low-value request (${extractedAmount}). Automatic approval.`
      } else if (extractedAmount <= 5000) {
        score    = 70
        decision = 'APPROVED'
        notes    = `Moderate-value request (${extractedAmount}). Standard review passed.`
      } else {
        score    = 50
        decision = 'REVIEW_REQUIRED'
        notes    = `High-value request (${extractedAmount}). Senior manager review required.`
      }

      return {
        agent:    'ComplianceAgent',
        fileName: fileName || 'unknown.pdf',
        score,
        decision,
        notes,
        verifiedAt: new Date().toISOString()
      }
    })

    await super.init()
  }
}

module.exports = AiAgentHubMock
