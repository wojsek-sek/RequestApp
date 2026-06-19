import RequestService from '#cds-models/RequestService';
import cds from '@sap/cds';

/**
 * Draft line items: derived totals on PATCH and header {@link RequestService.Requests.totalAmount} after item changes.
 */
export class ItemHandler {
    /** After item draft CUD, recompute parent request draft totalAmount. */
    recalculateRequestTotalAfterDraftChange = async (_: unknown, req: cds.Request) => {
        const itemKey: any = req.params?.[0] || {};
        const requestId: string | undefined =
            (req.data as any)?.request_ID ??
            (req.data as any)?.request?.ID ??
            itemKey.request_ID;

        if (!requestId) return;

        const draftItems = await SELECT.from('RequestService.Items.drafts').where({
            request_ID: requestId,
        });
        const totalAmount = (draftItems as any[]).reduce((sum, item) => {
            const quantity = Number(item.quantity) || 0;
            const price = Number(item.price) || 0;
            return sum + quantity * price;
        }, 0);

        await UPDATE('RequestService.Requests.drafts')
            .set({ totalAmount: Number(totalAmount.toFixed(2)) })
            .where({ ID: requestId });
    };

    /**
     * Populate the virtual `isEditable` flag on each item row.
     *
     * Mirrors the parent request's editability rule: RegionalManager + status N.
     * The flag is duplicated on Items (rather than read only from the parent) so
     * the parent's `UI.UpdateHidden: { $Path: 'isEditable' }` resolves cleanly
     * when Fiori propagates the path into the items composition (otherwise the
     * OData parser rejects `Requests:items.isEditable` with a 404).
     */
    afterRead = (results: unknown, req: cds.Request) => {
        const isManager = cds.context?.user?.is('RegionalManager');
        const items = Array.isArray(results) ? results : [results];
        for (const item of items) {
            if (!item || !(item as any).ID) continue;
            (item as any).isEditable = !!(isManager && (item as any).status_code === 'N');
        }
    };

    /**
     * Ensure `status_code` and `isEditable` are present in every items $select.
     *
     * Fiori only requests rendered columns; the virtual `isEditable` (used by
     * propagated UpdateHidden) and the underlying `status_code` it depends on
     * are never added automatically. Without injection `afterRead` would have
     * no `status_code` to evaluate.
     */
    injectRequiredColumns = (req: cds.Request): void => {
        const query = req.query?.SELECT;
        if (!query?.columns) return;
        const cols = query.columns as Array<{ ref?: string[] }>;
        const has  = (name: string) => cols.some(c => c.ref?.at(-1) === name);
        for (const field of ['status_code', 'isEditable'] as const) {
            if (!has(field)) cols.push({ ref: [field] });
        }
    };

    /** Compute itemTotal on CREATE and merge with server-side values on PATCH (delta-friendly). */
    calculateItemTotal = async (req: cds.Request) => {
        if (!('quantity' in (req.data as any)) && !('price' in (req.data as any))) {
            return;
        }

        const itemKeys = req.params[req.params.length - 1];
        const dbItem = itemKeys?.ID
            ? await cds.tx(req).run(SELECT.one.from(req.target as any).where({ ID: itemKeys.ID }))
            : null;

        let newQty = 'quantity' in (req.data as any) ? (req.data as any).quantity : (dbItem as any)?.quantity;
        let newPrice = 'price' in (req.data as any) ? (req.data as any).price : (dbItem as any)?.price;

        newQty = Number(newQty) || 0;
        newPrice = Number(newPrice) || 0;

        (req.data as any).itemTotal = newQty * newPrice;
    };
}
