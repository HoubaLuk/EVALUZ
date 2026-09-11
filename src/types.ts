export type Tab = 'criteria' | 'evaluation' | 'analytics' | 'statistics';

/**
 * Modelová situace (ADR-033).
 *
 * `id` je databázové ID — slouží k operacím nad stromem (přejmenovat, smazat).
 * `key` je `scenario_key` ze serveru a je to to, co zbytek aplikace zná jako
 * `scenario_id`: putuje do URL i do všech volání API. Dřív se generoval na klientovi
 * jako `scen-${Date.now()}`, takže situace existovala jen ve stromu v prohlížeči;
 * nyní ho vydává server a situace je řádek v databázi.
 */
export interface Scenario {
  id: number;
  key: string;
  name: string;
}

export interface ClassData {
  id: number;
  name: string;
  scenarios: Scenario[];
  /** Rozbalení ve stromu — čistě UI, drží se v prohlížeči a na serveru nemá co dělat. */
  expanded?: boolean;
}

export interface Criterion {
  id: number;
  name: string;
  description: string;
}

export interface CriterionResult {
  nazev: string;
  splneno: boolean;
  body: number;
  oduvodneni: string;
  citace: string;
  /**
   * Míra jistoty modelu tímto dílčím hodnocením, 1–5 (ADR-029).
   * `null` = model ji neuvedl; starší záznamy pole nemají vůbec.
   *
   * POZOR: je to modelovo TVRZENÍ o obtížnosti, ne měření jeho nejistoty — model
   * neumí introspekci do vlastních pravděpodobností. Slouží k triáži, kam se podívat,
   * ne jako důkaz, že jinde je hodnocení spolehlivé.
   */
  jistota?: number | null;
  /** Zásah vyučujícího. Odvozuje SERVER diffem proti uložené verzi, ne klient. */
  upraveno_lektorem?: boolean;
  _llm_omitted?: boolean;
}

export interface Student {
  id: number;
  name: string;
  // 'queued' = zařazeno do fronty, čeká na volný slot souběžnosti (EVAL_QUEUED).
  // Bez tohoto stavu vypadal čekající ÚZ stejně jako nezahájený a lektor dávku
  // zbytečně spouštěl znovu.
  status: 'evaluated' | 'pending' | 'evaluating' | 'queued';
  score: number;
  maxScore: number;
  evaluationDetails?: CriterionResult[]; // Added to store individual results
  cleanedName?: string;
  identita?: {
    hodnost?: string;
    jmeno?: string;
    prijmeni?: string;
  };
  zpetna_vazba?: string;
  isDirty?: boolean;
  is_approved?: boolean;
}


export interface AnalyticsData {
  name: string;
  count: number;
}
