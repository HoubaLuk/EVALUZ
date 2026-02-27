export type Tab = 'criteria' | 'evaluation' | 'analytics';

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
  upraveno_lektorem?: boolean;
}

export interface Student {
  id: number;
  name: string;
  status: 'evaluated' | 'pending' | 'evaluating';
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
}


export interface AnalyticsData {
  name: string;
  count: number;
}
