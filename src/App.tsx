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
import { ProfileModal } from './components/ProfileModal';
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
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    return (t && ['criteria', 'evaluation', 'analytics', 'statistics'].includes(t)) ? t : 'evaluation';
  });
  const [selectedStudent, setSelectedStudent] = useState<number | null>(1); // Default to first student for demo
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
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

  // Registrace nového účtu
  const [showRegister, setShowRegister] = useState(false);
  const [regSuccess, setRegSuccess] = useState('');
  const [regData, setRegData] = useState({
    email: '', password: '', confirmPassword: '',
    first_name: '', last_name: '', title_before: '', title_after: '',
    school_location: '', funkcni_zarazeni: '',
  });

  // Lifed State
  const [classes, setClasses] = React.useState<ClassData[]>(() => {
    const stored = localStorage.getItem('upvsp_classes');
    if (stored) return JSON.parse(stored);
    localStorage.setItem('upvsp_classes', JSON.stringify(DEFAULT_CLASS_DATA));
    return DEFAULT_CLASS_DATA;
  });

  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('scenario') || null
  );
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

  // Synchronizuje aktivní záložku a scénář do URL search params.
  // Díky tomu přežije browser refresh — SPA nemá URL router, ale state lze
  // uchovat v ?tab=...&scenario=... bez nutnosti reloadu.
  useEffect(() => {
    const p = new URLSearchParams();
    if (activeTab) p.set('tab', activeTab);
    if (activeScenarioId) p.set('scenario', activeScenarioId);
    const newUrl = p.toString() ? `?${p.toString()}` : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  }, [activeTab, activeScenarioId]);

  const handleSelectScenario = (classId: string, scenarioId: string) => {
    setActiveClassId(classId);
    setActiveScenarioId(scenarioId);
    setCachedAnalytics({});
    setHasEvaluations(false);
    setHasCriteria(false);
  };

  useEffect(() => {
    if (!classes || classes.length === 0) return;
    if (activeScenarioId) {
      // Scénář byl načten z URL — najít a nastavit jeho třídu
      for (const cls of classes) {
        if (cls.scenarios?.some(s => s.id === activeScenarioId)) {
          setActiveClassId(cls.id);
          return;
        }
      }
    }
    // Fallback: žádný URL param nebo scénář nenalezen → auto-vyber první scénář
    if (!activeClassId) {
      const firstClass = classes[0];
      if (firstClass.scenarios && firstClass.scenarios.length > 0) {
        setActiveClassId(firstClass.id);
        setActiveScenarioId(firstClass.scenarios[0].id);
      }
    }
  }, [classes]);

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
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authEmail, password: authPassword })
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



  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (regData.password !== regData.confirmPassword) {
      setAuthError('Hesla se neshodují.');
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: regData.email,
          password: regData.password,
          first_name: regData.first_name,
          last_name: regData.last_name,
          title_before: regData.title_before,
          title_after: regData.title_after,
          school_location: regData.school_location,
          funkcni_zarazeni: regData.funkcni_zarazeni,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Chyba při registraci.');
      setRegSuccess(data.message);
      setShowRegister(false);
      setAuthEmail(regData.email);
      setRegData({ email: '', password: '', confirmPassword: '', first_name: '', last_name: '', title_before: '', title_after: '', school_location: '', funkcni_zarazeni: '' });
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
        <div className="card" style={{ width: '100%', maxWidth: 440 }}>
          <div className="card__header card__header--primary" style={{ flexDirection: 'column', alignItems: 'center', padding: '24px 24px 20px', gap: 8 }}>
            <Icon icon={faLock} size="2x" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
              {showRegister ? 'Registrace nového účtu' : 'Přihlášení do systému'}
            </h2>
            <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.75 }}>EVALUZ — ÚPVSP</p>
          </div>
          <div className="card__body">

            {/* Zpráva o úspěšné registraci */}
            {regSuccess && !showRegister && (
              <div className="alert alert--positive" style={{ marginBottom: 16 }}>
                {regSuccess}
              </div>
            )}

            {authError && (
              <div className="alert alert--negative" style={{ marginBottom: 16 }}>
                {authError}
              </div>
            )}

            {!showRegister ? (
              /* ── Přihlašovací formulář ── */
              <form onSubmit={handleLogin}>
                <div className="form-group">
                  <label className="form-label">E-mail vyučujícího</label>
                  <input type="email" required value={authEmail} onChange={e => setAuthEmail(e.target.value)} className="form-control" />
                </div>
                <div className="form-group">
                  <label className="form-label">Heslo</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'} required
                      value={authPassword} onChange={e => setAuthPassword(e.target.value)}
                      className="form-control" style={{ paddingRight: 40 }}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                      tabIndex={-1}>
                      <Icon icon={showPassword ? faEyeSlash : faEye} />
                    </button>
                  </div>
                </div>
                <div className="btn-group" style={{ marginTop: 20 }}>
                  <button type="submit" disabled={authLoading} className="btn btn--primary btn--lg" style={{ flex: 1, justifyContent: 'center' }}>
                    {authLoading ? <><span className="spinner spinner--sm spinner--white" /> Přihlašuji...</> : <><Icon icon={faRightToBracket} /> Vstoupit</>}
                  </button>
                </div>
                <div style={{ textAlign: 'center', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
                  <button type="button" onClick={() => { setShowRegister(true); setAuthError(''); setRegSuccess(''); }}
                    style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'underline' }}>
                    Nemám účet — registrovat se jako Vyučující
                  </button>
                </div>
              </form>
            ) : (
              /* ── Registrační formulář ── */
              <form onSubmit={handleRegister}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16, padding: '8px 12px', background: 'rgba(15,82,125,0.06)', borderLeft: '3px solid var(--color-primary)', borderRadius: 4 }}>
                  Nový účet bude vytvořen s rolí <strong>Vyučující</strong>. Povýšení na Administrátora nebo SuperAdmina může provést pouze SuperAdmin v Administraci systému.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Jméno *</label>
                    <input type="text" required value={regData.first_name} onChange={e => setRegData({ ...regData, first_name: e.target.value })} className="form-control" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Příjmení *</label>
                    <input type="text" required value={regData.last_name} onChange={e => setRegData({ ...regData, last_name: e.target.value })} className="form-control" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Titul před jménem</label>
                    <input type="text" placeholder="Bc., Mgr." value={regData.title_before} onChange={e => setRegData({ ...regData, title_before: e.target.value })} className="form-control" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Titul za jménem</label>
                    <input type="text" placeholder="Ph.D." value={regData.title_after} onChange={e => setRegData({ ...regData, title_after: e.target.value })} className="form-control" />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Funkční zařazení</label>
                  <select value={regData.funkcni_zarazeni} onChange={e => setRegData({ ...regData, funkcni_zarazeni: e.target.value })} className="form-control">
                    <option value="">Vyberte zařazení</option>
                    <option value="Vyučující">Vyučující</option>
                    <option value="Metodik">Metodik</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Organizační článek</label>
                  <select value={regData.school_location} onChange={e => setRegData({ ...regData, school_location: e.target.value })} className="form-control">
                    <option value="">Vyberte útvar...</option>
                    <option value="ÚPVSP">ÚPVSP</option>
                    <option value="VZ Holešov">VZ Holešov</option>
                    <option value="VZ Brno">VZ Brno</option>
                    <option value="VZ Hrdlořezy">VZ Hrdlořezy</option>
                    <option value="VZ Pardubice">VZ Pardubice</option>
                    <option value="VZ Jihlava">VZ Jihlava</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Služební e-mail *</label>
                  <input type="email" required value={regData.email} onChange={e => setRegData({ ...regData, email: e.target.value })} className="form-control" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Heslo *</label>
                    <input type="password" required minLength={12} value={regData.password} onChange={e => setRegData({ ...regData, password: e.target.value })} className="form-control" placeholder="Min. 12 znaků, A, a, 1" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Potvrzení hesla *</label>
                    <input type="password" required value={regData.confirmPassword} onChange={e => setRegData({ ...regData, confirmPassword: e.target.value })} className="form-control" />
                  </div>
                </div>
                <div className="btn-group" style={{ marginTop: 16 }}>
                  <button type="button" onClick={() => { setShowRegister(false); setAuthError(''); }} className="btn btn--outline" style={{ flex: 1, justifyContent: 'center' }}>
                    Zpět na přihlášení
                  </button>
                  <button type="submit" disabled={authLoading} className="btn btn--positive" style={{ flex: 1, justifyContent: 'center' }}>
                    {authLoading ? <span className="spinner spinner--sm spinner--white" /> : null}
                    Vytvořit účet
                  </button>
                </div>
              </form>
            )}
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
        setIsProfileOpen={setIsProfileOpen}
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
                isActive={activeTab === 'analytics'}
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
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
    </div>
  );
}
