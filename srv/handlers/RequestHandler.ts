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

    /** Title length, justification for high amounts, positive total. */
    validateOnWrite = async (req: cds.Request) => {
        const { totalAmount, justification, title } = req.data as Partial<Request>;

        if (title && title.length < 5) {
            return req.error(400, 'TITLE_TOO_SHORT', 'title');
        }

        if ((totalAmount ?? 0) > 1000 && !justification) {
            return req.error(400, 'JUSTIFICATION_REQUIRED_FOR_HIGH_AMOUNT', 'justification');
        }

        if ((totalAmount ?? 1) <= 0) {
            return req.error(400, 'AMOUNT_MUST_BE_POSITIVE', 'totalAmount');
        }
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

    approveRequest = async (req: cds.Request) => {
        const { ID } = req.params[0] as { ID: string };
        const currentUserId = req.user.id;

        await UPDATE(Requests)
            .set({
                status_code:  'A',
                approvalDate: new Date().toISOString(),
                approver:     currentUserId,
            })
            .where({ ID });

        return SELECT.one.from(Request).where({ ID });
    };

    rejectRequest = async (req: cds.Request) => {
        const { ID } = req.params[0] as { ID: string };
        const { reason } = req.data as { reason?: string };
        const currentUserId = req.user.id;

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

    /** Runs on draft activation (Fiori "Save"). Basic validation only — status stays N. */
    beforeSave = async (req: cds.Request) => {
        const data = req.data as Partial<Request>;
        if (!data.ID) return;

        // Guard: only N-status (Draft) requests can be saved via the edit flow.
        // S/A/R/C transitions happen exclusively through the explicit bound actions.
        // UI.UpdateHidden is NOT used in annotations (it breaks the List Report Edit button),
        // so this server-side check is the authoritative gate.
        const current = await SELECT.one.from(Request).columns('status_code').where({ ID: data.ID });
        if (current && current.status_code && current.status_code !== 'N') {
            return req.error(400, 'EDIT_NOT_ALLOWED_FOR_CURRENT_STATUS');
        }

        if (data.title && data.title.length < 5) {
            return req.error(400, 'TITLE_TOO_SHORT', 'title');
        }
        if ((data.totalAmount ?? 0) > 1000 && !data.justification) {
            return req.error(400, 'JUSTIFICATION_REQUIRED_FOR_HIGH_AMOUNT', 'justification');
        }
        // status_code intentionally NOT set here — it stays N (the schema default).
    };

    /**
     * Submit a New request into the approval workflow.
     * Validates: attachment present, then runs AI compliance check.
     * Sets status N→S (AI may set A or R directly if confidence is high).
     */
    submitRequest = async (req: cds.Request) => {
        const { ID } = req.params[0] as { ID: string };

        // 1. Guard — only New requests can be submitted
        const current = await SELECT.one.from(Request).where({ ID });
        if (!current) return req.error(404, 'REQUEST_NOT_FOUND');
        if (current.status_code !== 'N') {
            return req.error(400, 'SUBMIT_ONLY_ALLOWED_FOR_NEW');
        }

        // 2. Require at least one attachment
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
            })
            .where({ ID });

        return SELECT.one.from(Request).where({ ID });
    };

    /** Supplier existence and block check against S/4HANA before activating draft. */
    validateSupplierBeforeSave = async (req: cds.Request) => {
        const itemKey = (req.params?.[0] ?? {}) as { request_ID?: string };
        const requestId: string | undefined =
            (req.data as Partial<Request>)?.ID ?? itemKey.request_ID;

        if (!requestId) return;

        const firstItem = await SELECT.one
            .from('RequestService.Items.drafts')
            .where({ request_ID: requestId }) as Item | null;

        if (!firstItem?.supplierId) {
            req.warn('NO_SUPPLIER_TO_VALIDATE');
            return;
        }

        try {
            console.log(`[SDK] Validating supplier: ${firstItem.supplierId}...`);

            const response = await executeHttpRequest(
                { destinationName: 'S4HANA_DESTINATION' },
                {
                    method:  'GET',
                    url:     `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier('${firstItem.supplierId}')`,
                    headers: { Accept: 'application/json' },
                }
            );

            const supplierData = response.data.d as S4SupplierData;
            const supplierLabel = supplierData.SupplierName ?? firstItem.supplierId;

            if (supplierData.DeletionIndicator === true) {
                return req.error(400, 'SUPPLIER_BLOCKED', 'supplierId', [supplierLabel]);
            }
        } catch (error: unknown) {
            const e = error as { message?: string; response?: { status?: number } };

            if (!e.response) {
                // No HTTP response = destination not configured or network unreachable.
                // In local dev S4HANA_DESTINATION is absent — warn and allow save to proceed.
                console.warn(`[SDK] S/4HANA unreachable, skipping supplier check: ${e.message ?? 'unknown'}`);
                return;
            }

            console.error('[SDK ERROR] S/4HANA returned an error:', e.message);
            if (e.response.status === 404) {
                req.error(400, 'SUPPLIER_NOT_FOUND', undefined, [firstItem.supplierId]);
            } else {
                req.error(500, 'CLOUD_SDK_ERROR');
            }
        }
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
