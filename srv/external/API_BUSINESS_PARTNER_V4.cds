/* checksum : 448eebf729d31d4de01b09f96ca388bf */
@cds.external : true
service PACBusinessPartner {
  @cds.external : true
  @cds.persistence.skip : true
  entity BusinessPartners {
    key ID : UUID not null;
    businessPartnerNumber : String(20);
    vendorCode : String(10);
    customerCode : String(10);
    businessPartnerName1 : String(40);
    businessPartnerName2 : String(40);
    address : String(10);
  };
};

