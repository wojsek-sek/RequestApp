import cds from '@sap/cds';

const LOG = cds.log('costcenters');

/** Mashup: Cost Centers from S/4 V2 + virtual Name/Description from to_Text. */
export class CostCenterHandler {
    constructor(private readonly costCenterApi: any) {}

    read = async (req: cds.Request) => {
        try {
            return await this.costCenterApi.run(req.query);
        } catch (error) {
            LOG.error('CostCenters fetch failed, returning mock fallback:', (error as Error).message);
            return [
                { CostCenter: '1000000001', CompanyCode: '1000' },
                { CostCenter: '1000000002', CompanyCode: '1000' },
                { CostCenter: '2000000001', CompanyCode: '2000' },
            ];
        }
    };

    beforeRead = (req: cds.Request) => {
        const query = req.query.SELECT;
        if (query && query.columns) {
            const hasToText = query.columns.some(
                (col: any) => col.ref && col.ref.includes('to_Text')
            );
            if (!hasToText) {
                query.columns.push({ ref: ['to_Text'], expand: ['*' as any] });
            }
        }
    };

    // CAP (cds 7+) always passes the full result set as an array to after('READ') handlers,
    // so we normalize and iterate — matching RequestHandler/ItemHandler. Treating the argument
    // as a single row left Name/Description unpopulated (the array has no `to_Text`).
    afterRead = (results: any, req: cds.Request) => {
        const rows = Array.isArray(results) ? results : [results];
        const sapLang = (req.locale || 'en').substring(0, 2).toUpperCase();

        for (const each of rows) {
            if (!each?.to_Text?.length) continue;

            const textRecord =
                each.to_Text.find((t: any) => t.Language === sapLang) ||
                each.to_Text.find((t: any) => t.Language === 'EN') ||
                each.to_Text[0];

            each.Name = textRecord.CostCenterName;
            each.Description = textRecord.CostCenterDescription;
        }
    };
}
