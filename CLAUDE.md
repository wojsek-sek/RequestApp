# CAPMAP — Claude Code Context

## What this project is

B2B **CapEx Request Management** app built on SAP CAP (Node.js + TypeScript) with a Fiori Elements frontend. Users create capital expenditure requests with line items, route them through a New→Submit→Approve/Reject workflow (with Cancel and Withdraw transitions), and can generate AI-written business justifications via Google Gemini. Deployed on SAP BTP (Cloud Foundry) with XSUAA auth, HANA DB, and an app-router entry point.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend framework | `@sap/cds@^9` (CAP for Node.js) |
| Language | TypeScript (`tsx` runner, ES2022, strict mode) |
| Database (prod) | SAP HANA via `@cap-js/hana@^2` + HDI container |
| Database (dev) | SQLite via `@cap-js/sqlite@^2` |
| Auth | XSUAA (`@sap/xssec@^4`) — OAuth 2.0 |
| S/4HANA integration | SAP Cloud SDK v4 (`@sap-cloud-sdk/connectivity`, `http-client`, `resilience`) |
| AI | Google Gemini `gemini-3-flash-preview` via `@google/genai@^2.3.0` |
| File attachments | `@cap-js/attachments` plugin — official CAP attachment solution |
| Frontend | Fiori Elements (List Report + Object Page) on UI5 v1.145+ |
| Build | `mbt build` → MTA archive for BTP deployment |

---

## Project Layout

```
CAPMAP/
├── db/schema.cds              # Data model
├── srv/
│   ├── MainService.cds        # OData service definition
│   ├── MainService.ts         # Handler bootstrapping
│   └── handlers/
│       ├── RequestHandler.ts  # Core business logic + AI action
│       ├── ItemHandler.ts     # Line-item totals recalculation
│       ├── CostCenterHandler.ts  # S/4 mashup with locale-aware names
│       ├── SupplierHandler.ts    # S/4 Business Partner read-through
│       └── ProductHandler.ts    # S/4 Products with localized description
│   └── utils/PromptTemplates.ts # Gemini prompt builder
├── app/requestsui/
│   ├── webapp/manifest.json   # UI5 app config, routing
│   ├── webapp/xs-app.json     # App-router rules for this app
│   └── annotations.cds        # All Fiori annotations (facets, charts, actions)
├── app/router/
│   ├── xs-app.json            # Global app-router routing
│   └── package.json           # @sap/approuter
├── @cds-models/               # Auto-generated TS types (cds-typer, do not edit)
├── mta.yaml                   # BTP deployment descriptor
├── xs-security.json           # XSUAA roles & scopes
└── .cdsrc.json                # CDS runtime config (auth, external APIs, dev users)
```

---

## Data Model (`db/schema.cds`)

**Requests** (header entity, `cuid` + `managed` + `ApprovalTracking`):
- `title`, `totalAmount` (Decimal), `currency` (default USD)
- `costCenter` (ref to S/4 cost center), `region` (row-level security key)
- `status` → `Statuses` code-list (N=New/Draft, S=Submitted, A=Approved, R=Rejected, C=Cancelled)
- `approver`, `approvalDate`, `justification` (from `ApprovalTracking` aspect)
- `rejectReason`, `cancelReason` (String(500)) — set by `rejectRequest` / `cancelRequest` actions
- `aiComplianceScore` (Integer), `aiAuditNotes` (String) — AI document analysis results on submit
- `attachments` — `Composition of many Attachments` (from `@cap-js/attachments` plugin); at least one required before `submitRequest`
- Composition: `items` (cascade-delete on header delete)

**Attachments** (managed by `@cap-js/attachments` plugin):
- Declared as `using { Attachments } from '@cap-js/attachments'` in schema.cds
- Plugin handles upload UI, filename/mimeType extraction, malware scanning automatically
- **Do NOT** declare a separate `RequestAttachments` entity — plugin generates everything
- In service context the entity is named `RequestService.Requests.attachments`; its generated TypeScript class is `Requests.attachments`

**Items** (line-item entity, `cuid`):
- `productId`, `description`, `quantity`, `price`, `itemTotal` (calculated)
- `category` → `Categories` code-list, `supplierId` (S/4 Business Partner ref)

**Code-lists**: `Statuses` — N New · S Submitted · A Approved · R Rejected · C Cancelled (criticality via CDS `case` in schema). `Categories` — IT · FU · MA · SW.

---

## OData Service (`srv/MainService.cds`)

Path: `/service/request`  
Requires: `authenticated-user`

Key projections and restrictions:
- **Requests**: `@odata.draft.enabled`; Viewer=READ, RegionalManager=CRUD (WHERE region IN user.region)
- **Items**: draft composition of Requests
- **Requests_attachments**: auto-registered by `@cap-js/attachments` — do NOT add manually to MainService.cds
- **CostCenters**: read-only mashup of `API_COSTCENTER_V2.A_CostCenter` + `to_Text` expansion
- **Suppliers**: read-only mashup of `API_BUSINESS_PARTNER.A_Supplier`
- **Products**: read-only mashup of `API_PRODUCT_SRV.A_Product` + `to_Description` expansion

**OData aggregation** enabled: groupby (status, costCenter, currency), sum/min/max on totalAmount, countdistinct on ID. Powers the analytics charts.

**Bound actions on Requests**:
- `submitRequest()` — validates attachment present, runs AI compliance check, sets N→S (AI may set A or R directly)
- `approveRequest()` — sets status=A, records approver + date (SoD: must be RegionalManager and not the creator)
- `rejectRequest(reason)` — sets status=R, records approver + date + rejectReason
- `cancelRequest(reason)` — allowed from N or S; sets status=C, records cancelReason
- `withdrawRequest()` — allowed from S only; resets N, clears approver/approvalDate/AI results
- `generateAIJustification()` — draft only; calls Gemini, persists result to `justification`

---

## Handler Patterns

All handlers registered in `MainService.ts` inside `init()`. Use **arrow-function class fields** — they are automatically bound to `this`, no `.bind()` needed:

```typescript
// srv/handlers/SomeHandler.ts
import cds from '@sap/cds'
import { Requests } from '#cds-models/RequestService'

export class SomeHandler {
    validate = (req: cds.Request) => { /* ... */ }
    enrich   = (results: Requests[]) => { /* ... */ }
}

// srv/MainService.ts — inside init():
const h = new SomeHandler()
this.before('CREATE', 'Requests', h.validate)
this.after ('READ',   'Requests', h.enrich)
```

**Key business rules in `RequestHandler.ts`**:
- `justification` required when `totalAmount > 1000`
- `title` min length 5 chars
- Supplier `DeletionIndicator` check via Cloud SDK before save (graceful degradation in dev)
- After item PATCH/POST/DELETE: `ItemHandler` recalculates `Requests.totalAmount`

**Draft-enabled entity key extraction** (critical pattern):
```typescript
// req.params[0] for draft entities includes { ID, IsActiveEntity: true }
// IsActiveEntity is virtual — NEVER pass it to a DB WHERE clause
const { ID } = req.params[0] as { ID: string }  // extract only what you need
await UPDATE(Requests).set({ ... }).where({ ID })
```

**Querying attachments in handlers**:
```typescript
// Use Requests.attachments (generated class, name='RequestService.Requests.attachments')
// NEVER use SELECT.from('sap.attachments.Attachments') — it's an abstract aspect, not a concrete entity
import { Requests } from '#cds-models/RequestService'
const attachments = await SELECT.from(Requests.attachments).where({ up__ID: ID }) as Requests.attachment[]
```

---

## AI Integration

File: `srv/handlers/RequestHandler.ts` → `generateAIJustification()`  
Prompt: `srv/utils/PromptTemplates.ts`

```typescript
// Bound action — always on draft
// Sends item names + categories + user locale to Gemini
// Model: gemini-3-flash-preview
// Result: 2-3 sentence business justification, locale-aware (en/pl)
// Side-effect annotation in annotations.cds refreshes justification field on UI
```

API key: stored in `.env` as `GEMINI_API_KEY`.

---

## MCP Servers (AI coding assistance)

Three SAP MCP servers configured in `.mcp.json` at the project root (project scope — committed to git, shared with the team).

| Server | Purpose |
|---|---|
| `cap` | CDS model search, CAP documentation (offline mode) |
| `ui5` | SAPUI5 API knowledge |
| `fiori` | Fiori Elements generation/editing |

**Windows-specific**: All servers run via `node node_modules/...` (NOT `npx`). On Windows, `npx` tries to execute bash shebang scripts and crashes with `SyntaxError`. Packages are installed as devDependencies.

CAP server runs with `CDS_MCP_OFFLINE=true` — embeddings pre-downloaded via:
```powershell
node node_modules/@cap-js/mcp-server/index.js --download
```

MCP servers load at session start — if tools from `cap`/`ui5`/`fiori` are not visible, restart Claude Code from the `C:\Dev\CAPMAP` directory.

---

## Authorization Model

**xs-security.json** defines:
- `Viewer` scope: read-only, no region restriction
- `RegionalManager` scope: full CRUD, constrained by `Region` attribute (row-level security in service `@restrict`)

**Dev users** (`.cdsrc.json`):
- `admin-eu` — RegionalManager, Region=[EU, PL, EN]
- `admin-us` — RegionalManager, Region=[US]
- `readonly-user` — Viewer only

Access user info in handlers: `cds.context.user`, `cds.context.user.attr.region`

---

## External S/4HANA APIs

All three are OData V2 remote services. Registered in `.cdsrc.json`.

| Service | Purpose | Key entities |
|---|---|---|
| `API_COSTCENTER_V2` | Cost center names (localized via to_Text) | `A_CostCenter`, `A_CostCenterText` |
| `API_BUSINESS_PARTNER` | Supplier lookup + deletion check | `A_Supplier` |
| `API_PRODUCT_SRV` | Product catalog (localized via to_Description) | `A_Product` |

**Dev**: Direct sandbox.api.sap.com URLs + APIKey in `.env`  
**Prod**: Named destination `S4HANA_DESTINATION` via BTP Destination Service

**Graceful degradation pattern** (validateSupplierBeforeSave): If the Cloud SDK throws with no HTTP response (i.e., `!error.response`), the destination is not configured — warn and allow save. Only block on actual HTTP error responses. This prevents dev crashes while maintaining prod behavior.

Cloud SDK pattern used for supplier validation:
```typescript
import { executeHttpRequest } from '@sap-cloud-sdk/http-client'
// executeHttpRequest({ destinationName: 'S4HANA_DESTINATION' }, { method: 'GET', url: '...' })
```

---

## Fiori App (`app/requestsui/`)

**Template**: `sap.fe.templates.ListReport` + `sap.fe.templates.ObjectPage`  
**App ID**: `capmap.requestsui`  
**Data source**: `mainService` → `/service/request/` (OData 4.01)

**Routing**:
1. `RequestsList` (List Report — entity Requests)
2. `RequestsObjectPage` (Object Page — entity Requests, draft)
3. `Requests_itemsObjectPage` (Object Page — entity Items, nested in draft)

**Key annotations** (`annotations.cds`):
- Header facets: Status DataPoint + TotalAmount DataPoint
- Object page facets: GeneralInfo, Justification (multiline), AI Audit Results, Attachments (plugin), Items table
- Attachments facet targets `attachments/@UI.LineItem` — provided automatically by `@cap-js/attachments`, no manual annotation needed
- Action visibility: Submit (status=N), Approve/Reject (isApprover=true), Cancel (N or S), Withdraw (S)
- `generateAIJustification` has `@Common.SideEffects` → refreshes justification field
- Charts: RequestsByStatus (donut), AmountByCostCenter (column)
- Visual filters on List Report: Status (bar), CostCenter (bar)
- Value helps: costCenter, currency, category_code, supplierId, productId

**i18n**: English (default) + Polish. Bundle key prefix pattern: match existing keys before adding new ones.

---

## BTP Deployment

**Command**: `mbt build` → produces `.mtar` → deploy via `cf deploy`

**MTA modules** (`mta.yaml`):
| Module | Type | Notes |
|---|---|---|
| `CAPMAP-srv` | Node.js | CAP service, entry `server.js` from `gen/srv` |
| `CAPMAP-db-deployer` | HDB | Deploys HDI artifacts from `gen/db` |
| `CAPMAPrequestsui` | HTML5 | `npm run build` in `app/requestsui`, output `dist/` |
| `CAPMAP-app-deployer` | Application content | Uploads Fiori app to HTML5 repo |
| `CAPMAP` | Node.js | App-router entry point |

**BTP Resources**:
- `CAPMAP-auth` — XSUAA (application plan), `dedicated` tenant mode
- `CAPMAP-db` — HDI container (hana, hdi-shared plan)
- `CAPMAP-connectivity` — Connectivity service (S/4HANA on-prem tunneling)
- `CAPMAP-destination` — Destination service (named destination lookup)
- `CAPMAP-html5-repo-host` / `CAPMAP-html5-runtime` — HTML5 apps repo

**Role collections** auto-created by MTA: `CAPMAP-Viewer`, `CAPMAP-RegionalManager`

---

## Dev Workflow

```bash
# Local dev server (SQLite, mock auth)
cds watch

# Open with Fiori app auto-launch
npm run watch-requestsui

# Seed test PDF attachment on every request (dev data, idempotent)
npm run seed:attachments

# Regenerate TypeScript types after CDS model changes
node node_modules/@cap-js/cds-typer/lib/cli.js "*" --outputDirectory @cds-models

# Production build
mbt build

# Deploy to BTP CF (trial)
cf deploy mta_archives/CAPMAP_1.0.0.mtar
```

**Local auth**: `cds.env.requires.auth = { kind: 'mocked', users: {...} }` — users defined in `.cdsrc.json`. No token needed for local dev.

**Env files** (not in git):
- `.env` — `GEMINI_API_KEY`, S4HANA API key
- `default-env.json` — destination service credentials for local Cloud SDK calls

---

## Conventions & Gotchas

- **Types**: Always import from `#cds-models/...` (auto-generated, path alias in `package.json`). Never hand-write entity types. Use `cds-typer '*' --outputDirectory @cds-models` after any CDS model change.
- **Singular vs plural CDS classes**: `Request` (singular, `is_singular: true`) for `SELECT.one.from(Request)`. `Requests` (array type) for `UPDATE(Requests)` and collection queries.
- **CQL globals**: `SELECT`, `UPDATE`, `INSERT` are CAP globals — require `"types": ["@cap-js/cds-types"]` in `tsconfig.json` to resolve.
- **Draft handling**: Requests and Items have parallel `_drafts` shadow tables. Actions like `submitRequest` must work on both active and draft contexts. Use `'RequestService.Items.drafts'` string for draft table queries.
- **Draft-enabled action keys**: `req.params[0]` includes `{ ID, IsActiveEntity: true }`. `IsActiveEntity` is virtual — always destructure `const { ID } = req.params[0]` before DB queries.
- **totalAmount recalculation**: Must be triggered from `ItemHandler` after every item write, not inline in item save. Parent entity patched directly via `UPDATE Requests SET totalAmount=...`.
- **Attachments plugin**: `sap.attachments.Attachments` is an abstract CDS aspect — `SELECT.from('sap.attachments.Attachments')` throws "Query source must be an entity or an association". Always query via the generated composition class: `SELECT.from(Requests.attachments).where({ up__ID: ID })`.
- **S4HANA destination in dev**: `validateSupplierBeforeSave` catches Cloud SDK errors; if `!error.response` (no HTTP response = destination not found), it warns and allows save rather than crashing. Never call `req.error()` in the no-destination branch — unhandled rejection crashes the process and causes port conflicts on restart.
- **External API errors**: CostCenterHandler has a mock fallback; SupplierHandler gracefully degrades when destination is missing. Supplier deletion check blocks save on actual HTTP 404/error responses only.
- **Localization**: Both CostCenter and Product handlers parse user locale from `cds.context.user.locale` (format: `en_US`). First 2 chars = language code for S/4 text lookups.
- **mbt build** requires the `mbt` npm package and Cloud Foundry CLI + `cf deploy` plugin.
- **MCP servers** (Windows): restart Claude Code from `C:\Dev\CAPMAP` if cap/ui5/fiori tools are missing. Do not use `npx` — use `node` with direct script paths.
- **Virtual fields in `$select`**: Fiori builds `$select` from rendered columns only. Virtual fields (`isEditable`, `isApprover`) used purely in annotation expressions are never added by Fiori. The `injectRequiredColumns` method (registered as `before('READ', 'Requests')`) forces them into every explicit `$select` so `afterRead` values actually reach the client.
- **`UI.UpdateHidden` with dynamic `$Path`**: Do NOT annotate the entity with `UI.UpdateHidden: { $edmJson: { $Path: '...' } }`. In the List Report the expression is evaluated once at entity-type level (no row instance) → `status_code` resolves to `null` → `$Ne(null,'N') = true` → Edit button permanently hidden for all rows. Keep `UI.UpdateHidden` unset; use `beforeSave` as the server-side status gate instead.
- **`beforeSave` is the status gate**: Since `UI.UpdateHidden` is not set, the `before('SAVE', 'Requests')` handler is the authoritative guard that prevents non-N requests from being saved via the edit flow. It reads the active entity's `status_code` and rejects with `EDIT_NOT_ALLOWED_FOR_CURRENT_STATUS` if it's not N.
