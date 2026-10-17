import { BoardControls } from '@/components/BoardControls';
import { ChessBoard } from '@/components/ChessBoard';
import { EnginePanel } from '@/components/EnginePanel';
import { EvalBar } from '@/components/EvalBar';
import { AccountDialog } from '@/components/AccountSection';
import { HelpDialog } from '@/components/HelpDialog';
import { ImportDialog } from '@/components/ImportDialog';
import { MoveList, MoveTools } from '@/components/MoveList';
import { Notices } from '@/components/Notices';
import { OpeningsPanel } from '@/components/OpeningsPanel';
import { PlayerStrip } from '@/components/PlayerStrip';
import { PlayPanel } from '@/components/PlayPanel';
import { PlayerPanel } from '@/components/PlayerPanel';
import { MoveVerdict } from '@/components/MoveVerdict';
import { LearnPanel } from '@/components/LearnPanel';
import { StrengthPanel } from '@/components/StrengthPanel';
import { PuzzlePanel } from '@/components/PuzzlePanel';
import { ReviewPanel } from '@/components/ReviewPanel';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Home } from '@/components/Home';
import { Sidebar } from '@/components/Sidebar';
import { TacticsPanel } from '@/components/TacticsPanel';
import { describeStatus, lineEnd, statusAt } from '@/chess/gameTree';
import { useAutoAnalysis } from '@/hooks/useAutoAnalysis';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useGame } from '@/stores/gameStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { usePlay } from '@/stores/playStore';
import { useSetting } from '@/stores/settingsStore';
import { openDialog, setMobileTab, setRightTab, toggleMoves, toggleSidebar, useUi, type RightTab } from '@/stores/uiStore';
import { useEffect, useMemo } from 'react';
import { useView } from '@/stores/viewStore';

/**
 * The right-hand side has four sections; sections with more than one panel show a second row of sub-tabs.
 * (Fewer tabs at once: what you want to do first, then which tool.)
 */
const SECTIONS: { id: string; label: string; short?: string; hint: string; tabs: { id: RightTab; label: string }[] }[] = [
  {
    id: 'analyse', label: 'Analyse', hint: 'Look at a game or position',
    tabs: [
      { id: 'engine', label: 'Engine' },
      { id: 'review', label: 'Review' },
      { id: 'openings', label: 'Openings' },
      { id: 'tactics', label: 'Tactics' },
    ],
  },
  {
    id: 'train', label: 'Train', hint: 'Lessons and puzzles',
    tabs: [
      { id: 'learn', label: 'Learn' },
      { id: 'puzzles', label: 'Puzzles' },
    ],
  },
  {
    id: 'games', label: 'My games', short: 'Games', hint: 'Your Chess.com / Lichess games and strength',
    tabs: [
      { id: 'player', label: 'Player' },
      { id: 'strength', label: 'Strength' },
    ],
  },
  { id: 'play', label: 'Play', hint: 'Play Stockfish', tabs: [{ id: 'play', label: 'Play' }] },
];
const lastInSection = new Map<string, RightTab>();


function StatusLine() {
  const tree = useGame((s) => s.tree);
  const currentId = useGame((s) => s.currentId);
  const text = useMemo(() => describeStatus(statusAt(tree, currentId)), [tree, currentId]);
  const turn = tree.nodes[currentId]?.fen.split(' ')[1] === 'b' ? 'Black' : 'White';
  const result = tree.headers['Result'];
  const atEnd = lineEnd(tree, currentId) === currentId;
  const shownResult = atEnd && result !== undefined && ['1-0', '0-1', '1/2-1/2'].includes(result) ? result : null;
  return (
    <div className="status-line" role="status" data-testid="game-status">
      {text ?? `${turn} to move`}{shownResult !== null && ` · Result ${shownResult === '1/2-1/2' ? '½–½' : shownResult}`}
    </div>
  );
}

export default function App() {
  const theme = useSetting('theme');
  const dialog = useUi((s) => s.dialog);
  const rightTab = useUi((s) => s.rightTab);
  const mobileTab = useUi((s) => s.mobileTab);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const movesCollapsed = useUi((s) => s.movesCollapsed);
  const puzzleActive = usePuzzle((s) => s.phase !== 'off');
  const playActive = usePlay((s) => s.phase !== 'off');
  const view = useView();
  const section = SECTIONS.find((sec) => sec.tabs.some((t) => t.id === rightTab));
  if (section) lastInSection.set(section.id, rightTab);
  useAutoAnalysis();
  useKeyboard();

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  if (view === 'home') {
    return (
      <>
        <Home />
        {dialog === 'help' && <HelpDialog />}
        {dialog === 'import' && <ImportDialog />}
        {dialog === 'account' && <AccountDialog />}
        <Notices />
      </>
    );
  }

  return (
    <div data-section={section?.id ?? ''} data-live={puzzleActive ? 'puzzle' : playActive ? 'play' : ''} className={`app mobile-${mobileTab} ${puzzleActive ? 'has-puzzle' : ''} ${collapsed ? 'side-collapsed' : ''} ${movesCollapsed ? 'moves-collapsed' : ''}`}>
      <div className="col-left">
        <button className="side-toggle" data-testid="side-toggle" aria-expanded={!collapsed} aria-label={collapsed ? 'Tools: export, FEN, saved games' : 'Hide side menu'} title={collapsed ? 'Tools: export, FEN, saved games' : 'Hide side menu'} onClick={toggleSidebar}>
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg><span className="lb">{collapsed ? '' : 'Hide tools'}</span>
        </button>
        <div className="side-body"><Sidebar /></div>
      </div>

      <main className="col-center">
        <div className="board-stack">
          <div className="strip-wrap"><PlayerStrip position="top" /></div>
          <div className="board-area">
            <EvalBar />
            <ChessBoard />
          </div>
          <div className="strip-wrap"><PlayerStrip position="bottom" /></div>
        </div>
        <StatusLine />
        <MoveVerdict />
        <BoardControls />
        <section className="panel moves-panel" aria-label="Move list">
          <div className="moves-head">
            <h2>Moves</h2>
            <button className="btn small" onClick={toggleMoves} aria-expanded={!movesCollapsed} aria-label={movesCollapsed ? 'Show moves' : 'Hide moves'} title={movesCollapsed ? 'Show moves' : 'Hide moves to get a bigger board'} data-testid="moves-toggle">{movesCollapsed ? '▴ Show' : '▾ Hide'}</button>
          </div>
          {!movesCollapsed && <div className="moves-scroll"><MoveList /><MoveTools /></div>}
        </section>
      </main>

      <div className="col-right">
        <nav className="tabs" role="tablist" aria-label="Sections">
          <div className="tab-row primary" role="presentation">
            {SECTIONS.map((sec) => {
              const active = sec.tabs.some((t) => t.id === rightTab);
              return (
                <button key={sec.id} role="tab" aria-selected={active} aria-label={sec.label} className={active ? 'active' : ''} title={sec.hint}
                  onClick={() => { const t = sec.tabs.some((x) => x.id === lastInSection.get(sec.id)) ? lastInSection.get(sec.id)! : sec.tabs[0]!.id; setRightTab(t); setMobileTab(t); }}>
                  <span className="lbl-full" aria-hidden="true">{sec.label}</span>
                  {sec.short !== undefined && <span className="lbl-short" aria-hidden="true">{sec.short}</span>}
                </button>
              );
            })}
            <button className="help-btn" onClick={() => openDialog('help')} aria-label="Help and tips" title="Help and tips" data-testid="open-help">?</button>
          </div>
          {section && section.tabs.length > 1 && (
            <div className="tab-row sub" role="presentation">
              {section.tabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={rightTab === t.id} className={rightTab === t.id ? 'active' : ''} onClick={() => { setRightTab(t.id); setMobileTab(t.id); }}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </nav>
        <div className={`right-panels tab-${rightTab}`}>
          <div className="p-engine"><EnginePanel /></div>
          <div className="p-review"><ReviewPanel /></div>
          <div className="p-openings"><OpeningsPanel /></div>
          <div className="p-tactics"><TacticsPanel /></div>
          <div className="p-learn"><LearnPanel /></div>
          <div className="p-puzzles"><PuzzlePanel /></div>
          <div className="p-play"><PlayPanel /></div>
          <div className="p-strength"><StrengthPanel /></div>
          <div className="p-player"><PlayerPanel /></div>
        </div>
      </div>

      <nav className="mobile-tabs" aria-label="Sections">
        <button className={mobileTab === 'board' ? 'active' : ''} onClick={() => setMobileTab('board')}>Board</button>
        {SECTIONS.map((sec) => {
          const active = sec.tabs.some((t) => t.id === mobileTab);
          return (
            <button key={sec.id} className={active ? 'active' : ''} onClick={() => {
              const t = sec.tabs.some((x) => x.id === lastInSection.get(sec.id)) ? lastInSection.get(sec.id)! : sec.tabs[0]!.id;
              setRightTab(t); setMobileTab(t);
            }}>{sec.label}</button>
          );
        })}
        <button className={mobileTab === 'menu' ? 'active' : ''} onClick={() => setMobileTab('menu')}>Menu</button>
      </nav>

      {dialog === 'import' && <ImportDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'help' && <HelpDialog />}
      {dialog === 'account' && <AccountDialog />}
      <Notices />
    </div>
  );
}
