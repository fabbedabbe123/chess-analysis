# Chess Analysis

A browser chess analysis platform powered by real Stockfish (WebAssembly, in a Web Worker): interactive board, live evaluation, multi-line analysis, full game review, PGN/FEN import/export, variations, opening names and optional Lichess explorer statistics.

## Commands

```bash
npm install          # also copies the Stockfish files from node_modules into public/engine (postinstall)
npm run dev          # dev server, http://localhost:5173
npm test             # unit tests (vitest)
npm run typecheck    # strict TypeScript (TypeScript 7)
npm run lint         # ESLint (typescript-eslint runs on the TS 6 API alias, see below)
npm run build        # typecheck + production build into dist/
npm run preview      # serve dist/ at http://localhost:4173
```

## Tooling notes

- `typescript` in `package.json` is an alias for `@typescript/typescript6` because typescript-eslint does not support TypeScript 7 yet; the real compiler is `@typescript/native` (TS 7), which provides `tsc`. Switch back when typescript-eslint supports it.
- CI (`.github/workflows/ci.yml`): typecheck, lint, tests, and a check that `public/data/lessons.json` is up to date with `data-src/`. `.github/workflows/pages.yml` builds with a relative base and deploys `dist/` to GitHub Pages (enable it once under Settings → Pages → Source: GitHub Actions).

## Engine

- Package: `stockfish` 19 (npm). `scripts/copy-engine.mjs` copies the **lite** builds (`.js` + matching `.wasm`) into `public/engine/`; they are served from your own origin, no CDN.
- Single-threaded lite (~1.8 MB) is the default. The multi-threaded lite build is used only when the page is cross-origin isolated (`COOP: same-origin`, `COEP: require-corp`; the dev and preview servers send these) **and** the machine has ≥3 cores; if it fails to start, the app falls back to the single-threaded build automatically.
- If you host `dist/` yourself, send the two headers above to enable threads; without them everything still works single-threaded.
- Strength (Skill Level / Elo limit), MultiPV, hash, threads, depth/time/infinite are in Settings. Reviews always run at full strength on a second engine instance.
- Newer requests always supersede older ones (stop → wait for `bestmove` → start the latest), and results for another position are never displayed.

## Conventions

- Engines report scores from the side to move; the app converts once (`toWhiteScore`) and shows **White's point of view** everywhere. The eval bar's white part is White's winning-chance share (flips with the board).
- Move classes use the loss of the mover's winning chances (thresholds configurable). Accuracy is an **estimate** adapted from Lichess's published formula, not Chess.com's or Lichess's number.

## Network use

Nothing is required at runtime except static files. The only external call is the **optional** Lichess opening explorer (`explorer.lichess.ovh`), off by default; it may require a Lichess API token (Settings). If it is unreachable the offline opening-name book still works and no numbers are invented. Games and settings are stored in the browser's localStorage only.

## Move grades (Chess.com-style labels)

The review and the move list use ten grades: Brilliant (!!), Great (!), Best, Excellent, Good, Book, Inaccuracy (?!), Mistake (?), Miss and Blunder (??). Chess.com's own algorithm is not public, so the rules are ours and documented in `src/analysis/classify.ts` and in the "How the grades are decided" box of the Review tab: the six base classes (winning-chance loss thresholds) stay the basis for accuracy; on top of them Book = opening-book move with every earlier move also book (Lichess opening database), Brilliant = best/near-best move that leaves you at least 2 points of material down after the exchanges in Stockfish's own line, while not already clearly winning (< 80 %) and not worse afterwards (>= 45 %), Great = Stockfish's best move with the second-best at least 15 winning-chance points worse (needs MultiPV 2, so reviews cost somewhat more), Miss = an inaccuracy/mistake right after the opponent erred or a missed forced mate / clear win that leaves you at 40 % or better. A sacrifice that is the ONLY way to keep a won position (the second-best move is at least 15 points worse, and you are still at 90 % or better afterwards) is Brilliant even if the position was already winning. Precedence: Book > Brilliant > Great > Miss > base class. These are approximations: for example, the Opera Game's 16.Qb8+ is graded Best, not Brilliant, because a forced mate was already on the board (100 % before the move).

## Learn tab (lessons and skills)

`public/data/lessons.json` holds 23 skills / 43 exercises, built from `data-src/lessons.src.mjs` (SAN) by `node scripts/build-lessons.mjs`, which fails on any illegal move and checks opening drills against the Lichess opening book. Skills: mating patterns (smothered, Arabian, Anastasia), pawn breakthrough, forks, pins, skewers, discovered attacks/checks (incl. double check), back-rank mate, deflection / removing the defender, sacrifices and mating attacks (smothered mate, Philidor's queen sacrifice, Legal's mate), favourable trades, opening principles, six opening lines to memorise (Italian, Ruy Lopez, Queen's Gambit, London for White; Najdorf Sicilian, French, Caro-Kann for Black) and five endgame skills (king and pawn, the opposition, Lucena's bridge, Philidor's defence, two-rook mate). Each skill has an explanation, key ideas, a step-through worked example and exercises on the real board; after each exercise the "why it works" text is shown. Exercises run through the existing puzzle engine (your game is parked and restored). Exercises marked exact accept only the stored move; the others accept any move Stockfish rates as good as the stored one. Opening drills are book lines (no engine judgement). Skill status (Learning / Practised / Mastered) is computed only from your own results: mastered = every exercise solved first try without hints.

`node scripts/verify-lessons.mjs [depth]` re-checks every engine exercise with Stockfish (stored first move within 3 win-% points of best, exact exercises beat the best alternative by 10 win-% points or mate where the alternative does not, opponent replies are engine-reasonable unless the exercise deliberately punishes a natural mistake, final position at least +150 cp or mate). `tests/lessons.test.ts` additionally asserts the geometry of each idea (a fork move attacks two pieces, the pinned piece has no legal move, a discovered check is not given by the moved piece, the smothered king is surrounded by its own pieces, ...) without the engine. Flows: `python3 e2e/lessons.py`, `python3 e2e/features.py` (side-menu collapse, resume, auto review after import).

## Puzzle mode

The Puzzles tab bundles 79 puzzles (`public/data/puzzles.json`) that were generated from weak self-play positions and verified with Stockfish (re-checked at depth 20: 76 of 79 pass the strict uniqueness check; three older ones, p065, p070 and p072, have an alternative within a few tenths of a pawn in the latest run, which the app handles by accepting equally good moves; 4 newly generated candidates that failed were dropped). Types: mate in 1-3, tactic, defence. Difficulty = how shallow the engine finds the first move. Wrong moves are judged by Stockfish and taken back; a different move that is as good as the stored one is accepted. Hints, show-solution, streak and progress (localStorage) are included. "Practice from your game" turns review mistakes into puzzles. Your game is parked and restored when you exit.

```bash
node scripts/generate-puzzles.mjs [target] [maxMinutes]   # MERGE=1 to top up
node scripts/verify-puzzles.mjs [depth] [--prune]          # independent re-check
```

## Play against Stockfish + coach

The Play tab starts a full game against a dedicated, strength-limited Stockfish worker (the shared full-strength engine does hints, the evaluation bar and move feedback, so the two never collide). Levels Beginner-Maximum use the engine's real UCI options: `Skill Level` 0-20 and `UCI_LimitStrength`/`UCI_Elo` 1320-3190 (verified with `uci`; there is no Elo below 1320, so Beginner/Easy use Skill Level plus a shallow search). Levels are approximate and uncalibrated: no Elo rating is claimed. Includes colour choice, legal-move enforcement, check/mate/stalemate/50-move/repetition/insufficient-material detection, resign, draw offers (accepted only if Stockfish does not rate itself better), practice-mode take-back, restart, 3-step hints (idea, piece/threat, move + line), move feedback (every move / significant only / after the game / none) with configurable thresholds, a post-game review reusing the review engine (eval graph, per-side stats, key moments with "play the recommended line"), a rule-based coach report in eight categories, puzzle recommendations matched to the actual mistake (no match, no recommendation) and a "train on this game" session, plus a progress dashboard (record by level, accuracy trend of reviewed games, mistake areas, puzzle stats, goals) stored in localStorage. The coach wording is rule-based, not an AI model, and is labelled as such. An unfinished game is saved after every move and offered as "Resume" (or "Discard") in the Play tab after a reload; your own analysis game is restored first. Finished games are stored in the history. Coach cards link to related lessons in the Learn tab (a fixed, rule-based mapping, not a diagnosis).

Browser checks: `python3 e2e/play.py`, `python3 e2e/play_long.py` (real Stockfish).

## Player tracking (Chess.com)

The Player tab reads a user's public games from Chess.com's open Published-Data API (no key, no login) and shows W/D/L by colour and time control, a rating chart, the openings played with score, weak openings (needs >=5 games and <50%), and the recent games, which open on the board for review. Newest 3 months load first, older ones on demand; data is kept in localStorage (max 600 games). Unit-tested with mocked responses and driven in a browser with `python3 e2e/player_tracking.py` (Playwright route mock). Not verified against the live API: the build sandbox cannot reach chess.com.

## Strength tab (estimate, focus areas, training plan)

The Strength tab turns analysed games into an estimate of your playing strength and a short training plan. Games get in from three places: a finished Play game that you analyse, any reviewed game via "Count this game for my strength" (you say which side you were) in the Review tab, and a batch analysis of your tracked Chess.com games (real Stockfish in a dedicated worker, depth up to 14, one game at a time, each saved when finished; stopping keeps the results). Stored in localStorage (`chess-analysis:strength-games:v1`, newest 200).

- **Estimate** (`src/strength/strength.ts`): average centipawn loss of your moves (book moves skipped, scores clamped to +-1000, move-weighted over your 20 most recent games) mapped to a rating with the community rule of thumb `3100 * exp(-0.01 * ACPL)`. That mapping is NOT calibrated here, so the result is shown as a range that narrows with the evidence (350 / sqrt(n), n = min(games, moves / 30), 125-400 points) with a confidence label, and nothing is shown below 20 counted moves. It is an estimate of playing strength, not an Elo. If your Chess.com games carry your rating, it is shown next to the estimate.
- **Focus areas**: needs 3 analysed games. The coach's rule-based categories ranked by winning-chance points lost; the top two with at least 15 % share are highlighted; a trend (improving / steady / worse) appears from 6 games by comparing the newer half with the older half. These are patterns, not proven causes.
- **Training plan**: for each focus area up to two related unfinished lessons (fixed mapping `RELATED_LESSONS` in `src/play/coach.ts`; mastery comes from your own puzzle results) plus "play and analyse 3 more games".

Checks: `tests/strength.test.ts` (maths, bands, focus, plan, sanitising) and `python3 e2e/strength.py` (real Stockfish; uses synthetic 44-ply games from `e2e/strength_pgns.json`, and a seeded tracker for the batch because the Chess.com API is not reachable from the build sandbox).

## More features (added in the third round)

- **Lichess tracking**: the Player tab has a Chess.com / Lichess switch. Lichess games come from `GET /api/games/user/{name}` (NDJSON, `pgnInJson`, `opening`), 100 per page, "Load 100 older games" pages back with `until`. Variants and unfinished games are skipped and counted. Tracked Lichess games can be analysed in the Strength tab like Chess.com ones. Checked against the live API in a real browser (response shape and CORS); the UI flow is tested with a mocked network (`e2e/lichess.py`).
- **Analyse from a link**: the Import dialog accepts `https://lichess.org/<id>` (fetches the PGN from `lichess.org/game/export/<id>`). Chess.com game links cannot be fetched from a browser (the endpoint sends no CORS headers), so the dialog says so instead of pretending.
- **Train my mistakes**: every analysed game keeps its (up to 8) worst moves; the Strength tab turns the open ones into puzzles (position before your move, find Stockfish's move), focus-area mistakes first.
- **Repertoire and book exits** (Player tab): per colour and opening, games, score, the average half-move where the game left the bundled opening book, how often *you* left it first and your most common first non-book move. Offline, no engine.
- **Progress chart** (Strength tab): rolling 5-game strength estimate over time. Same uncalibrated rule as the estimate.
- **More lessons**: mating patterns (smothered, Arabian, Anastasia) and pawn breakthrough, engine-verified like the others.
- **Spaced repetition**: bundled/online puzzles come back after 1, 3, 7, 16, 35 days when solved cleanly; any miss, hint or shown solution resets to 1 day. "Review due" starts a session. Lesson exercises and one-off mistake puzzles are not scheduled (they cannot be rebuilt from an id).
- **Lichess puzzles (optional, online)**: "Get 20 Lichess puzzles" fetches `/api/puzzle/batch/mix`, replays `game.pgn` to the puzzle position, validates every puzzle for legality and keeps up to 300 in localStorage. The puzzle database is CC0 (https://database.lichess.org/#puzzles). They are not generated or verified by this app's engine, and the button simply reports an error if the network or the hosting page blocks the request.
- **Play from a position**: standard start, the current board position, or a pasted FEN (rejected if illegal or already over). The FEN/SetUp headers are kept so the game can be resumed, saved and reviewed.
- **Clocks**: none, 3+2, 5+0, 10+0 or 15+10. Clocks start once both sides have moved; increment after each move; a flag loses unless the other side could not checkmate (simplified rule, see `canMate`), in which case it is a draw. Stockfish limits its thinking time by what it has left. A resumed game restores the clock values saved at the last move (time away is not charged).
- **Why a move was bad**: for inaccuracies, mistakes, misses and blunders (Review tab verdict and the post-game key moments) `src/analysis/whyBad.ts` lists reasons taken only from Stockfish's stored lines: evaluation before/after, the best reply and its line, whether it captures the piece you just moved, material won or lost along the line (counted with chess rules), forced mates allowed or missed, and what the better move would have gained. If the lines show no concrete loss it says so instead of inventing a cause. The post-game table uses the same grade names as the move list (Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder).
- **Backup**: Settings → Your data exports/imports everything stored by the app (the Lichess token is never exported).

Checks: `tests/lichess.test.ts`, `tests/lichessPuzzles.test.ts`, `tests/repertoire.test.ts`, `tests/clock.test.ts`, extra cases in `tests/strength.test.ts` and `tests/play.test.ts`; browser flows `e2e/lichess.py`, `e2e/puzzles_srs.py`, `e2e/play_position_clock.py`, `e2e/backup.py`; CI runs the e2e scripts (`.github/workflows/ci.yml`, job `e2e`).

## Known limits

- Standard chess only (no Chess960). Tactics panel is a heuristic (hanging pieces, absolute pins, simple forks); puzzles are a small bundled set (79) generated by Stockfish, not a large database.
- The Lichess explorer client is unit-tested against mocked responses but could not be exercised live from the build sandbox.

## License

GPL-3.0 (bundles Stockfish and Chessground). Piece sets: cburnett/merida GPLv2+, chessnut Apache-2.0, rhosgfx CC0. Opening names: lichess-org/chess-openings (CC0).

## Browser (end-to-end) checks

`e2e/*.py` are Playwright scripts (Python) used for the QA audit; they drive the real UI against `npm run preview` (port 4173) with real Stockfish: board/move-list/FEN synchronisation under random play, evaluation perspective and mate display, PGN round trip, review/cancel/engine controls, settings persistence, mobile navigation, corrupted/blocked localStorage. Run e.g. `python3 e2e/sync_random_walk.py 7` (needs `pip install playwright` and a Chromium).

Learn flow: `python3 e2e/lessons.py`. Puzzle flows: `python3 e2e/puzzles.py` and `python3 e2e/puzzle_from_mistakes.py`.
