import { API_BASE_URL } from './api';

/**
 * Strom tříd a modelových situací (ADR-033).
 *
 * Situace je řádek v databázi patřící konkrétnímu lektorovi; strom se z nich odvozuje.
 * Dřív to bylo obráceně — `scenario_id` vzniklo na klientovi (`scen-${Date.now()}`)
 * a jediným záznamem o existenci situace byl strom v `localStorage`, později JSON blob
 * na serveru (ADR-031). Když se strom ztratil nebo přepsal, kritéria a vyhodnocení v DB
 * zůstala, ale nevedla k nim cesta.
 *
 * V prohlížeči proto ze stromu NEZŮSTÁVÁ NIC. Žádná cache, žádné vytlačování lokálního
 * stavu na server — přesně to promíchalo účty na sdíleném počítači.
 */

export interface WorkspaceScenario {
    id: number;
    /** Klíč, který zbytek aplikace zná jako `scenario_id`. Generuje ho server. */
    key: string;
    name: string;
}

export interface WorkspaceGroup {
    id: number;
    name: string;
    scenarios: WorkspaceScenario[];
}

/** Počty dotčených záznamů z odpovědi 409 — podklad pro potvrzovací dialog. */
export interface DeleteBlocked {
    scenarios: number;
    evaluations: number;
}

function authHeaders(): HeadersInit {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`,
    };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE_URL}/workspace${path}`, {
        ...init,
        headers: authHeaders(),
    });
    if (!res.ok) {
        throw new Error(`Operace se strukturou tříd selhala (HTTP ${res.status})`);
    }
    return res.status === 204 ? (undefined as T) : await res.json();
}

export async function fetchTree(): Promise<WorkspaceGroup[]> {
    const data = await call<{ groups: WorkspaceGroup[] }>('');
    return data.groups ?? [];
}

export function createGroup(name: string): Promise<WorkspaceGroup> {
    return call('/groups', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameGroup(id: number, name: string): Promise<WorkspaceGroup> {
    return call(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function createScenario(groupId: number, name: string): Promise<WorkspaceScenario> {
    return call('/scenarios', {
        method: 'POST',
        body: JSON.stringify({ group_id: groupId, name }),
    });
}

export function renameScenario(id: number, name: string): Promise<WorkspaceScenario> {
    return call(`/scenarios/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

/**
 * Smaže třídu nebo situaci.
 *
 * Bez `force` server odmítne smazat cokoli, pod čím leží vyhodnocení, a vrátí 409
 * s počty. Ty se vrací jako `DeleteBlocked`, aby je volající ukázal v dialogu a teprve
 * po potvrzení zavolal znovu s `force`. Nikdy tak nevznikne záznam v DB, ke kterému
 * nevede cesta — přesně ten stav, kvůli kterému tahle vrstva existuje.
 */
async function remove(path: string, force: boolean): Promise<DeleteBlocked | null> {
    const res = await fetch(`${API_BASE_URL}/workspace${path}${force ? '?force=true' : ''}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    if (res.status === 409) {
        const { detail } = await res.json();
        return { scenarios: detail?.scenarios ?? 0, evaluations: detail?.evaluations ?? 0 };
    }
    if (!res.ok) throw new Error(`Smazání selhalo (HTTP ${res.status})`);
    return null;
}

export function deleteGroup(id: number, force = false): Promise<DeleteBlocked | null> {
    return remove(`/groups/${id}`, force);
}

export function deleteScenario(id: number, force = false): Promise<DeleteBlocked | null> {
    return remove(`/scenarios/${id}`, force);
}

/**
 * Smaže veškerý stav aplikace z prohlížeče (ADR-033).
 *
 * Odhlášení dřív mazalo POUZE token, takže po přepnutí účtu na sdíleném počítači zůstal
 * v prohlížeči strom předchozího lektora — a ten se pak vytlačil na server pod cizí účet.
 * Tohle je jediné místo, kde se stav session zahazuje; volá ho tlačítko odhlášení
 * i větev 401. `theme` se úmyslně zachovává, je to nastavení zařízení, ne uživatele.
 */
export function clearSessionState(): void {
    try {
        const zachovat = new Set(['theme']);
        Object.keys(localStorage)
            .filter(k => (k.startsWith('upvsp_') || k.startsWith('evaluz_')) && !zachovat.has(k))
            .forEach(k => localStorage.removeItem(k));
    } catch {
        // Privátní okno nebo zablokované úložiště — odhlášení nesmí selhat kvůli úklidu.
    }
}
