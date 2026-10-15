import { BoardControls } from '@/components/BoardControls';
import { ChessBoard } from '@/components/ChessBoard';
import { EnginePanel } from '@/components/EnginePanel';
import { EvalBar } from '@/components/EvalBar';
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
import { Sidebar } from '@/components/Sidebar';
import { TacticsPanel } from '@/components/TacticsPanel';
import { describeStatus, statusAt } from '@/chess/gameTree';
import { useAutoAnalysis } from '@/hooks/useAutoAnalysis';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useGame } from '@/stores/gameStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { useSetting } from '@/stores/settingsStore';
import { setMobileTab, setRightTab, toggleSidebar, useUi, type MobileTab, type RightTab } from '@/stores/uiStore';
import { useEffect, useMemo } from 'react';

/** The right-hand tabs come in two groups so the bar stays readable: looking at a game, and getting better. */
const TAB_GROUPS: { label: string; tabs: { id: RightTab; label: string }[] }[] = [
  {
    label: 'Analyse',
    tabs: [
      { id: 'engine', label: 'Engine' },
      { id: 'review', label: 'Review' },
      { id: 'openings', label: 'Openings' },
      { id: 'tactics', label: 'Tactics' },
    ],
  },
  {
    label: 'Improve',
    tabs: [
      { id: 'learn', label: 'Learn' },
      { id: 'puzzles', label: 'Puzzles' },
      { id: 'play', label: 'Play' },
      { id: 'strength', label: 'Strength' },
      { id: 'player', label: 'Player' },
    ],
  },
];

const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'engine', label: 'Engine' },
  { id: 'moves', label: 'Moves' },
  { id: 'review', label: 'Review' },
  { id: 'openings', label: 'Openings' },
  { id: 'tactics', label: 'Tactics' },
  { id: 'learn', label: 'Learn' },
  { id: 'puzzles', label: 'Puzzles' },
  { id: 'play', label: 'Play' },
  { id: 'strength', label: 'Strength' },
  { id: 'player', label: 'Player' },
  { id: 'menu', label: 'Menu' },
];

function StatusLine() {
  const tree = useGame((s) => s.tree);
  const currentId = useGame((s) => s.currentId);
  const text = useMemo(() => describeStatus(statusAt(tree, currentId)), [tree, currentId]);
  const turn = tree.nodes[currentId]?.fen.split(' ')[1] === 'b' ? 'Black' : 'White';
  return (
    <div className="status-line" role="status" data-testid="game-status">
      {text ?? `${turn} to move`}
    </div>
  );
}

export default function App() {
  const theme = useSetting('theme');
  const dialog = useUi((s) => s.dialog);
  const rightTab = useUi((s) => s.rightTab);
  const mobileTab = useUi((s) => s.mobileTab);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const puzzleActive = usePuzzle((s) => s.phase !== 'off');
  useAutoAnalysis();
  useKeyboard();

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  return (
    <div className={`app mobile-${mobileTab} ${puzzleActive ? 'has-puzzle' : ''} ${collapsed ? 'side-collapsed' : ''}`}>
      <div className="col-left">
        <button className="side-toggle" data-testid="side-toggle" aria-expanded={!collapsed} aria-label={collapsed ? 'Show side menu' : 'Hide side menu'} title={collapsed ? 'Show side menu' : 'Hide side menu'} onClick={toggleSidebar}>
          {collapsed ? '»' : '« Hide menu'}
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
      </main>

      <div className="col-right">
        <nav className="tabs" role="tablist" aria-label="Analysis panels">
          {TAB_GROUPS.map((g) => (
            <div className="tab-group" key={g.label} role="presentation">
              <span className="tab-group-label" aria-hidden="true">{g.label}</span>
              <div className="tab-row" role="presentation">
                {g.tabs.map((t) => (
                  <button key={t.id} role="tab" aria-selected={rightTab === t.id} className={rightTab === t.id ? 'active' : ''} onClick={() => setRightTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
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
        <section className="panel moves-panel" aria-label="Move list">
          <header className="panel-head"><h2>Moves</h2></header>
          <MoveList />
          <MoveTools />
        </section>
      </div>

      <nav className="mobile-tabs" aria-label="Sections">
        {MOBILE_TABS.map((t) => (
          <button key={t.id} className={mobileTab === t.id ? 'active' : ''} onClick={() => { setMobileTab(t.id); if (t.id === 'engine' || t.id === 'review' || t.id === 'openings' || t.id === 'tactics' || t.id === 'puzzles' || t.id === 'play' || t.id === 'player' || t.id === 'learn' || t.id === 'strength') setRightTab(t.id); }}>
            {t.label}
          </button>
        ))}
      </nav>

      {dialog === 'import' && <ImportDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'help' && <HelpDialog />}
      <Notices />
    </div>
  );
}
