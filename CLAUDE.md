# CAPMAP — Claude Code Context

## What this project is

B2B **CapEx Request Management** app built on SAP CAP (Node.js + TypeScript) with a Fiori Elements frontend. Users create capital expenditure requests with line items, route them through a Draft→Submit→Approve/Reject workflow, and can generate AI-written business justifications via Google Gemini. Deployed on SAP BTP (Cloud Foundry) with XSUAA auth, HANA DB, and an app-router entry point.

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
| AI | Google Gemini `gemini-2.5-flash-preview-05-20` via `@google/genai@^2.3.0` |
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
- `status` → `Statuses` code-list (D=Draft, S=Submitted, A=Approved, R=Rejected)
- `approver`, `approvalDate`, `justification` (from `ApprovalTracking` aspect)
- Composition: `items` (cascade-delete on header delete)

**Items** (line-item entity, `cuid`):
- `productId`, `description`, `quantity`, `price`, `itemTotal` (calculated)
- `category` → `Categories` code-list, `supplierId` (S/4 Business Partner ref)

**Code-lists**: `Statuses` (with criticality 0–3), `Categories` (IT/Furniture/Machinery/Software)

---

## OData Service (`srv/MainService.cds`)

Path: `/service/request`  
Requires: `authenticated-user`

Key projections and restrictions:
- **Requests**: `@odata.draft.enabled`; Viewer=READ, RegionalManager=CRUD (WHERE region IN user.region)
- **Items**: draft composition of Requests
- **CostCenters**: read-only mashup of `API_COSTCENTER_V2.A_CostCenter` + `to_Text` expansion
- **Suppliers**: read-only mashup of `API_BUSINESS_PARTNER.A_Supplier`
- **Products**: read-only mashup of `API_PRODUCT_SRV.A_Product` + `to_Description` expansion

**OData aggregation** enabled: groupby (status, costCenter, currency), sum/min/max on totalAmount, countdistinct on ID. Powers the analytics charts.

**Bound actions on Requests**:
- `submitRequest()` — sets status=S
- `approveRequest()` — sets status=A, records approver + date
- `rejectRequest()` — sets status=R, records approver + date
- `generateAIJustification()` — calls Gemini, persists result to `justification`

---

## Handler Patterns

All handlers registered in `MainService.ts` via `cds.on('bootstrap')`. Pattern:

```typescript
// srv/handlers/SomeHandler.ts
import cds from '@sap/cds'
import { Requests } from '#cds-models/RequestService'

export class SomeHandler {
  constructor(private srv: cds.ApplicationService, private externalApi?: cds.RemoteService) {}

  register() {
    this.srv.before('READ', Requests, this.beforeRead.bind(this))
    this.srv.on('READ', Requests, this.onRead.bind(this))
    this.srv.after('READ', Requests, this.afterRead.bind(this))
  }
}
```

**Key business rules in `RequestHandler.ts`**:
- `justification` required when `totalAmount > 1000`
- `title` min length 5 chars
- Supplier `DeletionIndicator` check via Cloud SDK before save
- `syncStatusCriticality()`: maps status codes to UI criticality numbers on every READ
- After item PATCH/POST/DELETE: `ItemHandler` recalculates `Requests.totalAmount`

---

## AI Integration

File: `srv/handlers/RequestHandler.ts` → `generateAIJustification()`  
Prompt: `srv/utils/PromptTemplates.ts`

```typescript
// Bound action — always on draft
// Sends item names + categories + user locale to Gemini
// Model: gemini-2.5-flash-preview-05-20
// Result: 2-3 sentence business justification, locale-aware (en/pl)
// Side-effect annotation in annotations.cds refreshes justification field on UI
```

API key: stored in `.env` as `GEMINI_API_KEY`.

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

Cloud SDK pattern used for supplier validation:
```typescript
import { businessPartnerService } from './external/API_BUSINESS_PARTNER'
const { supplierApi } = businessPartnerService()
// then execute via destination
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
- Object page facets: GeneralInfo, Justification (multiline), Items table
- Action visibility: Submit (status=D), Approve/Reject (status=S)
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

# Regenerate TypeScript types after CDS model changes
cds-typer '*' --outputDirectory @cds-models

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

- **Types**: Always import from `#cds-models/...` (auto-generated, path alias in `package.json`). Never hand-write entity types.
- **Draft handling**: Requests and Items have parallel `_drafts` shadow tables. Actions like `submitRequest` must work on both active and draft contexts.
- **totalAmount recalculation**: Must be triggered from `ItemHandler` after every item write, not inline in item save. Parent entity patched directly via `UPDATE Requests SET totalAmount=...`.
- **Status criticality**: `syncStatusCriticality()` runs in every `after READ` — do not set `criticality` elsewhere or it will be overwritten.
- **External API errors**: CostCenterHandler has a mock fallback; SupplierHandler returns HTTP 502 on failure. Supplier deletion check blocks the entire save.
- **Localization**: Both CostCenter and Product handlers parse user locale from `cds.context.user.locale` (format: `en_US`). First 2 chars = language code for S/4 text lookups.
- **mbt build** requires the `mbt` npm package and Cloud Foundry CLI + `cf deploy` plugin.
