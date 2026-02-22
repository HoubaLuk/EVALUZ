import React, { useState } from 'react';
import {
  Shield,
  Settings,
  ChevronDown,
  Folder,
  FileText,
  UploadCloud,
  Wand2,
  CheckCircle2,
  XCircle,
  MessageSquareQuote,
  Save,
  Download,
  Edit,
  Trash2,
  Plus,
  Database,
  BarChart3,
  Network,
  ChevronRight,
  User,
  AlertCircle,
  MoreVertical,
  X,
  SlidersHorizontal
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer
} from 'recharts';

// --- Types ---
type Tab = 'criteria' | 'evaluation' | 'analytics';

// --- Mock Data ---
const criteriaData = [
  { id: 1, name: 'Kdo vyslal hlídku', description: 'Uvedení operačního důstojníka nebo jiného zdroje vyslání.' },
  { id: 2, name: 'Označení místa události', description: 'Přesná adresa nebo popis místa, kde k události došlo.' },
  { id: 3, name: 'Zákonná výzva před použitím DP', description: 'Zda byla učiněna výzva "Jménem zákona!" před použitím donucovacích prostředků.' },
];

const studentsData = [
  { id: 1, name: 'stržm. Jiří Adámek', status: 'evaluated', score: 14, maxScore: 25 },
  { id: 2, name: 'stržm. Petr Novák', status: 'pending', score: 0, maxScore: 25 },
  { id: 3, name: 'stržm. Jan Svoboda', status: 'pending', score: 0, maxScore: 25 },
];

const evaluationDetails = [
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

const analyticsData = [
  { name: 'Chybná citace § 52', count: 12 },
  { name: 'Chybějící lustrace PATROS', count: 8 },
  { name: 'Absence zákonné výzvy', count: 5 },
  { name: 'Nepřesný popis zranění', count: 3 },
];

// --- Components ---

const Tooltip = ({ children, content }: { children: React.ReactNode; content: string }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div 
      className="relative flex items-center"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-[#002855] text-white text-xs rounded-md whitespace-nowrap z-50 shadow-lg">
          {content}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#002855]"></div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('evaluation');
  const [selectedStudent, setSelectedStudent] = useState<number | null>(1); // Default to first student for demo
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<'prompt1' | 'prompt2' | 'prompt3' | 'vllm'>('prompt1');

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans flex flex-col">
      {/* Top Navigation */}
      <header className="h-16 bg-[#002855] text-white flex items-center justify-between px-6 shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#D4AF37] flex items-center justify-center shadow-inner">
            <Shield className="w-6 h-6 text-[#002855]" />
          </div>
          <h1 className="text-xl font-semibold tracking-wide">ÚPVSP | AI Evaluátor ÚZ</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 cursor-pointer hover:text-[#D4AF37] transition-colors">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
              <User className="w-5 h-5 text-slate-300" />
            </div>
            <span className="text-sm font-medium">npor. Mgr. Jan Novák - Lektor</span>
            <ChevronDown className="w-4 h-4" />
          </div>
          <button 
            onClick={() => setIsAdminOpen(true)}
            className="flex items-center gap-2 text-sm font-medium hover:text-[#D4AF37] transition-colors"
          >
            <Settings className="w-4 h-4" />
            Administrace
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shadow-sm z-0">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pracovní prostor</h2>
          </div>
          <div className="p-4 border-b border-slate-100">
            <button className="w-full flex items-center justify-center gap-2 py-2 border-2 border-[#002855] text-[#002855] rounded-lg hover:bg-[#002855] hover:text-white transition-colors text-sm font-semibold">
              <Folder className="w-4 h-4" />
              + Nová třída
            </button>
          </div>
          <div className="p-4 flex-1 overflow-y-auto">
            <div className="space-y-1">
              {/* Folder */}
              <div className="group flex items-center justify-between px-2 py-1.5 text-slate-700 hover:bg-slate-50 rounded-md cursor-pointer transition-colors">
                <div className="flex items-center gap-2">
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                  <Folder className="w-4 h-4 text-[#D4AF37]" />
                  <span className="font-medium text-sm">ZOP 01/2026</span>
                </div>
                <button className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-[#002855] transition-all rounded-md hover:bg-slate-200">
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* Files */}
              <div className="pl-8 space-y-1">
                <div className="group flex items-center justify-between px-2 py-1.5 text-slate-600 hover:bg-slate-50 rounded-md cursor-pointer transition-colors">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400" />
                    <span className="text-sm">MS1: Dopravní nehoda</span>
                  </div>
                  <button className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-[#002855] transition-all rounded-md hover:bg-slate-200">
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="group flex items-center justify-between px-2 py-1.5 bg-[#002855]/5 text-[#002855] rounded-md cursor-pointer border-l-2 border-[#002855] transition-colors">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#002855]" />
                    <span className="text-sm font-semibold">MS2: Vstup do obydlí</span>
                  </div>
                  <button className="opacity-0 group-hover:opacity-100 p-1 text-[#002855]/60 hover:text-[#002855] transition-all rounded-md hover:bg-[#002855]/10">
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Add Scenario Button */}
                <div className="pt-1">
                  <button className="flex items-center gap-2 px-2 py-1.5 w-full text-left text-slate-400 hover:text-[#D4AF37] hover:bg-slate-50 rounded-md transition-colors text-sm font-medium">
                    <FileText className="w-4 h-4 opacity-50" />
                    + Nová modelová situace
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-white px-8 py-6 border-b border-slate-200">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
              <span>ZOP 01/2026</span>
              <ChevronRight className="w-4 h-4" />
              <span className="text-[#002855] font-medium">Modelová situace 2</span>
            </div>
            <h2 className="text-3xl font-bold text-[#002855]">MS2: Vstup do obydlí</h2>
            <p className="text-slate-500 mt-1">Hodnocení úředních záznamů dle § 40 zákona o policii.</p>
          </div>

          {/* Workflow Stepper */}
          <div className="px-8 py-6 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center justify-between max-w-4xl mx-auto relative">
              {/* Connecting Line */}
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-slate-200 rounded-full z-0"></div>
              <div 
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-[#002855] rounded-full z-0 transition-all duration-300"
                style={{ width: activeTab === 'criteria' ? '0%' : activeTab === 'evaluation' ? '50%' : '100%' }}
              ></div>

              {/* Steps */}
              {[
                { id: 'criteria', num: '1', label: 'Precizace kritérií' },
                { id: 'evaluation', num: '2', label: 'Vyhodnocení ÚZ' },
                { id: 'analytics', num: '3', label: 'Analýza třídy' }
              ].map((step, index) => {
                const isActive = activeTab === step.id;
                const isPast = 
                  (activeTab === 'evaluation' && index === 0) || 
                  (activeTab === 'analytics' && index <= 1);

                return (
                  <button
                    key={step.id}
                    onClick={() => setActiveTab(step.id as Tab)}
                    className="relative z-10 flex flex-col items-center gap-2 group"
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                      isActive 
                        ? 'bg-[#002855] text-white ring-4 ring-[#002855]/20 shadow-md' 
                        : isPast
                          ? 'bg-[#D4AF37] text-white'
                          : 'bg-white text-slate-400 border-2 border-slate-200 hover:border-slate-300'
                    }`}>
                      {isPast ? <CheckCircle2 className="w-5 h-5" /> : step.num}
                    </div>
                    <span className={`text-sm font-semibold transition-colors ${
                      isActive ? 'text-[#002855]' : isPast ? 'text-slate-700' : 'text-slate-400'
                    }`}>
                      {step.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab Content Area */}
          <div className="flex-1 overflow-y-auto p-8">
            {activeTab === 'criteria' && <TabCriteria />}
            {activeTab === 'evaluation' && (
              <TabEvaluation 
                selectedStudent={selectedStudent} 
                setSelectedStudent={setSelectedStudent} 
              />
            )}
            {activeTab === 'analytics' && <TabAnalytics />}
          </div>
        </main>
      </div>

      {/* Administration Modal */}
      {isAdminOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-[#002855] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#D4AF37]" />
                <h2 className="text-lg font-semibold tracking-wide">Administrace systému & Prompt Engineering</h2>
              </div>
              <button 
                onClick={() => setIsAdminOpen(false)}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 flex overflow-hidden">
              {/* Modal Sidebar */}
              <div className="w-64 bg-slate-50 border-r border-slate-200 p-4 flex flex-col gap-1">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Kategorie promptů</h3>
                <button 
                  onClick={() => setAdminTab('prompt1')}
                  className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                    adminTab === 'prompt1' 
                      ? 'bg-[#002855]/10 text-[#002855] font-semibold border-l-4 border-[#002855]' 
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Fáze 1: Precizace kritérií
                </button>
                <button 
                  onClick={() => setAdminTab('prompt2')}
                  className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                    adminTab === 'prompt2' 
                      ? 'bg-[#002855]/10 text-[#002855] font-semibold border-l-4 border-[#002855]' 
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Fáze 2: Evaluace ÚZ (JSON)
                </button>
                <button 
                  onClick={() => setAdminTab('prompt3')}
                  className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                    adminTab === 'prompt3' 
                      ? 'bg-[#002855]/10 text-[#002855] font-semibold border-l-4 border-[#002855]' 
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Fáze 3: Globální analýza
                </button>
                <div className="my-2 border-t border-slate-200"></div>
                <button 
                  onClick={() => setAdminTab('vllm')}
                  className={`w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
                    adminTab === 'vllm' 
                      ? 'bg-[#002855]/10 text-[#002855] font-semibold border-l-4 border-[#002855]' 
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  Napojení na vLLM (API)
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 p-6 flex flex-col bg-white overflow-hidden">
                {adminTab !== 'vllm' ? (
                  <>
                    <div className="mb-4">
                      <h3 className="text-lg font-bold text-[#002855] mb-1">
                        Systémový prompt: {adminTab === 'prompt1' ? 'Fáze 1' : adminTab === 'prompt2' ? 'Fáze 2' : 'Fáze 3'}
                      </h3>
                      <p className="text-sm text-slate-500 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 text-[#D4AF37]" />
                        Zde můžete upravit chování AI. Změny se projeví u všech lektorů.
                      </p>
                    </div>
                    
                    <textarea 
                      className="flex-1 w-full border border-slate-300 rounded-xl p-4 font-mono text-sm text-slate-700 focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none resize-none leading-relaxed bg-slate-50"
                      defaultValue={`Jsi expertní asistent pro tvorbu metodických materiálů Policie ČR (Útvar policejního vzdělávání a služební přípravy).

Tvým úkolem je transformovat heslovitá zadání lektora do strukturovaných hodnotících kritérií v Markdownu.
Při komunikaci s lektorem využívej Sokratovské dotazování - ptej se na detaily, které by mohly být sporné (např. přesné znění paragrafů, nutnost lustrace v evidencích, přesné formulace zákonných výzev).

Výstup musí vždy obsahovat:
1. Bodovou hodnotu
2. Popis pro AI (Klíčová instrukce pro následnou evaluaci)
3. Příklady správného splnění
4. Příklady chybného splnění

Zachovávej maximální profesionalitu, stručnost a přesnost v souladu se zákonem č. 273/2008 Sb., o Policii České republiky.`}
                    />

                    <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <label className="block text-sm font-semibold text-[#002855] mb-1">Model Temperature</label>
                        <p className="text-xs text-slate-500">Určuje míru kreativity vs. faktické přesnosti modelu.</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <input type="range" min="0" max="1" step="0.1" defaultValue="0.1" className="w-32 accent-[#002855]" />
                        <span className="bg-white border border-slate-200 px-3 py-1 rounded-md text-sm font-mono font-medium text-[#002855]">
                          0.1 (Faktická přesnost)
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col">
                    <div className="mb-6">
                      <h3 className="text-lg font-bold text-[#002855] mb-1">Konfigurace inferenčního enginu</h3>
                      <p className="text-sm text-slate-500">Nastavení připojení k lokálnímu nebo vzdálenému vLLM serveru.</p>
                    </div>
                    
                    <div className="space-y-6 max-w-2xl">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">API Endpoint URL</label>
                        <div className="flex gap-3">
                          <input 
                            type="text" 
                            placeholder="http://localhost:8000/v1"
                            defaultValue="http://localhost:8000/v1"
                            className="flex-1 border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none"
                          />
                          <button className="px-4 py-2.5 border-2 border-[#002855] text-[#002855] rounded-lg hover:bg-[#002855] hover:text-white transition-colors text-sm font-semibold whitespace-nowrap">
                            Test připojení
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Název modelu / Model ID</label>
                        <input 
                          type="text" 
                          placeholder="qwen2.5-32b-instruct"
                          defaultValue="qwen2.5-32b-instruct"
                          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">API Key (volitelné)</label>
                        <input 
                          type="password" 
                          placeholder="sk-..."
                          className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Max Tokens</label>
                        <input 
                          type="number" 
                          placeholder="4096"
                          defaultValue={4096}
                          className="w-full sm:w-1/3 border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button 
                onClick={() => setIsAdminOpen(false)}
                className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium shadow-sm"
              >
                Zrušit
              </button>
              <button 
                onClick={() => setIsAdminOpen(false)}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#D4AF37] to-[#C5A028] text-white rounded-lg hover:opacity-90 transition-opacity text-sm font-bold shadow-md"
              >
                <Save className="w-4 h-4" />
                {adminTab === 'vllm' ? 'Uložit konfiguraci API' : 'Uložit systémové prompty'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Tab Components ---

function TabCriteria() {
  return (
    <div className="h-full flex gap-6 max-w-7xl mx-auto">
      {/* Left Column: Socratic AI Chat */}
      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-[#002855]" />
            <h3 className="font-semibold text-[#002855]">AI Asistent pro tvorbu kritérií</h3>
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 text-slate-600 rounded-md hover:bg-slate-50 transition-colors text-xs font-medium shadow-sm">
            <UploadCloud className="w-3.5 h-3.5" />
            Nahrát metodický pokyn/skripta (.pdf)
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
          {/* Chat Messages */}
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[#002855] flex items-center justify-center flex-shrink-0">
              <Wand2 className="w-4 h-4 text-[#D4AF37]" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-3 text-sm text-slate-700 shadow-sm">
              <p>Dobrý den, jsem váš AI asistent pro tvorbu hodnotících kritérií. Vložte prosím název modelové situace a svá heslovitá kritéria. Budu se vás následně doptávat na detaily.</p>
            </div>
          </div>
          
          <div className="flex gap-3 flex-row-reverse">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-slate-600" />
            </div>
            <div className="bg-[#002855] text-white rounded-2xl rounded-tr-none p-3 text-sm shadow-sm">
              <p>MS2: Vstup do obydlí. Kritérium 1: Kdo vyslal hlídku. Kritérium 2: Ustanovení § a zákona pro použití DP.</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[#002855] flex items-center justify-center flex-shrink-0">
              <Wand2 className="w-4 h-4 text-[#D4AF37]" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-3 text-sm text-slate-700 shadow-sm">
              <p>Děkuji. Podívejme se na Kritérium 1. Jaký konkrétní subjekt musí student uvést, aby bylo splněno? Stačí uvést 'OOP Holešov', nebo vyžadujete explicitně např. 'Operační středisko' (OS) či 'Dozorčí služba' (DS)?</p>
            </div>
          </div>

          <div className="flex gap-3 flex-row-reverse">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-slate-600" />
            </div>
            <div className="bg-[#002855] text-white rounded-2xl rounded-tr-none p-3 text-sm shadow-sm">
              <p>Musí tam být výslovně OS nebo DS. Uvést samotný útvar nestačí.</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[#002855] flex items-center justify-center flex-shrink-0">
              <Wand2 className="w-4 h-4 text-[#D4AF37]" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-3 text-sm text-slate-700 shadow-sm">
              <p>Zapsáno. U Kriteria 2 se ptáte na DP. Považujete za správné pouze § 52 písm. a) a p) ZOP, nebo uznáte i § 53?</p>
            </div>
          </div>

          <div className="flex gap-3 flex-row-reverse">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-slate-600" />
            </div>
            <div className="bg-[#002855] text-white rounded-2xl rounded-tr-none p-3 text-sm shadow-sm">
              <p>Pouze § 52 písm. a) a p). Pokud napíše § 53, je to chyba.</p>
            </div>
          </div>
          
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[#002855] flex items-center justify-center flex-shrink-0">
              <Wand2 className="w-4 h-4 text-[#D4AF37]" />
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl rounded-tl-none p-3 text-sm text-emerald-800 shadow-sm">
              <p className="flex items-center gap-2 font-medium mb-1"><CheckCircle2 className="w-4 h-4" /> Úspěšně analyzováno</p>
              <p>Rozumím. Získal jsem všechny potřebné informace pro precizní formulaci. Generuji finální kritéria do pravého panelu.</p>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-white">
          <div className="relative">
            <input 
              type="text" 
              placeholder="Napište zprávu asistentovi..." 
              className="w-full border border-slate-300 rounded-lg pl-4 pr-12 py-3 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none"
            />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-[#002855] text-white rounded-md hover:bg-[#002855]/90 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Criteria Output */}
      <div className="flex-1 flex flex-col gap-4">
        <div className="flex items-center justify-between bg-[#002855] text-white p-4 rounded-xl shadow-sm">
          <h3 className="text-lg font-bold tracking-wide">HODNOTÍCÍ KRITÉRIA: MS2 - Vstup do obydlí</h3>
          <Shield className="w-5 h-5 text-[#D4AF37]" />
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {/* Criterion 1 */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-[#002855] text-white text-xs font-bold px-2 py-0.5 rounded">Kritérium 1</span>
                  <h4 className="font-bold text-[#002855] text-lg">Kdo vyslal hlídku</h4>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-slate-200 text-slate-700 text-xs font-semibold px-2.5 py-1 rounded-full">1 bod</span>
              </div>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div>
                <h5 className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Wand2 className="w-4 h-4 text-[#D4AF37]" /> Popis pro AI (Klíčová instrukce)
                </h5>
                <p className="text-slate-600 bg-slate-50 p-2.5 rounded-md border border-slate-100">
                  Student musí explicitně uvést, že hlídku vyslalo Operační středisko (OS) nebo Dozorčí služba (DS). Uvedení samotného útvaru (např. OOP Holešov) je nedostačující.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h5 className="font-semibold text-emerald-700 mb-1 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Příklady správného splnění
                  </h5>
                  <ul className="list-disc list-inside text-slate-600 space-y-1 bg-emerald-50/50 p-2.5 rounded-md border border-emerald-100">
                    <li>"Hlídka byla vyslána dozorčí službou..."</li>
                    <li>"...na pokyn operačního střediska."</li>
                  </ul>
                </div>
                <div>
                  <h5 className="font-semibold text-rose-700 mb-1 flex items-center gap-1.5">
                    <XCircle className="w-4 h-4" /> Příklady chybného splnění
                  </h5>
                  <ul className="list-disc list-inside text-slate-600 space-y-1 bg-rose-50/50 p-2.5 rounded-md border border-rose-100">
                    <li>"Hlídka OOP Holešov vyjela na místo..."</li>
                    <li>"Byli jsme vysláni na adresu..."</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Criterion 2 */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-[#002855] text-white text-xs font-bold px-2 py-0.5 rounded">Kritérium 2</span>
                  <h4 className="font-bold text-[#002855] text-lg">Ustanovení § a zákona pro použití DP</h4>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-rose-100 text-rose-700 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Klíčové
                </span>
                <span className="bg-slate-200 text-slate-700 text-xs font-semibold px-2.5 py-1 rounded-full">2 body</span>
              </div>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div>
                <h5 className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Wand2 className="w-4 h-4 text-[#D4AF37]" /> Popis pro AI (Klíčová instrukce)
                </h5>
                <p className="text-slate-600 bg-slate-50 p-2.5 rounded-md border border-slate-100">
                  Student musí uvést použití donucovacích prostředků výhradně podle § 52 písm. a) a p) zákona o policii. Zmínka o § 53 je hodnocena jako chyba.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h5 className="font-semibold text-emerald-700 mb-1 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Příklady správného splnění
                  </h5>
                  <ul className="list-disc list-inside text-slate-600 space-y-1 bg-emerald-50/50 p-2.5 rounded-md border border-emerald-100">
                    <li>"Byly použity donucovací prostředky dle § 52 písm. a) a p) ZOP..."</li>
                  </ul>
                </div>
                <div>
                  <h5 className="font-semibold text-rose-700 mb-1 flex items-center gap-1.5">
                    <XCircle className="w-4 h-4" /> Příklady chybného splnění
                  </h5>
                  <ul className="list-disc list-inside text-slate-600 space-y-1 bg-rose-50/50 p-2.5 rounded-md border border-rose-100">
                    <li>"...dle § 53 ZOP"</li>
                    <li>"...použity hmaty a chvaty dle zákona."</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        <button className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-[#D4AF37] to-[#C5A028] text-white rounded-xl hover:opacity-90 transition-opacity text-base font-bold shadow-md mt-2">
          <Save className="w-5 h-5" />
          Uložit do databáze kritérií
        </button>
      </div>
    </div>
  );
}

function TabEvaluation({ selectedStudent, setSelectedStudent }: { selectedStudent: number | null, setSelectedStudent: (id: number | null) => void }) {
  const [students, setStudents] = useState(studentsData);
  const [selectAll, setSelectAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([1]);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [activeSourceQuote, setActiveSourceQuote] = useState<string | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationProgress, setEvaluationProgress] = useState(0);

  const toggleStudent = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedIds([]);
    } else {
      setSelectedIds(students.map(s => s.id));
    }
    setSelectAll(!selectAll);
  };

  const openSourceModal = (quote: string) => {
    setActiveSourceQuote(quote);
    setIsSourceModalOpen(true);
  };

  const handleBatchEvaluate = () => {
    if (selectedIds.length === 0) return;
    setIsEvaluating(true);
    setEvaluationProgress(0);

    const interval = setInterval(() => {
      setEvaluationProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsEvaluating(false);
          setStudents(currentStudents => 
            currentStudents.map(s => 
              selectedIds.includes(s.id) ? { ...s, status: 'evaluated', score: Math.floor(Math.random() * 5) + 20 } : s
            )
          );
          return 100;
        }
        return prev + 5;
      });
    }, 150); // 100% in 3 seconds (20 steps of 150ms)
  };

  return (
    <div className="h-full flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* Top Action Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-2 px-4 py-2 border-2 border-[#002855] text-[#002855] rounded-lg hover:bg-[#002855] hover:text-white transition-colors text-sm font-semibold">
            <UploadCloud className="w-4 h-4" />
            Nahrát ÚZ (.docx)
          </button>
          <button 
            onClick={handleSelectAll}
            className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors text-sm font-medium"
          >
            <input 
              type="checkbox" 
              checked={selectAll}
              onChange={handleSelectAll}
              className="w-4 h-4 rounded border-slate-300 text-[#002855] focus:ring-[#002855]"
            />
            Vybrat všechny
          </button>
        </div>
        <button 
          onClick={handleBatchEvaluate}
          disabled={isEvaluating || selectedIds.length === 0}
          className={`flex items-center gap-2 px-6 py-2.5 text-white rounded-lg transition-all text-sm font-bold shadow-md relative overflow-hidden ${
            isEvaluating || selectedIds.length === 0
              ? 'bg-slate-300 cursor-not-allowed'
              : 'bg-gradient-to-r from-[#D4AF37] to-[#C5A028] hover:opacity-90'
          }`}
        >
          {isEvaluating && (
            <div 
              className="absolute left-0 top-0 bottom-0 bg-black/10 transition-all duration-150" 
              style={{ width: `${evaluationProgress}%` }}
            />
          )}
          <Wand2 className={`w-4 h-4 relative z-10 ${isEvaluating ? 'animate-pulse' : ''}`} />
          <span className="relative z-10">
            {isEvaluating ? `Zpracovávám... ${evaluationProgress}%` : 'Hromadně vyhodnotit (AI)'}
          </span>
        </button>
      </div>

      {/* Two-Column Layout */}
      <div className="flex-1 flex gap-6 min-h-[500px]">
        {/* Left Column: Student Roster (25%) */}
        <div className="w-1/4 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="font-semibold text-[#002855]">Seznam studentů</h3>
            <span className="text-xs font-medium text-slate-400">{selectedIds.length}/{students.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {students.map(student => (
              <div
                key={student.id}
                className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors cursor-pointer ${
                  selectedStudent === student.id 
                    ? 'bg-[#002855]/10 border border-[#002855]/20' 
                    : 'hover:bg-slate-50 border border-transparent'
                }`}
                onClick={() => setSelectedStudent(student.id)}
              >
                <input 
                  type="checkbox" 
                  checked={selectedIds.includes(student.id)}
                  onChange={() => toggleStudent(student.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 rounded border-slate-300 text-[#002855] focus:ring-[#002855]"
                />
                <div className="flex-1 min-w-0 flex items-center justify-between">
                  <p className={`text-sm font-medium truncate ${selectedStudent === student.id ? 'text-[#002855]' : 'text-slate-700'}`}>
                    {student.name}
                  </p>
                  {student.status === 'evaluated' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3" /> Zpracováno
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                      <AlertCircle className="w-3 h-3" /> Čeká
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: The Full-Width Evaluation Canvas (75%) */}
        <div className="w-3/4 flex flex-col gap-4">
          {selectedStudent === 1 ? (
            <>
              {/* Header */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                    <User className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-[#002855]">Hodnocení: stržm. Jiří Adámek</h2>
                    <p className="text-sm text-slate-500">MS2: Vstup do obydlí • Nahráno: 12. 5. 2026 15:42</p>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Celkové skóre</span>
                  <div className="bg-[#002855] text-white px-4 py-1.5 rounded-lg font-bold text-lg shadow-inner">
                    {students.find(s => s.id === 1)?.score || 14} / 25 b.
                  </div>
                </div>
              </div>

              {/* AI Evaluation Table */}
              <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-[#002855] text-white flex items-center gap-2">
                  <Wand2 className="w-5 h-5 text-[#D4AF37]" />
                  <h3 className="font-semibold text-base tracking-wide">Výsledky AI Evaluace</h3>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                        <th className="px-6 py-4 font-medium w-1/4">Kritérium</th>
                        <th className="px-6 py-4 font-medium text-center w-24">Splněno</th>
                        <th className="px-6 py-4 font-medium">Zdůvodnění</th>
                        <th className="px-6 py-4 font-medium text-center w-24">Body</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {evaluationDetails.map((detail) => (
                        <tr key={detail.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-5 text-sm font-medium text-[#002855] align-top">
                            {detail.criterion}
                          </td>
                          <td className="px-6 py-5 text-center align-top">
                            {detail.met ? (
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 shadow-sm">
                                <CheckCircle2 className="w-5 h-5" />
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-rose-100 text-rose-700 shadow-sm">
                                <XCircle className="w-5 h-5" />
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-5 text-sm text-slate-600 align-top">
                            <div className="flex items-start gap-3">
                              <p className="leading-relaxed flex-1">{detail.reasoning}</p>
                              <Tooltip content="Zobrazit zdroj v textu studenta (AI Act Compliance)">
                                <button 
                                  onClick={() => openSourceModal(detail.sourceQuote)}
                                  className="p-2 text-[#D4AF37] hover:bg-[#D4AF37]/10 rounded-lg transition-colors flex-shrink-0 mt-0.5 border border-[#D4AF37]/30 shadow-sm bg-white" 
                                  aria-label="Zobrazit zdroj v textu studenta"
                                >
                                  <MessageSquareQuote className="w-4 h-4" />
                                </button>
                              </Tooltip>
                            </div>
                          </td>
                          <td className="px-6 py-5 text-center align-top">
                            <div className="flex flex-col items-center gap-1">
                              <input 
                                type="number" 
                                defaultValue={detail.points}
                                className="w-14 text-center border border-slate-300 rounded-md py-1 text-sm font-medium focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37] outline-none"
                              />
                              <span className="text-xs text-slate-400 font-medium">/{detail.maxPoints}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bottom Action Bar */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#002855] uppercase tracking-wider mb-2">
                    Závěrečná pedagogická zpětná vazba (Editovatelné)
                  </label>
                  <textarea 
                    className="w-full border border-slate-300 rounded-xl p-4 text-sm focus:ring-2 focus:ring-[#002855] focus:border-[#002855] outline-none resize-none h-24 bg-slate-50 leading-relaxed"
                    defaultValue="Úřední záznam je celkově dobře strukturovaný, nicméně zcela chybí zákonná výzva před použitím donucovacích prostředků, což je fatální chyba. Dále je nutné přesněji specifikovat paragrafy při poučení osoby."
                  />
                </div>
                <div className="flex justify-end">
                  <button className="flex items-center gap-2 px-6 py-3 bg-[#002855] text-white rounded-xl hover:bg-[#002855]/90 transition-colors text-sm font-bold shadow-md">
                    <Download className="w-5 h-5 text-[#D4AF37]" />
                    Uložit a Exportovat PDF
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-slate-400">
              <AlertCircle className="w-12 h-12 mb-4 text-slate-300" />
              <p className="text-lg font-medium text-slate-500">Vyberte studenta pro zobrazení evaluace</p>
            </div>
          )}
        </div>
      </div>

      {/* AI Act Source Modal Placeholder */}
      {isSourceModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-[#002855] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#D4AF37]" />
                <h2 className="text-lg font-semibold tracking-wide">Zdrojová pasáž z textu studenta</h2>
              </div>
              <button 
                onClick={() => setIsSourceModalOpen(false)}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 bg-[#fdfdfc]">
              <p className="text-sm text-slate-500 mb-4">
                Níže je zobrazen originální text studenta se zvýrazněnou pasáží, na jejímž základě AI asistent učinil své rozhodnutí.
              </p>
              <div className="font-serif text-sm leading-relaxed text-slate-800 whitespace-pre-wrap max-w-prose mx-auto bg-white border border-slate-200 p-6 rounded-xl shadow-sm">
                {`...
Po vstupu do bytu se osoba začala chovat agresivně a s napřaženou pěstí se rozběhla proti zakročujícím policistům, proto byly ihned použity hmaty a chvaty sebeobrany, kterými byl muž sveden na zem a byla mu přiložena pouta.

`}
                <mark className="bg-yellow-200 px-1 rounded text-slate-900 font-medium">{activeSourceQuote}</mark>
                {`

Osoba byla na místě poučena o svých právech a povinnostech. Na místo byla přivolána RZS k ošetření napadené ženy. Lustrace v evidencích (PATROS) proběhla s negativním výsledkem.
...`}
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button 
                onClick={() => setIsSourceModalOpen(false)}
                className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium shadow-sm"
              >
                Zavřít
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabAnalytics() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold text-[#002855]">Globální analýza třídy</h3>
          <p className="text-sm text-slate-500 mt-1">Agregovaná data z 24 hodnocených úředních záznamů.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-[#002855] text-white rounded-lg hover:bg-[#002855]/90 transition-colors text-sm font-medium shadow-sm">
          <Download className="w-4 h-4 text-[#D4AF37]" />
          Exportovat analýzu do PDF
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Chart */}
        <div className="col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <BarChart3 className="w-5 h-5 text-[#002855]" />
            <h4 className="font-semibold text-[#002855]">Nejčastější chyby napříč třídou</h4>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analyticsData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#E2E8F0" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 12, fill: '#475569' }} />
                <RechartsTooltip 
                  cursor={{fill: '#F1F5F9'}}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="count" fill="#002855" radius={[0, 4, 4, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Mindmap Placeholder */}
        <div className="col-span-1 bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Network className="w-5 h-5 text-[#002855]" />
            <h4 className="font-semibold text-[#002855]">Myšlenková mapa chybovosti</h4>
          </div>
          <div className="flex-1 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-center p-4 text-center">
            <div className="text-slate-400">
              <Network className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm font-medium">Interaktivní mapa vazeb</p>
              <p className="text-xs mt-1">Zobrazuje korelaci mezi chybami (např. chybějící výzva často souvisí s nepřesným popisem DP).</p>
            </div>
          </div>
        </div>
      </div>

      {/* AI Recommendations */}
      <div className="bg-gradient-to-br from-[#002855] to-[#001a38] rounded-xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#D4AF37] rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-x-1/2 -translate-y-1/2"></div>
        
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <Wand2 className="w-5 h-5 text-[#D4AF37]" />
            <h4 className="font-semibold text-lg">Pedagogická doporučení pro další výuku (AI)</h4>
          </div>
          <div className="space-y-4 text-slate-200 text-sm leading-relaxed">
            <p>
              <strong className="text-white">1. Zaměření na § 52 (Zákonná výzva):</strong> 50 % studentů (12/24) opomnělo uvést přesné znění zákonné výzvy před použitím donucovacích prostředků. Doporučujeme zařadit krátký opakovací blok na toto téma do příští hodiny.
            </p>
            <p>
              <strong className="text-white">2. Lustrace v evidencích:</strong> Třetina třídy nezmínila provedení lustrace osob v systému PATROS. Je vhodné zdůraznit, že lustrace je standardním postupem při každém ztotožňování.
            </p>
            <p>
              <strong className="text-white">3. Pozitivní trend:</strong> Všichni studenti správně identifikovali a popsali místo události i osobu, která hlídku na místo vyslala. V tomto ohledu je metodika výuky vysoce efektivní.
            </p>
          </div>
          <button className="mt-6 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg transition-colors text-sm font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Vytvořit osnovu pro opakovací hodinu
          </button>
        </div>
      </div>
    </div>
  );
}
