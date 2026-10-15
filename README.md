# Chess Analysis

A browser chess analysis platform powered by real Stockfish (WebAssembly, in a Web Worker): interactive board, live evaluation, multi-line analysis, full game review, PGN/FEN import/export, variations, opening names and optional Lichess explorer statistics.

## Commands

```bash
npm install          # also copies the Stockfish files from node_modules into public/engine (postinstall)
npm run dev          # dev server, http://localhost:5173
npm test             # 368 unit tests (vitest)
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

`public/data/lessons.json` holds 21 skills / 39 exercises, built from `data-src/lessons.src.mjs` (SAN) by `node scripts/build-lessons.mjs`, which fails on any illegal move and checks opening drills against the Lichess opening book. Skills: forks, pins, skewers, discovered attacks/checks (incl. double check), back-rank mate, deflection / removing the defender, sacrifices and mating attacks (smothered mate, Philidor's queen sacrifice, Legal's mate), favourable trades, opening principles, six opening lines to memorise (Italian, Ruy Lopez, Queen's Gambit, London for White; Najdorf Sicilian, French, Caro-Kann for Black) and five endgame skills (king and pawn, the opposition, Lucena's bridge, Philidor's defence, two-rook mate). Each skill has an explanation, key ideas, a step-through worked example and exercises on the real board; after each exercise the "why it works" text is shown. Exercises run through the existing puzzle engine (your game is parked and restored). Exercises marked exact accept only the stored move; the others accept any move Stockfish rates as good as the stored one. Opening drills are book lines (no engine judgement). Skill status (Learning / Practised / Mastered) is computed only from your own results: mastered = every exercise solved first try without hints.

`node scripts/verify-lessons.mjs [depth]` re-checks every engine exercise with Stockfish (stored first move within 3 win-% points of best, exact exercises beat the best alternative by 10 win-% points or mate where the alternative does not, opponent replies are engine-reasonable unless the exercise deliberately punishes a natural mistake, final position at least +150 cp or mate). `tests/lessons.test.ts` additionally asserts the geometry of each idea (a fork move attacks two pieces, the pinned piece has no legal move, a discovered check is not given by the moved piece, the smothered king is surrounded by its own pieces, ...) without the engine. Flows: `python3 e2e/lessons.py`, `python3 e2e/features.py` (side-menu collapse, resume, auto review after import).

## Puzzle mode

The Puzzles tab bundles 72 puzzles (`public/data/puzzles.json`) that were generated from weak self-play positions and verified with Stockfish (all 72 re-checked at depth 20). Types: mate in 1-3, tactic, defence. Difficulty = how shallow the engine finds the first move. Wrong moves are judged by Stockfish and taken back; a different move that is as good as the stored one is accepted. Hints, show-solution, streak and progress (localStorage) are included. "Practice from your game" turns review mistakes into puzzles. Your game is parked and restored when you exit.

```bash
node scripts/generate-puzzles.mjs [target] [maxMinutes]   # MERGE=1 to top up
node scripts/verify-puzzles.mjs [depth] [--prune]          # independent re-check
```

## Play against Stockfish + coach

The Play tab starts a full game against a dedicated, strength-limited Stockfish worker (the shared full-strength engine does hints, the evaluation bar and move feedback, so the two never collide). Levels Beginner-Maximum use the engine's real UCI options: `Skill Level` 0-20 and `UCI_LimitStrength`/`UCI_Elo` 1320-3190 (verified with `uci`; there is no Elo below 1320, so Beginner/Easy use Skill Level plus a shallow search). Levels are approximate and uncalibrated: no Elo rating is claimed. Includes colour choice, legal-move enforcement, check/mate/stalemate/50-move/repetition/insufficient-material detection, resign, draw offers (accepted only if Stockfish does not rate itself better), practice-mode take-back, restart, 3-step hints (idea, piece/threat, move + line), move feedback (every move / significant only / after the game / none) with configurable thresholds, a post-game review reusing the review engine (eval graph, per-side stats, key moments with "play the recommended line"), a rule-based coach report in eight categories, puzzle recommendations matched to the actual mistake (no match, no recommendation) and a "train on this game" session, plus a progress dashboard (record by level, accuracy trend of reviewed games, mistake areas, puzzle stats, goals) stored in localStorage. The coach wording is rule-based, not an AI model, and is labelled as such. An unfinished game is saved after every move and offered as "Resume" (or "Discard") in the Play tab after a reload; your own analysis game is restored first. Finished games are stored in the history. Coach cards link to related lessons in the Learn tab (a fixed, rule-based mapping, not a diagnosis).

Browser checks: `python3 e2e/play.py`, `python3 e2e/play_long.py` (real Stockfish).

## Player tracking (Chess.com)

The Player tab reads a user's public games from Chess.com's open Published-Data API (no key, no login) and shows W/D/L by colour and time control, a rating chart, the openings played with score, weak openings (needs >=5 games and <50%), and the recent games, which open on the board for review. Newest 3 months load first, older ones on demand; data is kept in localStorage (max 600 games). Unit-tested with mocked responses and driven in a browser with `python3 e2e/player_tracking.py` (Playwright route mock). Not verified against the live API: the build sandbox cannot reach chess.com.

## Known limits

- Standard chess only (no Chess960). Tactics panel is a heuristic (hanging pieces, absolute pins, simple forks); puzzles are a small bundled set (72) generated by Stockfish, not a large database.
- The Lichess explorer client is unit-tested against mocked responses but could not be exercised live from the build sandbox.

## License

GPL-3.0 (bundles Stockfish and Chessground). Piece sets: cburnett/merida GPLv2+, chessnut Apache-2.0, rhosgfx CC0. Opening names: lichess-org/chess-openings (CC0).

## Browser (end-to-end) checks

`e2e/*.py` are Playwright scripts (Python) used for the QA audit; they drive the real UI against `npm run preview` (port 4173) with real Stockfish: board/move-list/FEN synchronisation under random play, evaluation perspective and mate display, PGN round trip, review/cancel/engine controls, settings persistence, mobile navigation, corrupted/blocked localStorage. Run e.g. `python3 e2e/sync_random_walk.py 7` (needs `pip install playwright` and a Chromium).

Learn flow: `python3 e2e/lessons.py`. Puzzle flows: `python3 e2e/puzzles.py` and `python3 e2e/puzzle_from_mistakes.py`.
