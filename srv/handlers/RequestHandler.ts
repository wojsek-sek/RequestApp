import cds from '@sap/cds';
import { Item, Requests } from '#cds-models/RequestService';
import { executeHttpRequest } from '@sap-cloud-sdk/http-client';
import { GoogleGenAI } from '@google/genai';
import { PROMPTS } from '../utils/PromptTemplates';

/** Requests entity: validation, bound actions, draft save supplier check. */
export class RequestHandler {
    private criticalityFromStatusCode(code?: string): number {
        switch (code) {
            case 'A':
                return 3;
            case 'R':
                return 1;
            case 'S':
                return 2;
            default:
                return 0;
        }
    }

    /** Keep statusCriticality in sync when status is set on create/update. */
    syncStatusCriticality = (req: cds.Request) => {
        const data: any = req.data || {};
        const code: string | undefined =
            data.status_code ?? data.status?.code ?? data.status ?? undefined;
        if (code) {
            data.statusCriticality = this.criticalityFromStatusCode(code);
        }
    };

    /** Title length, justification for high amounts, positive total. */
    validateOnWrite = async (req: cds.Request) => {
        const { totalAmount, justification, title } = req.data as any;

        if (title && title.length < 5) {
            return req.error(400, 'TITLE_TOO_SHORT', 'title');
        }

        if (totalAmount > 1000 && !justification) {
            return req.error(400, 'JUSTIFICATION_REQUIRED_FOR_HIGH_AMOUNT', 'justification');
        }

        if (totalAmount <= 0) {
            return req.error(400, 'AMOUNT_MUST_BE_POSITIVE', 'totalAmount');
        }
    };

    /** Ensure status_code is selected when Fiori sends a column list. */
    injectStatusCodeColumn = (req: cds.Request) => {
        const query = req.query.SELECT;
        if (query && query.columns) {
            const hasStatusCode = query.columns.some(
                (col: any) => col.ref && col.ref.includes('status_code')
            );
            if (!hasStatusCode) {
                query.columns.push({ ref: ['status_code'] });
            }
        }
    };

    approveRequest = async (req: cds.Request) => {
        const keys = req.params[0];
        const currentUserId = req.user.id;

        await UPDATE(Requests)
            .set({
                status_code: 'A',
                approvalDate: new Date().toISOString(),
                approver: currentUserId,
            })
            .where(keys);

        return SELECT.one.from(Requests).where(keys);
    };

    rejectRequest = async (req: cds.Request) => {
        const keys = req.params[0];
        const currentUserId = req.user.id;

        await UPDATE(Requests)
            .set({
                status_code: 'R',
                approvalDate: new Date().toISOString(),
                approver: currentUserId,
            })
            .where(keys);

        return SELECT.one.from(Requests).where(keys);
    };

    submitRequest = async (req: cds.Request) => {
        const keys = req.params[0];
        const currentUserId = req.user.id;

        // Fetch the active record to inspect attachment and current fields
        const current = await SELECT.one.from(Requests).where(keys) as any;

        if (!current?.attachment) {
            return req.error(400, 'ATTACHMENT_REQUIRED_BEFORE_SUBMIT', 'attachment');
        }

        // Run AI agent pipeline before changing status
        const agentHub = await cds.connect.to('AI_Agent_Hub');

        const analysis = await agentHub.send('analyzeDocument', {
            requestId:   current.ID,
            fileName:    current.fileName,
            totalAmount: current.totalAmount,
        }) as any;

        const compliance = await agentHub.send('verifyCompliance', analysis) as any;

        // Persist AI outputs together with the status transition
        await UPDATE(Requests)
            .set({
                status_code:       'S',
                approvalDate:      new Date().toISOString(),
                approver:          currentUserId,
                aiComplianceScore: compliance.score,
                aiAuditNotes:      compliance.notes,
            })
            .where(keys);

        return SELECT.one.from(Requests).where(keys);
    };

    /** Supplier existence and block check against S/4HANA before activating draft. */
    validateSupplierBeforeSave = async (req: cds.Request) => {
        const itemKey: any = req.params?.[0] || {};
        const requestId: string | undefined = (req.data as any)?.ID ?? itemKey.request_ID;

        if (!requestId) return;

        const firstItem = (await SELECT.one
            .from('RequestService.Items.drafts')
            .where({ request_ID: requestId })) as Item;

        if (!firstItem?.supplierId) {
            req.warn('NO_SUPPLIER_TO_VALIDATE');
            return;
        }

        try {
            console.log(`[SDK] Validating supplier: ${firstItem.supplierId}...`);

            const response = await executeHttpRequest(
                { destinationName: 'S4HANA_DESTINATION' },
                {
                    method: 'GET',
                    url: `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier('${firstItem.supplierId}')`,
                    headers: { Accept: 'application/json' },
                }
            );

            const supplierData = response.data.d;
            const supplierLabel = supplierData.SupplierName || firstItem.supplierId;

            if (supplierData.DeletionIndicator === true) {
                return req.error(400, 'SUPPLIER_BLOCKED', 'supplierId', [supplierLabel]);
            }

            req.info('SUPPLIER_SAFE', undefined, [supplierLabel]);
        } catch (error: any) {
            console.error('[SDK ERROR] Failed to connect to S/4HANA:', error.message);
            if (error.response?.status === 404) {
                req.error(400, 'SUPPLIER_NOT_FOUND', undefined, [firstItem.supplierId]);
            } else {
                req.error(500, 'CLOUD_SDK_ERROR');
            }
        }
    };

    /** Generate business justification via Gemini and persist on the request draft. */
    generateAIJustification = async (req: cds.Request) => {
        const requestId = req.params[0].ID;

        const draftItems = await cds.tx(req).run(
            SELECT.from('RequestService.Items.drafts').where({ request_ID: requestId })
        );

        const itemNames = draftItems.map((item: Item) => item.description).join(', ');
        const itemCategories = draftItems.map((item: Item) => item.category).join(', ');

        if (!itemNames) {
            return req.error(400, 'AI_ITEMS_REQUIRED');
        }

        const currentLocale = req.locale || 'en';
        const promptText = PROMPTS.GENERATE_JUSTIFICATION(itemNames, itemCategories, currentLocale);

        try {
            const ai = new GoogleGenAI({
                apiKey: process.env['GEMINI_API_KEY'],
            });

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: promptText,
            });

            const aiGeneratedText = response.text;

            await cds.tx(req).run(
                UPDATE('RequestService.Requests.drafts')
                    .set({ justification: aiGeneratedText })
                    .where({ ID: requestId })
            );

            req.info('AI_JUSTIFICATION_SUCCESS');
        } catch (error) {
            console.error('[AI] Generation failed:', error);
            req.error(500, 'AI_GENERATION_ERROR');
        }
    };
}
