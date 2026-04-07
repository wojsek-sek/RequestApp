using { capmap.db as my } from '../db/schema';
using { sap.common.Currencies as CommonCurrencies } from '@sap/cds/common.cds';

// Import V2 API (Cost Centers)
using { API_COSTCENTER_V2 as extV2 } from './external/API_COSTCENTER_V2';
// Import V4 API (Business Partners)
using { PACBusinessPartner as extV4 } from './external/API_BUSINESS_PARTNER_V4';

@requires: 'authenticated-user'
@path: '/service/request'   
service RequestService {

    // Expose the main Requests entity with Fiori Draft handling enabled
    // This allows users to save requests as drafts before submitting
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
    @odata.draft.enabled
    entity Requests as projection on my.Requests;

    // Expose the Items entity
    // Note: No need for @odata.draft.enabled here, as Items are linked 
    // to Requests via 'Composition' and are handled automatically
    entity Items as projection on my.Items;

    // CodeLists (Dictionaries) - these should be strictly read-only for the UI
    // We don't want business users modifying statuses or categories via API
    @readonly
    entity Statuses as projection on my.Statuses;

    entity Categories as projection on my.Categories;

    @readonly
    entity Currencies as projection on CommonCurrencies;

    @readonly
    entity CostCenterTexts as projection on extV2.A_CostCenterText;

    @readonly
    entity CostCenters as projection on extV2.A_CostCenter {
        key CostCenter,
        CompanyCode,
        to_Text
    };

    // --- MASHUP 2: OData V4 (Business Partners) ---
    @readonly
    entity Suppliers as projection on extV4.BusinessPartners {
        key businessPartnerNumber as ID, // Alias for standardisation
        businessPartnerName1 @UI.Hidden,
        businessPartnerName2 @UI.Hidden,
        virtual Name : String,
        vendorCode as Code
    };

}   