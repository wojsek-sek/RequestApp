import cds from '@sap/cds';
import { Requests } from '#cds-models/RequestService';
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

        // Connect to the external OData V2 service (Products)
        const productApi = await cds.connect.to('API_PRODUCT_SRV');


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
        this.before('READ', 'Suppliers', (req) => {
            const query = req.query.SELECT;
            // Sprawdzamy, czy zapytanie ma narzucone konkretne kolumny (np. przez Fiori $select)
            if (query && query.columns) {
                // Wymuszamy pobranie prawdziwych pól z S/4HANA, aby nasz 'after' handler miał na czym pracować
                query.columns.push({ ref: ['businessPartnerName1'] });
                query.columns.push({ ref: ['businessPartnerName2'] });
            }
        });

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


        // ---------------------------------------------------------
        // MASHUP 3: Delegate READ requests for Products (V2)
        // ---------------------------------------------------------
        this.on('READ', 'Products', async (req) => {
            try {
                return await productApi.run(req.query);
            } catch (error) {
                console.error('[Mock/API Error] Products:', (error as Error).message);
                return [
                    { ID: 'HT-1000', Type: 'HAWA', Description: 'Notebook Basic 15' },
                    { ID: 'HT-1001', Type: 'HAWA', Description: 'Notebook Basic 17' },
                    { ID: 'HT-1002', Type: 'HAWA', Description: 'Notebook Professional 15' }
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

        // ---------------------------------------------------------
        // CUSTOM ACTIONS: Approve & Reject
        // ---------------------------------------------------------
        this.on('approve', 'Requests', async (req) => {
            // req.params[0] holds the UUID of the active entity
            const keys = req.params[0];
            
            // req.user.id holds the username from the mock auth (e.g., 'admin-eu') or XSUAA
            const currentUserId = req.user.id;

            await UPDATE(Requests)
                .set({ 
                    status_code: 'A',
                    approvalDate: new Date().toISOString(),
                    approver: currentUserId // Systemowy wpis bez ingerencji usera
                })
                .where(keys);

            const updated = await SELECT.one.from(Requests).where(keys);
            return updated;
        });
        
        this.on('reject', 'Requests', async (req) => {
            const keys = req.params[0];
            const currentUserId = req.user.id;

            await UPDATE(Requests)
                .set({ 
                    status_code: 'R',
                    approvalDate: new Date().toISOString(),
                    approver: currentUserId
                })
                .where(keys);

            const updated = await SELECT.one.from(Requests).where(keys);
            
            return updated;
        });

        // ---------------------------------------------------------
        // PRE-READ: Inject required fields for virtual calculations
        // ---------------------------------------------------------
        this.before('READ', 'Requests', (req) => {
            const query = req.query.SELECT;
            // Force fetching status_code from HANA/SQLite so our 'after' logic has data to evaluate
            // Szukamy, czy w tablicy kolumn znajduje się już 'status_code'
            // Sprawdzamy, czy zapytanie w ogóle ma narzuconą listę kolumn 
            // (Jeśli nie ma query.columns, to znaczy że to SELECT *, więc nic nie musimy dodawać)
            if (query && query.columns) {
                
                // Szukamy, czy w tablicy kolumn znajduje się już 'status_code'
                const hasStatusCode = query.columns.some((col: any) => 
                    col.ref && col.ref.includes('status_code')
                );

                // Wstrzykujemy kolumnę TYLKO, jeśli Fiori samo o nią nie poprosiło
                if (!hasStatusCode) {
                    query.columns.push({ ref: ['status_code'] });
                }
            }
        });

        // ---------------------------------------------------------
        // POST-READ: Calculate UI virtual fields
        // ---------------------------------------------------------
        this.after('READ', 'Requests', (each) => {
            // Guard clause to prevent errors on metadata requests
            if (!each) return;

            // Now 'each.status_code' is guaranteed to be populated
            if (each.status_code === 'A' || each.status_code === 'R') {
                each.isActionable = false;
                each.isReadOnly = true;
            } else {
                each.isActionable = true;
                each.isReadOnly = false;
            }
        });

        // ---------------------------------------------------------
        // MASHUP 1: Cost Centers (Virtual Fields & $expand)
        // ---------------------------------------------------------
        this.before('READ', 'CostCenters', (req) => {
            const query = req.query.SELECT;
            if (query && query.columns) {
                // Wymuszamy na zapytaniu rozszerzenie (expand) asocjacji do tekstów
                const hasToText = query.columns.some((col: any) => col.ref && col.ref.includes('to_Text'));
                if (!hasToText) {
                    query.columns.push({ ref: ['to_Text'], expand: ['*' as any] });
                }
            }
        });

        this.after('READ', 'CostCenters', (each, req) => {
            if (!each) return;
            
            // Jeśli przyszły do nas teksty z S/4HANA
            if (each.to_Text && each.to_Text.length > 0) {
                
            const userLocale = req.locale || 'en';
            
            // 2. Przekształcamy np. 'en-US' lub 'pl' na format S/4HANA (2 znaki, wielkie litery: 'EN', 'PL')
            const sapLang = userLocale.substring(0, 2).toUpperCase();

            // 3. Łańcuch opadający (Fallback chain):
            // - Najpierw szukamy języka użytkownika
            // - Jeśli w S/4HANA nie ma tego tłumaczenia, szukamy angielskiego
            // - Jeśli nie ma nawet angielskiego, bierzemy cokolwiek (pierwszy element)
            const textRecord = each.to_Text.find((t: any) => t.Language === sapLang) 
                            || each.to_Text.find((t: any) => t.Language === 'EN') 
                            || each.to_Text[0];
                
                // Przypisujemy do naszych wirtualnych pól
                each.Name = textRecord.CostCenterName;
                each.Description = textRecord.CostCenterDescription;
            }
        });

        // Call the super.init() to ensure standard CAP handlers (like Drafts) are loaded
        return super.init();
    }
}