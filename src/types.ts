export type Tab = 'criteria' | 'evaluation' | 'analytics' | 'statistics';

export interface Scenario {
  id: string;
  name: string;
}

export interface ClassData {
  id: string;
  name: string;
  scenarios: Scenario[];
  expanded?: boolean;
}

export const DEFAULT_CLASS_DATA: ClassData[] = [{
  id: "class-1",
  name: "ZOP 01/2026",
  expanded: true,
  scenarios: [
    { id: "scen-1", name: "MS1: Dopravní nehoda" },
    { id: "scen-2", name: "MS2: Vstup do obydlí" }
  ]
}];

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
