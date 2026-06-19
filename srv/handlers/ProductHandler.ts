import cds from '@sap/cds';

const LOG = cds.log('products');

/** Mashup: Products from S/4 with localized Description from to_Description expand. */
export class ProductHandler {
    constructor(private readonly productApi: any) {}

    read = async (req: cds.Request) => {
        const incomingSel = req.query?.SELECT;
        const userLang =
            typeof req.locale === 'string' ? req.locale.split('-')[0]!.toUpperCase() : 'EN';

        const query: any = (SELECT as any).from('API_PRODUCT_SRV.A_Product').columns(
            'Product',
            'ProductType',
            'NetWeight',
            { ref: ['to_Description'], expand: ['*'] }
        );

        if (incomingSel?.limit !== undefined) {
            query.SELECT.limit = incomingSel.limit;
        }
        if (incomingSel?.where) {
            const whereStr = JSON.stringify(incomingSel.where);
            if (!whereStr.includes('Description')) {
                query.SELECT.where = incomingSel.where;
            }
        }

        const descRowsFromExpand = (toDesc: any): any[] => {
            if (!toDesc) return [];
            if (Array.isArray(toDesc)) return toDesc;
            if (Array.isArray(toDesc.results)) return toDesc.results;
            if (typeof toDesc === 'object' && 'Language' in toDesc && 'ProductDescription' in toDesc) {
                return [toDesc];
            }
            return [];
        };

        const pickProductDescription = (rows: any[]): string => {
            if (!rows.length) return '';
            const byLang = rows.find((d) => d.Language === userLang);
            const byEn = rows.find((d) => d.Language === 'EN');
            return (
                byLang?.ProductDescription ??
                byEn?.ProductDescription ??
                rows[0].ProductDescription ??
                ''
            );
        };

        try {
            const results: any[] = await this.productApi.tx(req).run(query);

            return results.map((item) => ({
                ID: item.Product,
                Type: item.ProductType,
                NetWeight: item.NetWeight,
                Description: pickProductDescription(descRowsFromExpand(item.to_Description)),
            }));
        } catch (err) {
            LOG.error('Error fetching Products from S/4HANA:', err);
            return req.reject(502, 'PRODUCT_FETCH_ERROR');
        }
    };
}
