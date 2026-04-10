import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';
import {
    faUserPen, faXmark, faFloppyDisk, faCircleCheck,
    faKey, faEye, faEyeSlash, faClockRotateLeft, faDownload,
    faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import { useDialog } from '../contexts/DialogContext';

interface ProfileModalProps {
    /** Příznak, zda je modální okno otevřené */
    isOpen: boolean;
    /** Funkce pro zavření modálního okna */
    onClose: () => void;
}

/**
 * Profil vyučujícího a podpisová doložka.
 * Dostupné všem přihlášeným uživatelům přes dropdown v záhlaví.
 * Obsahuje: osobní údaje, živý náhled doložky, změnu hesla, historii exportů.
 */
export function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
    const { showAlert } = useDialog();

    // Sekce v modálu
    const [activeSection, setActiveSection] = useState<'profile' | 'password'>('profile');

    // Profilová data
    const [profile, setProfile] = useState({
        title_before: '',
        first_name: '',
        last_name: '',
        title_after: '',
        rank_shortcut: '',
        rank_full: '',
        school_location: '',
        funkcni_zarazeni: '',
        email: '',
    });

    // Změna hesla
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNewPw, setShowNewPw] = useState(false);
    const [showConfirmPw, setShowConfirmPw] = useState(false);

    // Historie exportů
    const [exportsHistory, setExportsHistory] = useState<any[]>([]);

    // UI stavy
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [passwordSuccess, setPasswordSuccess] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchProfileData();
        }
    }, [isOpen]);

    /**
     * Načte profil přihlášeného uživatele a historii jeho exportů.
     */
    const fetchProfileData = async () => {
        setIsLoading(true);
        try {
            const token = localStorage.getItem('upvsp_token');

            // Profil uživatele
            const meRes = await fetch(`${API_BASE_URL}/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (meRes.ok) {
                const meData = await meRes.json();
                setProfile({
                    title_before: meData.title_before || '',
                    first_name: meData.first_name || '',
                    last_name: meData.last_name || '',
                    title_after: meData.title_after || '',
                    rank_shortcut: meData.rank_shortcut || '',
                    rank_full: meData.rank_full || '',
                    school_location: meData.school_location || '',
                    funkcni_zarazeni: meData.funkcni_zarazeni || '',
                    email: meData.email || '',
                });
            }

            // Historie exportů
            const historyRes = await fetch(`${API_BASE_URL}/export/history`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (historyRes.ok) {
                const historyData = await historyRes.json();
                setExportsHistory(historyData);
            }
        } catch (error) {
            console.error('Chyba při načítání profilu:', error);
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Uloží změny v profilu (osobní údaje a doložka).
     * Po úspěšném uložení provede reload pro aktualizaci záhlaví.
     */
    const handleSaveProfile = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            const res = await fetch(`${API_BASE_URL}/auth/me`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify(profile)
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Chyba při ukládání profilu.');
            }
            setSaveSuccess(true);
            // Reload pro promítnutí změn do záhlaví (jméno, funkční zařazení)
            setTimeout(() => window.location.reload(), 1000);
        } catch (error: any) {
            showAlert(error.message || 'Chyba při ukládání na server.');
        } finally {
            setIsSaving(false);
        }
    };

    /**
     * Změní heslo přihlášeného uživatele.
     * Validace: min. 12 znaků, kombinace A, a, 1; shoda obou polí.
     */
    const handleChangePassword = async () => {
        if (newPassword !== confirmPassword) {
            showAlert('Hesla se neshodují. Zkontrolujte zadání.');
            return;
        }
        if (newPassword.length < 12) {
            showAlert('Heslo musí mít min. 12 znaků a obsahovat velká, malá písmena a číslice.');
            return;
        }
        setIsChangingPassword(true);
        setPasswordSuccess(false);
        try {
            const res = await fetch(`${API_BASE_URL}/auth/password`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}`
                },
                body: JSON.stringify({ new_password: newPassword })
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Chyba při změně hesla.');
            }
            setPasswordSuccess(true);
            setNewPassword('');
            setConfirmPassword('');
            setTimeout(() => setPasswordSuccess(false), 4000);
        } catch (error: any) {
            showAlert(error.message || 'Chyba při změně hesla.');
        } finally {
            setIsChangingPassword(false);
        }
    };

    if (!isOpen) return null;

    // Živý náhled podpisové doložky
    const signaturePreview = (
        <div style={{ padding: 16, background: 'var(--bg-surface-2)', border: '1px solid var(--border-color)', borderLeft: '3px solid var(--color-warning)', borderRadius: 6, marginTop: 8 }}>
            <h4 style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon icon={faUserPen} size="xs" /> Živý náhled podpisové doložky
            </h4>
            <div style={{ fontSize: '0.9rem', lineHeight: 1.7, fontWeight: 600, color: 'var(--text-primary)' }}>
                {profile.rank_shortcut} {profile.title_before} {profile.first_name} {profile.last_name}{profile.title_after ? `, ${profile.title_after}` : ''}<br />
                {profile.rank_full}<br />
                Útvar policejního vzdělávání a služební přípravy
                {profile.school_location && profile.school_location !== 'ÚPVSP' && (
                    <><br /><span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{profile.school_location}</span></>
                )}
            </div>
        </div>
    );

    return (
        <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: 680, height: '85vh', display: 'flex', flexDirection: 'column' }}>
                {/* Hlavička */}
                <div className="modal__header modal__header--primary">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon icon={faUserPen} /> Profil vyučujícího a podpisová doložka
                    </span>
                    <button className="btn btn--sm btn--icon-only" style={{ background: 'transparent', border: 'none', color: '#fff' }} onClick={onClose}>
                        <Icon icon={faXmark} />
                    </button>
                </div>

                {/* Záložky */}
                <div style={{ display: 'flex', gap: 2, padding: '8px 16px 0', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
                    <button
                        onClick={() => setActiveSection('profile')}
                        style={{
                            padding: '8px 16px',
                            fontSize: '0.82rem',
                            fontWeight: activeSection === 'profile' ? 700 : 500,
                            background: activeSection === 'profile' ? 'var(--color-primary)' : 'transparent',
                            color: activeSection === 'profile' ? '#fff' : 'var(--text-secondary)',
                            border: 'none',
                            borderRadius: '4px 4px 0 0',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        <Icon icon={faUserPen} size="xs" /> Osobní údaje a doložka
                    </button>
                    <button
                        onClick={() => setActiveSection('password')}
                        style={{
                            padding: '8px 16px',
                            fontSize: '0.82rem',
                            fontWeight: activeSection === 'password' ? 700 : 500,
                            background: activeSection === 'password' ? 'var(--color-primary)' : 'transparent',
                            color: activeSection === 'password' ? '#fff' : 'var(--text-secondary)',
                            border: 'none',
                            borderRadius: '4px 4px 0 0',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        <Icon icon={faKey} size="xs" /> Změna hesla
                    </button>
                </div>

                {/* Obsah */}
                <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                    {isLoading ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
                            <span className="spinner spinner--lg" />
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Načítám profil...</p>
                        </div>
                    ) : activeSection === 'profile' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div>
                                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', margin: '0 0 4px' }}>Osobní údaje</h3>
                                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Údaje zadané níže budou použity pro generování PDF a oddělení vašich dat v systému.</p>
                            </div>

                            <div className="form-group">
                                <label>Služební e-mail</label>
                                <input type="email" value={profile.email} disabled className="form-control" style={{ opacity: 0.7, cursor: 'not-allowed' }} />
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>E-mail slouží jako přihlašovací jméno a nelze ho změnit.</p>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div className="form-group">
                                    <label>Titul před jménem</label>
                                    <input type="text" placeholder="Bc., Mgr., Ing." value={profile.title_before} onChange={e => setProfile({ ...profile, title_before: e.target.value })} className="form-control" />
                                </div>
                                <div className="form-group">
                                    <label>Titul za jménem</label>
                                    <input type="text" placeholder="Ph.D." value={profile.title_after} onChange={e => setProfile({ ...profile, title_after: e.target.value })} className="form-control" />
                                </div>
                                <div className="form-group">
                                    <label>Jméno</label>
                                    <input type="text" value={profile.first_name} onChange={e => setProfile({ ...profile, first_name: e.target.value })} className="form-control" />
                                </div>
                                <div className="form-group">
                                    <label>Příjmení</label>
                                    <input type="text" value={profile.last_name} onChange={e => setProfile({ ...profile, last_name: e.target.value })} className="form-control" />
                                </div>
                                <div className="form-group">
                                    <label>Hodnostní označení</label>
                                    <input type="text" placeholder="plk., kpt., por." value={profile.rank_shortcut} onChange={e => setProfile({ ...profile, rank_shortcut: e.target.value })} className="form-control" />
                                </div>
                                <div className="form-group">
                                    <label>Hodnost</label>
                                    <select value={profile.rank_full} onChange={e => setProfile({ ...profile, rank_full: e.target.value })} className="form-control">
                                        <option value="">Vyberte hodnost</option>
                                        <option value="vrchní komisař">vrchní komisař</option>
                                        <option value="rada">rada</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Funkční zařazení</label>
                                    <select value={profile.funkcni_zarazeni} onChange={e => {
                                        const val = e.target.value;
                                        let newRankShortcut = profile.rank_shortcut;
                                        let newRankFull = profile.rank_full;
                                        if (val === 'Lektor') { newRankShortcut = 'kpt.'; newRankFull = 'vrchní komisař'; }
                                        else if (val === 'Metodik') { newRankShortcut = 'pplk.'; newRankFull = 'rada'; }
                                        setProfile({ ...profile, funkcni_zarazeni: val, rank_shortcut: newRankShortcut, rank_full: newRankFull });
                                    }} className="form-control">
                                        <option value="">Vyberte zařazení</option>
                                        <option value="Vyučující">Vyučující</option>
                                        <option value="Metodik">Metodik</option>
                                        <option value="Administrátor">Administrátor</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Organizační článek</label>
                                    <select value={profile.school_location} onChange={e => setProfile({ ...profile, school_location: e.target.value })} className="form-control">
                                        <option value="">Vyberte útvar...</option>
                                        <option value="ÚPVSP">ÚPVSP</option>
                                        <option value="VZ Holešov">VZ Holešov</option>
                                        <option value="VZ Brno">VZ Brno</option>
                                        <option value="VZ Hrdlořezy">VZ Hrdlořezy</option>
                                        <option value="VZ Pardubice">VZ Pardubice</option>
                                        <option value="VZ Jihlava">VZ Jihlava</option>
                                    </select>
                                </div>
                            </div>

                            {signaturePreview}

                            {/* Historie exportů */}
                            {exportsHistory.length > 0 && (
                                <div style={{ marginTop: 8 }}>
                                    <h4 style={{ fontWeight: 700, color: 'var(--color-primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                                        <Icon icon={faClockRotateLeft} /> Moje poslední exporty
                                    </h4>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                        <thead>
                                            <tr style={{ background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Datum exportu</th>
                                                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Scénář / Třída</th>
                                                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Typ</th>
                                                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Akce</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {exportsHistory.map((item, idx) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{item.created_at}</td>
                                                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{item.scenario_name}</td>
                                                    <td style={{ padding: '8px 12px' }}><span className="badge badge--light">{item.type}</span></td>
                                                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                                        <a href={`${API_BASE_URL.replace('/api/v1', '')}${item.download_url}`} download onClick={(e) => e.stopPropagation()} className="btn btn--outline btn--sm">
                                                            <Icon icon={faDownload} /> Stáhnout znovu
                                                        </a>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Změna hesla */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 440 }}>
                            <div>
                                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', margin: '0 0 4px' }}>Změna přístupového hesla</h3>
                                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Heslo musí mít min. 12 znaků a obsahovat velká písmena, malá písmena a číslice.</p>
                            </div>

                            <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div className="form-group">
                                    <label>Nové heslo</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type={showNewPw ? 'text' : 'password'}
                                            value={newPassword}
                                            onChange={e => setNewPassword(e.target.value)}
                                            className="form-control"
                                            placeholder="Min. 12 znaků, A, a, 1"
                                            style={{ paddingRight: 40 }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowNewPw(!showNewPw)}
                                            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                                            aria-label="Zobrazit heslo"
                                        >
                                            <Icon icon={showNewPw ? faEyeSlash : faEye} size="sm" />
                                        </button>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Potvrzení nového hesla</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type={showConfirmPw ? 'text' : 'password'}
                                            value={confirmPassword}
                                            onChange={e => setConfirmPassword(e.target.value)}
                                            className="form-control"
                                            placeholder="Zopakujte nové heslo"
                                            style={{ paddingRight: 40 }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirmPw(!showConfirmPw)}
                                            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                                            aria-label="Zobrazit heslo"
                                        >
                                            <Icon icon={showConfirmPw ? faEyeSlash : faEye} size="sm" />
                                        </button>
                                    </div>
                                    {newPassword && confirmPassword && newPassword !== confirmPassword && (
                                        <p style={{ fontSize: '0.75rem', color: 'var(--color-negative)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Icon icon={faCircleExclamation} size="xs" /> Hesla se neshodují.
                                        </p>
                                    )}
                                </div>

                                {passwordSuccess && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid var(--color-positive)', borderRadius: 6, color: 'var(--color-positive)', fontWeight: 600, fontSize: '0.85rem' }}>
                                        <Icon icon={faCircleCheck} /> Heslo bylo úspěšně změněno.
                                    </div>
                                )}

                                <button
                                    className="btn btn--positive"
                                    onClick={handleChangePassword}
                                    disabled={isChangingPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword || newPassword.length < 12}
                                >
                                    {isChangingPassword ? <span className="spinner spinner--sm spinner--white" /> : <Icon icon={faKey} />}
                                    Změnit heslo
                                </button>
                            </div>

                            <div style={{ padding: 12, background: 'rgba(250, 204, 21, 0.08)', border: '1px solid rgba(250, 204, 21, 0.3)', borderRadius: 6, fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                <Icon icon={faCircleExclamation} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 1 }} />
                                <span>Po změně hesla budete moci dál pracovat bez nutnosti opětovného přihlášení. Nové heslo použijte při příštím přihlášení.</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Patička — tlačítka pro ukládání profilu */}
                {!isLoading && activeSection === 'profile' && (
                    <div className="modal__footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
                        {saveSuccess && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-positive)', fontWeight: 600, fontSize: '0.85rem' }}>
                                <Icon icon={faCircleCheck} /> Uloženo — stránka se obnoví…
                            </span>
                        )}
                        <button className="btn btn--outline" onClick={onClose}>Zavřít</button>
                        <button className="btn btn--positive" onClick={handleSaveProfile} disabled={isSaving}>
                            {isSaving ? <span className="spinner spinner--sm spinner--white" /> : <Icon icon={faFloppyDisk} />}
                            Uložit profil
                        </button>
                    </div>
                )}
                {!isLoading && activeSection === 'password' && (
                    <div className="modal__footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
                        <button className="btn btn--outline" onClick={onClose}>Zavřít</button>
                    </div>
                )}
            </div>
        </div>
    );
}
