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
            }
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
        Title : 'AI Compliance Score',
        CriticalityCalculation : {
            ImprovementDirection  : #Maximize,
            DeviationRangeLowValue  : 50,
            ToleranceRangeLowValue  : 80,
        },
    },

    // AI Audit Results — hidden while Draft, shown after submission.
    UI.FieldGroup #AIAuditResultsGroup : {
        $Type : 'UI.FieldGroupType',
        Label : 'AI Audit Results',
        Data : [
            {
                $Type  : 'UI.DataFieldForAnnotation',
                Target : '@UI.DataPoint#AIScoreDataPoint',
                Label  : 'Compliance Score',
            },
            {
                $Type : 'UI.DataField',
                Value : aiAuditNotes,
                Label : 'Audit Notes',
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
            // 3 — always visible; add/delete locked when not Draft by entity-level UI.UpdateHidden
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
        },
        {
            // 5 — hidden while Draft; visible after Submit / Approve / Reject
            $Type : 'UI.ReferenceFacet',
            ID    : 'AIAuditResultsFacet',
            Label : '{i18n>AuditScore}',
            Target : '@UI.FieldGroup#AIAuditResultsGroup',
            ![@UI.Hidden] : {$edmJson: {$Eq: [{$Path: 'status_code'}, 'D']}},
        },
    ],
    
    UI.SelectionFields: [
        status_code,
        costCenter,
        title,
        approvalDate,
        justification,
        totalAmount,
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

    // Header facets (status + amount)
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
        }
    ],

    UI.Identification: [
            { $Type: 'UI.DataFieldForAction', Action: 'RequestService.submitRequest', Label: '{i18n>Submit}', Criticality: 3, @UI.Hidden: {$edmJson: {$Ne: [{$Path: 'status_code'}, 'D']}}},
            { $Type: 'UI.DataFieldForAction', Action: 'RequestService.approveRequest', Label: '{i18n>Approve}', Criticality: 3, @UI.Hidden: {$edmJson: {$Ne: [{$Path: 'status_code'}, 'S']}}},
            { $Type: 'UI.DataFieldForAction', Action: 'RequestService.rejectRequest', Label: '{i18n>Reject}', Criticality: 1, @UI.Hidden: {$edmJson: {$Ne: [{$Path: 'status_code'}, 'S']}} },
            { 
                $Type: 'UI.DataFieldForAction', 
                Action: 'RequestService.generateAIJustification', 
                Label: '{i18n>AutoJustify}',
                IconUrl: 'sap-icon://ai'
            }
    ],

    UI.UpdateHidden : {$edmJson: {$Ne: [{$Path: 'status_code'}, 'D']}},
    UI.DeleteHidden : {$edmJson: {$Ne: [{$Path: 'status_code'}, 'D']}},
    
);

// Value helps + UI behavior
annotate service.Requests with {
    createdAt  @UI.Hidden;
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
                    Label: '{i18n>CompanyCode}'

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

    // 1. Group the fields that should appear on the detail page
    UI.FieldGroup #ItemDetails : {
        $Type : 'UI.FieldGroupType',
        Data : [
            // {
            //     $Type : 'UI.DataField',
            //     Value : productId,
            //     Label : '{i18n>Product}'
            // },
            // {
            //     $Type : 'UI.DataField',
            //     Value : description,
            //     Label : '{i18n>ItemDescription}'
            // },
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
                //{ $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'CompanyCode' }
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
// ── RequestAttachments — table view inside the Object Page ────────────────
annotate service.RequestAttachments with @(
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Value : fileName,
            Label : 'File Name',
        },
        {
            $Type : 'UI.DataField',
            Value : mediaType,
            Label : 'File Type',
        },
        {
            $Type : 'UI.DataField',
            Value : uploadedAt,
            Label : 'Uploaded At',
        },
        {
            $Type : 'UI.DataField',
            Value : uploadedBy,
            Label : 'Uploaded By',
        },
    ],
    UI.HeaderInfo : {
        TypeName       : 'Attachment',
        TypeNamePlural : 'Attachments',
        Title          : {
            $Type : 'UI.DataField',
            Value : fileName,
        },
    }
);

annotate service.RequestAttachments with {
    ID         @UI.Hidden;
    request    @UI.Hidden;
    uploadedAt @readonly;
    uploadedBy @readonly;
};

annotate service.Requests with {
    totalAmount @Common.Label : '{i18n>Amount}'
};

annotate service.Requests with {
    justification @Common.Label : '{i18n>BusinessJustification}'
};

annotate service.Requests with {
    approvalDate @Common.Label : '{i18n>ApprovalDate}'
};

annotate service.Requests with {
    title @Common.Label : '{i18n>Title}'
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
    // 1. Mini-wykres dla Statusu
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
    // Wariant prezentacji dla filtra statusu
    UI.PresentationVariant #VFStatusPV: {
        SortOrder: [{
            Property: status_code,
            Descending: true
        }],
        Visualizations: ['@UI.Chart#VFChartStatus']
    },

    // 2. Mini-wykres dla Cost Center
    UI.Chart #VFChartCostCenter: {
        ChartType: #Bar, // Poziomy Bar wygląda obłędnie w ciasnym pasku filtrów
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
    // Wariant prezentacji dla filtra Cost Center
    UI.PresentationVariant #VFCostCenterPV: {
        SortOrder: [{
            Property: costCenter,
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
};
