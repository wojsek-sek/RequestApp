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

    /** Merge PATCH for quantity/price with server-side itemTotal (delta-friendly). */
    patchRecalculateItemTotal = async (req: cds.Request) => {
        if (!('quantity' in (req.data as any)) && !('price' in (req.data as any))) {
            return;
        }

        const itemKeys = req.params[req.params.length - 1];
        const dbItem = await cds.tx(req).run(
            SELECT.one.from(req.target as any).where({
                ID: itemKeys.ID,
            })
        );

        if (!dbItem) return;

        let newQty = 'quantity' in (req.data as any) ? (req.data as any).quantity : (dbItem as any).quantity;
        let newPrice = 'price' in (req.data as any) ? (req.data as any).price : (dbItem as any).price;

        newQty = Number(newQty) || 0;
        newPrice = Number(newPrice) || 0;

        (req.data as any).itemTotal = newQty * newPrice;
    };
}
