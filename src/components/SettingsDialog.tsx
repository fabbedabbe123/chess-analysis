import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { playSound, unlockAudio } from '@/utils/sound';
import { DEFAULT_THRESHOLDS } from '@/analysis/classify';
import { clearEvalCache, restartEngine, useEngine } from '@/stores/engineStore';
import {
  BOARD_THEMES,
  PIECE_SETS,
  resetSettings,
  updateSettings,
  useSettings,
  type Settings,
} from '@/stores/settingsStore';
import { closeDialog, confirmThen, requestReanalysis } from '@/stores/uiStore';
import { startTour } from '@/stores/tourStore';
import { applyBackup, collectBackup, describeBackup, parseBackup } from '@/utils/backup';
import { BOARD_COLORS } from '@/utils/boardStyle';
import { downloadText } from '@/utils/download';
import { notify } from '@/stores/gameStore';
import { Modal } from './Modal';
import { AccountSettings } from './AccountSection';

type SectionId = 'account' | 'board' | 'sound' | 'engine' | 'review' | 'openings' | 'data';
const SECTIONS: { id: SectionId; label: string; icon: string; keywords: string }[] = [
  { id: 'account', label: 'Account', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c.5-4 3.5-6 8-6s7.5 2 8 6', keywords: 'account sign in username e-mail email friends privacy online status sync picture avatar delete cloud profile' },
  { id: 'board', label: 'Board & pieces', icon: 'M4 4h16v16H4zM4 12h16M12 4v16', keywords: 'board pieces colour color theme dark light coordinates legal moves highlight last move arrows evaluation format centipawns pawns win percent' },
  { id: 'sound', label: 'Sound & motion', icon: 'M4 9v6h4l5 4V5L8 9zM17 8a5 5 0 010 8', keywords: 'sound volume audio move sounds test animations confetti win lose' },
  { id: 'engine', label: 'Engine', icon: 'M13 2L4 14h7l-1 8 9-12h-7z', keywords: 'engine stockfish analyse automatically auto review import search limit depth time infinite lines multipv hash memory threads wdl win draw loss limit playing strength elo skill level restart cache' },
  { id: 'review', label: 'Game review', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 12l3 3 5-6', keywords: 'review depth thresholds excellent good inaccuracy mistake blunder grades classification' },
  { id: 'openings', label: 'Opening explorer', icon: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13', keywords: 'opening explorer database masters lichess token api' },
  { id: 'data', label: 'Your data', icon: 'M4 7c0-2 3.5-3 8-3s8 1 8 3-3.5 3-8 3-8-1-8-3zM4 7v10c0 2 3.5 3 8 3s8-1 8-3V7M4 12c0 2 3.5 3 8 3s8-1 8-3', keywords: 'data backup download restore file reset all settings defaults tour tutorial' },
];

function Icon({ d, className }: { d: string; className?: string }) {
  return <svg className={`ic ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
}

/** One settings line: title + optional hint on the left, the control on the right. */
function Row({ title, hint, children, htmlFor }: { title: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="set-row">
      <div className="set-t">{htmlFor !== undefined ? <label htmlFor={htmlFor}>{title}</label> : <b>{title}</b>}{hint !== undefined && <span>{hint}</span>}</div>
      <div className="set-c">{children}</div>
    </div>
  );
}

/** A switch: a real checkbox (so labels, keyboard and tests work) styled as a toggle. The whole row is the label. */
function Toggle({ k, label, hint }: { k: keyof Settings; label: string; hint?: string }) {
  const s = useSettings();
  return (
    <label className="set-row set-toggle">
      <span className="set-t"><b>{label}</b>{hint !== undefined && <span>{hint}</span>}</span>
      <input type="checkbox" className="switch" checked={Boolean(s[k])} onChange={(e) => updateSettings({ [k]: e.target.checked } as Partial<Settings>)} />
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** − value + with a typed number input in the middle (keeps keyboard entry and min/max). */
function Stepper({ k, label, min, max, step = 1, unit }: { k: keyof Settings; label: string; min: number; max: number; step?: number; unit?: string }) {
  const s = useSettings();
  const v = Number(s[k]);
  const put = (n: number) => updateSettings({ [k]: Math.max(min, Math.min(max, n)) } as Partial<Settings>);
  return (
    <div className="stepper">
      <button type="button" aria-label={`Less ${label}`} onClick={() => put(v - step)} disabled={v <= min}>−</button>
      <input type="number" aria-label={label} min={min} max={max} step={step} value={v} onChange={(e) => updateSettings({ [k]: Number(e.target.value) } as Partial<Settings>)} />
      {unit !== undefined && <span className="unit">{unit}</span>}
      <button type="button" aria-label={`More ${label}`} onClick={() => put(v + step)} disabled={v >= max}>+</button>
    </div>
  );
}

/** Small live board that shows what the board options do. */
function BoardPreview() {
  const s = useSettings();
  const [light, dark] = BOARD_COLORS[s.boardTheme];
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const pieces = useMemo(() => {
    const out: { key: string; x: number; y: number; img: string }[] = [];
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R'.split('/').forEach((row, r) => {
      let c = 0;
      for (const ch of row) {
        if (/[1-8]/.test(ch)) { c += Number(ch); continue; }
        const col = ch === ch.toUpperCase() ? 'w' : 'b';
        out.push({ key: `${r}${c}`, x: c * 12.5, y: r * 12.5, img: `${base}pieces/${s.pieceSet}/${col}${ch.toUpperCase()}.svg` });
        c += 1;
      }
    });
    return out;
  }, [base, s.pieceSet]);
  return (
    <div className="set-preview" aria-label="Board preview" role="img" style={{ backgroundColor: light, backgroundImage: `conic-gradient(${dark} 25%, transparent 0 50%, ${dark} 0 75%, transparent 0)` }}>
      {s.highlightLastMove && <><i className="hl" style={{ left: '75%', top: '87.5%' }} /><i className="hl" style={{ left: '62.5%', top: '62.5%' }} /></>}
      {pieces.map((p) => <i key={p.key} className="pc" style={{ left: `${p.x}%`, top: `${p.y}%`, backgroundImage: `url('${p.img}')` }} />)}
      {s.showLegalMoves && <><i className="dot" style={{ left: '75%', top: '37.5%' }} /><i className="dot" style={{ left: '87.5%', top: '50%' }} /><i className="dot" style={{ left: '37.5%', top: '50%' }} /></>}
      {s.showCoordinates && 'abcdefgh'.split('').map((f, i) => <span key={f} className="co" style={{ left: `${i * 12.5 + 10}%`, top: '95%', color: i % 2 === 0 ? light : dark }}>{f}</span>)}
      {s.showCoordinates && [8, 7, 6, 5, 4, 3, 2, 1].map((n, i) => <span key={n} className="co" style={{ left: '1.2%', top: `${i * 12.5 + 1.2}%`, color: i % 2 === 0 ? dark : light }}>{n}</span>)}
      {s.showEngineArrows && <svg className="arr" viewBox="0 0 8 8"><path d="M3.5 6.5 L3.5 4.6" stroke="#3f6a1d" strokeWidth="0.2" strokeLinecap="round" opacity=".85" /><polygon points="3.5,4.05 3.2,4.65 3.8,4.65" fill="#3f6a1d" opacity=".85" /></svg>}
    </div>
  );
}

function DataBackup() {
  const exportAll = () => {
    try {
      const backup = collectBackup(localStorage);
      downloadText(`chess-analysis-backup-${backup.exportedAt.slice(0, 10)}.json`, JSON.stringify(backup), 'application/json');
      notify('info', 'Backup downloaded.');
    } catch {
      notify('error', 'Could not read this browser\'s storage.');
    }
  };
  const importFile = async (file: File | undefined) => {
    if (file === undefined) return;
    if (file.size > 30_000_000) { notify('error', 'That file is too large to be a backup.'); return; }
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) { notify('error', parsed.error); return; }
    confirmThen(true, `Restore ${describeBackup(parsed.keys, parsed.backup.data)} from ${parsed.backup.exportedAt.slice(0, 10) || 'an unknown date'}? This replaces everything stored in this browser (games, settings, progress).`, 'Restore', () => {
      const r = applyBackup(parsed.backup, localStorage);
      if (!r.ok) { notify('error', r.error); return; }
      window.location.reload();
    });
  };
  return (
    <div className="set-tiles">
      <div className="set-tile">
        <Icon d="M12 4v12M7 11l5 5 5-5M5 20h14" className="big" />
        <b>Download backup</b>
        <span>One file with your games, review results, puzzle progress and settings. The Lichess token is never included.</span>
        <button className="btn primary" onClick={exportAll} data-testid="backup-export">Download</button>
      </div>
      <div className="set-tile">
        <Icon d="M12 20V8M7 13l5-5 5 5M5 4h14" className="big" />
        <b>Restore from file</b>
        <span>Replaces everything stored in this browser with the backup.</span>
        <label className="btn" style={{ cursor: 'pointer' }}>
          Choose file…
          <input type="file" accept="application/json,.json" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} data-testid="backup-import" />
        </label>
      </div>
    </div>
  );
}

function useNarrow(): boolean {
  const q = '(max-width: 700px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches === true);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

export function SettingsDialog() {
  const s = useSettings();
  const caps = useEngine((e) => e.capabilities);
  const maxThreads = caps?.flavor === 'multi' ? Math.min(caps.maxThreads, 32) : 1;
  const th = s.thresholds;
  const setTh = (key: keyof typeof th, value: number) => updateSettings({ thresholds: { ...th, [key]: value } });
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<SectionId>('account');
  const [advanced, setAdvanced] = useState(false);
  const narrow = useNarrow();
  const [mobileSection, setMobileSection] = useState<SectionId | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const matches = (id: SectionId) => {
    if (q === '') return true;
    const sec = SECTIONS.find((x) => x.id === id)!;
    return q.split(/\s+/).every((w) => sec.keywords.includes(w) || sec.label.toLowerCase().includes(w));
  };
  const shown = (id: SectionId) => (narrow && q === '' ? mobileSection === id : matches(id));
  const anyShown = SECTIONS.some((x) => matches(x.id));
  const advOpen = advanced || (q !== '' && /hash|thread|wdl|win|draw|loss|limit|elo|skill|restart|cache|memory/.test(q));

  // Highlight the section in view (desktop: one scrolling pane with all sections).
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || narrow) return;
    const onScroll = () => {
      const secs = Array.from(pane.querySelectorAll<HTMLElement>('[data-sec]'));
      const top = pane.getBoundingClientRect().top + 80;
      let id: SectionId = (secs[0]?.dataset['sec'] as SectionId) ?? 'account';
      for (const el of secs) if (el.getBoundingClientRect().top <= top) id = el.dataset['sec'] as SectionId;
      if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4 && secs.length) id = secs[secs.length - 1]!.dataset['sec'] as SectionId;
      setCurrent(id);
    };
    pane.addEventListener('scroll', onScroll, { passive: true });
    return () => pane.removeEventListener('scroll', onScroll);
  }, [narrow, q]);

  const jump = (id: SectionId) => {
    if (narrow) { setMobileSection(id); setQuery(''); return; }
    setCurrent(id);
    paneRef.current?.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const listMode = narrow && mobileSection === null && q === '';
  const head = (id: SectionId, sub: string) => (
    <div className="set-head">
      {narrow && q === '' && <button type="button" className="set-back" onClick={() => setMobileSection(null)}><Icon d="M15 5l-7 7 7 7" />Settings</button>}
      <h3>{SECTIONS.find((x) => x.id === id)!.label}</h3>
      <p>{sub}</p>
    </div>
  );

  return (
    <Modal title="Settings" onClose={closeDialog} wide className="settings-modal">
      <div className={`set ${narrow ? 'narrow' : ''} ${listMode ? 'list-mode' : ''}`}>
        <label className="set-search">
          <Icon d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings (e.g. sound, depth)" aria-label="Search settings" data-testid="settings-search" />
        </label>

        <nav className="set-nav" aria-label="Settings sections">
          {SECTIONS.map((x) => (
            <button key={x.id} type="button" className={`${!narrow && current === x.id && matches(x.id) ? 'on' : ''} ${matches(x.id) ? '' : 'dim'}`} onClick={() => jump(x.id)} data-testid={`settings-nav-${x.id}`}>
              <Icon d={x.icon} />{x.label}{narrow && <Icon d="M9 5l7 7-7 7" className="chev" />}
            </button>
          ))}
          {!narrow && <div className="set-navfoot">Everything is saved as you change it.<button type="button" className="linklike" onClick={() => { closeDialog(); startTour(); }} data-testid="settings-tour">Show the tour again</button></div>}
        </nav>

        <div className="set-pane" ref={paneRef}>
          {shown('account') && (
            <section data-sec="account" className="set-sec">
              {head('account', 'Optional. Sign in with an e-mail link to sync games, puzzles and settings between devices.')}
              <AccountSettings />
            </section>
          )}

          {shown('board') && (
            <section data-sec="board" className="set-sec">
              {head('board', 'What you change shows up on the preview straight away.')}
              <div className="set-boardgrid">
                <BoardPreview />
                <div>
                  <div className="set-label">Board colours</div>
                  <div className="set-swatches">
                    {BOARD_THEMES.map((t) => {
                      const [l, d] = BOARD_COLORS[t.id];
                      return (
                        <button key={t.id} type="button" className={`set-swatch ${s.boardTheme === t.id ? 'on' : ''}`} aria-label={`${t.label} board`} aria-pressed={s.boardTheme === t.id} onClick={() => updateSettings({ boardTheme: t.id })}>
                          <i style={{ backgroundColor: l, backgroundImage: `conic-gradient(${d} 25%, transparent 0 50%, ${d} 0 75%, transparent 0)` }} />{t.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="set-label" style={{ marginTop: 20 }}>Pieces</div>
                  <div className="set-pieces">
                    {PIECE_SETS.map((p) => (
                      <button key={p.id} type="button" className={`set-pset ${s.pieceSet === p.id ? 'on' : ''}`} aria-label={`${p.label} pieces`} aria-pressed={s.pieceSet === p.id} onClick={() => updateSettings({ pieceSet: p.id })}>
                        <img src={`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}pieces/${p.id}/wN.svg`} alt="" />{p.label.replace(/ \(.*\)/, '')}<small>{p.license}</small>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="set-label">On the board</div>
              <div className="set-card">
                <Toggle k="showCoordinates" label="Show coordinates" />
                <Toggle k="showLegalMoves" label="Show legal moves" hint="Dots on the squares a picked-up piece can go to." />
                <Toggle k="highlightLastMove" label="Highlight last move" />
                <Toggle k="showEngineArrows" label="Engine arrows on the board" hint="The best moves drawn on the board while analysing." />
              </div>
              <div className="set-label">App</div>
              <div className="set-card">
                <Row title="Theme"><Segmented label="Theme" value={s.theme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} onChange={(v) => updateSettings({ theme: v })} /></Row>
                <Row title="Evaluation format" hint="How scores are written next to the board and lines."><Segmented label="Evaluation format" value={s.evalDisplay} options={[{ value: 'pawns', label: '+0.35' }, { value: 'centipawns', label: '+35' }, { value: 'winpercent', label: '59%' }]} onChange={(v) => updateSettings({ evalDisplay: v })} /></Row>
              </div>
            </section>
          )}

          {shown('sound') && (
            <section data-sec="sound" className="set-sec">
              {head('sound', 'Wood-like clicks for moves and captures, and a short effect when a game ends.')}
              <div className="set-card">
                <Toggle k="moveSounds" label="Move sounds (moves, captures, win / lose)" />
                <Row title={`Volume ${s.soundVolume}%`}>
                  <input type="range" min={0} max={100} step={5} value={s.soundVolume} aria-label="Sound volume" onChange={(e) => updateSettings({ soundVolume: Number(e.target.value) })} onPointerUp={() => { unlockAudio(); playSound('move', s.soundVolume / 100); }} data-testid="sound-volume" />
                  <button className="btn" type="button" onClick={() => { unlockAudio(); playSound('capture', s.soundVolume / 100); setTimeout(() => playSound('win', s.soundVolume / 100), 450); }} data-testid="sound-test">▶ Test</button>
                </Row>
                <Toggle k="winAnimations" label="Win / lose animations" hint="Confetti, and a gentle shake when you lose." />
              </div>
            </section>
          )}

          {shown('engine') && (
            <section data-sec="engine" className="set-sec">
              {head('engine', 'Stockfish runs in your browser. The defaults are good for most people.')}
              <div className="set-label">When to analyse</div>
              <div className="set-card">
                <Toggle k="autoAnalyze" label="Analyse automatically" hint="Start the engine on every position you look at." />
                <Toggle k="autoReviewOnImport" label="Review the game automatically after importing a PGN" />
              </div>
              <div className="set-label">How deep</div>
              <div className="set-card">
                <Row title="Search limit"><Segmented label="Search limit" value={s.analysisMode} options={[{ value: 'depth', label: 'Depth' }, { value: 'time', label: 'Time' }, { value: 'infinite', label: 'Infinite' }]} onChange={(v) => updateSettings({ analysisMode: v })} /></Row>
                {s.analysisMode === 'depth' && <Row title="Depth" hint="18 is quick and strong. Higher is slower."><Stepper k="analysisDepth" label="Depth" min={1} max={60} /></Row>}
                {s.analysisMode === 'time' && <Row title="Time per position"><Stepper k="analysisTimeMs" label="Time per position (ms)" min={100} max={600000} step={500} unit="ms" /></Row>}
                {s.analysisMode === 'infinite' && <Row title="Runs until you move on or press Stop."><span /></Row>}
                <Row title="Lines" hint="How many best moves to show at once."><Stepper k="multiPv" label="Lines (MultiPV)" min={1} max={Math.min(caps?.maxMultiPv ?? 8, 8)} /></Row>
              </div>
              <button type="button" className={`set-adv ${advOpen ? 'open' : ''}`} aria-expanded={advOpen} onClick={() => setAdvanced(!advanced)} data-testid="settings-advanced">
                <Icon d="M9 5l7 7-7 7" />Advanced: memory, threads, strength limit
              </button>
              {advOpen && (
                <div className="set-card">
                  <Row title="Hash (memory)" hint="MB of memory for the engine."><Stepper k="hashMb" label="Hash (MB)" min={1} max={512} unit="MB" /></Row>
                  <Row title="Threads" hint={caps?.flavor === 'multi' ? undefined : 'This browser runs the single-threaded engine (needs a cross-origin-isolated page for more).'}><Stepper k="threads" label="Threads" min={1} max={maxThreads} /></Row>
                  <Toggle k="showWdl" label="Show win/draw/loss (UCI_ShowWDL)" />
                  <Toggle k="limitStrength" label="Limit playing strength (Elo)" hint="Applies to live analysis. Reviews always use full strength." />
                  {s.limitStrength
                    ? <Row title="Elo"><Stepper k="elo" label="Elo" min={caps?.minElo ?? 1320} max={caps?.maxElo ?? 3190} step={50} /></Row>
                    : <Row title="Skill level" hint="20 = full strength. Reviews always use full strength."><Stepper k="skillLevel" label="Skill level (0–20)" min={0} max={20} /></Row>}
                  <Row title="Restart engine & clear cache" hint="If analysis seems stuck."><button className="btn" type="button" onClick={() => { clearEvalCache(); restartEngine(); requestReanalysis(); }}>Restart</button></Row>
                </div>
              )}
            </section>
          )}

          {shown('review') && (
            <section data-sec="review" className="set-sec">
              {head('review', 'How hard the review looks, and where the line goes between a good move and a mistake.')}
              <div className="set-card">
                <Row title="Review depth" hint="Higher is more accurate but slower. 14 is a good balance."><Stepper k="reviewDepth" label="Review depth" min={6} max={30} /></Row>
              </div>
              <div className="set-label">Move grades · lost winning chance (percentage points)</div>
              <div className="set-card set-pad">
                <div className="set-scale" aria-hidden="true" />
                <div className="set-marks">
                  {([['excellent', 'Excellent up to', '#81b64c'], ['good', 'Good up to', '#96bc4b'], ['inaccuracy', 'Inaccuracy up to', '#e6b83a'], ['mistake', 'Mistake up to', '#e08a3a']] as const).map(([k, label, color]) => (
                    <label key={k} className="set-mark">
                      <span><i style={{ background: color }} />{label}</span>
                      <input type="number" min={0} max={100} step={0.5} value={th[k]} aria-label={`${k} ≤`} onChange={(e) => setTh(k, Number(e.target.value))} />
                    </label>
                  ))}
                </div>
                <div className="set-markfoot"><span>Best = the engine's first choice. Above the last value it is a blunder. Applies the next time you run a review.</span><button className="btn" type="button" onClick={() => updateSettings({ thresholds: DEFAULT_THRESHOLDS })}>Reset thresholds</button></div>
              </div>
            </section>
          )}

          {shown('openings') && (
            <section data-sec="openings" className="set-sec">
              {head('openings', 'Which games the Openings tab compares your moves with.')}
              <div className="set-card">
                <Row title="Database" hint="Masters = strong over-the-board games. Lichess = millions of online games."><Segmented label="Database" value={s.explorerSource} options={[{ value: 'masters', label: 'Masters' }, { value: 'lichess', label: 'Lichess' }]} onChange={(v) => updateSettings({ explorerSource: v })} /></Row>
                <Row title="Lichess API token (optional)" hint="Stored only in this browser and sent only to explorer.lichess.ovh." htmlFor="set-token">
                  <input id="set-token" className="set-input" type="password" value={s.explorerToken} autoComplete="off" onChange={(e) => updateSettings({ explorerToken: e.target.value.trim() })} placeholder="lip_…" />
                </Row>
              </div>
            </section>
          )}

          {shown('data') && (
            <section data-sec="data" className="set-sec">
              {head('data', 'Games, review results, puzzle progress and settings live in this browser. Keep a backup or move it to another browser.')}
              <DataBackup />
              {narrow && <div className="set-card"><Row title="Guided tour" hint="A one-minute walk through the app."><button className="btn" type="button" onClick={() => { closeDialog(); startTour(); }}>Show the tour</button></Row></div>}
              <div className="set-label">Danger zone</div>
              <div className="set-card danger">
                <Row title="Reset all settings" hint="Back to the defaults. Your games and progress are kept."><button className="btn danger" type="button" onClick={() => confirmThen(true, 'Reset all settings to their defaults? Your games and progress are kept.', 'Reset settings', () => resetSettings())}>Reset all settings</button></Row>
              </div>
            </section>
          )}

          {!anyShown && <p className="set-none">No setting matches “{query}”.</p>}
        </div>

        <footer className="set-foot">
          <span className="set-saved">Saved automatically</span>
          <button className="btn primary" onClick={closeDialog}>Done</button>
        </footer>
      </div>
    </Modal>
  );
}
