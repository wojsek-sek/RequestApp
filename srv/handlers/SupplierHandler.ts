import cds from '@sap/cds';

/** Mashup: Suppliers from S/4 Business Partner API (read-through). */
export class SupplierHandler {
    constructor(private readonly bupa: any) {}

    read = async (req: cds.Request) => {
        try {
            return await this.bupa.tx(req).run(req.query);
        } catch (err) {
            console.error('Error fetching Suppliers from S/4HANA:', err);
            req.reject(502, 'SUPPLIERS_FETCH_ERROR');
        }
    };
}
