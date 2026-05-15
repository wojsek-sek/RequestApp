import cds from '@sap/cds';

/** Mashup: Cost Centers from S/4 V2 + virtual Name/Description from to_Text. */
export class CostCenterHandler {
    constructor(private readonly costCenterApi: any) {}

    read = async (req: cds.Request) => {
        try {
            return await this.costCenterApi.run(req.query);
        } catch (error) {
            console.error('[Mock/API Error] CostCenters:', (error as Error).message);
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

    afterRead = (each: any, req: cds.Request) => {
        if (!each) return;

        if (each.to_Text && each.to_Text.length > 0) {
            const userLocale = req.locale || 'en';
            const sapLang = userLocale.substring(0, 2).toUpperCase();

            const textRecord =
                each.to_Text.find((t: any) => t.Language === sapLang) ||
                each.to_Text.find((t: any) => t.Language === 'EN') ||
                each.to_Text[0];

            each.Name = textRecord.CostCenterName;
            each.Description = textRecord.CostCenterDescription;
        }
    };
}
