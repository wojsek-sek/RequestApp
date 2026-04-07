import cds from '@sap/cds';

// Export the main service class
export default class RequestService extends cds.ApplicationService {
    private _criticalityFromStatusCode(code?: string): number {
        switch (code) {
            case 'A':
                return 3; // Approved (Positive)
            case 'R':
                return 1; // Rejected (Negative)
            case 'S':
                return 2; // Submitted (Critical)
            default:
                return 0; // Draft / Unknown
        }
    }
    
    // Lifecycle method: initialization
    async init() {
        // Connect to the external OData V2 service (Cost Centers)
        const costCenterApi = await cds.connect.to('API_COSTCENTER_V2');
        
        // Connect to the external OData V4 service (Business Partners)
        const businessPartnerApi = await cds.connect.to('PACBusinessPartner');

        // ---------------------------------------------------------
        // MASHUP 1: Delegate READ requests for Cost Centers (V2)
        // ---------------------------------------------------------
        // Using string 'CostCenters' is bulletproof against undefined errors
        this.on('READ', 'CostCenters', async (req) => {
            // Forward the incoming query to the external V2 system
            try {
                // Forward the request to the external API
                return await costCenterApi.run(req.query);
            } catch (error) {
                // Log the error and return mock data to keep value help usable
                console.error('[Mock/API Error] CostCenters:', (error as Error).message);
                return [
                    { CostCenter: '1000000001', CompanyCode: '1000' },
                    { CostCenter: '1000000002', CompanyCode: '1000' },
                    { CostCenter: '2000000001', CompanyCode: '2000' },
                ];
            }
        });

        // ---------------------------------------------------------
        // MASHUP 2: Delegate READ requests for Suppliers (V4)
        // ---------------------------------------------------------
        // Using string 'Suppliers' guarantees the entity is found in runtime
        this.on('READ', 'Suppliers', async (req) => {
            // Forward the incoming query to the external V4 system
            try {
                // Forward the request to the external API
                return await businessPartnerApi.run(req.query);
            } catch (error) {
                // Log the error and return mock data to keep value help usable
                console.error('[Mock/API Error] Suppliers:', (error as Error).message);
                return [
                    { ID: '100000', businessPartnerName1: 'Demo', businessPartnerName2: 'Supplier 1', Code: 'V100000' },
                    { ID: '200000', businessPartnerName1: 'Demo', businessPartnerName2: 'Supplier 2', Code: 'V200000' },
                ];
            }
        });

        this.after('READ', 'Suppliers', (each) => {
            // Bezpieczne łączenie stringów (jeśli jedno z pól jest nullem)
            const name1 = each.businessPartnerName1 || '';
            const name2 = each.businessPartnerName2 || '';
            
            // Tworzymy finalne pole Name
            each.Name = `${name1} ${name2}`.trim();
            
            // (Opcjonalnie) Jeśli dostawca nie ma nazwy, wstawmy zaślepkę
            if (!each.Name) {
                each.Name = 'Brak danych';
            }
            
            delete each.businessPartnerName1;
            delete each.businessPartnerName2;
        });

        // Keep statusCriticality in sync when user sets status
        this.before(['CREATE', 'UPDATE'], 'Requests', (req) => {
            const data: any = req.data || {};
            const code: string | undefined =
                data.status_code ?? data.status?.code ?? data.status ?? undefined;
            if (code) {
                data.statusCriticality = this._criticalityFromStatusCode(code);
            }
        });

        // WALIDACJA PRZED ZAPISEM
        this.before(['CREATE', 'UPDATE'], 'Requests', async (req) => {
            const { totalAmount, justification, title } = req.data;

            // 1. Sprawdzamy, czy tytuł nie jest za krótki
            if (title && title.length < 5) {
                return req.error(400, 'TITLE_TOO_SHORT', 'title');
            }

            // 2. Biznesowy "Gurdrail": Request musi mieć uzasadnienie przy dużej kwocie
            if (totalAmount > 1000 && !justification) {
                // Zwracamy błąd celowany w konkretne pole (target), żeby Fiori podświetliło je na czerwono
                return req.error(400, 'JUSTIFICATION_REQUIRED_FOR_HIGH_AMOUNT', 'justification');
            }

            // 3. Kwota nie może być ujemna ani zerowa
            if (totalAmount <= 0) {
                return req.error(400, 'AMOUNT_MUST_BE_POSITIVE', 'totalAmount');
            }
        });

        // this.after('READ', 'Requests', (each) => {
        //     switch (each.status_code) {
        //         case 'A': each.statusCriticality = 3; break; // Approved -> Green
        //         case 'R': each.statusCriticality = 1; break; // Rejected -> Red
        //         case 'S': each.statusCriticality = 2; break; // Submitted -> Yellow
        //         default:  each.statusCriticality = 0;        // Draft -> Grey
        //     }
        // });

        // Call the super.init() to ensure standard CAP handlers (like Drafts) are loaded
        return super.init();
    }
}