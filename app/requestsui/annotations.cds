using RequestService as service from '../../srv/MainService';

annotate service.Requests with @(
    UI.FieldGroup #GeneratedGroup : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : approver,
            },
            {
                $Type : 'UI.DataField',
                Value : approvalDate,
            },
            {
                $Type : 'UI.DataField',
                Value : title,
            },
            {
                $Type : 'UI.DataField',
                Value : totalAmount,
            },
            {
                $Type : 'UI.DataField',
                Value : currency,
            },
            {
                $Type : 'UI.DataField',
                Value : costCenter,
            },
            {
                $Type : 'UI.DataField',
                Label : '{i18n>Status}',
                Value : status_code,
                Criticality : status.criticality,
                CriticalityRepresentation : #WithoutIcon
            },
            {
                $Type : 'UI.DataField',
                Value : rejectReason,
                Label : '{i18n>RejectReason}',
                // Only visible when status is Rejected
                ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'status_code' }, 'R'] } },
            },
            {
                $Type : 'UI.DataField',
                Value : cancelReason,
                Label : '{i18n>CancelReason}',
                // Only visible when status is Cancelled
                ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'status_code' }, 'C'] } },
            },
        ],
    },
    UI.FieldGroup #JustificationGroup : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                @UI.MultiLineText: true,
                @HTML5.CssDefaults: {width: '100%'},
                Value : justification,
            }
        ],
    },

    // DataPoint for aiComplianceScore with 3-tier criticality via CriticalityCalculation:
    //   score < 50  → Negative  (red,    1)
    //   score 50-79 → Critical  (orange, 2)
    //   score >= 80 → Positive  (green,  3)
    UI.DataPoint #AIScoreDataPoint : {
        Value : aiComplianceScore,
        Title : '{i18n>AIComplianceScore}',
        Criticality: {
        $edmJson: {
            $If: [
                { $Ge: [{ $Path: 'aiComplianceScore' }, 80] },
                3, // Positive (Green)
                {
                    $If: [
                        { $Lt: [{ $Path: 'aiComplianceScore' }, 50] },
                        1, // Negative (Red)
                        2  // Critical/Warning (Orange)
                    ]
                }
                ]   
            }
        }
    },

    // AI Audit Results — hidden while Draft, shown after submission.
    UI.FieldGroup #AIAuditResultsGroup : {
        $Type : 'UI.FieldGroupType',
        Label : '{i18n>AIAuditResults}',
        Data : [
            {
                $Type  : 'UI.DataFieldForAnnotation',
                Target : '@UI.DataPoint#AIScoreDataPoint',
                Label  : '{i18n>ComplianceScore}',
            },
            {
                $Type : 'UI.DataField',
                Value : aiAuditNotes,
                Label : '{i18n>AuditNotes}',
            },
        ],
    },

    UI.Facets : [
        {
            // 1 — always visible
            $Type : 'UI.ReferenceFacet',
            ID    : 'GeneratedFacet1',
            Label : '{i18n>GeneralInfo}',
            Target : '@UI.FieldGroup#GeneratedGroup',
        },
        {
            // 2 — always visible
            $Type : 'UI.ReferenceFacet',
            ID    : 'JustificationGroup1',
            Label : '{i18n>Justification}',
            Target : '@UI.FieldGroup#JustificationGroup',
        },
        {
            // 5 — hidden while New; visible after Submit / Approve / Reject
            $Type : 'UI.ReferenceFacet',
            ID    : 'AIAuditResultsFacet',
            Label : '{i18n>AuditScore}',
            Target : '@UI.FieldGroup#AIAuditResultsGroup',
            ![@UI.Hidden] : {$edmJson: {$Eq: [{$Path: 'status_code'}, 'N']}},
        },
        {
            // 3 — always visible
            $Type : 'UI.CollectionFacet',
            ID    : 'AttachmentsFacet',
            Label : '{i18n>Attachments}',
            Facets : [
                {
                    $Type : 'UI.ReferenceFacet',
                    ID    : 'AttachmentsTableFacet',
                    Target : 'attachments/@UI.LineItem',
                },
            ],
        },
        {
            // 4 — always visible
            $Type : 'UI.CollectionFacet',
            ID    : 'RequestItemsFacet',
            Label : '{i18n>RequestItemsSection}',
            Facets : [
                {
                    $Type : 'UI.ReferenceFacet',
                    ID    : 'ItemsTableFacet',
                    Target : 'items/@UI.LineItem',
                },
            ],
        }
    ],
    
    UI.SelectionFields: [
        status_code,
        costCenter,
        title,
        approvalDate,
        justification,
        totalAmount,
        createdAt,   // time-based dimension for the Line chart visual filter
    ],
    
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Value : title,
            Label : '{i18n>Title1}',
        },
        {
            $Type : 'UI.DataField',
            Value : approvalDate,
            Label : '{i18n>ApprovalDate}',
        },
        {
            $Type : 'UI.DataField',
            Value : justification,
            Label : '{i18n>BusinessJustification}',
        },
        {
            $Type : 'UI.DataField',
            Value : totalAmount,
            Label : '{i18n>Amount}',
        },
        {
           $Type : 'UI.DataField',
            Label : '{i18n>Status}',
            Value : status_code,
            Criticality : status.criticality,
            CriticalityRepresentation : #OnlyIcon,
            @UI.Importance    : #High,
            @HTML5.CssDefaults: {width: '10em'},
        },
    ],
    Common.SemanticKey : [title],
    UI.HeaderInfo : {
        TypeName       : '{i18n>Request}',
        TypeNamePlural : '{i18n>Requests}',
        Title          : {
            $Type : 'UI.DataField',
            Value : title,
        },
        Description    : {
            $Type : 'UI.DataField',
            Value : justification,
        }
    },
    // Status data point for header facet
    UI.DataPoint #StatusDataPoint : {
        Value       : status_code,
        Title       : '{i18n>Status}',
        Criticality : status.criticality,
        CriticalityRepresentation : #WithoutIcon
    },

    // Total amount data point for header facet
    UI.DataPoint #TotalAmountDataPoint : {
        Value : totalAmount,
        Title : '{i18n>TotalAmount}',
    },

    // Header facets (status + amount + AI compliance score)
    UI.HeaderFacets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'StatusFacet',
            Target : '@UI.DataPoint#StatusDataPoint',
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'AmountFacet',
            Target : '@UI.DataPoint#TotalAmountDataPoint',
        },
        // Show AI compliance score in header only after submission (not while New/Draft)
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'AIScoreFacet',
            Target : '@UI.DataPoint#AIScoreDataPoint',
            ![@UI.Hidden]: { $edmJson: { $Eq: [{ $Path: 'status_code' }, 'N'] } },
        }
    ],

    UI.Identification: [
            // Submit: visible only on the ACTIVE record with status New (N).
            //   Hidden in draft (edit) mode because Submit transitions the entity out of
            //   draft — the draft row is deleted as a side effect, which leaves Fiori bound
            //   to a non-existent draft URL → "Not Found". Matching the SAP Travel-sample
            //   pattern, the user must Save the draft first; the button then appears on the
            //   active view and Submit runs on a stable URL.
            { $Type: 'UI.DataFieldForAction', Action: 'RequestService.submitRequest',
              Label: '{i18n>Submit}', Criticality: 3,
              ![@UI.Hidden]: { $edmJson: { $Or: [
                  { $Ne: [{ $Path: 'status_code' }, 'N'] },
                  { $Eq: [{ $Path: 'IsActiveEntity' }, false] }
              ]}}
            },
            // Approve/Reject: visible only when isApprover=true (RegionalManager, not the creator, status=S)
            { $Type: 'UI.DataFieldForAction', Action: 'RequestService.approveRequest', Label: '{i18n>Approve}', Criticality: 3,
              ![@UI.Hidden]: { $edmJson: { $Not: [{ $Path: 'isApprover' }] } } },
            { $Type: 'UI.DataFieldForAction', Action: 'RequestService.rejectRequest',  Label: '{i18n>Reject}',  Criticality: 1,
              ![@UI.Hidden]: { $edmJson: { $Not: [{ $Path: 'isApprover' }] } } },
            // Cancel: visible for New (N) or Submitted (S) status — replaces the Delete button
            { $Type: 'UI.DataFieldForAction', Action: 'RequestService.cancelRequest',  Label: '{i18n>Cancel}',  Criticality: 0,
              ![@UI.Hidden]: { $edmJson: { $And: [
                  { $Ne: [{ $Path: 'status_code' }, 'N'] },
                  { $Ne: [{ $Path: 'status_code' }, 'S'] }
              ]}}},
            // Withdraw: visible only when status is Submitted (S) — sends back to New for editing
            { $Type: 'UI.DataFieldForAction', Action: 'RequestService.withdrawRequest', Label: '{i18n>Withdraw}', Criticality: 0,
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'status_code' }, 'S'] } }
            },
            {
                $Type: 'UI.DataFieldForAction',
                Action: 'RequestService.generateAIJustification',
                Label: '{i18n>AutoJustify}',
                IconUrl: 'sap-icon://ai'
            }
    ],

    // Edit/Delete hidden unless isEditable = true (RegionalManager + status N).
    // This covers two cases in one field:
    //   - Viewer (readonly-user): isEditable is always false → buttons never appear
    //   - RegionalManager viewing a Submitted/Approved/Rejected request: status ≠ N → false
    //
    // NOTE: We deliberately do NOT use Capabilities.UpdateRestrictions with $Path:'isEditable'.
    //   1. isEditable is undefined on draft reads (handler registered on 'Requests', not 'Requests.drafts')
    //      → Updatable evaluates to falsy in edit mode → all fields become read-only.
    //   2. OData propagates the path to the items composition when re-reading after a side-effect
    //      → URL parser emits: Invalid resource path "Requests:items.isEditable".
    // The Edit button is gated by UI.UpdateHidden above; bypass PATCH is blocked server-side by
    // RequestHandler.beforeUpdate.
    UI.UpdateHidden : { $edmJson: { $Not: [{ $Path: 'isEditable' }] } },
    UI.DeleteHidden : true
);

// Value helps + UI behavior
annotate service.Requests with {
    createdAt  @UI.HiddenFilter: false;
    createdBy  @UI.Hidden;
    modifiedAt @UI.Hidden;
    modifiedBy @UI.Hidden;
    region @UI.Hidden;
    ID @UI.Hidden;

    status @readonly;
    status_code @readonly;
    approver    @readonly;
    approvalDate @readonly;
    totalAmount @readonly;
    rejectReason @readonly;
    cancelReason @readonly;

    justification @UI.MultiLineText: true;

    costCenter @(
        Common.Label: '{i18n>CostCenter}',
        Common.ValueList: {
            $Type : 'Common.ValueListType',
            CollectionPath : 'CostCenters',
            Parameters : [
                {
                    $Type : 'Common.ValueListParameterInOut',
                    LocalDataProperty : costCenter,
                    ValueListProperty : 'CostCenter',
                    Label: '{i18n>CostCenter}'
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'CompanyCode',
                    Label: '{i18n>CompanyCode}',
                    HTML5.CssDefaults: {width: '10em'}

                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'Name',
                    Label: '{i18n>Name}',
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'Description',
                },
            ],
        }
    );

    currency @(
        Common.ValueListWithFixedValues: true,
        Common.Label: '{i18n>Currency}',
        Common.ValueList: {
            $Type : 'Common.ValueListType',
            CollectionPath : 'Currencies',
            Parameters : [
                {
                    $Type : 'Common.ValueListParameterInOut',
                    LocalDataProperty : currency,
                    ValueListProperty : 'code',
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'name',
                },
            ],
        }
    );
};

annotate service.Items with @(

    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Value : productId,
            Label : '{i18n>Product}'
        },
        {
            $Type : 'UI.DataField',
            Value : description,
            Label : '{i18n>ItemDescription}',
        },
        {
            $Type : 'UI.DataField',
            Value : quantity,
            Label : '{i18n>Quantity}',
        },
        {
            $Type : 'UI.DataField',
            Value : price,
            Label : '{i18n>UnitPrice}',
        },
        {
            $Type : 'UI.DataField',
            Value : category_code,
            Label : '{i18n>Category}',
            @HTML5.CssDefaults: {width: '10em'}
        },
        {
            $Type : 'UI.DataField',
            Value : supplierId,
            Label : '{i18n>Supplier}',
            @HTML5.CssDefaults: {width: '10em'}
        },
        {
            $Type : 'UI.DataField',
            Value : itemTotal,
            Label : '{i18n>ItemTotal}',
        },
    ],

    UI.FieldGroup #ItemDetails : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : quantity,
                Label : '{i18n>Quantity}'
            },
            {
                $Type : 'UI.DataField',
                Value : price,
                Label : '{i18n>UnitPrice}'
            },
            {
                $Type : 'UI.DataField',
                Value : category_code,
                Label : '{i18n>Category}'
            },
            {
                $Type : 'UI.DataField',
                Value : supplierId,
                Label : '{i18n>Supplier}'
            },
            {
                $Type : 'UI.DataField',
                Value : itemTotal,
                Label : '{i18n>ItemTotal}'
            }
        ]
    },

    // 2. Tell Fiori to generate the page using the FieldGroup above
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'ItemDetailsFacet',
            Label : '{i18n>ItemDetails}',
            Target : '@UI.FieldGroup#ItemDetails'
        }
    ],

    // Object page header for a single line item
    UI.HeaderInfo : {
        TypeName       : '{i18n>Item}',
        TypeNamePlural : '{i18n>Items}',
        Title          : {
            $Type : 'UI.DataField',
            Value : productId,
        },
        Description    : {
            $Type : 'UI.DataField',
            Value : description 
        }
    }
);

annotate service.Items with {
    ID @UI.Hidden;
    request @UI.Hidden;
    status_code @UI.Hidden;
    itemTotal @readonly;

    category_code @(
        Common.ValueListWithFixedValues: true,
        Common.Text: category.name,
        Common.TextArrangement: #TextOnly,
        Common.Label: '{i18n>Category}',
        Common.ValueList: {
            $Type : 'Common.ValueListType',
            CollectionPath : 'Categories',
            Parameters : [
                {
                    $Type : 'Common.ValueListParameterInOut',
                    LocalDataProperty : category,
                    ValueListProperty : 'code',
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'name',
                },
            ],
        }
    );

    supplierId @(
        Common.Label: '{i18n>Supplier}',
        Common.ValueList: {
            $Type : 'Common.ValueListType',
            CollectionPath : 'Suppliers',
            Parameters : [
                {
                    $Type : 'Common.ValueListParameterInOut',
                    LocalDataProperty : supplierId,
                    ValueListProperty : 'ID',
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'SupplierName',
                },
            ],
        }
    );

    // Bind the Product ID to the S/4HANA Product Master
    productId @(
        Common.ValueList: {
            Label: '{i18n>Products}',
            CollectionPath: 'Products',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: productId, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterOut', LocalDataProperty: description, ValueListProperty: 'Description' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'Type' }
            ]
        }
    );
 
};

annotate service.Requests with {
    totalAmount   @Common.Label: '{i18n>Amount}';
    justification @Common.Label: '{i18n>BusinessJustification}';
    approvalDate  @Common.Label: '{i18n>ApprovalDate}';
    title         @Common.Label: '{i18n>Title}';
};

// Hide internal / auto-generated columns from the Attachments sub-table.
// The plugin's own @UI.LineItem already shows: content (filename link), status, createdAt, createdBy, note.
// The fields below are either FK keys, duplicates, or fully system-managed — no value shown to the user.
annotate service.Requests.attachments with {
    ID         @UI.Hidden;        // internal UUID key — meaningless to the user
    up__ID     @UI.Hidden;        // FK back to the parent request — redundant in context
    mimeType   @UI.Hidden;        // already embedded in the content download link rendering
    lastScan   @UI.Hidden;        // system-managed scan timestamp — noise in the table
    modifiedAt @UI.Hidden;        // attachments are not modified after upload; createdAt suffices
    modifiedBy @UI.Hidden;        // same — createdBy already covers the uploader identity
};

annotate RequestService.Requests with @(
    Common.SideEffects #RecalculateTotal: {
        SourceEntities: [items],
        SourceProperties: ['items/quantity', 'items/price'],
        TargetProperties: ['totalAmount', 'items/itemTotal'],
    }
);

// Refresh itemTotal when quantity or price changes (item object page / Items context)
annotate service.Items with @(Common.SideEffects #RecalculateItemTotalForItem: {
    SourceProperties: ['quantity', 'price'],
    TargetProperties: ['itemTotal']
});

annotate RequestService.Requests with actions {

    generateAIJustification @(
        Common.SideEffects #RefreshAIJustification: {
            TargetProperties: ['_it/justification'],
        }
    );
    // cancelRequest SideEffects are defined on the action in MainService.cds
    // (TargetEntities: [''] triggers a full entity re-read — status, cancelReason, etc.)

    // Gray out toolbar action buttons when selected rows don't satisfy the condition.
    // Fiori Elements evaluates @Core.OperationAvailable per selected row and disables
    // the button if ANY row returns false.
    //
    // Submit: only available on ACTIVE rows with status N (see UI.Hidden above for the
    // rationale — running Submit on a draft would delete the draft mid-action and leave
    // Fiori bound to a non-existent URL).
    submitRequest   @Core.OperationAvailable : { $edmJson: { $And: [
        { $Eq: [{ $Path: 'status_code' }, 'N'] },
        { $Eq: [{ $Path: 'IsActiveEntity' }, true] }
    ]}};
    approveRequest  @Core.OperationAvailable : { $edmJson: { $Path: 'isApprover' } };
    rejectRequest   @Core.OperationAvailable : { $edmJson: { $Path: 'isApprover' } };

    cancelRequest   @Core.OperationAvailable : { $edmJson: {
        $Or: [
            { $Eq: [{ $Path: 'status_code' }, 'N'] },
            { $Eq: [{ $Path: 'status_code' }, 'S'] }
        ]
    }};

    withdrawRequest @Core.OperationAvailable : { $edmJson: {
        $Eq: [{ $Path: 'status_code' }, 'S']
    }};
};

annotate RequestService.Requests with @(
    UI.Chart #RequestsByStatus: {
        ChartType: #Donut,
        Title: '{i18n>ChartRequestsByStatus}',
        DynamicMeasures: ['@Analytics.AggregatedProperty#RequestCount',
        ],
        Dimensions: [status_code],
        MeasureAttributes: [{
            DynamicMeasure: '@Analytics.AggregatedProperty#RequestCount',
            Role: #Axis1,
        }],
        DimensionAttributes: [{
            Dimension: status_code,
            Role: #Category,
        }],
    },

    UI.Chart #AmountByCostCenter: {
        ChartType: #Column,
        Title: '{i18n>ChartSpendByCostCenter}',
        DynamicMeasures: ['@Analytics.AggregatedProperty#TotalAmountSum',
        ],
        Dimensions: [costCenter],
        MeasureAttributes: [{
            DynamicMeasure: '@Analytics.AggregatedProperty#TotalAmountSum',
            Role: #Axis1,
        }],
        DimensionAttributes: [{
            Dimension: costCenter,
            Role: #Category,
        }],
    },

    // Table first, then chart — enables chart + table layout (toolbar: Table | Chart | Both)
    UI.SelectionPresentationVariant #StatusView: {
        Text: '{i18n>OperationalView}',
        PresentationVariant: {
            SortOrder: [{ Property: ID, Descending: true }],
            Visualizations: [
                '@UI.Chart#RequestsByStatus',
            ],
        },
    },

    UI.SelectionPresentationVariant #FinancialView: {
        Text: '{i18n>FinancialView}',
        PresentationVariant: {
            SortOrder: [{ Property: ID, Descending: true }],
            Visualizations: [
                '@UI.Chart#AmountByCostCenter',
            ],
        },
    },
);

annotate RequestService.Requests with @(
    // Status visual filter mini-chart (bar — count per status)
    UI.Chart #VFChartStatus: {
        ChartType: #Bar,
        DynamicMeasures: ['@Analytics.AggregatedProperty#RequestCount' ],
        Dimensions: [status_code],
        MeasureAttributes: [{
            DynamicMeasure: '@Analytics.AggregatedProperty#RequestCount',
            Role: #Axis1
        }],
        DimensionAttributes: [{
            Dimension: status_code,
            Role: #Category
        }]
    },
    // Presentation variant for the Status visual filter.
    UI.PresentationVariant #VFStatusPV: {
        SortOrder : [{
            Property  : status_code,
            Descending: true
        }],
        Visualizations: ['@UI.Chart#VFChartStatus']
    },

    // 3. Visual Filter: Total Spend Over Time (Line chart — requires time-based dimension)
    // createdAt (Timestamp → Edm.DateTimeOffset) satisfies the Line chart requirement.
    // The chart always displays the last 6 data points sorted ascending — MaxItems does not apply here.
    UI.Chart #VFChartCreatedAt: {
        ChartType: #Line,
        DynamicMeasures: ['@Analytics.AggregatedProperty#TotalAmountSum'],
        Dimensions: [createdAt],
        MeasureAttributes: [{
            DynamicMeasure: '@Analytics.AggregatedProperty#TotalAmountSum',
            Role: #Axis1
        }],
        DimensionAttributes: [{
            Dimension: createdAt,
            Role: #Category
        }]
    },
    // Presentation variant for the time-based visual filter.
    // SortOrder ascending — oldest to newest so the line reads left-to-right.
    // No MaxItems here — Line charts are not bar charts; the runtime controls the visible window.
    UI.PresentationVariant #VFCreatedAtPV: {
        SortOrder: [{
            Property: createdAt,
            Descending: false
        }],
        Visualizations: ['@UI.Chart#VFChartCreatedAt']
    },

    // Cost center visual filter mini-chart (bar — total spend per cost center)
    UI.Chart #VFChartCostCenter: {
        ChartType: #Bar,
        DynamicMeasures: ['@Analytics.AggregatedProperty#TotalAmountSum'],
        Dimensions: [costCenter],
        MeasureAttributes: [{
            DynamicMeasure: '@Analytics.AggregatedProperty#TotalAmountSum',
            Role: #Axis1
        }],
        DimensionAttributes: [{
            Dimension: costCenter,
            Role: #Category
        }]
    },
    // Presentation variant for the Cost Center visual filter.
    // SortOrder Descending = show highest-spend cost centers first.
    UI.PresentationVariant #VFCostCenterPV: {
        SortOrder : [{
            Property  : costCenter,
            Descending: true
        }],
        Visualizations: ['@UI.Chart#VFChartCostCenter']
    }
);

annotate RequestService.Requests with {
    status @(
        Common.ValueList #VisualFilterStatus: {
            CollectionPath: 'Requests',
            PresentationVariantQualifier: 'VFStatusPV',
            Parameters: [
                {
                    $Type: 'Common.ValueListParameterInOut',
                    LocalDataProperty: status_code,
                    ValueListProperty: 'status_code'
                }
            ]
        }
    );

    costCenter @(
        Common.ValueList #VisualFilterCostCenter: {
            CollectionPath: 'Requests',
            PresentationVariantQualifier: 'VFCostCenterPV',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: costCenter, ValueListProperty: 'costCenter' }
            ]
        }
    );

    createdAt @(
        Common.Label: '{i18n>CreatedDate}',
        Common.ValueList #VisualFilterCreatedAt: {
            CollectionPath: 'Requests',
            PresentationVariantQualifier: 'VFCreatedAtPV',
            Parameters: [
                {
                    $Type: 'Common.ValueListParameterInOut',
                    LocalDataProperty: createdAt,
                    ValueListProperty: 'createdAt'
                }
            ]
        }
    );
};

// Enables mass-edit: Fiori can PATCH active instances directly (bypasses draft protocol).
annotate service.Requests with @odata.draft.bypass;