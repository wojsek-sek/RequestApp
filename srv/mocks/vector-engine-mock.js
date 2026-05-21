/**
 * Vector Engine — local development mock.
 *
 * Simulates a vector database backed by an in-memory document store.
 * Supports:
 *   - embed:  returns a deterministic pseudo-embedding for a given text string
 *   - upsert: stores a document in the in-memory corpus
 *   - search: finds the top-k most similar documents via keyword overlap scoring
 *
 * Documents are keyed by requestId so re-indexing a request replaces its entry.
 *
 * Usage from a CAP handler:
 *   const vec = await cds.connect.to('VectorEngine')
 *   await vec.send('upsert', { requestId, text, metadata })
 *   const hits = await vec.send('search', { query, topK: 3 })
 *   const emb  = await vec.send('embed',  { text })
 */

const cds = require('@sap/cds')

// In-memory document store shared for the lifetime of the CDS server process
const _store = new Map()

class VectorEngineMock extends cds.Service {

  async init () {
    // Seed the store with a handful of representative policy-document entries
    _seedCorpus()

    // ── embed ────────────────────────────────────────────────────────────
    this.on('embed', req => {
      const { text = '' } = req.data
      return {
        text,
        embedding: _deterministicEmbedding(text),
        dimensions: 16
      }
    })

    // ── upsert ───────────────────────────────────────────────────────────
    this.on('upsert', req => {
      const { requestId, text = '', metadata = {} } = req.data
      if (!requestId) return req.error(400, 'requestId is required for upsert')

      _store.set(requestId, {
        id:        requestId,
        text,
        keywords:  _tokenize(text),
        metadata,
        embedding: _deterministicEmbedding(text),
        indexedAt: new Date().toISOString()
      })

      return { indexed: true, id: requestId, docCount: _store.size }
    })

    // ── search ───────────────────────────────────────────────────────────
    this.on('search', req => {
      const { query = '', topK = 3 } = req.data
      const queryTokens = _tokenize(query)

      const scored = []
      for (const doc of _store.values()) {
        const score = _overlapScore(queryTokens, doc.keywords)
        if (score > 0) scored.push({ ...doc, score })
      }

      // Sort descending by score, return top-k
      scored.sort((a, b) => b.score - a.score)
      const hits = scored.slice(0, topK).map(d => ({
        id:       d.id,
        text:     d.text,
        score:    d.score,
        metadata: d.metadata
      }))

      return { query, hits, total: scored.length }
    })

    await super.init()
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Tokenizes a string into lowercase words, stripping punctuation.
 * Used for both indexing and query matching.
 */
function _tokenize (text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2)
}

/**
 * Jaccard-like overlap score: |query ∩ doc| / |query|.
 * Returns a value in [0, 1].
 */
function _overlapScore (queryTokens, docTokens) {
  if (!queryTokens.length) return 0
  const docSet = new Set(docTokens)
  const matches = queryTokens.filter(t => docSet.has(t)).length
  return matches / queryTokens.length
}

/**
 * Produces a deterministic 16-element pseudo-embedding from text.
 * Not semantically meaningful — sufficient for local mock parity checks.
 */
function _deterministicEmbedding (text) {
  const vec = new Array(16).fill(0)
  for (let i = 0; i < text.length; i++) {
    vec[i % 16] = (vec[i % 16] + text.charCodeAt(i)) % 256
  }
  // Normalize to [0, 1]
  return vec.map(v => parseFloat((v / 256).toFixed(4)))
}

/**
 * Seeds the in-memory store with static policy documents so that searches
 * return meaningful results without any prior upsert calls.
 */
function _seedCorpus () {
  const docs = [
    {
      id:   'POL-001',
      text: 'Capital expenditure approval policy total amount justification required senior manager',
      metadata: { type: 'policy', source: 'finance' }
    },
    {
      id:   'POL-002',
      text: 'IT software hardware license procurement purchase order category approval',
      metadata: { type: 'policy', source: 'it' }
    },
    {
      id:   'POL-003',
      text: 'Supplier vendor business partner compliance deletion indicator blocked validation',
      metadata: { type: 'policy', source: 'procurement' }
    },
    {
      id:   'POL-004',
      text: 'High value purchase review required senior approval above threshold regional manager',
      metadata: { type: 'policy', source: 'finance' }
    }
  ]

  for (const doc of docs) {
    _store.set(doc.id, {
      ...doc,
      keywords:  _tokenize(doc.text),
      embedding: _deterministicEmbedding(doc.text),
      indexedAt: new Date().toISOString()
    })
  }
}

module.exports = VectorEngineMock
