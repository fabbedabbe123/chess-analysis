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
import { applyBackup, collectBackup, describeBackup, parseBackup } from '@/utils/backup';
import { downloadText } from '@/utils/download';
import { notify } from '@/stores/gameStore';
import { Modal } from './Modal';
import { AccountSettings } from './AccountSection';

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
    <fieldset>
      <legend>Your data</legend>
      <p className="muted small-print">Everything (games, review results, puzzle progress, settings) lives only in this browser. Download a backup to keep it safe or to move it to another browser. The Lichess token is never included.</p>
      <div className="row wrap">
        <button className="btn" onClick={exportAll} data-testid="backup-export">Download backup</button>
        <label className="btn" style={{ cursor: 'pointer' }}>
          Restore from file…
          <input type="file" accept="application/json,.json" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} data-testid="backup-import" />
        </label>
      </div>
    </fieldset>
  );
}

function Check({ k, label }: { k: keyof Settings; label: string }) {
  const s = useSettings();
  return (
    <label className="field check">
      <input type="checkbox" checked={Boolean(s[k])} onChange={(e) => updateSettings({ [k]: e.target.checked } as Partial<Settings>)} />
      <span>{label}</span>
    </label>
  );
}

function Num({ k, label, min, max, step = 1, hint }: { k: keyof Settings; label: string; min: number; max: number; step?: number; hint?: string }) {
  const s = useSettings();
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} max={max} step={step} value={Number(s[k])} onChange={(e) => updateSettings({ [k]: Number(e.target.value) } as Partial<Settings>)} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function SettingsDialog() {
  const s = useSettings();
  const caps = useEngine((e) => e.capabilities);
  const maxThreads = caps?.flavor === 'multi' ? Math.min(caps.maxThreads, 32) : 1;
  const th = s.thresholds;
  const setTh = (key: keyof typeof th, value: number) => updateSettings({ thresholds: { ...th, [key]: value } });

  return (
    <Modal title="Settings" onClose={closeDialog} wide>
      <div className="settings-grid">
        <AccountSettings />
        <fieldset>
          <legend>Appearance</legend>
          <label className="field"><span>Theme</span>
            <select value={s.theme} onChange={(e) => updateSettings({ theme: e.target.value as Settings['theme'] })}>
              <option value="dark">Dark</option><option value="light">Light</option>
            </select>
          </label>
          <label className="field"><span>Board</span>
            <select value={s.boardTheme} onChange={(e) => updateSettings({ boardTheme: e.target.value as Settings['boardTheme'] })}>
              {BOARD_THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Pieces</span>
            <select value={s.pieceSet} onChange={(e) => updateSettings({ pieceSet: e.target.value as Settings['pieceSet'] })}>
              {PIECE_SETS.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.license})</option>)}
            </select>
          </label>
          <Check k="showCoordinates" label="Show coordinates" />
          <Check k="showLegalMoves" label="Show legal moves" />
          <Check k="highlightLastMove" label="Highlight last move" />
          <Check k="showEngineArrows" label="Engine arrows on the board" />
          <Check k="moveSounds" label="Move sounds (moves, captures, win / lose)" />
          <button className="btn small" type="button" onClick={() => { unlockAudio(); playSound("capture", s.soundVolume / 100); setTimeout(() => playSound("win", s.soundVolume / 100), 450); }} data-testid="sound-test">▶ Play test sound</button>
          <label className="field"><span>Sound volume: {s.soundVolume}%</span>
            <input type="range" min={0} max={100} step={5} value={s.soundVolume} onChange={(e) => updateSettings({ soundVolume: Number(e.target.value) })} onPointerUp={() => { unlockAudio(); playSound("move", s.soundVolume / 100); }} data-testid="sound-volume" />
          </label>
          <Check k="winAnimations" label="Win / lose animations" />
          <label className="field"><span>Evaluation format</span>
            <select value={s.evalDisplay} onChange={(e) => updateSettings({ evalDisplay: e.target.value as Settings['evalDisplay'] })}>
              <option value="pawns">Pawns (+0.35)</option><option value="centipawns">Centipawns (+35)</option><option value="winpercent">White win % (59%)</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Engine</legend>
          <Check k="autoAnalyze" label="Analyse automatically" />
          <Check k="autoReviewOnImport" label="Review the game automatically after importing a PGN" />
          <label className="field"><span>Search limit</span>
            <select value={s.analysisMode} onChange={(e) => updateSettings({ analysisMode: e.target.value as Settings['analysisMode'] })}>
              <option value="depth">Fixed depth</option><option value="time">Fixed time</option><option value="infinite">Infinite (until you navigate or stop)</option>
            </select>
          </label>
          <Num k="analysisDepth" label="Depth" min={1} max={60} />
          <Num k="analysisTimeMs" label="Time per position (ms)" min={100} max={600000} step={100} />
          <Num k="multiPv" label="Lines (MultiPV)" min={1} max={Math.min(caps?.maxMultiPv ?? 8, 8)} />
          <Num k="hashMb" label="Hash (MB)" min={1} max={512} />
          <Num k="threads" label="Threads" min={1} max={maxThreads} hint={caps?.flavor === 'multi' ? undefined : 'This browser runs the single-threaded engine (needs a cross-origin-isolated page for more).'} />
          <Check k="showWdl" label="Show win/draw/loss (UCI_ShowWDL)" />
          <Check k="limitStrength" label="Limit playing strength (Elo)" />
          {s.limitStrength ? (
            <Num k="elo" label="Elo" min={caps?.minElo ?? 1320} max={caps?.maxElo ?? 3190} hint="Applies to live analysis. Reviews always use full strength." />
          ) : (
            <Num k="skillLevel" label="Skill level (0–20)" min={0} max={20} hint="20 = full strength. Reviews always use full strength." />
          )}
          <div className="row">
            <button className="btn small" onClick={() => { clearEvalCache(); restartEngine(); requestReanalysis(); }}>Restart engine & clear cache</button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Game review</legend>
          <Num k="reviewDepth" label="Review depth" min={6} max={30} />
          <p className="muted small-print">Classification uses the loss of the mover's winning chances (percentage points). A move is: best (engine's first choice), excellent ≤ A, good ≤ B, inaccuracy ≤ C, mistake ≤ D, blunder above D.</p>
          {(['excellent', 'good', 'inaccuracy', 'mistake'] as const).map((k) => (
            <label key={k} className="field"><span>{k} ≤</span>
              <input type="number" min={0} max={100} step={0.5} value={th[k]} onChange={(e) => setTh(k, Number(e.target.value))} />
            </label>
          ))}
          <button className="btn small" onClick={() => updateSettings({ thresholds: DEFAULT_THRESHOLDS })}>Reset thresholds</button>
          <p className="muted small-print">Thresholds apply the next time you run a review.</p>
        </fieldset>

        <fieldset>
          <legend>Opening explorer</legend>
          <label className="field"><span>Database</span>
            <select value={s.explorerSource} onChange={(e) => updateSettings({ explorerSource: e.target.value as Settings['explorerSource'] })}>
              <option value="masters">Masters</option><option value="lichess">Lichess</option>
            </select>
          </label>
          <label className="field"><span>Lichess API token (optional)</span>
            <input type="password" value={s.explorerToken} autoComplete="off" onChange={(e) => updateSettings({ explorerToken: e.target.value.trim() })} placeholder="lip_…" />
            <small className="muted">Stored only in this browser and sent only to explorer.lichess.ovh.</small>
          </label>
        </fieldset>
        <DataBackup />
      </div>
      <div className="row">
        <button className="btn danger" onClick={() => resetSettings()}>Reset all settings</button>
        <button className="btn primary" onClick={closeDialog}>Done</button>
      </div>
    </Modal>
  );
}
