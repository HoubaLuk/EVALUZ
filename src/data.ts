import { Criterion, Student, AnalyticsData } from './types';

export const criteriaData: Criterion[] = [
    { id: 1, name: 'Kdo vyslal hlídku', description: 'Uvedení operačního důstojníka nebo jiného zdroje vyslání.' },
    { id: 2, name: 'Označení místa události', description: 'Přesná adresa nebo popis místa, kde k události došlo.' },
    { id: 3, name: 'Zákonná výzva před použitím DP', description: 'Zda byla učiněna výzva "Jménem zákona!" před použitím donucovacích prostředků.' },
];

export const studentsData: Student[] = [
    { id: 1, name: 'stržm. Jiří Adámek', status: 'evaluated', score: 14, maxScore: 25 },
    { id: 2, name: 'stržm. Petr Novák', status: 'pending', score: 0, maxScore: 25 },
    { id: 3, name: 'stržm. Jan Svoboda', status: 'pending', score: 0, maxScore: 25 },
];

export const evaluationDetails: any[] = [
    {
        id: 1,
        criterion: 'Kdo vyslal hlídku',
        met: true,
        points: 5,
        maxPoints: 5,
        reasoning: 'Student správně uvedl, že hlídku vyslal operační důstojník IOS.',
        sourceQuote: 'Dne 12. 5. 2026 v 14:30 byla naše hlídka vyslána operačním důstojníkem IOS na adresu...'
    },
    {
        id: 2,
        criterion: 'Označení místa události',
        met: true,
        points: 5,
        maxPoints: 5,
        reasoning: 'Místo události je přesně specifikováno včetně čísla popisného.',
        sourceQuote: '...na adresu Nádražní 15, Praha 5, do třetího patra bytového domu.'
    },
    {
        id: 3,
        criterion: 'Zákonná výzva před použitím DP',
        met: false,
        points: 0,
        maxPoints: 10,
        reasoning: 'V textu chybí explicitní zmínka o použití zákonné výzvy před hmaty a chvaty.',
        sourceQuote: 'Po vstupu do bytu se osoba začala chovat agresivně, proto byly ihned použity hmaty a chvaty.'
    },
    {
        id: 4,
        criterion: 'Poučení osoby',
        met: true,
        points: 4,
        maxPoints: 5,
        reasoning: 'Osoba byla poučena, ale chybí přesná citace paragrafu.',
        sourceQuote: 'Osoba byla na místě poučena o svých právech a povinnostech.'
    }
];

export const analyticsData: AnalyticsData[] = [
    { name: 'Chybná citace § 52', count: 12 },
    { name: 'Chybějící lustrace PATROS', count: 8 },
    { name: 'Absence zákonné výzvy', count: 5 },
    { name: 'Nepřesný popis zranění', count: 3 },
];
