import React, { useState } from 'react';
import { ChevronRight, CheckCircle2 } from 'lucide-react';

import { Tab, ClassData, DEFAULT_CLASS_DATA } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { AdminModal } from './components/AdminModal';
import { TabCriteria } from './components/TabCriteria';
import { TabEvaluation } from './components/TabEvaluation';
import { TabAnalytics } from './components/TabAnalytics';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('evaluation');
  const [selectedStudent, setSelectedStudent] = useState<number | null>(1); // Default to first student for demo
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Lifted State
  const [classes, setClasses] = React.useState<ClassData[]>(() => {
    const stored = localStorage.getItem('upvsp_classes');
    if (stored) return JSON.parse(stored);
    localStorage.setItem('upvsp_classes', JSON.stringify(DEFAULT_CLASS_DATA));
    return DEFAULT_CLASS_DATA;
  });

  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);

  const handleSelectScenario = (classId: string, scenarioId: string) => {
    setActiveClassId(classId);
    setActiveScenarioId(scenarioId);
  };

  const activeClass = classes.find(c => c.id === activeClassId);
  const activeScenario = activeClass?.scenarios.find(s => s.id === activeScenarioId);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans flex flex-col">
      <Header setIsAdminOpen={setIsAdminOpen} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          classes={classes}
          setClasses={setClasses}
          activeClassId={activeClassId}
          activeScenarioId={activeScenarioId}
          onSelectScenario={handleSelectScenario}
        />

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-white px-8 py-6 border-b border-slate-200">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
              <span>{activeClass?.name || 'Nevybráno'}</span>
              <ChevronRight className="w-4 h-4" />
              <span className="text-[#002855] font-medium">{activeScenario?.name || 'Vyberte situaci v postranním panelu'}</span>
            </div>
            <h2 className="text-3xl font-bold text-[#002855]">{activeScenario?.name || 'ÚPVSP | AI Evaluátor'}</h2>
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
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${isActive
                      ? 'bg-[#002855] text-white ring-4 ring-[#002855]/20 shadow-md'
                      : isPast
                        ? 'bg-[#D4AF37] text-white'
                        : 'bg-white text-slate-400 border-2 border-slate-200 hover:border-slate-300'
                      }`}>
                      {isPast ? <CheckCircle2 className="w-5 h-5" /> : step.num}
                    </div>
                    <span className={`text-sm font-semibold transition-colors ${isActive ? 'text-[#002855]' : isPast ? 'text-slate-700' : 'text-slate-400'
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

      <AdminModal isOpen={isAdminOpen} onClose={() => setIsAdminOpen(false)} />
    </div>
  );
}
