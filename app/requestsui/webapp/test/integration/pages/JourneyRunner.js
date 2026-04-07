sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"capmap/requestsui/test/integration/pages/RequestsList",
	"capmap/requestsui/test/integration/pages/RequestsObjectPage"
], function (JourneyRunner, RequestsList, RequestsObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('capmap/requestsui') + '/test/flp.html#app-preview',
        pages: {
			onTheRequestsList: RequestsList,
			onTheRequestsObjectPage: RequestsObjectPage
        },
        async: true
    });

    return runner;
});

