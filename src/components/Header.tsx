import React, { useState, useRef, useEffect } from 'react';
import {
  faUser, faChevronDown, faGear, faRightFromBracket,
  faUserPen, faMoon, faSun, faChartBar, faHouse,
  faClipboardList, faFileLines, faChartPie, faLock,
  faBars, faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import { Tab } from '../types';
import { API_BASE_URL } from '../utils/api';

interface HeaderProps {
  setIsAdminOpen: (isOpen: boolean) => void;
  lecturerName: string;
  isAdminUser: boolean;
  activeTab: Tab;
  onOpenStatistics: () => void;
  setActiveTab: (tab: Tab) => void;
  hasCriteria: boolean;
  hasEvaluations: boolean;
  hasAnalytics?: boolean;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}

const TAB_CONFIG: { id: Tab; label: string; icon: typeof faClipboardList; requiresCriteria?: boolean; requiresEvaluations?: boolean; adminOnly?: boolean }[] = [
  { id: 'criteria',   label: 'Precizace hodnotících kritérií', icon: faClipboardList },
  { id: 'evaluation', label: 'Vyhodnocování ÚZ',             icon: faFileLines,    requiresCriteria: true },
  { id: 'analytics',  label: 'Analýza třídy',  icon: faChartPie,     requiresCriteria: true, requiresEvaluations: true },
  { id: 'statistics', label: 'Statistiky',     icon: faChartBar,     adminOnly: true },
];

export function Header({
  setIsAdminOpen, lecturerName, isAdminUser,
  activeTab, onOpenStatistics, setActiveTab,
  hasCriteria, hasEvaluations, hasAnalytics = false,
  isMobileMenuOpen, setIsMobileMenuOpen,
}: HeaderProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    fetch(`${API_BASE_URL}/version`)
      .then(res => res.json())
      .then(data => setAppVersion(data.version || ''))
      .catch(() => setAppVersion(''));
  }, []);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' ||
        (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isTabLocked = (tab: typeof TAB_CONFIG[0]) => {
    if (tab.adminOnly && !isAdminUser) return true;
    if (tab.requiresCriteria && !hasCriteria) return true;
    if (tab.requiresEvaluations && !hasEvaluations) return true;
    return false;
  };

  // Záložka je "hotová" (zežloutne) jakmile byl příslušný krok dokončen
  const isTabDone = (tab: typeof TAB_CONFIG[0]) => {
    if (tab.id === 'criteria')   return hasCriteria;
    if (tab.id === 'evaluation') return hasEvaluations;
    if (tab.id === 'analytics')  return hasAnalytics;
    return false;
  };

  const handleTabClick = (tab: typeof TAB_CONFIG[0]) => {
    if (isTabLocked(tab)) return;
    if (tab.id === 'statistics') {
      onOpenStatistics();
    } else {
      setActiveTab(tab.id);
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="app-header">
      {/* ─── Horní pruh: Aplikační nabídka (sekundární barva, 44px) ─── */}
      <div className="header-appbar">
        {/* Levá část: Statický titulek organizace */}
        <div className="header-appbar__home">
          <img
            src="/logo-upvsp.png"
            alt="ÚPVSP"
            className="header-appbar__home__logo-img"
          />
          <span className="header-appbar__home__label">Útvar policejního vzdělávání a služební přípravy</span>
        </div>

        {/* Středová část: Logo + název + podtitulek aplikace */}
        <div className="header-appbar__logo">
          <span className="header-appbar__logo__name">EVALUZ</span>
          <span className="header-appbar__logo__subtitle">AI aplikace pro vyhodnocování ÚZ v rámci ZOP</span>
        </div>

        {/* Pravá část 41.67%: Uživatel, odhlášení, dark mode */}
        <div className="header-appbar__user">
          {appVersion && (
            <span className="header-appbar__user__version">v{appVersion}</span>
          )}

          {/* Přepínač dark mode */}
          <button
            className="header-btn header-btn--icon-only"
            onClick={() => setIsDarkMode(!isDarkMode)}
            aria-label="Přepnout tmavý režim"
            title={isDarkMode ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim'}
          >
            <Icon icon={isDarkMode ? faSun : faMoon} />
          </button>

          {/* Dropdown uživatele */}
          <div className="header-dropdown" ref={dropdownRef}>
            <button
              className="header-btn"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              aria-haspopup="true"
              aria-expanded={isDropdownOpen}
            >
              <Icon icon={faUser} />
              <span className="header-appbar__user__name">{lecturerName}</span>
              <Icon icon={faChevronDown} size="xs" />
            </button>

            {isDropdownOpen && (
              <div className="header-dropdown__menu">
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setIsDropdownOpen(false);
                    setIsAdminOpen(true);
                    setTimeout(() => window.dispatchEvent(new CustomEvent('openProfileTab')), 50);
                  }}
                >
                  <Icon icon={faUserPen} />
                  Můj profil
                </button>
                <div className="dropdown-item--separator" role="separator" />
                <button
                  className="dropdown-item dropdown-item--danger"
                  onClick={() => {
                    localStorage.removeItem('upvsp_token');
                    window.location.reload();
                  }}
                >
                  <Icon icon={faRightFromBracket} />
                  Odhlásit se
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Dolní pruh: Navigační menu (primární barva, 44px) ─── */}
      <nav className="header-navbar" role="navigation" aria-label="Hlavní navigace">
        {/* Levá část 25%: hamburger na mobilu */}
        <div className="header-navbar__left">
          <button
            className={`hamburger ${isMobileMenuOpen ? 'hamburger--open' : ''}`}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Otevřít navigační menu"
            aria-expanded={isMobileMenuOpen}
          >
            <span className="hamburger__line" />
            <span className="hamburger__line" />
            <span className="hamburger__line" />
          </button>
        </div>

        {/* Středová část 50%: záložky */}
        <div className={`header-navbar__tabs${isMobileMenuOpen ? ' header-navbar__tabs--open' : ''}`}>
          {TAB_CONFIG.map(tab => {
            if (tab.adminOnly && !isAdminUser) return null;
            const locked = isTabLocked(tab);
            const isActive = activeTab === tab.id;
            const done = !locked && isTabDone(tab);
            return (
              <button
                key={tab.id}
                className={`nav-tab${isActive ? ' nav-tab--active' : ''}${locked ? ' nav-tab--locked' : ''}${done ? ' nav-tab--done' : ''}`}
                onClick={() => handleTabClick(tab)}
                disabled={locked}
                title={locked ? 'Tento krok ještě není dostupný' : tab.label}
              >
                <Icon icon={locked ? faLock : tab.icon} size="sm" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Pravá část 25%: admin, nastavení */}
        <div className="header-navbar__right">
          <button
            className="header-btn"
            onClick={() => setIsAdminOpen(true)}
            title="Administrace systému"
          >
            <Icon icon={faGear} />
            <span>Administrace</span>
          </button>
        </div>
      </nav>
    </header>
  );
}
