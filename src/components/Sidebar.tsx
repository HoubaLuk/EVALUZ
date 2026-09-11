import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/api';
import {
  fetchTree, createGroup, renameGroup, deleteGroup,
  createScenario, renameScenario, deleteScenario as deleteScenarioApi,
} from '../utils/workspace';
import {
  faFolder, faFolderOpen, faChevronDown, faChevronRight, faChevronLeft,
  faEllipsisVertical, faFileLines, faPen, faTrash, faCopy,
  faHardDrive, faRotate, faCircleQuestion, faCircleCheck, faCircleXmark,
  faXmark, faPlus,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ClassData } from '../types';
import { useDialog } from '../contexts/DialogContext';

export interface SidebarProps {
  classes: ClassData[];
  setClasses: React.Dispatch<React.SetStateAction<ClassData[]>>;
  activeClassId: number | null;
  /** Klíč situace (`scenario_key`) — to, co putuje do URL i do volání API. */
  activeScenarioId: string | null;
  onSelectScenario: (classId: number, scenarioKey: string) => void;
  onScenarioCreated?: (classId: number, scenarioKey: string) => void;
}

export type EditMode =
  | null
  | { type: 'new_class' }
  | { type: 'new_scenario'; classId: number }
  | { type: 'rename_class'; classId: number; currentName: string }
  | { type: 'rename_scenario'; classId: number; scenId: number; currentName: string };

/**
 * Rozbalení tříd ve stromu. Čistě kosmetika vázaná na zařízení, takže patří do
 * prohlížeče — na rozdíl od samotného stromu, který je od ADR-033 výhradně na serveru.
 * Klíč začíná `upvsp_`, takže ho `clearSessionState()` uklidí při odhlášení.
 */
const COLLAPSED_KEY = 'upvsp_collapsed_groups';

function readCollapsed(): Set<number> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch { return new Set(); }
}

function writeCollapsed(ids: Set<number>): void {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids])); } catch { /* ignorovat */ }
}

export function Sidebar({ classes, setClasses, activeClassId, activeScenarioId, onSelectScenario, onScenarioCreated }: SidebarProps) {
  const { showConfirm } = useDialog();

  const [editMode, setEditMode] = React.useState<EditMode>(null);
  const [editValue, setEditValue] = React.useState('');
  const [isCollapsed, setIsCollapsed] = React.useState(() => {
    const saved = localStorage.getItem('upvsp_sidebar_collapsed');
    return saved ? JSON.parse(saved) : false;
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncInfo, setLastSyncInfo] = useState<{ name: string; date: string } | null>(() => {
    const saved = localStorage.getItem('evaluz_last_sync');
    return saved ? JSON.parse(saved) : null;
  });
  const [showSyncHelp, setShowSyncHelp] = useState(false);
  const [syncDirHandle, setSyncDirHandle] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleCollapseToggle = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem('upvsp_sidebar_collapsed', JSON.stringify(next));
  };

  /** Načte strom ze serveru. Rozbalení tříd je čistě UI, drží se v prohlížeči. */
  const reload = React.useCallback(async (): Promise<ClassData[]> => {
    const groups = await fetchTree();
    const sbalene = readCollapsed();
    const strom = groups.map(g => ({
      id: g.id,
      name: g.name,
      expanded: !sbalene.has(g.id),
      scenarios: g.scenarios,
    }));
    setClasses(strom);
    return strom;
  }, [setClasses]);

  React.useEffect(() => { reload().catch(err => hlasChybu(err)); }, [reload]);

  function hlasChybu(err: unknown) {
    console.error('Operace se strukturou tříd selhala:', err);
    setToast({ message: 'Změnu se nepodařilo uložit. Zkuste to prosím znovu.', type: 'error' });
    setTimeout(() => setToast(null), 8000);
  }

  /** Obalí serverovou operaci: po úspěchu překreslí strom, při chybě to řekne nahlas. */
  const provest = React.useCallback(async (akce: () => Promise<unknown>) => {
    try {
      await akce();
      await reload();
      return true;
    } catch (err) {
      hlasChybu(err);
      return false;
    }
  }, [reload]);

  const handleSaveEdit = React.useCallback(async () => {
    if (!editMode) return;
    const val = editValue.trim();
    const rezim = editMode;
    setEditMode(null);
    setEditValue('');

    if (rezim.type === 'new_class' && val) {
      await provest(() => createGroup(val));
    } else if (rezim.type === 'new_scenario' && val) {
      // Nový scénář je potřeba rovnou aktivovat. Dřív se tak nedělo a lektor nahrál ÚZ
      // ještě pod starým scénářem; teprve pozdější ruční přepnutí resetovalo stav
      // v TabEvaluation a vypadalo to jako ztráta nahraných souborů.
      try {
        const vytvorena = await createScenario(rezim.classId, val);
        await reload();
        onScenarioCreated?.(rezim.classId, vytvorena.key);
      } catch (err) { hlasChybu(err); }
    } else if (rezim.type === 'rename_class' && val && val !== rezim.currentName) {
      await provest(() => renameGroup(rezim.classId, val));
    } else if (rezim.type === 'rename_scenario' && val && val !== rezim.currentName) {
      await provest(() => renameScenario(rezim.scenId, val));
    }
  }, [editMode, editValue, provest, reload, onScenarioCreated]);

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); setEditMode(null); setEditValue(''); }
  };

  const startEdit = (e: React.MouseEvent | undefined, mode: EditMode, initialValue: string = '') => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    setEditMode(mode);
    setEditValue(initialValue);
  };

  const toggleClassExpansion = React.useCallback((classId: number, e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const sbalene = readCollapsed();
    if (sbalene.has(classId)) sbalene.delete(classId); else sbalene.add(classId);
    writeCollapsed(sbalene);
    setClasses(prev => prev.map(c => c.id === classId ? { ...c, expanded: !c.expanded } : c));
  }, [setClasses]);

  /**
   * Smaže třídu nebo situaci. Server bez `force` odmítne cokoli, pod čím leží
   * vyhodnocení, a vrátí počty — ty se ukážou v druhém dotazu. Tím se nikdy nestane,
   * že by v databázi zůstala data, ke kterým nevede cesta (ADR-033).
   */
  const smazat = React.useCallback(async (
    smaz: (force: boolean) => Promise<{ scenarios: number; evaluations: number } | null>,
    prvniOtazka: string,
    poUspechu: () => void,
  ) => {
    if (!await showConfirm(prvniOtazka)) return;
    try {
      const blokovano = await smaz(false);
      if (blokovano) {
        const { evaluations, scenarios } = blokovano;
        const kde = scenarios > 1 ? ` ve ${scenarios} modelových situacích` : '';
        const potvrd = await showConfirm(
          `Pozor: je zde ${evaluations} vyhodnocených úředních záznamů${kde}. `
          + 'Smazáním přijdete i o ně a nelze to vzít zpět. Opravdu pokračovat?'
        );
        if (!potvrd) return;
        await smaz(true);
      }
      await reload();
      poUspechu();
    } catch (err) { hlasChybu(err); }
  }, [showConfirm, reload]);

  const deleteClass = React.useCallback((id: number, name: string) => smazat(
    force => deleteGroup(id, force),
    `Opravdu chcete smazat třídu "${name}" i se všemi modelovými situacemi?`,
    () => { if (activeClassId === id) onSelectScenario(0, ''); },
  ), [smazat, activeClassId, onSelectScenario]);

  const duplicateScenario = React.useCallback((classId: number, scenId: number) => {
    const zdroj = classes.find(c => c.id === classId)?.scenarios.find(s => s.id === scenId);
    if (!zdroj) return;
    // Kopie je prázdná situace se stejným názvem — kritéria ani vyhodnocení se nekopírují,
    // stejně jako dřív.
    provest(() => createScenario(classId, `${zdroj.name} (Kopie)`));
  }, [classes, provest]);

  const deleteScenario = React.useCallback((classId: number, scenId: number, name: string) => smazat(
    force => deleteScenarioApi(scenId, force),
    `Opravdu chcete smazat modelovou situaci "${name}"?`,
    () => {
      const klic = classes.find(c => c.id === classId)?.scenarios.find(s => s.id === scenId)?.key;
      if (klic && activeScenarioId === klic) onSelectScenario(classId, '');
    },
  ), [smazat, classes, activeScenarioId, onSelectScenario]);

  const performSync = async (dirHandle: any) => {
    try {
      setIsSyncing(true);
      // Strom je na serveru (ADR-033), takže se třídy i situace zakládají přes API
      // a klíč vydává server. Dřív vznikaly lokálně jako `class-${Date.now()}` a žily
      // jen v prohlížeči, odkud se spustil sync.
      let strom = await reload();
      let totalFiles = 0; let newClassesCount = 0; let newScenariosCount = 0;

      for await (const [className, classHandle] of (dirHandle as any).entries()) {
        if ((classHandle as any).kind !== 'directory') continue;
        let cls = strom.find(c => c.name === className);
        if (!cls) {
          const zalozena = await createGroup(className);
          strom = await reload();
          cls = strom.find(c => c.id === zalozena.id)!;
          newClassesCount++;
        }

        for await (const [scenName, scenHandle] of (classHandle as any).entries()) {
          if ((scenHandle as any).kind !== 'directory') continue;
          let scen = cls.scenarios.find(s => s.name === scenName);
          if (!scen) {
            scen = await createScenario(cls.id, scenName);
            strom = await reload();
            cls = strom.find(c => c.id === cls!.id)!;
            newScenariosCount++;
          }
          const validFiles: File[] = [];
          for await (const [fileName, fileHandle] of (scenHandle as any).entries()) {
            if ((fileHandle as any).kind === 'file') {
              const file = await (fileHandle as any).getFile();
              const ext = file.name.split('.').pop()?.toLowerCase();
              if (ext && ['pdf', 'doc', 'docx', 'rtf', 'odt'].includes(ext) && !fileName.startsWith('~') && !fileName.startsWith('.')) {
                validFiles.push(file);
              }
            }
          }
          if (validFiles.length > 0) {
            totalFiles += validFiles.length;
            const formData = new FormData();
            validFiles.forEach(f => formData.append('files', f));
            formData.append('scenario_id', scen.key);
            formData.append('scenario_display_name', scen.name || '');
            await fetch(`${API_BASE_URL}/evaluate/fast-scan`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${localStorage.getItem('upvsp_token')}` },
              body: formData,
            });
          }
        }
      }

      await reload();
      const msg = totalFiles > 0
        ? `Sync dokončen! ${newClassesCount > 0 ? newClassesCount + ' nových tříd, ' : ''}${newScenariosCount > 0 ? newScenariosCount + ' nových situací, ' : ''}${totalFiles} souborů nahráno.`
        : newClassesCount > 0 || newScenariosCount > 0
          ? `Struktura synchronizována (${newClassesCount} tříd, ${newScenariosCount} situací). Žádné dokumenty k nahrání.`
          : 'Žádné nové položky nalezeny. Zkontrolujte strukturu složek.';

      const syncInfo = { name: dirHandle.name, date: new Date().toLocaleString('cs-CZ') };
      setLastSyncInfo(syncInfo);
      localStorage.setItem('evaluz_last_sync', JSON.stringify(syncInfo));
      setToast({ message: msg, type: totalFiles > 0 || newClassesCount > 0 || newScenariosCount > 0 ? 'success' : 'error' });
      if (totalFiles > 0) window.dispatchEvent(new CustomEvent('evaluz-sync-complete'));
      setTimeout(() => setToast(null), 8000);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setToast({ message: 'Nastala chyba při synchronizaci.', type: 'error' });
        setTimeout(() => setToast(null), 6000);
      }
    } finally { setIsSyncing(false); }
  };

  const isFileSystemApiSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const handleSelectAndSync = async () => {
    if (!isFileSystemApiSupported) {
      setToast({ message: 'Synchronizace vyžaduje HTTPS nebo localhost.', type: 'error' });
      setTimeout(() => setToast(null), 6000);
      return;
    }
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      setSyncDirHandle(dirHandle);
      await performSync(dirHandle);
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error('Directory Picker Error:', e);
    }
  };

  const handleDirectSync = async () => {
    if (syncDirHandle) await performSync(syncDirHandle);
    else await handleSelectAndSync();
  };

  return (
    <aside className={`sidebar${isCollapsed ? ' sidebar--collapsed' : ''}`}>
      {/* Toggle button */}
      <button
        className="sidebar-toggle"
        style={isCollapsed
          ? { position: 'static', margin: '10px auto 0', display: 'flex', alignSelf: 'center' }
          : { position: 'absolute', right: 4, top: 12, zIndex: 9999 }
        }
        onClick={handleCollapseToggle}
        title={isCollapsed ? 'Rozbalit sidebar' : 'Sbalit sidebar'}
      >
        <Icon icon={isCollapsed ? faChevronRight : faChevronLeft} size="xs" />
      </button>

      {/* Sync sekce */}
      <div style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
        {!isCollapsed ? (
          <>
            <div style={{ display: 'flex', gap: 6, paddingRight: 40 }}>
              <button
                className={`btn btn--sm${syncDirHandle ? ' btn--primary' : ' btn--outline'}`}
                style={{ flex: 1 }}
                onClick={handleDirectSync}
                disabled={isSyncing}
                title={syncDirHandle ? `Synchronizovat: ${syncDirHandle.name}` : 'Vybrat složku a synchronizovat'}
              >
                <Icon icon={isSyncing ? faRotate : faHardDrive} spin={isSyncing} />
                {isSyncing ? 'Synchronizuji...' : 'Sync ÚZ v PC'}
              </button>
              <button
                className="btn btn--sm btn--outline"
                onClick={handleSelectAndSync}
                title="Změnit cílovou složku"
              >
                <Icon icon={faFolder} />
              </button>
              <button
                className="btn btn--sm btn--outline"
                onClick={() => setShowSyncHelp(!showSyncHelp)}
                title="Nápověda ke struktuře složek"
              >
                <Icon icon={faCircleQuestion} />
              </button>
            </div>
            {lastSyncInfo && !showSyncHelp && (
              <div className="sidebar-sync">
                <Icon icon={faCircleCheck} style={{ color: 'var(--color-positive)' }} size="xs" />
                Sync: {lastSyncInfo.name} · {lastSyncInfo.date}
              </div>
            )}
            {showSyncHelp && (
              <div className="alert alert--primary" style={{ marginTop: 8, fontSize: '0.75rem' }}>
                <div>
                  <strong>Požadovaná struktura složek:</strong>
                  <pre style={{ fontFamily: 'monospace', fontSize: '0.7rem', background: 'var(--bg-surface-2)', padding: 8, borderRadius: 4, margin: '4px 0', whiteSpace: 'pre-wrap' }}>
                    {`Kořenová složka/\n  ├── ZOP 02-2026/\n  │   ├── MS1 - Téma/\n  │   │   ├── student1.docx\n  │   │   └── student2.pdf\n  │   └── MS2 - Téma/\n  └── ZOP 03-2026/`}
                  </pre>
                  <p style={{ margin: 0, color: 'var(--color-warning)' }}>
                    Nepoužívejte lomítko v názvech složek (ZOP 02-2026, ne 02/2026).
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <button
            className="btn btn--sm btn--outline btn--icon-only"
            style={{ width: '100%' }}
            onClick={handleDirectSync}
            disabled={isSyncing}
            title="Sync ÚZ v PC"
          >
            <Icon icon={isSyncing ? faRotate : faHardDrive} spin={isSyncing} />
          </button>
        )}
      </div>

      {/* Nová třída */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)' }}>
        {!isCollapsed ? (
          editMode?.type === 'new_class' ? (
            <input
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onBlur={handleSaveEdit}
              placeholder="Název třídy (Enter)"
              className="form-control form-control--sm"
            />
          ) : (
            <button
              className="sidebar-add-btn"
              onClick={(e) => startEdit(e, { type: 'new_class' })}
            >
              <Icon icon={faPlus} size="xs" />
              Nová třída
            </button>
          )
        ) : (
          <button
            className="btn btn--sm btn--outline btn--icon-only"
            style={{ width: '100%' }}
            onClick={() => { setIsCollapsed(false); localStorage.setItem('upvsp_sidebar_collapsed', 'false'); }}
            title="Přidat třídu"
          >
            <Icon icon={faPlus} size="xs" />
          </button>
        )}
      </div>

      {/* Seznam tříd */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
        {classes.map(cls => (
          <div key={cls.id} className="sidebar-class">
            {/* Hlavička třídy */}
            <div
              className="sidebar-class__header"
              title={isCollapsed ? cls.name : undefined}
              onClick={(e) => {
                if (isCollapsed) {
                  setIsCollapsed(false);
                  localStorage.setItem('upvsp_sidebar_collapsed', 'false');
                  if (!cls.expanded) toggleClassExpansion(cls.id, e);
                } else {
                  toggleClassExpansion(cls.id, e);
                }
              }}
            >
              {!isCollapsed && (
                <Icon
                  icon={cls.expanded ? faChevronDown : faChevronRight}
                  className="sidebar-class__chevron"
                  size="xs"
                />
              )}
              <Icon
                icon={cls.expanded ? faFolderOpen : faFolder}
                className="sidebar-class__icon"
                size="sm"
              />
              {!isCollapsed && (
                editMode?.type === 'rename_class' && editMode.classId === cls.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onBlur={handleSaveEdit}
                    onClick={e => e.stopPropagation()}
                    className="form-control"
                    style={{ fontSize: '0.825rem', height: 28, padding: '0 6px', flex: 1 }}
                  />
                ) : (
                  <span className="sidebar-class__name">{cls.name}</span>
                )
              )}
              {!isCollapsed && (
                <div className="sidebar-class__actions">
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        className="sidebar-icon-btn"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        title="Možnosti třídy"
                      >
                        <Icon icon={faEllipsisVertical} size="xs" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content className="dropdown-content" sideOffset={4} align="end">
                        <DropdownMenu.Item
                          className="dropdown-item"
                          onSelect={() => startEdit(undefined, { type: 'rename_class', classId: cls.id, currentName: cls.name }, cls.name)}
                        >
                          <Icon icon={faPen} size="xs" /> Přejmenovat
                        </DropdownMenu.Item>
                        <div className="dropdown-item--separator" role="separator" />
                        <DropdownMenu.Item
                          className="dropdown-item dropdown-item--danger"
                          onSelect={() => deleteClass(cls.id, cls.name)}
                        >
                          <Icon icon={faTrash} size="xs" /> Smazat třídu
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              )}
            </div>

            {/* Scénáře */}
            {!isCollapsed && cls.expanded && (
              <div className="sidebar-scenarios">
                {cls.scenarios.map(scen => {
                  const isSelected = scen.key === activeScenarioId;
                  return (
                    <div
                      key={scen.id}
                      className={`sidebar-scenarios__item${isSelected ? ' sidebar-scenarios__item--active' : ''}`}
                      onClick={() => onSelectScenario(cls.id, scen.key)}
                    >
                      <Icon icon={faFileLines} className="sidebar-scenarios__item__icon" size="xs" />
                      {editMode?.type === 'rename_scenario' && editMode.scenId === scen.id ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onKeyDown={handleInputKeyDown}
                          onBlur={handleSaveEdit}
                          onClick={e => e.stopPropagation()}
                          className="form-control"
                          style={{ fontSize: '0.8rem', height: 26, padding: '0 6px', flex: 1 }}
                        />
                      ) : (
                        <span className="sidebar-scenarios__name">{scen.name}</span>
                      )}
                      <div className="sidebar-scenarios__actions">
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <button
                              className="sidebar-icon-btn"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            >
                              <Icon icon={faEllipsisVertical} size="xs" />
                            </button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content className="dropdown-content" sideOffset={4} align="end">
                              <DropdownMenu.Item
                                className="dropdown-item"
                                onSelect={() => startEdit(undefined, { type: 'rename_scenario', classId: cls.id, scenId: scen.id, currentName: scen.name }, scen.name)}
                              >
                                <Icon icon={faPen} size="xs" /> Přejmenovat
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                className="dropdown-item"
                                onSelect={() => duplicateScenario(cls.id, scen.id)}
                              >
                                <Icon icon={faCopy} size="xs" /> Duplikovat
                              </DropdownMenu.Item>
                              <div className="dropdown-item--separator" role="separator" />
                              <DropdownMenu.Item
                                className="dropdown-item dropdown-item--danger"
                                onSelect={() => deleteScenario(cls.id, scen.id, scen.name)}
                              >
                                <Icon icon={faTrash} size="xs" /> Smazat
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      </div>
                    </div>
                  );
                })}

                {/* Nová modelová situace */}
                {editMode?.type === 'new_scenario' && editMode.classId === cls.id ? (
                  <div style={{ padding: '4px 12px 4px 32px' }}>
                    <input
                      autoFocus
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      onBlur={handleSaveEdit}
                      placeholder="Název (MS/OOP: Téma)"
                      className="form-control"
                      style={{ fontSize: '0.8rem', height: 28, padding: '0 8px' }}
                    />
                  </div>
                ) : (
                  <button
                    className="sidebar-add-btn"
                    style={{ paddingLeft: 32, fontSize: '0.8rem' }}
                    onClick={(e) => startEdit(e, { type: 'new_scenario', classId: cls.id })}
                  >
                    <Icon icon={faPlus} size="xs" />
                    Nová modelová situace
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`alert alert--${toast.type === 'success' ? 'positive' : 'negative'}`}
          style={{ position: 'absolute', bottom: 8, left: 8, right: 8, margin: 0, zIndex: 50 }}
        >
          <Icon
            icon={toast.type === 'success' ? faCircleCheck : faCircleXmark}
            className="alert__icon"
          />
          <span style={{ flex: 1, fontSize: '0.8rem' }}>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', opacity: 0.7 }}
          >
            <Icon icon={faXmark} size="xs" />
          </button>
        </div>
      )}
    </aside>
  );
}
