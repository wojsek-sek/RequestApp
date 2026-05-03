using { capmap.db as my } from '../db/schema';
using { sap.common.Currencies as CommonCurrencies } from '@sap/cds/common.cds';

// Import V2 API (Cost Centers)
using { API_COSTCENTER_V2 as extV2 } from './external/API_COSTCENTER_V2';
// Import V2 API (Business Partners)
using { API_BUSINESS_PARTNER as externalBP } from './external/API_BUSINESS_PARTNER';
// Import Product API
using { API_PRODUCT_SRV as extProduct } from './external/API_PRODUCT_SRV';


@requires: 'authenticated-user'
@path: '/service/request'   
service RequestService {

    @restrict: [
        // 1. Viewer może CZYTAĆ wszystko (brak warunku 'where')
        { grant: 'READ', to: 'Viewer' },
        
        // 2. RegionalManager może robić WSZYSTKO (CRUD), ale TYLKO w swoim regionie
        { 
            grant: '*', 
            to: 'RegionalManager', 
            where: 'region = $user.Region' 
        }
    ]
    // Expose the main Requests entity with Fiori Draft handling enabled
    // This allows users to save requests as drafts before submitting
    //@UI.UpdateHidden: isReadOnly
    //@UI.DeleteHidden: isReadOnly
    @odata.draft.enabled
    entity Requests as projection on my.Requests {
        *,
        // virtual isActionable : Boolean @UI.Hidden,
        // virtual isReadOnly : Boolean @UI.Hidden
    } actions {
        @Common.IsActionCritical: true
        @Common.SideEffects: {
            TargetProperties: [
                'status_code',
                'approvalDate',
                'approver'
            ]
        }
        action approveRequest() returns Requests;
        //@Core.OperationAvailable: in.isActionable
        @Common.SideEffects: {
            TargetProperties: [
                'status_code',
                'approvalDate',
                'approver'
            ]
        }
        action rejectRequest() returns Requests;

        @Common.SideEffects: {
            TargetProperties: [
                'status_code',
                'approvalDate',
                'approver'
            ]
        }
        action submitRequest() returns Requests; 

        //action verifySupplierRisk() returns String; 
    };

    // Expose the Items entity
    // Note: No need for @odata.draft.enabled here, as Items are linked 
    // to Requests via 'Composition' and are handled automatically
    entity Items as projection on my.Items {
        *,
        request.status.code as status_code
    };

    // CodeLists (Dictionaries) - these should be strictly read-only for the UI
    // We don't want business users modifying statuses or categories via API
    @readonly
    entity Statuses as projection on my.Statuses;

    @readonly
    entity Categories as projection on my.Categories;

    @readonly
    entity Currencies as projection on CommonCurrencies;

    @readonly
    entity CostCenterTexts as projection on extV2.A_CostCenterText;

    @readonly
    entity CostCenters as projection on extV2.A_CostCenter {
        @title : '{i18n>CostCenter}'
        key CostCenter,
        @title : '{i18n>CompanyCode}'
        CompanyCode,
        @title : '{i18n>Name}'
        virtual Name : String(20),
        @title : '{i18n>Description}'
        virtual Description : String(40),
        @UI.Hidden
        to_Text
    };

    // --- MASHUP 2: OData V4 (Business Partners) ---
    @readonly
    entity Suppliers as projection on externalBP.A_Supplier {
        key Supplier as ID,
        @title : '{i18n>SupplierName}'
        SupplierName
        //to_SupplierCompany.CompanyCode as CompanyCode
    };

    @readonly
    entity Products as projection on extProduct.A_Product {
        key Product as ID,
        ProductType as Type,
        NetWeight,
        virtual null as Description : String(255)
    };
}   