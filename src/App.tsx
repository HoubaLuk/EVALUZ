import * as React from 'react';
import { useState, useEffect } from 'react';
import {
  faLock, faRightToBracket, faEye, faEyeSlash, faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './components/Icon';

import { Tab, ClassData, DEFAULT_CLASS_DATA } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { AdminModal } from './components/AdminModal';
import { TabCriteria } from './components/TabCriteria';
import { TabEvaluation } from './components/TabEvaluation';
import { TabAnalytics } from './components/TabAnalytics';
import { TabMonitor } from './components/TabMonitor';

import { API_BASE_URL } from './utils/api';

/**
 * Hlavní vstupní bod aplikace EVALUZ.
 * Spravuje globální stav (autentizace, výběr scénářů) a základní layout.
 */
export default function EvaluzDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('evaluation');
  const [selectedStudent, setSelectedStudent] = useState<number | null>(1); // Default to first student for demo
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Auth State
  const [authState, setAuthState] = useState<'CHECKING' | 'RECOGNIZED_EMPTY_DB' | 'LOGIN_REQUIRED' | 'AUTHENTICATED' | 'FORCE_PASSWORD_CHANGE'>('CHECKING');
  const [token, setToken] = useState<string | null>(localStorage.getItem('upvsp_token'));
  const [lecturerName, setLecturerName] = useState<string>('Načítám profil...');
  const [lecturerId, setLecturerId] = useState<number | null>(null);
  const [isAdminUser, setIsAdminUser] = useState<boolean>(false);

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
            const displayRole = meData.funkcni_zarazeni ? ` - ${meData.funkcni_zarazeni}` : ' - Vyučující';
            setLecturerName(fullName.replace(/\s+/g, ' ').trim() + displayRole);
            setLecturerId(meData.id);
            setIsAdminUser(meData.is_superadmin || meData.is_admin);

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
      <div className="main-layout" style={{ alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div className="spinner spinner--lg" />
        <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Ověřování přístupu...</p>
      </div>
    );
  }

  if (authState === 'RECOGNIZED_EMPTY_DB') {
    return (
      <div className="main-layout">
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
      <div className="main-layout" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div className="card" style={{ width: '100%', maxWidth: 420 }}>
          <div className="card__header card__header--primary" style={{ flexDirection: 'column', alignItems: 'center', padding: '24px 24px 20px', gap: 8 }}>
            <Icon icon={faLock} size="2x" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Přihlášení do systému</h2>
            <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.75 }}>EVALUZ — ÚPVSP</p>
          </div>
          <div className="card__body">
            <form onSubmit={handleLogin}>
              {authError && (
                <div className="alert alert--negative" style={{ marginBottom: 16 }}>
                  {authError}
                </div>
              )}
              <div className="form-group">
                <label className="form-label">E-mail vyučujícího</label>
                <input
                  type="email" required
                  value={authEmail} onChange={e => setAuthEmail(e.target.value)}
                  className="form-control"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Heslo</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'} required
                    value={authPassword} onChange={e => setAuthPassword(e.target.value)}
                    className="form-control"
                    style={{ paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                    tabIndex={-1}
                  >
                    <Icon icon={showPassword ? faEyeSlash : faEye} />
                  </button>
                </div>
              </div>
              <div className="btn-group" style={{ marginTop: 20 }}>
                <button type="submit" disabled={authLoading} className="btn btn--primary btn--lg" style={{ flex: 1, justifyContent: 'center' }}>
                  {authLoading
                    ? <><span className="spinner spinner--sm spinner--white" /> Přihlašuji...</>
                    : <><Icon icon={faRightToBracket} /> Vstoupit</>
                  }
                </button>
              </div>
            </form>
          </div>
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
      <div className="main-layout" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div className="card" style={{ width: '100%', maxWidth: 420 }}>
          <div className="card__header card__header--warning" style={{ flexDirection: 'column', alignItems: 'center', padding: '24px 24px 20px', gap: 8 }}>
            <Icon icon={faLock} size="2x" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Vynucená změna hesla</h2>
            <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.85 }}>Z bezpečnostních důvodů musíte nastavit nové heslo</p>
          </div>
          <div className="card__body">
            <form onSubmit={handleChangePassword}>
              {authError && (
                <div className="alert alert--negative" style={{ marginBottom: 16 }}>
                  {authError}
                </div>
              )}
              <p className="text-sm" style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
                Administrátor resetoval Vaše heslo, případně Vaše heslo expirovalo.
                Zadejte nové bezpečné heslo (min. 12 znaků, kombinace malých, velkých písmen a číslic).
              </p>
              <div className="form-group">
                <label className="form-label">Nové heslo</label>
                <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="form-control" />
              </div>
              <div className="form-group">
                <label className="form-label">Potvrzení nového hesla</label>
                <input type="password" required value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)} className="form-control" />
              </div>
              <div className="btn-group" style={{ marginTop: 20 }}>
                <button type="submit" disabled={authLoading || !newPassword || !newPasswordConfirm} className="btn btn--positive btn--lg" style={{ flex: 1, justifyContent: 'center' }}>
                  {authLoading ? <span className="spinner spinner--sm spinner--white" /> : null}
                  Změnit heslo a vstoupit
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main-layout">
      <Header
        setIsAdminOpen={setIsAdminOpen}
        lecturerName={lecturerName}
        isAdminUser={isAdminUser}
        activeTab={activeTab}
        onOpenStatistics={() => setActiveTab(activeTab === 'statistics' ? 'evaluation' : 'statistics')}
        setActiveTab={setActiveTab}
        hasCriteria={hasCriteria}
        hasEvaluations={hasEvaluations}
        hasAnalytics={activeScenarioId ? scenariosWithAnalysis.includes(activeScenarioId) : false}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
      />

      {/* Mobilní overlay pro sidebar */}
      {isMobileMenuOpen && (
        <div className="sidebar-overlay sidebar-overlay--open" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      <div className="content-area">
        {activeTab !== 'statistics' && (
          <Sidebar
            classes={classes}
            setClasses={setClasses}
            activeClassId={activeClassId}
            activeScenarioId={activeScenarioId}
            onSelectScenario={handleSelectScenario}
          />
        )}

        {/* Hlavní obsah */}
        <main className="main-content">
          {/* Breadcrumb + nadpis scénáře */}
          {activeTab !== 'statistics' && activeScenarioId && (
            <div className="card" style={{ marginBottom: 16, flexShrink: 0 }}>
              <div className="card__body" style={{ padding: '12px 16px' }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
                  {activeClass?.name || 'Nevybráno'} › <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{activeScenario?.name}</span>
                </p>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {activeScenario?.name || 'EVALUZ'}
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2 }}>Hodnocení úředních záznamů dle precizovaných kritérií</p>
              </div>
            </div>
          )}

          {/* Obsah záložek */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: activeTab === 'criteria' ? 'flex' : 'none', flexDirection: 'column' }}>
              <TabCriteria
                scenarioId={activeScenarioId}
                scenarioName={activeScenario?.name || null}
                onCriteriaSaved={() => setHasCriteria(true)}
              />
            </div>

            <div style={{ flex: 1, display: activeTab === 'evaluation' ? 'flex' : 'none', flexDirection: 'column' }}>
              <TabEvaluation
                selectedStudent={selectedStudent}
                setSelectedStudent={setSelectedStudent}
                scenarioId={activeScenarioId}
                className={activeClass?.name}
                scenarioName={activeScenario?.name}
                onEvaluatedChange={setHasEvaluations}
                lecturerId={lecturerId}
              />
            </div>

            <div style={{ display: activeTab === 'analytics' ? 'block' : 'none' }}>
              <TabAnalytics
                scenarioId={activeScenarioId}
                className={activeClass?.name ?? null}
                scenarioName={activeScenario?.name ?? null}
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

            <div style={{ display: activeTab === 'statistics' ? 'block' : 'none', flex: 1 }}>
              <TabMonitor />
            </div>
          </div>
        </main>
      </div>

      <AdminModal isOpen={isAdminOpen} onClose={() => setIsAdminOpen(false)} />
    </div>
  );
}
