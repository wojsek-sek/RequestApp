namespace capmap.db;

using { cuid, managed, sap.common.CodeList } from '@sap/cds/common';

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
// By adding 'ApprovalTracking', the Requests entity inherits its fields
entity Requests : cuid, managed, ApprovalTracking {
    title        : String(100)  @title: 'Request Title';
    totalAmount  : Decimal(15, 2) @title: 'Total Amount';
    currency     : String(3) default 'USD' @title: 'Currency';
    costCenter   : String(10)   @title: 'Cost Center (S/4HANA)';
    
    @Common.Text           : status.name
    @Common.TextArrangement: #TextOnly
    status       : Association to Statuses default 'D' @title: 'Status';
    // Composition: Items are deleted if the Request is deleted
    items        : Composition of many Items on items.request = $self;
    region : String(2); // np. 'EU', 'US'
}

// ---------------------------------------------------------
// Request Items (Equipment / Services)
// ---------------------------------------------------------
entity Items : cuid {
    request      : Association to Requests;
    
    // Field for integrating S/4HANA Product Master Data
    productId    : String(40)   @title: 'Product ID (S/4HANA)';
    description  : String(200)  @title: 'Item Description';
    quantity     : Integer      @title: 'Quantity';
    price        : Decimal(15, 2) @title: 'Unit Price (Net)';
    category     : Association to Categories @title: 'Category';
    supplierId   : String(10) @title: 'Suggested Supplier (BP)';
    
    // Simple math expression for calculated field
    itemTotal    : Decimal(15, 2) = (quantity * price) @title: 'Item Total';
}

// ---------------------------------------------------------
// CodeLists (Dictionaries for Dropdowns)
// ---------------------------------------------------------
entity Statuses : CodeList {
    key code : String(1) enum {
        Draft     = 'D';
        Submitted = 'S';
        Approved  = 'A';
        Rejected  = 'R';
    };
    criticality : Integer = case code
        when 'A' then 3 // Green (Approved)
        when 'R' then 1 // Red (Rejected)
        when 'S' then 2 // Yellow (Submitted)
        else 0          // Grey (Draft / Unknown)
    end @title: 'Criticality';
}

entity Categories : CodeList {
    key code : String(2) enum {
        IT        = 'IT'; // Computers, Servers
        Furniture = 'FU'; // Office Furniture
        Machinery = 'MA'; // Machines
        Software  = 'SW'; // Licenses
    };
}