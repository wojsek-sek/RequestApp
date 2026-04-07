/* checksum : e2ec291b1974f588275e391515ded43f */
@cds.external : true
@m.IsDefaultEntityContainer : 'true'
@sap.message.scope.supported : 'true'
@sap.supported.formats : 'atom json xlsx'
service API_COSTCENTER_V2 {
  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Cost Center'
  entity A_CostCenter {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Controlling Area'
    key ControllingArea : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cost Center'
    key CostCenter : String(10) not null;
    @sap.display.format : 'Date'
    @sap.label : 'Valid To'
    @sap.quickinfo : 'Valid To Date'
    key ValidityEndDate : Date not null;
    @sap.display.format : 'Date'
    @sap.label : 'Valid From'
    @sap.quickinfo : 'Valid-From Date'
    ValidityStartDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Area'
    BusinessArea : String(4);
    @sap.label : 'Person Responsible'
    CostCtrResponsiblePersonName : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'User Responsible'
    CostCtrResponsibleUser : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    CostCenterCurrency : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Profit Center'
    ProfitCenter : String(10);
    @sap.label : 'Department'
    Department : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Costing Sheet'
    CostingSheet : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Functional Area'
    FunctionalArea : String(16);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Region'
    @sap.quickinfo : 'Region (State, Province, County)'
    Region : String(3);
    @sap.label : 'City'
    CityName : String(35);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Hierarchy Area'
    @sap.quickinfo : 'Standard Hierarchy Area'
    CostCenterStandardHierArea : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cost Center Category'
    CostCenterCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Actual primary costs'
    @sap.quickinfo : 'Lock Indicator for Actual Primary Postings'
    IsBlkdForPrimaryCostsPosting : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Actl Sec. Costs'
    @sap.quickinfo : 'Lock Indicator for Actual Secondary Costs'
    IsBlkdForSecondaryCostsPosting : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Actual Revenues'
    @sap.quickinfo : 'Lock Indicator for Actual Revenue Postings'
    IsBlockedForRevenuePosting : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Commitment Update'
    @sap.quickinfo : 'Lock Indicator for Commitment Update'
    IsBlockedForCommitmentPosting : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plan primary costs'
    @sap.quickinfo : 'Lock Indicator for Plan Primary Costs'
    IsBlockedForPlanPrimaryCosts : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Lock Plan Sec Costs'
    @sap.quickinfo : 'Lock Indicator for Plan Secondary Costs'
    IsBlockedForPlanSecondaryCosts : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Lock Planning Revn'
    @sap.quickinfo : 'Lock Indicator for Planning Revenues'
    IsBlockedForPlanRevenues : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Record Quantity'
    @sap.quickinfo : 'Indicator for Recording Consumption Quantities'
    ConsumptionQtyIsRecorded : String(1);
    @sap.label : 'Language Key'
    Language : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Created By'
    @sap.quickinfo : 'Entered By'
    CostCenterCreatedByUser : String(12);
    @sap.display.format : 'Date'
    @sap.label : 'Entered On'
    CostCenterCreationDate : Date;
    to_Text : Association to many A_CostCenterText {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Cost Center Text'
  entity A_CostCenterText {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cost Center'
    key CostCenter : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Controlling Area'
    key ControllingArea : String(4) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.display.format : 'Date'
    @sap.label : 'Valid To'
    @sap.quickinfo : 'Valid To Date'
    key ValidityEndDate : Date not null;
    @sap.display.format : 'Date'
    @sap.label : 'Valid From'
    @sap.quickinfo : 'Valid-From Date'
    ValidityStartDate : Date;
    @sap.label : 'Cost Center Name'
    CostCenterName : String(20);
    @sap.label : 'Cost Center Desc.'
    @sap.quickinfo : 'Description of Cost Center'
    CostCenterDescription : String(40);
    to_CostCenter : Association to A_CostCenter {  };
  };
};

