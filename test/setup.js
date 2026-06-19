'use strict'
// Tell CDS to also look for .ts service implementations (srv/MainService.ts).
// tsx is already the runtime (called via "tsx node_modules/jest-cli/bin/jest.js"),
// so TypeScript require() hooks are active — no need to register tsx/cjs here.
process.env.CDS_TYPESCRIPT = 'true'
