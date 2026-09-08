import { API_BASE_URL } from './api';
import { ClassData } from '../types';

/**
 * Strom tříd a modelových situací — uložený na serveru u konkrétního lektora (ADR-031).
 *
 * Dřív žil výhradně v `localStorage`, takže modelová situace vytvořená na jednom počítači
 * na jiném vůbec neexistovala. Kritéria i vyhodnocení přitom v databázi byla — jen se
 * `scenario_id` generuje na klientovi (`scen-${Date.now()}`), takže ho nešlo odnikud
 * zjistit a k datům se nedalo dostat.
 *
 * `localStorage` zůstává jako CACHE: UI se vykreslí okamžitě z posledního známého stavu
 * a server ho vzápětí přepíše. Bez toho by strom po přihlášení na okamžik zmizel.
 */
export const WORKSPACE_CACHE_KEY = 'upvsp_classes';

function authHeaders(): HeadersInit {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`,
    };
}

export function readCachedWorkspace(): ClassData[] | null {
    try {
        const raw = localStorage.getItem(WORKSPACE_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function writeCachedWorkspace(classes: ClassData[]): void {
    try {
        localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify(classes));
    } catch {
        // Plné úložiště nebo privátní okno — cache je jen pohodlí, ne zdroj pravdy.
    }
}

/**
 * Načte strom ze serveru.
 *
 * `null` znamená „lektor na serveru ještě nic nemá" — volající pak nabídne jednorázový
 * přenos z prohlížeče. Prázdné pole je NĚCO JINÉHO: lektor si strom vědomě vymazal
 * a nesmí se mu vrátit.
 */
export async function fetchWorkspace(): Promise<ClassData[] | null> {
    const res = await fetch(`${API_BASE_URL}/workspace`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Nepodařilo se načíst strom situací (HTTP ${res.status})`);
    const data = await res.json();
    return Array.isArray(data?.classes) ? data.classes : null;
}

export async function saveWorkspace(classes: ClassData[]): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/workspace`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ classes }),
    });
    if (!res.ok) throw new Error(`Nepodařilo se uložit strom situací (HTTP ${res.status})`);
}

/**
 * Sjednotí stav po přihlášení a vrátí strom, který se má zobrazit.
 *
 * Server je zdrojem pravdy. Jedinou výjimkou je první přihlášení po nasazení ADR-031:
 * server nemá nic, ale v prohlížeči leží strom z dřívějška — ten se jednorázově vytlačí
 * nahoru, aby o něj lektor nepřišel a aby se jeho dosavadní situace zpřístupnily
 * i z ostatních počítačů.
 */
export async function syncWorkspaceOnLogin(): Promise<ClassData[] | null> {
    const remote = await fetchWorkspace();
    if (remote !== null) {
        writeCachedWorkspace(remote);
        return remote;
    }

    const cached = readCachedWorkspace();
    if (cached && cached.length > 0) {
        await saveWorkspace(cached);
        return cached;
    }
    return null;
}
