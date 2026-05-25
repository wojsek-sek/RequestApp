namespace capmap.db;

using { cuid, managed, sap.common.CodeList } from '@sap/cds/common';
using { Attachments } from '@cap-js/attachments';

// ---------------------------------------------------------
// Custom Aspect: Reusable block of fields for approvals
// ---------------------------------------------------------
aspect ApprovalTracking {
    approver     : String(100) @title: 'Approver ID';
    approvalDate : DateTime    @title: 'Approval Date';
    justification: String(500) @title: 'Business Justification';
}

// ---------------------------------------------------------
// CapEx Request Header
// ---------------------------------------------------------
entity Requests : cuid, managed, ApprovalTracking {
    title        : String(100)  @title: 'Request Title' @mandatory;
    totalAmount  : Decimal(15, 2) @title: 'Total Amount';
    currency     : String(3) default 'USD' @title: 'Currency';
    costCenter   : String(10)   @title: 'Cost Center (S/4HANA)';

    @Common.Text           : status.name
    @Common.TextArrangement: #TextOnly
    status       : Association to Statuses default 'N' @title: 'Status';
    items        : Composition of many Items on items.request = $self;
    region       : String(2);

    attachments       : Composition of many Attachments;

    aiComplianceScore : Integer;
    aiAuditNotes      : String;

    // Workflow reason fields — populated by the corresponding bound action
    rejectReason  : String(500) @title: 'Rejection Reason';
    cancelReason  : String(500) @title: 'Cancellation Reason';
}

// ---------------------------------------------------------
// Request Items
// ---------------------------------------------------------
entity Items : cuid {
    request      : Association to Requests;
    productId    : String(40)   @title: 'Product ID (S/4HANA)';
    description  : String(200)  @title: 'Item Description';
    quantity     : Integer      @title: 'Quantity' @mandatory;
    price        : Decimal(15, 2) @title: 'Unit Price (Net)' @mandatory;
    category     : Association to Categories @title: 'Category';
    supplierId   : String(10) @title: 'Suggested Supplier (BP)' @mandatory;
    itemTotal    : Decimal(15, 2) @title: 'Item Total';
}

// ---------------------------------------------------------
// CodeLists
// ---------------------------------------------------------
entity Statuses : CodeList {
    key code : String(1) enum {
        New       = 'N';
        Submitted = 'S';
        Approved  = 'A';
        Rejected  = 'R';
        Cancelled = 'C';
    };
    criticality : Integer = case code
        when 'A' then 3
        when 'R' then 1
        when 'S' then 5
        when 'C' then 2
        else 0
    end @title: 'Criticality';
}

entity Categories : CodeList {
    key code : String(2) enum {
        IT        = 'IT';
        Furniture = 'FU';
        Machinery = 'MA';
        Software  = 'SW';
    };
}
