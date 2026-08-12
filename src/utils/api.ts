export const API_BASE_URL = `/api/v1`;

/**
 * Výchozí název třídy. MUSÍ odpovídat defaultu parametru `class_name` ve fast-scan
 * endpointu (`backend/api/evaluate.py`) — jinak by se lektorovi vrátila jiná třída,
 * než do které se mu ukládají vyhodnocení.
 */
const DEFAULT_CLASS_NAME = 'Základní kurz';

let cachedClassId: { token: string; promise: Promise<number> } | null = null;

/**
 * Vrátí databázové ID třídy PŘIHLÁŠENÉHO lektora.
 *
 * Dřív bylo ve frontendu natvrdo `/analytics/class/1`. `ClassRoom` se ale zakládá
 * zvlášť pro každého lektora (auto-increment ID), takže data viděl jedině ten, jehož
 * třída měla shodou okolností ID 1. Ostatním backend vracel prázdné pole — jejich
 * vyhodnocené ÚZ zůstaly v UI jako „Nezpracováno", bez skóre a bez možnosti schválení,
 * přestože v DB byly kompletní. Izolace dat podle lektora (ADR-014) funguje nezávisle
 * na tomhle ID, takže nejde o bezpečnostní problém, ale o viditelnost vlastních dat.
 *
 * `POST /evaluate/classes/ensure` je idempotentní: třídu vrátí, a pokud ještě
 * neexistuje, založí ji.
 *
 * Cache je klíčovaná tokenem, takže se sama zneplatní při přihlášení jiného lektora
 * i po odhlášení — není potřeba ji nikde ručně invalidovat.
 */
export function getClassId(): Promise<number> {
    const token = localStorage.getItem('upvsp_token') || '';

    if (cachedClassId && cachedClassId.token === token) {
        return cachedClassId.promise;
    }

    const promise = fetch(`${API_BASE_URL}/evaluate/classes/ensure`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name: DEFAULT_CLASS_NAME }),
    })
        .then(res => {
            if (!res.ok) throw new Error(`Nepodařilo se zjistit ID třídy (HTTP ${res.status})`);
            return res.json();
        })
        .then(data => {
            if (typeof data?.id !== 'number') throw new Error('Odpověď classes/ensure neobsahuje ID třídy.');
            return data.id as number;
        })
        .catch(err => {
            // Zahodit neúspěšný pokus, ať se příští volání zkusí znovu místo toho,
            // aby se navždy drželo zamítnuté promise.
            cachedClassId = null;
            throw err;
        });

    cachedClassId = { token, promise };
    return promise;
}
