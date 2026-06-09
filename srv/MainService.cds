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
        // Viewer: read-only access (no region filter)
        { grant: 'READ', to: 'Viewer' },
        
        // RegionalManager: full CRUD within the user's region only
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
        status.name as statusText : String,
        virtual isApprover : Boolean,   // SoD: true when user can approve/reject (RegionalManager, not creator, status=S)
        virtual isEditable : Boolean,   // true when user has RegionalManager role AND status is N (Draft)
        // Day-granularity created date. The raw `createdAt` is a microsecond Timestamp, so
        // grouping/filtering on it yields one point per request and exact-instant equality that
        // never matches. `createdDate` truncates to the day so the analytic time filter groups by
        // day and `createdDate eq <day>` matches every request from that day.
        date(createdAt) as createdDate : Date,
        *
    } actions {
        // Submit a New request — validates attachment, runs AI compliance, sets status N→S.
        //
        // NOTE on draft handling:
        //   This action is intentionally NOT annotated with `@odata.draft.bypass` and is
        //   registered only on the active entity (`Requests`, not `Requests.drafts`).
        //   Fiori Elements then follows its standard "save-then-call" choreography when
        //   the user triggers Submit from edit mode:
        //     1. Fiori first issues `draftActivate` on the draft → CAP fires our
        //        before('SAVE','Requests') validations (title/justification/supplier) and
        //        commits the draft to the active entity.
        //     2. The page binding moves from the draft URL to the active URL.
        //     3. Only then does Fiori call `submitRequest` on the (now-active) entity.
        //     4. `TargetEntities:['']` refreshes the active URL — which still exists — so
        //        the resulting GET succeeds and no 404 is raised.
        //   Doing the draft-activate manually inside the handler (with `@odata.draft.bypass`)
        //   leaves Fiori bound to the deleted draft URL and produces a 404 on refresh.
        @Common.IsActionCritical: true
        @Common.SideEffects: {
            TargetProperties: ['status_code', 'aiComplianceScore', 'aiAuditNotes'],
            TargetEntities  : ['']
        }
        action submitRequest() returns Requests;

        @Common.IsActionCritical: true
        @Common.SideEffects: {
            TargetProperties: ['status_code', 'approvalDate', 'approver'],
            TargetEntities  : ['']
        }
        action approveRequest() returns Requests;

        @Common.SideEffects: {
            TargetProperties: ['status_code', 'approvalDate', 'approver', 'rejectReason'],
            TargetEntities  : ['']
        }
        action rejectRequest(reason : String) returns Requests;

        // Cancel a request (New or Submitted only) — sets status to C, preserves audit trail
        @Common.IsActionCritical: true
        @Common.SideEffects: {
            TargetProperties: ['status_code', 'cancelReason', 'approvalDate', 'approver'],
            TargetEntities  : ['']
        }
        action cancelRequest(reason : String) returns Requests;

        // Withdraw a Submitted request back to New so the requester can edit and re-submit
        @Common.IsActionCritical: true
        @Common.SideEffects: {
            TargetProperties: ['status_code', 'approver', 'approvalDate'],
            TargetEntities  : ['']
        }
        action withdrawRequest() returns Requests;

        // Bound action: generate business justification for the current request draft
        @cds.odata.bindingparameter.name : '_it'
        @Core.OperationAvailable : { $edmJson: { $Eq: [{ $Path: '_it/IsActiveEntity' }, false] } } // Available only while editing (draft)
        action generateAIJustification();

        //action verifySupplierRisk() returns String; 
    };

    // Expose the Items entity
    // Note: No need for @odata.draft.enabled here, as Items are linked
    // to Requests via 'Composition' and are handled automatically
    //
    // `isEditable` is duplicated on Items so the parent's UI.UpdateHidden path
    // (`{ $Path: 'isEditable' }`) resolves cleanly when Fiori propagates the
    // expression into the items composition during edit/expand. Without this,
    // requests like `Requests(ID)/items?$select=isEditable` produce a 404
    // "Invalid resource path Requests:items.isEditable" from the OData parser.
    entity Items as projection on my.Items {
        *,
        request.status.code as status_code,
        virtual isEditable  : Boolean
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

// OData V4 aggregation for analytical charts on the list report
annotate RequestService.Requests with @(
    Aggregation.ApplySupported: {
        Transformations: [
            'aggregate',
            'topcount',
            'bottomcount',
            'identity',
            'concat',
            'groupby',
            'filter',
            'search',
        ],
        GroupableProperties: [status_code, costCenter, currency, statusText, createdAt, createdDate],
        AggregatableProperties: [
            {
                Property: totalAmount,
                SupportedAggregationMethods: ['sum', 'min', 'max'],
            },
            {
                Property: ID,
                SupportedAggregationMethods: ['countdistinct'],
            },
        ],
    },
    Analytics.AggregatedProperty #TotalAmountSum: {
        Name: 'TotalAmountSum',
        AggregationMethod: 'sum',
        AggregatableProperty: totalAmount,
        @Common.Label: '{i18n>TotalAmountSum}',
    },
    Analytics.AggregatedProperty #RequestCount: {
        Name: 'RequestCount',
        AggregationMethod: 'countdistinct',
        AggregatableProperty: ID,
        @Common.Label: '{i18n>RequestCount}',
    },
);
        