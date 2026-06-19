'use strict'
// Minimal Jest transformer for TypeScript files (srv/*.ts).
// Uses esbuild (already a dependency of tsx) to transpile TS → CJS at test time.
// This lets Jest's require() load TypeScript service handlers without --experimental-vm-modules.
const { transformSync } = require('esbuild')

module.exports = {
  process(src, filename) {
    const result = transformSync(src, {
      loader: filename.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'cjs',
      target: 'node20',
      sourcemap: 'inline',
      sourcefile: filename,
    })
    return { code: result.code }
  },
}
