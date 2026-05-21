# CAPMAP — Development Guide

Practical reference for working on the codebase. See [README.md](README.md) for project overview and deployment.

---

## Handler Development

All service event handlers follow a consistent pattern. Register them in `MainService.ts` inside `cds.on('bootstrap')`.

```typescript
// srv/handlers/MyFeatureHandler.ts
import cds from '@sap/cds'
import { Requests } from '#cds-models/RequestService'

export class MyFeatureHandler {
  constructor(
    private srv: cds.ApplicationService,
    private externalApi?: cds.RemoteService
  ) {}

  register() {
    this.srv.before('CREATE', Requests, this.validate.bind(this))
    this.srv.on('bound action', Requests, 'myAction', this.myAction.bind(this))
    this.srv.after('READ', Requests, this.enrich.bind(this))
  }

  private async validate(req: cds.Request) {
    if (!req.data.title) return req.error(400, 'Title is required')
  }
}
```

### Useful Patterns

**Access user context and XSUAA attributes:**

```typescript
const { user } = cds.context
const region = user.attr?.region    // from XSUAA token attribute
const locale = user.locale          // e.g. 'en_US'
```

**Read from an external S/4HANA API via CDS:**

```typescript
const bpApi = await cds.connect.to('API_BUSINESS_PARTNER')
const result = await bpApi.run(
  SELECT.from('A_Supplier').where({ Supplier: id })
)
```

**Use Cloud SDK for typed, resilient S/4HANA calls:**

```typescript
import { businessPartnerService } from './external/API_BUSINESS_PARTNER'
const { supplierApi } = businessPartnerService()
const supplier = await supplierApi
  .requestBuilder()
  .getByKey(supplierId)
  .execute({ destinationName: 'S4HANA_DESTINATION' })
```

**Raise a user-visible field-level error:**

```typescript
req.error(400, 'Justification is required for amounts over 1000', 'justification')
```

### Key Conventions

- **Types:** always import from `#cds-models/...` (auto-generated). Never hand-write entity types.
- **Status criticality:** `syncStatusCriticality()` runs in every `after READ` in `RequestHandler`. Do not set `criticality` elsewhere — it will be overwritten.
- **totalAmount recalculation:** triggered from `ItemHandler` after every item write. The parent `Requests` row is patched directly via `UPDATE`.
- **Draft handling:** `Requests` and `Items` have parallel `*_drafts` shadow tables. Bound actions (submit, approve, reject) must handle both active and draft contexts.
- **Localization in S/4 handlers:** parse user locale with `user.locale.slice(0, 2)` to get the ISO language code for S/4HANA text expansion queries.

---

## Scripts

| Script | Command |
|---|---|
| Dev server (live reload) | `cds watch` |
| Dev + open Fiori app | `npm run watch-requestsui` |
| Regenerate TS types | `cds-typer '*' --outputDirectory @cds-models` |
| Production build | `npm run build` (runs `mbt build`) |
| Deploy to BTP CF | `cf deploy mta_archives/CAPMAP_1.0.0.mtar` |

---

## Troubleshooting

**TypeScript types not found after a model change**  
Run `cds-typer '*' --outputDirectory @cds-models`.

**Supplier validation always fails locally**  
Check `.cdsrc.json` for the `API_BUSINESS_PARTNER` sandbox URL and verify `S4HANA_API_KEY` is set in `.env`.

**AI justification returns an error**  
Verify `GEMINI_API_KEY` is in `.env` and the Gemini API is enabled in your Google Cloud project.

**Stale draft data after a schema change**  
Delete the local SQLite file to reset all state: `rm db.sqlite`

**MTA build fails**  
Ensure all workspace dependencies are installed (`npm install` from the root) and `mbt` is available (`npx mbt --version`).

**Cost centers or products show no description**  
The S/4HANA sandbox may be unavailable. `CostCenterHandler` falls back to mock data; `ProductHandler` returns items without descriptions and logs a warning.
