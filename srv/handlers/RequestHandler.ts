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

    constructor() {}

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
     * Ensure status_code is always included in projected columns.
     * Fiori List Report sometimes omits it when it builds column lists dynamically;
     * without it the criticality icon cannot be rendered.
     */
    injectStatusCodeColumn = (req: cds.Request) => {
        const query = req.query.SELECT;
        if (query?.columns) {
            // CAP's column_expr.ref is _segment[] where simple path segments are strings;
            // cast to string[] is safe for the single-level refs Fiori generates.
            const cols = query.columns as Array<{ ref?: string[] }>;
            const hasStatusCode = cols.some(col => col.ref?.includes('status_code'));
            if (!hasStatusCode) {
                query.columns.push({ ref: ['status_code'] });
            }
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
        const currentUserId = req.user.id;

        await UPDATE(Requests)
            .set({
                status_code:  'R',
                approvalDate: new Date().toISOString(),
                approver:     currentUserId,
            })
            .where({ ID });

        return SELECT.one.from(Request).where({ ID });
    };

    /** Runs on draft activation (Fiori "Save" button). Validates, checks attachments, runs AI compliance, and sets status. */
    beforeSave = async (req: cds.Request) => {
        const data      = req.data as Partial<Request>;
        const requestId = data.ID;
        if (!requestId) return;

        // 1. Validate title and high-value justification threshold
        if (data.title && data.title.length < 5) {
            return req.error(400, 'TITLE_TOO_SHORT', 'title');
        }
        if (((data.totalAmount ?? 0) as number) > 5000 && !data.justification) {
            return req.error(400, 'Justification required for amounts over 5000');
        }

        // 2. Require at least one attachment before activating the draft
        const attachments = await SELECT.from(Requests.attachments.drafts)
            .where({ up__ID: requestId }) as Requests.attachment[];
        if (!attachments.length) {
            return req.error(400, 'At least one attachment is required before submitting');
        }

        // 3. AI compliance check — graceful degradation if hub is unavailable
        try {
            const agentHub = await cds.connect.to('AI_Agent_Hub');

            const analysis = await agentHub.send('analyzeDocument', {
                requestId,
                fileName:    (attachments[0] as any).filename,
                totalAmount: data.totalAmount,
            }) as AnalysisResult;

            const compliance = await agentHub.send('verifyCompliance', analysis) as ComplianceResult;

            // 4. Write AI results and derived status into the draft activation payload
            (req.data as any).aiComplianceScore = compliance.score;
            (req.data as any).aiAuditNotes      = compliance.notes;

            const decision = compliance.decision?.toUpperCase();
            if (decision === 'APPROVED') {
                (req.data as any).status_code = 'A';
            } else if (decision === 'REJECTED') {
                (req.data as any).status_code = 'R';
            } else {
                (req.data as any).status_code = 'S';
            }
        } catch (e: unknown) {
            console.warn('[AI] Agent Hub unavailable, proceeding without compliance check:',
                (e as { message?: string })?.message ?? String(e));
            (req.data as any).status_code = 'S';
        }
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

            //req.info('SUPPLIER_SAFE', undefined, [supplierLabel]);
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

    /** Generate business justification via Gemini and persist on the request draft. */
    generateAIJustification = async (req: cds.Request) => {
        const { ID: requestId } = req.params[0] as { ID: string };

        const draftItems = await cds.tx(req).run(
            SELECT.from('RequestService.Items.drafts').where({ request_ID: requestId })
        ) as Item[];

        const itemNames      = draftItems.map((item) => item.description).join(', ');
        const itemCategories = draftItems.map((item) => item.category).join(', ');

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
