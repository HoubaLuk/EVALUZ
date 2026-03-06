import * as React from 'react';
import { useState, useEffect } from 'react';
import { ChevronRight, CheckCircle2, Lock, UserPlus, LogIn, Loader2, Eye, EyeOff } from 'lucide-react';

import { Tab, ClassData, DEFAULT_CLASS_DATA } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { AdminModal } from './components/AdminModal';
import { TabCriteria } from './components/TabCriteria';
import { TabEvaluation } from './components/TabEvaluation';
import { TabAnalytics } from './components/TabAnalytics';

import { API_BASE_URL } from './utils/api';

/**
 * Hlavní vstupní bod aplikace EVALUZ.
 * Spravuje globální stav (autentizace, výběr scénářů) a základní layout.
 */
export default function EvaluzDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('evaluation');
  const [selectedStudent, setSelectedStudent] = useState<number | null>(1); // Default to first student for demo
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Auth State
  const [authState, setAuthState] = useState<'CHECKING' | 'RECOGNIZED_EMPTY_DB' | 'LOGIN_REQUIRED' | 'AUTHENTICATED' | 'FORCE_PASSWORD_CHANGE'>('CHECKING');
  const [token, setToken] = useState<string | null>(localStorage.getItem('upvsp_token'));
  const [lecturerName, setLecturerName] = useState<string>('Načítám profil...');

  // Auth Form State (Login jen v App.tsx, zbytek v AdminModal)
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Lifed State
  const [classes, setClasses] = React.useState<ClassData[]>(() => {
    const stored = localStorage.getItem('upvsp_classes');
    if (stored) return JSON.parse(stored);
    localStorage.setItem('upvsp_classes', JSON.stringify(DEFAULT_CLASS_DATA));
    return DEFAULT_CLASS_DATA;
  });

  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [cachedAnalytics, setCachedAnalytics] = useState<Record<string, any>>({});
  const [scenariosWithAnalysis, setScenariosWithAnalysis] = useState<string[]>([]);
  const [hasEvaluations, setHasEvaluations] = useState(false);
  const [hasCriteria, setHasCriteria] = useState(false);

  useEffect(() => {
    // Načíst aktuální stav vložených kritérií pro scénář z DB
    if (activeScenarioId && token) {
      fetch(`${API_BASE_URL}/criteria/${activeScenarioId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.markdown_content && data.markdown_content !== "Kritéria zatím nebyla definována.") {
            setHasCriteria(true);
          } else {
            setHasCriteria(false);
          }
        })
        .catch(e => console.error(e));
    }
  }, [activeScenarioId, token]);

  useEffect(() => {
    // Načíst stav evaluací pro stávající scénář - pro správné zezlátnutí stepper ikony
    if (activeScenarioId && token) {
      fetch(`${API_BASE_URL}/analytics/class/1?scenario_id=${activeScenarioId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.some((s: any) => s.vysledky && s.vysledky.length > 0)) {
            setHasEvaluations(true);
          } else {
            setHasEvaluations(false);
          }
        })
        .catch(e => console.error(e));
    }
  }, [activeScenarioId, token]);

  useEffect(() => {
    // Načíst z DB jaké scénáře už mají hotovou analýzu
    fetch(`${API_BASE_URL}/analytics/class/1/status`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setScenariosWithAnalysis(data);
        }
      })
      .catch(e => console.error(e));
  }, []);

  const handleSelectScenario = (classId: string, scenarioId: string) => {
    setActiveClassId(classId);
    setActiveScenarioId(scenarioId);
    setCachedAnalytics({});
    setHasEvaluations(false);
    setHasCriteria(false);
  };

  useEffect(() => {
    if (classes && classes.length > 0 && !activeClassId) {
      const firstClass = classes[0];
      if (firstClass.scenarios && firstClass.scenarios.length > 0 && !activeScenarioId) {
        setActiveClassId(firstClass.id);
        setActiveScenarioId(firstClass.scenarios[0].id);
      }
    }
  }, [classes, activeClassId, activeScenarioId]);

  const activeClass = classes.find(c => c.id === activeClassId);
  const activeScenario = activeClass?.scenarios.find(s => s.id === activeScenarioId);

  // --- Auth & Initial Load ---
  useEffect(() => {
    const checkAuthStatus = async () => {
      setAuthState('CHECKING');
      try {
        const res = await fetch(`${API_BASE_URL}/auth/check?_t=${new Date().getTime()}`, {
          headers: { 'Cache-Control': 'no-cache' }
        });
        if (res.ok) {
          const checkData = await res.json();
          if (checkData.needs_setup) {
            setAuthState('RECOGNIZED_EMPTY_DB');
            setIsAdminOpen(true);
            return;
          }
        }

        if (token) {
          const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (!meRes.ok) {
            console.error("Ověřování tokenu selhalo, status:", meRes.status);
            setToken(null);
            localStorage.removeItem('upvsp_token');
            setAuthState('LOGIN_REQUIRED');
          } else {
            const meData = await meRes.json();
            const fullName = `${meData.rank_shortcut || ''} ${meData.title_before || ''} ${meData.first_name || ''} ${meData.last_name || ''}`;
            const displayRole = meData.funkcni_zarazeni ? ` - ${meData.funkcni_zarazeni}` : ' - Lektor';
            setLecturerName(fullName.replace(/\s+/g, ' ').trim() + displayRole);

            if (meData.must_change_password) {
              setAuthState('FORCE_PASSWORD_CHANGE');
            } else {
              setAuthState('AUTHENTICATED');
            }
          }
        } else {
          setAuthState('LOGIN_REQUIRED');
        }
      } catch (err) {
        console.error("Chyba při komunikaci s backendem (auth check):", err);
        setAuthState('LOGIN_REQUIRED');
      }
    };
    checkAuthStatus();
  }, [token]);


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append('username', authEmail);
      formData.append('password', authPassword);

      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });

      if (!res.ok) {
        throw new Error('Nesprávný email nebo heslo');
      }

      const data = await res.json();
      setToken(data.access_token);
      localStorage.setItem('upvsp_token', data.access_token);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };



  if (authState === 'CHECKING') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#002855] animate-spin mb-4" />
        <p className="text-slate-500 dark:text-slate-400 font-medium">Ověřování přístupu...</p>
      </div>
    );
  }

  if (authState === 'RECOGNIZED_EMPTY_DB') {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <AdminModal
          isOpen={isAdminOpen}
          onClose={() => { }}
          isSetupMode={true}
          onSetupComplete={(newToken) => {
            setToken(newToken);
            localStorage.setItem('upvsp_token', newToken);
            setIsAdminOpen(false);
            setAuthState('AUTHENTICATED');
          }}
        />
      </div>
    );
  }

  if (authState === 'LOGIN_REQUIRED') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-lg shadow-slate-200/50 border border-slate-100 overflow-hidden">
          <div className="bg-[#002855] px-6 py-6 text-center">
            <Lock className="w-12 h-12 text-white/90 mx-auto mb-3" />
            <h2 className="text-2xl font-bold text-white">Přihlášení do systému</h2>
            <p className="text-blue-200 text-sm mt-1">EVALUZ</p>
          </div>
          <form onSubmit={handleLogin} className="p-6">
            {authError && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">{authError}</div>}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">E-mail lektora</label>
                <input type="email" required value={authEmail} onChange={e => setAuthEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#002855] focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Heslo</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={authPassword}
                    onChange={e => setAuthPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#002855] focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 dark:text-slate-300"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <button type="submit" disabled={authLoading} className="w-full mt-6 bg-[#002855] text-white py-2.5 rounded-md font-medium hover:bg-[#001f44] transition-colors flex justify-center items-center">
              {authLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                <><LogIn className="w-5 h-5 mr-2" /> Vstoupit</>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (authState === 'FORCE_PASSWORD_CHANGE') {
    const handleChangePassword = async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError('');
      if (newPassword !== newPasswordConfirm) {
        setAuthError('Hesla se neshodují.');
        return;
      }
      setAuthLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/auth/password`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ new_password: newPassword })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Chyba při změně hesla');
        }
        setAuthState('AUTHENTICATED');
      } catch (err: any) {
        setAuthError(err.message);
      } finally {
        setAuthLoading(false);
      }
    };

    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-lg shadow-slate-200/50 border border-slate-100 overflow-hidden">
          <div className="bg-[#D4AF37] px-6 py-6 text-center">
            <Lock className="w-12 h-12 text-white/90 mx-auto mb-3" />
            <h2 className="text-2xl font-bold text-white">Vynucená změna hesla</h2>
            <p className="text-[#002855] text-sm mt-1 font-semibold">Z bezpečnostních důvodů (vyzývati si heslo)</p>
          </div>
          <form onSubmit={handleChangePassword} className="p-6">
            {authError && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">{authError}</div>}

            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
              Administrátor resetoval Vaše heslo, případně Vaše heslo expirovalo.
              Prosím zadejte nové bezpečné heslo (min. 12 znaků, kombinace malých, velkých písmen a číslic).
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nové heslo</label>
                <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Potvrzení nového hesla</label>
                <input type="password" required value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent" />
              </div>
            </div>

            <button type="submit" disabled={authLoading || !newPassword || !newPasswordConfirm} className="w-full mt-6 bg-[#002855] text-white py-2.5 rounded-md font-medium hover:bg-[#001f44] transition-colors flex justify-center items-center">
              {authLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Změnit heslo a vstoupit'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans flex flex-col transition-colors duration-200">
      <Header setIsAdminOpen={setIsAdminOpen} lecturerName={lecturerName} />

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
          <div className="bg-white dark:bg-slate-800 px-8 py-6 border-b border-slate-200 dark:border-slate-700 transition-colors duration-200">
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-2">
              <span>{activeClass?.name || 'Nevybráno'}</span>
              <ChevronRight className="w-4 h-4" />
              <span className="text-[#002855] dark:text-blue-300 font-medium">{activeScenario?.name || 'Vyberte situaci v postranním panelu'}</span>
            </div>
            <h2 className="text-3xl font-bold text-[#002855] dark:text-blue-100">{activeScenario?.name || 'EVALUZ'}</h2>

            <p className="text-slate-500 dark:text-slate-400 mt-1">Hodnocení úředních záznamů dle precizovaných kritérií.</p>
          </div>

          {/* Workflow Stepper */}
          <div className="px-8 py-6 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
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
                let isCompleted = false;
                const _hasAnalytics = !!(activeScenarioId && cachedAnalytics[activeScenarioId] && cachedAnalytics[activeScenarioId].stats?.length > 0);

                if (index === 0) {
                  isCompleted = hasCriteria;
                } else if (index === 1) {
                  isCompleted = hasEvaluations || activeTab === 'analytics' || _hasAnalytics;
                } else if (index === 2) {
                  isCompleted = _hasAnalytics;
                }

                const circleColorClass = isCompleted
                  ? `bg-[#D4AF37] text-white overflow-hidden transition-all duration-300 ${isActive ? 'ring-4 ring-[#D4AF37]/20 shadow-md' : ''}`
                  : isActive
                    ? 'bg-[#002855] text-white ring-4 ring-[#002855]/20 shadow-md transition-all duration-300'
                    : 'bg-white dark:bg-slate-800 text-slate-400 border-2 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:border-slate-600 transition-all duration-300';

                return (
                  <button
                    key={step.id}
                    onClick={() => setActiveTab(step.id as Tab)}
                    className="relative z-10 flex flex-col items-center gap-2 group"
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${circleColorClass}`}>
                      {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : step.num}
                    </div>
                    <span className={`text-sm font-semibold transition-colors ${isActive ? 'text-[#002855]' : isCompleted ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400'
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
            <div className={`${activeTab === 'criteria' ? 'block' : 'hidden'}`}>
              <TabCriteria
                scenarioId={activeScenarioId}
                scenarioName={activeScenario?.name || null}
                onCriteriaSaved={() => setHasCriteria(true)}
              />
            </div>

            <div className={`${activeTab === 'evaluation' ? 'block' : 'hidden'}`}>
              <TabEvaluation
                selectedStudent={selectedStudent}
                setSelectedStudent={setSelectedStudent}
                scenarioId={activeScenarioId}
                className={activeClass?.name}
                scenarioName={activeScenario?.name}
                onEvaluatedChange={setHasEvaluations}
              />
            </div>

            <div className={`${activeTab === 'analytics' ? 'block' : 'hidden'}`}>
              <TabAnalytics
                scenarioId={activeScenarioId}
                cachedData={activeScenarioId ? cachedAnalytics[activeScenarioId] : null}
                onCacheData={(data) => {
                  if (activeScenarioId) {
                    setCachedAnalytics(prev => ({ ...prev, [activeScenarioId]: data }));
                    if (!scenariosWithAnalysis.includes(activeScenarioId)) {
                      const newArr = [...scenariosWithAnalysis, activeScenarioId];
                      setScenariosWithAnalysis(newArr);
                      localStorage.setItem('upvsp_analysis_completed', JSON.stringify(newArr));
                    }
                  }
                }}
                onNavigateToStudent={(studentId) => {
                  setSelectedStudent(studentId);
                  setActiveTab('evaluation');
                }}
              />
            </div>
          </div>
        </main>
      </div>

      <AdminModal isOpen={isAdminOpen} onClose={() => setIsAdminOpen(false)} />
    </div>
  );
}
