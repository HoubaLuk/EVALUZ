import React, { useState, useRef, useEffect } from 'react';
import {
  faUser, faChevronDown, faGear, faRightFromBracket,
  faUserPen, faMoon, faSun, faChartBar,
  faClipboardList, faFileLines, faChartPie, faLock, faCheck,
  faBars, faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import { Tab } from '../types';
import { API_BASE_URL } from '../utils/api';

interface HeaderProps {
  setIsAdminOpen: (isOpen: boolean) => void;
  setIsProfileOpen: (isOpen: boolean) => void;
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

const STEPPER_TABS: { id: Tab; label: string; icon: typeof faClipboardList; requiresCriteria?: boolean; requiresEvaluations?: boolean }[] = [
  { id: 'criteria',   label: 'Precizace hodnotících kritérií', icon: faClipboardList },
  { id: 'evaluation', label: 'Vyhodnocování ÚZ',              icon: faFileLines,    requiresCriteria: true },
  { id: 'analytics',  label: 'Analýza třídy',                 icon: faChartPie,     requiresCriteria: true, requiresEvaluations: true },
];

export function Header({
  setIsAdminOpen, setIsProfileOpen, lecturerName, isAdminUser,
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

  const isTabLocked = (tab: typeof STEPPER_TABS[0]) => {
    if (tab.requiresCriteria && !hasCriteria) return true;
    if (tab.requiresEvaluations && !hasEvaluations) return true;
    return false;
  };

  const isTabDone = (tab: typeof STEPPER_TABS[0]) => {
    if (tab.id === 'criteria')   return hasCriteria;
    if (tab.id === 'evaluation') return hasEvaluations;
    if (tab.id === 'analytics')  return hasAnalytics;
    return false;
  };

  const handleStepClick = (tab: typeof STEPPER_TABS[0]) => {
    if (isTabLocked(tab)) return;
    setActiveTab(tab.id);
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="app-header">

      {/* ─── Jediný řádek záhlaví ─── */}
      <div className="header-appbar">

        {/* Levá část: Logo + název aplikace + podtitulek */}
        <div className="header-appbar__brand">
          <img src="/logo-upvsp.png" alt="ÚPVSP" className="header-appbar__brand__logo" />
          <div className="header-appbar__brand__text">
            <span className="header-appbar__brand__name">EVALUZ</span>
            <span className="header-appbar__brand__subtitle">Aplikace pro vyhodnocování ÚZ v ZOP pomocí AI</span>
          </div>
        </div>

        {/* Pravá část: verze, dark mode, uživatel, statistiky, administrace */}
        <div className="header-appbar__controls">
          {appVersion && (
            <span className="header-appbar__controls__version">v{appVersion}</span>
          )}

          <button
            className="header-btn header-btn--icon-only"
            onClick={() => setIsDarkMode(!isDarkMode)}
            aria-label="Přepnout tmavý režim"
            title={isDarkMode ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim'}
          >
            <Icon icon={isDarkMode ? faSun : faMoon} />
          </button>

          <div className="header-dropdown" ref={dropdownRef}>
            <button
              className="header-btn"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              aria-haspopup="true"
              aria-expanded={isDropdownOpen}
            >
              <Icon icon={faUser} />
              <span className="header-appbar__controls__name">{lecturerName}</span>
              <Icon icon={faChevronDown} size="xs" />
            </button>

            {isDropdownOpen && (
              <div className="header-dropdown__menu">
                <button
                  className="dropdown-item"
                  onClick={() => { setIsDropdownOpen(false); setIsProfileOpen(true); }}
                >
                  <Icon icon={faUserPen} /> Můj profil
                </button>
                <div className="dropdown-item--separator" role="separator" />
                <button
                  className="dropdown-item dropdown-item--danger"
                  onClick={() => { localStorage.removeItem('upvsp_token'); window.location.reload(); }}
                >
                  <Icon icon={faRightFromBracket} /> Odhlásit se
                </button>
              </div>
            )}
          </div>

          {isAdminUser && (
            <>
              <button className="header-btn" onClick={onOpenStatistics} title="Statistiky">
                <Icon icon={faChartBar} />
                <span>Statistiky</span>
              </button>
              <button className="header-btn" onClick={() => setIsAdminOpen(true)} title="Administrace systému">
                <Icon icon={faGear} />
                <span>Administrace</span>
              </button>
            </>
          )}

          {/* Hamburger pro mobilní zařízení */}
          <button
            className={`hamburger header-btn header-btn--icon-only${isMobileMenuOpen ? ' hamburger--open' : ''}`}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Otevřít navigační menu"
            aria-expanded={isMobileMenuOpen}
          >
            <Icon icon={isMobileMenuOpen ? faXmark : faBars} />
          </button>
        </div>
      </div>

      {/* ─── Stepper: 3 fáze pracovního postupu ─── */}
      <nav
        className={`header-stepper${isMobileMenuOpen ? ' header-stepper--mobile-open' : ''}`}
        role="navigation"
        aria-label="Pracovní postup"
      >
        {STEPPER_TABS.map((tab, i) => {
          const locked = isTabLocked(tab);
          const done = isTabDone(tab);
          const isActive = activeTab === tab.id;
          const prevDone = i === 0 ? true : isTabDone(STEPPER_TABS[i - 1]);

          return (
            <React.Fragment key={tab.id}>
              {i > 0 && (
                <div className={`stepper-line${prevDone ? ' stepper-line--done' : ''}`} />
              )}
              <button
                className={`stepper-step${isActive ? ' stepper-step--active' : ''}${done ? ' stepper-step--done' : ''}${locked ? ' stepper-step--locked' : ''}`}
                onClick={() => handleStepClick(tab)}
                disabled={locked}
                title={locked ? 'Dokončete předchozí krok' : tab.label}
              >
                <span className="stepper-step__circle">
                  {locked
                    ? <Icon icon={faLock} size="xs" />
                    : done
                      ? <Icon icon={faCheck} size="xs" />
                      : i + 1
                  }
                </span>
                <span className="stepper-step__label">{tab.label}</span>
              </button>
            </React.Fragment>
          );
        })}
      </nav>

    </header>
  );
}
