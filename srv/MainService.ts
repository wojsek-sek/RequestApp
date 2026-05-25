import cds from '@sap/cds';
import { CostCenterHandler } from './handlers/CostCenterHandler';
import { ItemHandler } from './handlers/ItemHandler';
import { ProductHandler } from './handlers/ProductHandler';
import { RequestHandler } from './handlers/RequestHandler';
import { SupplierHandler } from './handlers/SupplierHandler';

export default class RequestService extends cds.ApplicationService {
    async init() {
        const costCenterApi = await cds.connect.to('API_COSTCENTER_V2');
        const bupa = await cds.connect.to('API_BUSINESS_PARTNER');
        const productApi = await cds.connect.to('API_PRODUCT_SRV');

        const requestHandler = new RequestHandler();
        const itemHandler = new ItemHandler();
        const costCenterHandler = new CostCenterHandler(costCenterApi);
        const supplierHandler = new SupplierHandler(bupa);
        const productHandler = new ProductHandler(productApi);

        // --- Requests ---
        this.before(['CREATE', 'UPDATE'], 'Requests', requestHandler.validateOnWrite);
        this.before('READ', 'Requests', requestHandler.injectStatusCodeColumn);
        this.after('READ', 'Requests', requestHandler.afterRead);
        this.before('SAVE', 'Requests', requestHandler.beforeSave);
        this.before('SAVE', 'Requests', requestHandler.validateSupplierBeforeSave);

        this.on('approveRequest', 'Requests', requestHandler.approveRequest);
        this.on('rejectRequest', 'Requests', requestHandler.rejectRequest);
        this.on('generateAIJustification', 'Requests.drafts', requestHandler.generateAIJustification);
        this.on('DELETE', 'Requests', requestHandler.softDelete);

        // --- Items (draft composition) ---
        this.after(
            ['CREATE', 'UPDATE', 'DELETE'],
            'Items.drafts',
            itemHandler.recalculateRequestTotalAfterDraftChange
        );
        this.before('PATCH', 'Items.drafts', itemHandler.patchRecalculateItemTotal);

        // --- CostCenters mashup ---
        this.on('READ', 'CostCenters', costCenterHandler.read);
        this.before('READ', 'CostCenters', costCenterHandler.beforeRead);
        this.after('READ', 'CostCenters', costCenterHandler.afterRead);

        // --- Suppliers mashup ---
        this.on('READ', 'Suppliers', supplierHandler.read);

        // --- Products mashup ---
        this.on('READ', 'Products', productHandler.read);

        return super.init();
    }
}
