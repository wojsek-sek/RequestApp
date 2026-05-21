# CAPMAP — Capital Expenditure Request Management

> A full-stack enterprise application for managing CapEx purchase requests, built on **SAP CAP**, **TypeScript**, and **SAP Fiori Elements**, deployed on **SAP BTP Cloud Foundry**.

---

## Overview

CAPMAP digitizes the capital expenditure approval workflow for organizations that need a structured, auditable process for procurement requests. Employees create itemized purchase requests, route them for regional manager approval, and get AI-generated business justifications — all in a modern, mobile-ready Fiori UI backed by a SAP HANA database and live S/4HANA data.

### Key Capabilities

- **Draft-based request authoring** — save work in progress, edit freely, submit when ready
- **Structured approval workflow** — Draft → Submitted → Approved / Rejected with full audit trail
- **Line-item management** — add products from S/4HANA catalog, automatic total recalculation
- **AI-powered justifications** — one click generates a professional business case via Google Gemini
- **Regional access control** — managers only see and act on requests within their assigned region
- **Live S/4HANA data** — cost centers, suppliers, and products fetched in real time
- **Analytics & charts** — spending by cost center, requests by status, visual filter bar
- **Localization** — English and Polish UI with locale-aware S/4HANA text resolution

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SAP BTP Cloud Foundry                    │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │  App Router  │───▶│  CAP Service │───▶│   HDI Container   │  │
│  │  (approuter) │    │  (Node.js /  │    │   (SAP HANA DB)   │  │
│  └──────┬───────┘    │  TypeScript) │    └───────────────────┘  │
│         │            └──────┬───────┘                           │
│  ┌──────▼───────┐           │                                   │
│  │  HTML5 Repo  │    ┌──────▼──────────────────────────────┐   │
│  │  (Fiori UI)  │    │         External BTP Services        │   │
│  └──────────────┘    │  ┌────────────┐  ┌───────────────┐  │   │
│                       │  │   XSUAA    │  │  Destination  │  │   │
│                       │  │ (OAuth 2.0)│  │   Service     │  │   │
│                       │  └────────────┘  └───────────────┘  │   │
│                       └─────────────────────────────────────┘   │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼               ▼
             API_COSTCENTER  API_BUSINESS    API_PRODUCT_SRV
             _V2 (S/4HANA)  _PARTNER (S/4)  (S/4HANA OData)
```

### Request Lifecycle

```
  [Draft] ──── submit ────▶ [Submitted] ──── approve ────▶ [Approved]
                                  │
                                  └──────── reject ─────▶ [Rejected]
```

---

## Tech Stack

### Backend

| Technology | Version | Purpose |
|---|---|---|
| `@sap/cds` | ^9 | CAP framework — OData service, CDS model, event handlers |
| TypeScript | ^5 | Type-safe handler code (`tsx` runner in development) |
| `@cap-js/hana` | ^2 | SAP HANA database adapter (production) |
| `@cap-js/sqlite` | ^2 | SQLite adapter (local development) |
| `@sap/xssec` | ^4 | XSUAA token validation and user context |
| `@sap-cloud-sdk/*` | ^4.6 | Typed S/4HANA API calls via named destination |
| `@google/genai` | ^2.3 | Google Gemini AI (AI justification generation) |
| `@sap/hdi-deploy` | ^5.6 | HANA HDI artifact deployer |

### Frontend

| Technology | Version | Purpose |
|---|---|---|
| SAP UI5 | ^1.145 | UI framework |
| `sap.fe.templates` | — | Fiori Elements — List Report + Object Page |
| OData 4.01 | — | Client–service protocol |
| `cds-plugin-ui5` | ^0.13 | Serves UI5 app through CDS dev server |

### Infrastructure (SAP BTP)

| Service | Plan | Purpose |
|---|---|---|
| XSUAA | application | OAuth 2.0 authentication and authorization |
| SAP HANA HDI Container | hdi-shared | Persistent database |
| Connectivity | lite | S/4HANA on-premise tunneling |
| Destination | lite | Named destination for S/4HANA APIs |
| HTML5 Application Repository | app-host / app-runtime | Hosts the Fiori static app |
| Cloud Foundry Runtime | — | Node.js service and app-router |

---

## Project Structure

```
CAPMAP/
│
├── db/
│   └── schema.cds               # Data model — Requests, Items, code-lists, aspects
│
├── srv/
│   ├── MainService.cds          # OData service definition — projections, actions, auth
│   ├── MainService.ts           # Handler registration and bootstrapping
│   ├── handlers/
│   │   ├── RequestHandler.ts    # Core logic: validate, approve/reject/submit, AI action
│   │   ├── ItemHandler.ts       # Line-item totals recalculation
│   │   ├── CostCenterHandler.ts # S/4 cost center mashup with localized names
│   │   ├── SupplierHandler.ts   # S/4 Business Partner read-through + validation
│   │   └── ProductHandler.ts    # S/4 product catalog with localized descriptions
│   ├── utils/
│   │   └── PromptTemplates.ts   # Gemini prompt builder (locale-aware)
│   └── external/                # S/4HANA EDMX/CSN API definitions (generated)
│       ├── API_COSTCENTER_V2.*
│       ├── API_BUSINESS_PARTNER.*
│       └── API_PRODUCT_SRV.*
│
├── app/
│   ├── requestsui/
│   │   └── webapp/
│   │       ├── manifest.json    # Fiori app config — routing, models, targets
│   │       ├── xs-app.json      # App-router routing rules for this app
│   │       └── annotations.cds  # All UI annotations: facets, actions, charts, value-helps
│   └── router/
│       ├── xs-app.json          # Global app-router config (entry point routing)
│       └── package.json         # @sap/approuter dependency
│
├── @cds-models/                 # Auto-generated TypeScript types — DO NOT edit manually
│
├── mta.yaml                     # BTP multi-target deployment descriptor
├── xs-security.json             # XSUAA roles, scopes, and user attribute definitions
├── .cdsrc.json                  # CDS runtime config — auth strategy, external API config
├── package.json
└── tsconfig.json                # ES2022, strict mode, moduleResolution: NodeNext
```

---

## Data Model

### `Requests` — CapEx request header

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID | Auto-generated (`cuid`) |
| `title` | String | Minimum 5 characters |
| `totalAmount` | Decimal | Sum of all item totals; recalculated on item change |
| `currency` | Currency | Default: USD |
| `costCenter` | String | Reference to S/4HANA cost center |
| `region` | String | Row-level security key (e.g. EU, US, PL) |
| `status` | Association | → `Statuses` code-list |
| `approver` | String | Set automatically on approve / reject |
| `approvalDate` | Date | Set automatically on approve / reject |
| `justification` | LargeString | Manual entry or AI-generated text |
| `items` | Composition | → `Items` (cascade delete on header delete) |

### `Items` — line items

| Field | Type | Notes |
|---|---|---|
| `productId` | String | S/4HANA product reference |
| `description` | String | Free text |
| `quantity` | Decimal | Mandatory |
| `price` | Decimal | Mandatory |
| `itemTotal` | Decimal | `quantity × price`, recalculated on every save |
| `category` | Association | → `Categories` code-list |
| `supplierId` | String | S/4HANA Business Partner reference |

### Code-lists

| Entity | Values |
|---|---|
| `Statuses` | D = Draft (grey), S = Submitted (orange), A = Approved (green), R = Rejected (red) |
| `Categories` | IT, FU (Furniture), MA (Machinery), SW (Software) |

---

## OData Service

**Base path**: `/service/request`  
**Protocol**: OData 4.01 with draft support (`@odata.draft.enabled`)

### Bound Actions on `Requests`

| Action | Available when | Effect |
|---|---|---|
| `submitRequest()` | status = Draft | Sets status → Submitted |
| `approveRequest()` | status = Submitted | Sets status → Approved, records approver and date |
| `rejectRequest()` | status = Submitted | Sets status → Rejected, records approver and date |
| `generateAIJustification()` | Draft only | Calls Gemini, saves 2–3 sentence justification |

### Validation Rules

- `title` must be at least 5 characters
- `justification` is required when `totalAmount > 1000`
- `supplierId` is validated against S/4HANA before save — blocked or deleted suppliers are rejected

### Analytics Queries

OData `$apply` aggregations are enabled and power the Fiori charts:

```
# Requests by status (donut chart)
GET /service/request/Requests
  ?$apply=groupby((status_code),aggregate(ID with countdistinct as RequestCount))

# Spending by cost center (column chart)
GET /service/request/Requests
  ?$apply=groupby((costCenter),aggregate(totalAmount with sum as TotalAmountSum))
```

---

## Authorization Model

Defined in `xs-security.json` and enforced at the CDS service layer via `@restrict` annotations.

| Role | Can do | Region filter |
|---|---|---|
| `Viewer` | Read all requests | None |
| `RegionalManager` | Full CRUD | Only requests where `region = user.Region` |

The `Region` user attribute is assigned per user in the BTP cockpit role collection. CDS enforces it transparently — no handler code needed for filtering.

```cds
// srv/MainService.cds
@restrict: [
  { grant: 'READ', to: 'Viewer' },
  { grant: '*',    to: 'RegionalManager', where: 'region = $user.Region' }
]
```

---

## External Integrations

### S/4HANA APIs (OData V2)

| API | Used for |
|---|---|
| `API_COSTCENTER_V2` | Cost center value-help with localized name and description |
| `API_BUSINESS_PARTNER` | Supplier value-help and pre-save deletion status check |
| `API_PRODUCT_SRV` | Product catalog with locale-aware descriptions |

All three are configured in `.cdsrc.json`:

- **Development**: Direct `sandbox.api.sap.com` URLs with API key from `.env`
- **Production**: Named destination `S4HANA_DESTINATION` via BTP Destination Service

### Google Gemini AI

| Setting | Value |
|---|---|
| Model | `gemini-2.5-flash-preview-05-20` |
| Trigger | `generateAIJustification()` bound action |
| Input | Item names, categories, quantities, user locale |
| Output | 2–3 sentences of business justification |
| Config | `GEMINI_API_KEY` in `.env` |

---

## Local Development

### Prerequisites

- **Node.js** 20 or later
- **SAP CDS CLI**: `npm install -g @sap/cds-dk`
- **`.env` file** in the project root (see below)

### Environment Setup

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_google_gemini_api_key
S4HANA_API_KEY=your_sap_sandbox_api_key
```

Create `default-env.json` for local Cloud SDK calls if you need real S/4HANA data (otherwise the sandbox URLs in `.cdsrc.json` are used directly).

### Install and Start

```bash
# Install all dependencies (including app workspaces)
npm install

# Start the dev server with live reload (SQLite, mock auth)
cds watch

# Start and automatically open the Fiori app in the browser
npm run watch-requestsui
```

The dev server starts at **http://localhost:4004** with:
- Mock authentication — no XSUAA token required
- SQLite in-memory database
- Pre-configured local users (see table below)

### Dev Users

Log in with any of these credentials at the browser prompt:

| Username | Role | Accessible Regions |
|---|---|---|
| `admin-eu` | RegionalManager | EU, PL, EN |
| `admin-us` | RegionalManager | US |
| `readonly-user` | Viewer | All (read-only) |

### Regenerate TypeScript Types

Run this after any change to `.cds` model or service files:

```bash
cds-typer '*' --outputDirectory @cds-models
```

Types are imported in handlers using the `#cds-models/*` path alias defined in `package.json`.

---

## Fiori UI

The app uses **Fiori Elements** — no custom view XML or controllers are needed. All UI behavior (layout, actions, charts, value-helps) is driven by **OData annotations** in `app/requestsui/annotations.cds`.

### Pages

| Page | Template | Entity |
|---|---|---|
| List Report | `sap.fe.templates.ListReport` | `Requests` |
| Request Object Page | `sap.fe.templates.ObjectPage` | `Requests` (draft-enabled) |
| Item Object Page | `sap.fe.templates.ObjectPage` | `Items` (nested in draft) |

### UI Features

| Feature | Description |
|---|---|
| Visual Filters | Mini bar charts for Status and Cost Center filter the list in real time |
| Analytics Tab | Column chart (amount by cost center) + Donut chart (requests by status) |
| Draft Indicator | Unsaved changes are persisted to the database automatically |
| Contextual Actions | Submit / Approve / Reject buttons appear based on current request status |
| AI Button | Generates business justification with a single click (draft mode only) |
| Value Helps | Cost centers, suppliers, and products loaded live from S/4HANA |
| Side Effects | Changing item quantity or price immediately updates the request total |

### Localization

The app ships with **English** and **Polish** translations (`app/requestsui/webapp/i18n/`). S/4HANA text APIs are queried with the user's locale for cost center names and product descriptions.

---

## Building and Deploying to SAP BTP

### Prerequisites

- Cloud Foundry CLI: `cf` with the MultiApps plugin (`cf install-plugin multiapps`)
- `mbt` build tool — included in `devDependencies`, available after `npm install`
- Logged in to your BTP CF space: `cf login`
- BTP services provisioned: XSUAA, HANA HDI, Destination, HTML5 repo

### Build

```bash
# Produces: mta_archives/CAPMAP_1.0.0.mtar
npm run build
```

### Deploy

```bash
cf deploy mta_archives/CAPMAP_1.0.0.mtar
```

### Deployment Order (MTA)

The MTA descriptor orchestrates parallel and sequential deployments:

| Module | Type | What it does |
|---|---|---|
| `CAPMAP-db-deployer` | HDB | Deploys HANA HDI artifacts (tables, views) |
| `CAPMAP-srv` | Node.js | Starts the CAP OData service |
| `CAPMAPrequestsui` | HTML5 | Builds the Fiori app and uploads to HTML5 repo |
| `CAPMAP-app-deployer` | Content | Registers the HTML5 app in the repo |
| `CAPMAP` | Node.js | Starts the app-router (public entry point) |

### Post-Deploy Configuration

In the **BTP cockpit**, assign role collections to users:

| Role Collection | Use for |
|---|---|
| `CAPMAP-Viewer` | Read-only access — all regions |
| `CAPMAP-RegionalManager` | Full access — set the **Region** attribute (e.g. `EU`) |

---

## Handler Development Guide

All service event handlers follow a consistent pattern. Handlers are registered in `MainService.ts` via `cds.on('bootstrap')`.

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
    this.srv.after('READ',   Requests, this.enrich.bind(this))
  }

  private async validate(req: cds.Request) {
    if (!req.data.title) return req.error(400, 'Title is required')
  }
}
```

### Useful Patterns

**Access user context and attributes**:
```typescript
const { user } = cds.context
const region = user.attr?.region    // from XSUAA token attribute
const locale = user.locale          // e.g. 'en_US'
```

**Read from an external S/4HANA API**:
```typescript
const bpApi = await cds.connect.to('API_BUSINESS_PARTNER')
const result = await bpApi.run(
  SELECT.from('A_Supplier').where({ Supplier: id })
)
```

**Use Cloud SDK for typed, resilient S/4HANA calls**:
```typescript
import { businessPartnerService } from './external/API_BUSINESS_PARTNER'
const { supplierApi } = businessPartnerService()
const supplier = await supplierApi
  .requestBuilder()
  .getByKey(supplierId)
  .execute({ destinationName: 'S4HANA_DESTINATION' })
```

**Raise a user-visible error**:
```typescript
req.error(400, 'Justification is required for amounts over 1000', 'justification')
```

---

## Scripts Reference

| Script | Command | When to use |
|---|---|---|
| `npm start` | `npx cds-serve` | Production-style local start |
| `npm run watch` | `cds watch` | Development with live reload |
| `npm run watch-requestsui` | `cds watch --open ...` | Development + auto-open Fiori app |
| `npm run build` | `mbt build` | Produce the `.mtar` archive for BTP deploy |

---

## Troubleshooting

**TypeScript types not found after a model change**  
Regenerate them: `cds-typer '*' --outputDirectory @cds-models`

**Supplier validation always fails locally**  
Check `.cdsrc.json` for the `API_BUSINESS_PARTNER` sandbox URL and verify `S4HANA_API_KEY` is set in `.env`.

**AI justification returns an error**  
Verify `GEMINI_API_KEY` is present in `.env` and the Gemini API is enabled in your Google Cloud project.

**Stale draft data after a schema change**  
Delete the local SQLite file to reset all state:  
```bash
rm db.sqlite
```

**MTA build fails**  
Ensure all workspace dependencies are installed (`npm install` from the root) and that `mbt` is available (`npx mbt --version`).

**Cost centers or products show no description**  
The S/4HANA sandbox may be unavailable. `CostCenterHandler` logs a warning and falls back to mock data; `ProductHandler` returns items without descriptions.

---

## License

Private — internal use only.
