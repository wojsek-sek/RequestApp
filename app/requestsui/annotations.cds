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
                Value : justification,
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
        ],
    },
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'GeneratedFacet1',
            Label : 'General Information',
            Target : '@UI.FieldGroup#GeneratedGroup',
        },
        {
            $Type : 'UI.CollectionFacet',
            ID : 'RequestItemsFacet',
            Label : '{i18n>RequestItemsSection}',
            Facets : [
                {
                    $Type : 'UI.ReferenceFacet',
                    ID : 'ItemsTableFacet',
                    Target : 'items/@UI.LineItem',
                },
            ],
        },
    ],
    
    UI.SelectionFields: [
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
            Value : title, // Tu wyświetlamy nazwę wniosku zamiast ID
        },
        Description    : {
            $Type : 'UI.DataField',
            Value : justification, // Podtytuł (mniejszy tekst pod tytułem)
        }
    },
    // 1. Definicja punktu danych dla Statusu
    UI.DataPoint #StatusDataPoint : {
        Value       : status_code,
        Title       : '{i18n>Status}',
        Criticality : status.criticality,
        CriticalityRepresentation : #WithoutIcon
    },

    // 2. Definicja punktu danych dla Kwoty
    UI.DataPoint #TotalAmountDataPoint : {
        Value : totalAmount,
        Title : '{i18n>TotalAmount}',
    },

    // 3. Wrzucenie ich do nagłówka (HeaderFacets)
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
);

// Value helps + UI behavior
annotate service.Requests with {
    createdAt  @UI.Hidden;
    createdBy  @UI.Hidden;
    modifiedAt @UI.Hidden;
    modifiedBy @UI.Hidden;
    ID @UI.Hidden;
    status_code @(
        Common.Label: 'Status',
        Common.FieldControl: #Mandatory,
        Common.ValueList: {
            $Type : 'Common.ValueListType',
            CollectionPath : 'Statuses',
            Parameters : [
                {
                    $Type : 'Common.ValueListParameterInOut',
                    LocalDataProperty : status_code,
                    ValueListProperty : 'code',
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'name',
                },
            ],
        }
    );

    costCenter @(
        Common.Label: 'Cost Center',
        Common.ValueList: {
            $Type : 'Common.ValueListType',
            CollectionPath : 'CostCenters',
            Parameters : [
                {
                    $Type : 'Common.ValueListParameterInOut',
                    LocalDataProperty : costCenter,
                    ValueListProperty : 'CostCenter',
                },
                {
                    $Type : 'Common.ValueListParameterDisplayOnly',
                    ValueListProperty : 'CompanyCode',
                },
            ],
        }
    );

    currency @(
        Common.Label: 'Currency',
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
        },
        {
            $Type : 'UI.DataField',
            Value : supplierId,
            Label : '{i18n>Supplier}',
        },
        {
            $Type : 'UI.DataField',
            Value : itemTotal,
            Label : '{i18n>ItemTotal}',
        },
    ],
);

annotate service.Items with {
    ID @UI.Hidden;
    request @UI.Hidden;

    category @(
        Common.Text: category.name,
        Common.TextArrangement: #TextOnly,
        Common.Label: 'Category',
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
        Common.Label: 'Supplier',
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
                    ValueListProperty : 'Name',
                },
            ],
        }
    );
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

