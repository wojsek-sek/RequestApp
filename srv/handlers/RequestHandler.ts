import cds from '@sap/cds';
import { Request, Item, Requests } from '#cds-models/RequestService';
import { executeHttpRequest } from '@sap-cloud-sdk/http-client';
import { GoogleGenAI } from '@google/genai';
import { PROMPTS } from '../utils/PromptTemplates';

// Shapes returned by the AI Agent Hub mock — mirrors ai-agent-hub-mock.js
interface AnalysisResult {
    requestId: string;
    fileName: string;
    documentValid: boolean;
    extractedAmount: number;
    notes: string;
}

interface ComplianceResult {
    score: number;
    notes: string;
    decision: string;
}

// S/4HANA Business Partner response shape (subset we use)
interface S4SupplierData {
    SupplierName?: string;
    DeletionIndicator?: boolean;
}

/** Requests entity: validation, bound actions, draft-save supplier check. */
export class RequestHandler {

    /**
     * Block direct PATCH to active non-N requests.
     *
     * Fires for OData PATCH/PUT to active entity instances only — not for draft
     * patches (those target `Requests.drafts`) and not for DB-level CQL UPDATEs
     * issued inside action handlers (those bypass service event hooks entirely).
     * Draft activation SAVE is covered separately by `beforeSave`.
     *
     * This guard is the enforcement layer for `@odata.draft.bypass` inline edits
     * that skip the draft lifecycle.
     */
    beforeUpdate = async (req: cds.Request) => {
        const { ID } = (req.params?.[0] ?? {}) as { ID?: string };
        if (!ID) return;

        const current = await SELECT.one.from(Request)
            .columns('status_code')
            .where({ ID });

        if (current?.status_code && current.status_code !== 'N') {
            return req.error(400, 'EDIT_NOT_ALLOWED_FOR_CURRENT_STATUS');
        }
    };

    /** Title length, justification for high amounts, non-negative total. */
    validateOnWrite = async (req: cds.Request) => {
        const { totalAmount, justification, title } = req.data as Partial<Request>;

        if (title && title.length < 5) {
            return req.error(400, 'TITLE_TOO_SHORT', 'title');
        }

        if ((totalAmount ?? 0) > 1000 && !justification) {
            return req.error(400, 'JUSTIFICATION_REQUIRED_FOR_HIGH_AMOUNT', 'justification');
        }

        // Only a genuinely negative total is invalid. A zero/empty total is a normal
        // intermediate state (header created before any line items) — using nullish `?? 0`
        // here would let 0 slip through the `<= 0` trap that previously misfired on it.
        if ((totalAmount ?? 0) < 0) {
            return req.error(400, 'AMOUNT_CANNOT_BE_NEGATIVE', 'totalAmount');
        }
    };

    /**
     * Stamp the row-level-security key `region` on creation from the user's Region attribute.
     *
     * `region` is @UI.Hidden, so users never enter it — yet the @restrict on Requests filters
     * every operation by `region = $user.Region`. Without this default a freshly created request
     * gets region=null and, once the draft is activated, no longer matches the user's region:
     * the creator can no longer read, edit, or submit their own request.
     *
     * A RegionalManager may carry several regions (e.g. [EU, PL, EN]); we stamp the first one,
     * which satisfies the `region IN (...)` filter CAP generates for the multi-valued attribute.
     */
    defaultRegionOnCreate = (req: cds.Request): void => {
        this.applyDefaultRegion(req.data as Partial<Request>, req);
    };

    private applyDefaultRegion = (data: Partial<Request>, req: cds.Request): void => {
        if (data.region) return; // respect an explicitly supplied value
        const attr = (req.user?.attr as { Region?: string | string[] } | undefined)?.Region;
        const region = Array.isArray(attr) ? attr[0] : attr;
        if (region) data.region = region;
    };

    /**
     * Ensure control-relevant columns are always included in OData $select.
     *
     * Fiori Elements only requests columns that are rendered in the table.
     * Virtual fields used solely for annotation expressions (UpdateHidden,
     * OperationAvailable, UpdateRestrictions) are never in Fiori's $select,
     * so CAP omits them from the response and the client receives `undefined`.
     * Fiori treats `undefined` as permissive (truthy), which breaks button
     * graying logic entirely.
     *
     * Fields injected:
     *   status_code — criticality icon in List Report
     *   isEditable  — Edit button state (UpdateHidden, UpdateRestrictions)
     *   isApprover  — Approve/Reject button state (OperationAvailable, SoD)
     */
    injectRequiredColumns = (req: cds.Request): void => {
        const query = req.query?.SELECT;
        if (!query?.columns) return; // wildcard SELECT (*) — all columns already included

        const cols = query.columns as Array<{ ref?: string[] }>;
        const has  = (name: string) => cols.some(c => c.ref?.at(-1) === name);

        const REQUIRED = ['status_code', 'isEditable', 'isApprover'] as const;
        for (const field of REQUIRED) {
            if (!has(field)) {
                cols.push({ ref: [field] });
            }
        }
    };

    /**
     * Compute virtual display-control fields for each request row:
     *
     * isApprover — drives Approve/Reject button visibility.
     *   true when ALL of:
     *     1. Current user has the 'RegionalManager' role
     *     2. Current user is NOT the creator of the request (Segregation of Duties)
     *     3. Request status is 'S' (Submitted) — ready for approval
     *
     * isEditable — drives Edit/Delete button visibility.
     *   true when ALL of:
     *     1. Current user has the 'RegionalManager' role (Viewers are read-only)
     *     2. Request status is 'N' (New/Draft) — cannot edit submitted/approved/rejected requests
     */
    afterRead = async (results: Requests[], req: cds.Request) => {
        const userId    = cds.context?.user?.id;
        const isManager = cds.context?.user?.is('RegionalManager');

        const items = Array.isArray(results) ? results : [results];
        for (const item of items) {
            if (!item || !(item as any).ID) continue;

            // SoD: isApprover = RegionalManager + not creator + status is Submitted
            (item as any).isApprover = !!(isManager && (item as any).createdBy !== userId && (item as any).status_code === 'S');

            // isEditable: RegionalManager and status is New (N) only
            (item as any).isEditable = !!(isManager && (item as any).status_code === 'N');
        }
    };

    /**
     * Approve a Submitted request.
     *
     * The UI only shows this button when `isApprover` is true, but that is cosmetic —
     * a direct OData action call must be re-validated server-side, otherwise the creator
     * (or any RegionalManager) could approve a New/Approved/Rejected request by hand.
     * Two guards mirror the SoD/status rules baked into `isApprover` (see afterRead):
     *   1. status must be 'S' (Submitted) — nothing else is ready for a decision
     *   2. approver ≠ creator (Segregation of Duties)
     */
    approveRequest = async (req: cds.Request) => {
        const { ID } = req.params[0] as { ID: string };
        const currentUserId = req.user.id;

        const current = await SELECT.one.from(Request).where({ ID });
        if (!current) return req.error(404, 'REQUEST_NOT_FOUND');
        if (current.status_code !== 'S') {
            return req.error(400, 'APPROVE_ONLY_ALLOWED_FOR_SUBMITTED');
        }
        if (current.createdBy === currentUserId) {
            return req.error(403, 'APPROVAL_SOD_VIOLATION');
        }

        await UPDATE(Requests)
            .set({
                status_code:  'A',
                approvalDate: new Date().toISOString(),
                approver:     currentUserId,
            })
            .where({ ID });

        return SELECT.one.from(Request).where({ ID });
    };

    /** Reject a Submitted request. Same server-side status + SoD guards as approveRequest. */
    rejectRequest = async (req: cds.Request) => {
        const { ID } = req.params[0] as { ID: string };
        const { reason } = req.data as { reason?: string };
        const currentUserId = req.user.id;

        const current = await SELECT.one.from(Request).where({ ID });
        if (!current) return req.error(404, 'REQUEST_NOT_FOUND');
        if (current.status_code !== 'S') {
            return req.error(400, 'REJECT_ONLY_ALLOWED_FOR_SUBMITTED');
        }
        if (current.createdBy === currentUserId) {
            return req.error(403, 'APPROVAL_SOD_VIOLATION');
        }

        await UPDATE(Requests)
            .set({
                status_code:  'R',
                approvalDate: new Date().toISOString(),
                approver:     currentUserId,
                rejectReason: reason ?? null,
            })
            .where({ ID });

        return SELECT.one.from(Request).where({ ID });
    };

    // ─── Private validation helpers (shared between beforeSave and submitRequest) ───

    /**
     * Validate field-level business rules (title length, justification threshold).
     * Returns false and queues an error when a rule is violated; true otherwise.
     * Used in both beforeSave (draft data) and submitRequest (active entity data).
     */
    private checkFields = (data: Partial<Request>, req: cds.Request): boolean => {
        if (data.title && data.title.length < 5) {
            req.error(400, 'TITLE_TOO_SHORT', 'title');
            return false;
        }
        if ((data.totalAmount ?? 0) > 1000 && !data.justification) {
            req.error(400, 'JUSTIFICATION_REQUIRED_FOR_HIGH_AMOUNT', 'justification');
            return false;
        }
        return true;
    };

    /**
     * Validate every distinct supplier referenced by the request's items against S/4HANA.
     * Returns false and queues an error if ANY supplier is blocked or not found;
     * true on success or graceful degradation (no destination, no items with suppliers).
     *
     * Pass `'RequestService.Items.drafts'` during draft activation (beforeSave)
     * or `'RequestService.Items'` during submit (draft already activated by CAP).
     *
     * - Items without a supplierId are skipped silently — the catalog allows mixed lines.
     * - Duplicate supplier IDs across items are deduped so each supplier is checked once.
     * - Validation runs in parallel; the first hard error short-circuits the result, but
     *   we still let all in-flight calls settle to surface every problem to the user.
     * - If the destination is missing (local dev), all checks degrade gracefully to allow.
     */
    private checkSupplier = async (requestId: string, itemsTable: string, req: cds.Request): Promise<boolean> => {
        const items = await SELECT.from(itemsTable).where({ request_ID: requestId }) as Item[];

        const supplierIds = Array.from(new Set(
            items.map(item => item.supplierId).filter((id): id is string => !!id)
        ));

        if (supplierIds.length === 0) {
            return true;
        }

        const results = await Promise.all(
            supplierIds.map(supplierId => this.validateOneSupplier(supplierId, req))
        );

        return results.every(ok => ok);
    };

    /** Per-supplier S/4HANA check; isolates per-supplier error reporting from checkSupplier. */
    private validateOneSupplier = async (supplierId: string, req: cds.Request): Promise<boolean> => {
        try {
            console.log(`[SDK] Validating supplier: ${supplierId}...`);
            const response = await executeHttpRequest(
                { destinationName: 'S4HANA_DESTINATION' },
                {
                    method:  'GET',
                    url:     `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier('${supplierId}')`,
                    headers: { Accept: 'application/json' },
                }
            );
            const supplierData = response.data.d as S4SupplierData;
            const supplierLabel = supplierData.SupplierName ?? supplierId;
            if (supplierData.DeletionIndicator === true) {
                req.error(400, 'SUPPLIER_BLOCKED', 'supplierId', [supplierLabel]);
                return false;
            }
            return true;
        } catch (error: unknown) {
            const e = error as { message?: string; response?: { status?: number } };
            if (!e.response) {
                // No HTTP response = destination not configured (local dev) — allow and warn.
                console.warn(`[SDK] S/4HANA unreachable, skipping supplier check for ${supplierId}: ${e.message ?? 'unknown'}`);
                return true;
            }
            console.error('[SDK ERROR] S/4HANA returned an error:', e.message);
            if (e.response.status === 404) {
                req.error(400, 'SUPPLIER_NOT_FOUND', undefined, [supplierId]);
            } else {
                req.error(500, 'CLOUD_SDK_ERROR');
            }
            return false;
        }
    };

    // ────────────────────────────────────────────────────────────────────────────

    /**
     * Draft activation gate ("Save" button).
     * 1. Blocks saving a non-N request (only N can be edited).
     * 2. Applies field validations (title, justification threshold).
     * Supplier check runs in a separate handler registered after this one.
     */
    beforeSave = async (req: cds.Request) => {
        const data = req.data as Partial<Request>;
        if (!data.ID) return;

        // Backstop for the CREATE-time region default — covers direct API callers that
        // POST straight to the active entity without going through draftPrepare/CREATE.
        this.applyDefaultRegion(data, req);

        // Only N-status requests may be saved via the edit flow.
        const current = await SELECT.one.from(Request).columns('status_code').where({ ID: data.ID });
        if (current?.status_code && current.status_code !== 'N') {
            return req.error(400, 'EDIT_NOT_ALLOWED_FOR_CURRENT_STATUS');
        }

        this.checkFields(data, req);
        // status_code intentionally NOT set here — it stays N (the schema default).
    };

    /**
     * Submit a New request into the approval workflow.
     *
     * Registered on both `Requests` and `Requests.drafts`. The Fiori Submit button is
     * hidden while in draft mode (see annotations: UI.Hidden + Core.OperationAvailable
     * both require IsActiveEntity=true), so in normal UI usage this handler only fires
     * from the active context.
     *
     * The `if (isDraftContext)` branch below is a safety net for direct API calls that
     * could still reach the action via the draft URL (curl, integration tests). Without
     * it, a draft-context call would read the stale active row and silently lose any
     * pending field edits sitting in the draft.
     *
     * Validation order (mirrors save-time checks so nothing can be bypassed via direct submit):
     *   0. (Draft context only) Activate the draft to commit pending field changes
     *   1. Status guard — only N requests can be submitted
     *   2. Field validations — title length, justification required for high amounts
     *   3. Supplier check — S/4HANA DeletionIndicator on every item supplier (active Items table)
     *   4. Attachment required — at least one file must be present
     *   5. AI compliance check (graceful degradation)
     */
    submitRequest = async (req: cds.Request) => {
        const params = req.params[0] as { ID: string; IsActiveEntity?: boolean | string };
        const { ID } = params;
        const isDraftContext = params.IsActiveEntity === false || params.IsActiveEntity === 'false';

        // 0. Safety net — only fires for non-UI callers; the Submit button is hidden in
        //    draft mode so the standard Fiori flow always enters here on the active context.
        if (isDraftContext) {
            const svc = (cds.services as Record<string, cds.ApplicationService>)['RequestService'];
            await (svc as any).tx(req).send('SAVE', 'Requests', { ID });
        }

        // 1. Guard — only New requests can be submitted
        const current = await SELECT.one.from(Request).where({ ID });
        if (!current) return req.error(404, 'REQUEST_NOT_FOUND');
        if (current.status_code !== 'N') {
            return req.error(400, 'SUBMIT_ONLY_ALLOWED_FOR_NEW');
        }

        // 2. Field validations (same rules as beforeSave; re-checked here so they
        //    cannot be bypassed by calling submit without saving the draft first)
        if (!this.checkFields(current as Partial<Request>, req)) return;

        // 3. Supplier check on every item — by this point items live in the active table
        //    (either Fiori save-then-submit, or the safety-net activation above).
        if (!await this.checkSupplier(ID, 'RequestService.Items', req)) return;

        // 4. Require at least one attachment
        const attachments = await SELECT.from(Requests.attachments)
            .where({ up__ID: ID }) as Requests.attachment[];
        if (!attachments.length) {
            return req.error(400, 'ATTACH_REQUIRED_FOR_SUBMIT');
        }

        // 3. AI compliance check — graceful degradation if hub is unavailable
        let newStatusCode: 'S' | 'A' | 'R' = 'S';
        let aiScore: number | null = null;
        let aiNotes: string | null = null;

        try {
            const agentHub = await cds.connect.to('AI_Agent_Hub');

            const analysis = await agentHub.send('analyzeDocument', {
                requestId:   ID,
                fileName:    (attachments[0] as any).filename,
                totalAmount: current.totalAmount,
            }) as AnalysisResult;

            const compliance = await agentHub.send('verifyCompliance', analysis) as ComplianceResult;

            aiScore = compliance.score;
            aiNotes = compliance.notes;

            const decision = compliance.decision?.toUpperCase();
            if (decision === 'APPROVED') {
                newStatusCode = 'A';
            } else if (decision === 'REJECTED') {
                newStatusCode = 'R';
            } else {
                newStatusCode = 'S';
            }
        } catch (e: unknown) {
            console.warn('[AI] Agent Hub unavailable, submitting without compliance check:',
                (e as { message?: string })?.message ?? String(e));
            newStatusCode = 'S';
        }

        // 4. Persist status + AI results
        await UPDATE(Requests)
            .set({
                status_code:       newStatusCode,
                aiComplianceScore: aiScore,
                aiAuditNotes:      aiNotes,
                approvalDate: new Date().toISOString(),
                approver:    req.user.id 
            })
            .where({ ID });

        return SELECT.one.from(Request).where({ ID });
    };

    /**
     * Supplier check registered on before('SAVE') — runs during draft activation.
     * Items live in Items.drafts at this point; delegates to the shared checkSupplier helper.
     */
    validateSupplierBeforeSave = async (req: cds.Request) => {
        const requestId: string | undefined =
            (req.data as Partial<Request>)?.ID ??
            ((req.params?.[0] ?? {}) as { request_ID?: string }).request_ID;
        if (!requestId) return;
        await this.checkSupplier(requestId, 'RequestService.Items.drafts', req);
    };

    /**
     * Cancel a request — allowed only for New (N) or Submitted (S) status.
     * Sets status to Cancelled (C) and persists the optional cancellation reason.
     * Approved and Rejected requests are terminal states and cannot be cancelled.
     * This action replaces the Delete button; no rows are physically removed.
     */
    cancelRequest = async (req: cds.Request) => {
        const { ID } = req.params[0] as { ID: string };
        const { reason } = req.data as { reason?: string };
        const currentUserId = req.user.id;

        // Validate: only New or Submitted requests can be cancelled
        const current = await SELECT.one.from(Request).where({ ID });
        if (!current) return req.error(404, 'REQUEST_NOT_FOUND');
        if (!['N', 'S'].includes(current.status_code as string)) {
            return req.error(400, 'CANCEL_NOT_ALLOWED_FOR_STATUS');
        }

        await UPDATE(Requests)
            .set({
                status_code:  'C',
                cancelReason: reason ?? null,
                approvalDate: new Date().toISOString(),
                approver:     currentUserId,
            })
            .where({ ID });

        return SELECT.one.from(Request).where({ ID });
    };

    /**
     * Withdraw a Submitted request back to New so the requester can edit and re-submit.
     * Clears approval tracking fields; preserves justification and AI audit results.
     */
    withdrawRequest = async (req: cds.Request) => {
        const { ID } = req.params[0] as { ID: string };

        const current = await SELECT.one.from(Request).where({ ID });
        if (!current) return req.error(404, 'REQUEST_NOT_FOUND');
        if (current.status_code !== 'S') {
            return req.error(400, 'WITHDRAW_ONLY_ALLOWED_FOR_SUBMITTED');
        }

        await UPDATE(Requests)
            .set({
                status_code  : 'N',
                approver     : null,
                approvalDate : null,
                aiComplianceScore : null,
                aiAuditNotes : null,
            })
            .where({ ID });

        return SELECT.one.from(Request).where({ ID });
    };

    /** Generate business justification via Gemini and persist on the request draft. */
    generateAIJustification = async (req: cds.Request) => {
        const { ID: requestId } = req.params[0] as { ID: string };

        const draftItems = await cds.tx(req).run(
            SELECT.from('RequestService.Items.drafts').where({ request_ID: requestId })
        ) as Item[];

        const itemNames      = draftItems.map((item) => item.description).join(', ');
        const itemCategories = draftItems.map((item) => item.category_code).join(', ');

        if (!itemNames) {
            return req.error(400, 'AI_ITEMS_REQUIRED');
        }

        const promptText = PROMPTS.GENERATE_JUSTIFICATION(
            itemNames,
            itemCategories,
            req.locale ?? 'en'
        );

        try {
            const ai = new GoogleGenAI({ apiKey: process.env['GEMINI_API_KEY'] });

            const response = await ai.models.generateContent({
                model:    'gemini-3-flash-preview',
                contents: promptText,
            });

            await cds.tx(req).run(
                UPDATE('RequestService.Requests.drafts')
                    .set({ justification: response.text })
                    .where({ ID: requestId })
            );

            req.info('AI_JUSTIFICATION_SUCCESS');
        } catch (error: unknown) {
            console.error('[AI] Generation failed:', error);
            req.error(500, 'AI_GENERATION_ERROR');
        }
    };
}
