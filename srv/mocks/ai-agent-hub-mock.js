/**
 * AI Agent Hub — local development mock.
 *
 * Simulates two cooperating agents without real BTP/AI Core costs:
 *   - AuditAgent:      extracts fields from Request context, simulates PDF
 *                      extraction and vector lookup, returns a structured report.
 *   - ComplianceAgent: evaluates business rules and returns APPROVED or
 *                      REVIEW_REQUIRED with a deterministic reason string.
 *
 * Usage from a CAP handler:
 *   const hub = await cds.connect.to('AI_Agent_Hub')
 *   const audit  = await hub.send('audit',  { requestId, totalAmount, status, justification, items })
 *   const comply = await hub.send('comply', { requestId, totalAmount, status, justification })
 */

const cds = require('@sap/cds')

// Simulated policy thresholds (mirrors the validation rules in RequestHandler.ts)
const COMPLIANCE_AMOUNT_THRESHOLD = 1000
const HIGH_AMOUNT_THRESHOLD       = 50_000

class AiAgentHubMock extends cds.Service {

  async init () {
    // ── AuditAgent ─────────────────────────────────────────────────────────
    this.on('audit', req => {
      const { requestId, totalAmount, status, justification, items = [] } = req.data

      // Simulate PDF extraction: build a text excerpt from the request fields
      const extractedText = _simulatePdfExtraction({ requestId, totalAmount, status, justification, items })

      // Simulate vector lookup: find the closest policy document by keyword
      const vectorMatch = _simulateVectorLookup(extractedText)

      return {
        agent:         'AuditAgent',
        requestId,
        extractedText,
        vectorMatch,
        itemCount:     items.length,
        flagged:       totalAmount > HIGH_AMOUNT_THRESHOLD,
        auditedAt:     new Date().toISOString()
      }
    })

    // ── ComplianceAgent ────────────────────────────────────────────────────
    this.on('comply', req => {
      const { requestId, totalAmount, status, justification } = req.data

      const reasons = []

      if (totalAmount > COMPLIANCE_AMOUNT_THRESHOLD && !justification) {
        reasons.push(`Justification required for amounts above ${COMPLIANCE_AMOUNT_THRESHOLD}`)
      }
      if (totalAmount > HIGH_AMOUNT_THRESHOLD) {
        reasons.push(`High-value request (${totalAmount}) requires senior approval`)
      }
      if (status === 'R') {
        reasons.push('Request was previously rejected')
      }

      const verdict = reasons.length === 0 ? 'APPROVED' : 'REVIEW_REQUIRED'

      return {
        agent:     'ComplianceAgent',
        requestId,
        verdict,
        reasons,
        checkedAt: new Date().toISOString()
      }
    })

    await super.init()
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Builds a readable text excerpt that represents simulated PDF extraction.
 * Deterministic: same input always produces the same output.
 */
function _simulatePdfExtraction ({ requestId, totalAmount, status, justification, items }) {
  const itemLines = items
    .map(i => `  - ${i.description || i.productId || 'Item'}: qty ${i.quantity}, price ${i.price}`)
    .join('\n')

  return [
    `Request ID : ${requestId}`,
    `Status     : ${status}`,
    `Total      : ${totalAmount}`,
    `Justif.    : ${justification || '(none)'}`,
    `Items (${items.length}):`,
    itemLines || '  (no items)'
  ].join('\n')
}

/**
 * Simulates a vector similarity search by matching keywords from the text
 * against a static in-memory policy document corpus.
 * Returns the best-matching policy entry.
 */
function _simulateVectorLookup (text) {
  const corpus = [
    { id: 'POL-001', title: 'Capital Expenditure Policy',      keywords: ['capex', 'capital', 'expenditure', 'total', 'approval'] },
    { id: 'POL-002', title: 'IT Procurement Guidelines',       keywords: ['it', 'software', 'hardware', 'license'] },
    { id: 'POL-003', title: 'Supplier Compliance Framework',   keywords: ['supplier', 'vendor', 'partner', 'business'] },
    { id: 'POL-004', title: 'High-Value Purchase Procedure',   keywords: ['high', 'value', 'senior', 'approval', 'review'] },
    { id: 'POL-005', title: 'General Procurement Guidelines',  keywords: ['purchase', 'order', 'procurement', 'item'] }
  ]

  const lowerText = text.toLowerCase()

  let bestMatch   = corpus[corpus.length - 1] // default: general guidelines
  let bestScore   = 0

  for (const doc of corpus) {
    const score = doc.keywords.filter(kw => lowerText.includes(kw)).length
    if (score > bestScore) {
      bestScore = score
      bestMatch = doc
    }
  }

  return { policyId: bestMatch.id, policyTitle: bestMatch.title, score: bestScore }
}

module.exports = AiAgentHubMock
