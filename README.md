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

`public/data/lessons.json` holds 23 skills / 43 exercises, built from `data-src/lessons.src.mjs` (SAN) by `node scripts/build-lessons.mjs`, which fails on any illegal move and checks opening drills against the Lichess opening book. Skills: mating patterns (smothered, Arabian, Anastasia), pawn breakthrough, forks, pins, skewers, discovered attacks/checks (incl. double check), back-rank mate, deflection / removing the defender, sacrifices and mating attacks (smothered mate, Philidor's queen sacrifice, Legal's mate), favourable trades, opening principles, six opening lines to memorise (Italian, Ruy Lopez, Queen's Gambit, London for White; Najdorf Sicilian, French, Caro-Kann for Black) and five endgame skills (king and pawn, the opposition, Lucena's bridge, Philidor's defence, two-rook mate). Each skill has an explanation, key ideas, a step-through worked example and exercises on the real board; after each exercise the "why it works" text is shown. Exercises run through the existing puzzle engine (your game is parked and restored). Exercises marked exact accept only the stored move; the others accept any move Stockfish rates as good as the stored one. Opening drills are book lines (no engine judgement). Skill status (Learning / Practised / Mastered) is computed only from your own results (see the learning path below).

`node scripts/verify-lessons.mjs [depth]` re-checks every engine exercise with Stockfish (stored first move within 3 win-% points of best, exact exercises beat the best alternative by 10 win-% points or mate where the alternative does not, opponent replies are engine-reasonable unless the exercise deliberately punishes a natural mistake, final position at least +150 cp or mate). `tests/lessons.test.ts` additionally asserts the geometry of each idea (a fork move attacks two pieces, the pinned piece has no legal move, a discovered check is not given by the moved piece, the smothered king is surrounded by its own pieces, ...) without the engine. Flows: `python3 e2e/lessons.py`, `python3 e2e/features.py` (side-menu collapse, resume, auto review after import).

### Learning path, practice sets, daily practice, placement

The Learn tab opens on a path of 3 levels and 43 skills (`data-src/path.src.mjs` defines levels, order, `requires` and which Lichess themes feed each skill; 23 skills have hand-written lessons, 20 are practice-only with a short intro). `public/data/practice/` holds 5,476 real positions for 29 skills (`index.json` plus one file per skill, sorted by rating), built from the Lichess puzzle database (CC0) by the manual workflow `.github/workflows/build-practice.yml` (`scripts/build-practice.mjs`, output pushed to the `data/practice` branch). The positions are validated by Lichess and checked for legality here; they are not re-checked with Stockfish.

- **Mastery:** practised = lesson exercises solved (if the skill has any) and 10 practice positions solved; mastered = lesson solved first try and 20 practice positions solved with at least 14 on the first try. The Strength tab's plan uses the same rule.
- **Unlocking:** a skill opens when everything it `requires` is practised or known from the placement test. Locking only guides the order; any skill can still be opened. "Up next" is the first open skill that is not practised.
- **Daily practice:** 10 positions: due reviews first (Leitner boxes at 1, 3, 7, 16 and 35 days), then new positions from the next skills on the path.
- **Placement test:** 10 positions, one for each of 10 core skills, nearest rating 1100. Solved first try = skill known (stored in `localStorage`, `chess-analysis:placement:v1`).
- **From your games:** saved mistakes from analysed games, matched to a skill through `RELATED_LESSONS`.

Code: `src/lessons/path.ts`, tests `tests/path.test.ts`, e2e `python3 e2e/path.py`.

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

- **Estimate** (`src/strength/strength.ts`): average centipawn loss of your moves (book moves skipped, scores clamped to +-1000, move-weighted over your 20 most recent games) mapped to a rating with `4533 * exp(-0.0179 * ACPL)`, fitted on 51 public Chess.com players (562 games, Stockfish depth 14; leave-one-player-out RMSE about 390 points, the earlier community rule `3100 * exp(-0.01 * ACPL)` scored about 430). It is only a coarse guide: best at about 1000-1600, too high below ~1000 and too low above ~1600. The result is shown as a range (400 + 150 / sqrt(n) points, n = min(games, moves / 30), at most 550) with a confidence label, and nothing is shown below 20 counted moves. It is an estimate of playing strength, not an Elo. If your Chess.com games carry your rating, it is shown next to the estimate.
- **Focus areas**: needs 3 analysed games. The coach's rule-based categories ranked by winning-chance points lost; the top two with at least 15 % share are highlighted; a trend (improving / steady / worse) appears from 6 games by comparing the newer half with the older half. These are patterns, not proven causes.
- **Training plan**: for each focus area up to two related unfinished lessons (fixed mapping `RELATED_LESSONS` in `src/play/coach.ts`; mastery comes from your own puzzle results) plus "play and analyse 3 more games".

Checks: `tests/strength.test.ts` (maths, bands, focus, plan, sanitising) and `python3 e2e/strength.py` (real Stockfish; uses synthetic 44-ply games from `e2e/strength_pgns.json`, and a seeded tracker for the batch because the Chess.com API is not reachable from the build sandbox).

## Start page

Opening the site with nothing to continue shows a calm start page (Analyse a game / My games / Play Stockfish, plus your estimated level and due puzzles). If a game is on the board or a game against Stockfish is unfinished, the workspace opens directly. The brand in the side menu returns to the start page. `?workspace` in the address skips the start page (used by the tests).

## Usability round (fourth)

- Moves list now sits under the board (like Chess.com); the right-hand column is all for the active tool.
- Four sections instead of nine tabs: Analyse (Engine, Review, Openings, Tactics), Train (Learn, Puzzles), My games (Player, Strength), Play.
- A **?** button with a how-to guide.
- After a review the board jumps to your first error; the review starts with a one-line summary per side; best moves with big swings are marked "Forced sequence".
- "Show errors only" in the move list; the game result is shown at the end of the game.
- Import accepts PGN tags written on one line and refuses to "load" a game with no readable moves.
- Sidebar: settings buttons stay visible on short screens. Fixed SVG NaN console errors on mobile.

## Cloud sync (optional, sign in with an e-mail link)

The app works fully without an account: everything stays in the browser. If the site is built with a Supabase project, **Settings -> Account** lets you sign in with an e-mail link (no password) and keeps your progress in the cloud for use on other devices.

**Synced:** settings, play settings, analysed games and strength, games against Stockfish, saved games, puzzle progress, the Chess.com/Lichess *usernames*.
**Not synced:** the game on the board, downloaded Chess.com/Lichess games (re-downloaded in a click), Lichess puzzles, layout toggles, and the Lichess token (a secret: never uploaded, never overwritten by a download).

How it works (`src/sync/`): one row per (user, name) in `public.user_data`, protected by row level security so a user can only touch their own rows. Each sync compares both sides with a hash of the value at the last sync: unchanged -> nothing, changed on one side -> copied over, changed on both -> lists of records are merged by id, puzzle progress entry by entry, anything else the newer edit wins. Known limit: when both devices changed the same list, something deleted on one can come back. If a browser last synced for *another* account, its data is never uploaded to the new account; the cloud data replaces it.

### Set up (once)

1. Create a free project at supabase.com.
2. SQL editor: run `supabase/schema.sql`.
3. Authentication -> Providers: keep **Email** enabled (magic link). Authentication -> URL Configuration: set *Site URL* to `https://<user>.github.io/<repo>/` and add the same address (and `http://localhost:5173/`) to *Redirect URLs*.
4. Project Settings -> API: copy the **Project URL** and the **anon public** key (both are public by design; the *service_role* key must never be put in the site).
5. Put the URL and the key in `.github/workflows/pages.yml` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; already done for this site's project). The next push redeploys with sync on. Locally: `.env.local` with the same two names. Plain `vite build` without them leaves sync off.

Supabase's built-in mail sender is rate-limited (a few e-mails per hour); for heavier use add your own SMTP in the Supabase dashboard.

### What is tested

Unit tests cover the merge and sync rules, the secret handling and the config check (`tests/sync.test.ts`). `e2e/sync_cloud.py` drives the real app and the real Supabase client library against a **mock** server (requests, headers, what is uploaded and applied). It is **not** run against a real Supabase project; sign-in e-mails, row level security and real network behaviour must be checked once by hand after the setup.

## Layout round (fifth)

- The centre column always fits the window (checked at 1440x900 and 1280x720): the board size reserves room for the move verdict and the move list; reasons scroll inside the verdict card; the move list and annotation tools scroll together.
- The move verdict only shows on the Analyse tabs; engine arrows and the eval bar are hidden on Train / My games.
- Play setup: difficulty as a compact grid (details shown for the selected level) and a Start button that stays visible.
- Sidebar: duplicate "My games" button removed, Export as a 2-column grid. "?" is a small round icon; "My games" shortens to "Games" in narrow layouts.
- Game review: critical moments open, biggest swings / study positions / accuracy explanation folded.

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

### Sign-in UI

When sync is configured the site shows a **Sign in** button in the side menu and on the start page (plus a banner there), which opens a sign-in dialog: benefits, e-mail field, a "check your e-mail" state with a 60 s resend timer and "use another e-mail", and, once signed in, the account card with sync status, Sync now, Sign out and Delete cloud data. Without a Supabase project none of this is shown.

### Profile and usernames

After the first sign-in the app asks for a unique username (3-20 characters: letters, digits, underscore; unique ignoring case; a few names are reserved). The name lives in `public.profiles` (see `supabase/schema.sql`, run that part once too); availability is checked through `username_available()`, which only answers true/false. The profile dialog gathers username, e-mail, level estimate, puzzle progress, sync and sign-out. Profiles are private to their owner for now.

### Profile picture and friends

- The profile picture is cropped to a square, scaled to 128x128 and stored as a small JPEG data URL (max 60 000 characters, enforced by a database check) in `public.profiles.avatar`.
- Friends: find someone by their exact username, send a request, accept or decline. Everything goes through `security definer` functions (`search_user`, `friend_request`, `friend_respond`, `friend_remove`, `friends_overview`); the `friendships` table cannot be written directly. There is no way to list or browse users.
- What a friend sees: username, picture, member-since and, if the owner allows it (Settings -> Account), level estimate, games analysed, puzzles solved and best streak (`profile_stats`). Never games, e-mail or settings.
- Account details (picture, username, e-mail, sync, delete cloud data, sign out) live in Settings -> Account; the profile dialog shows your numbers and your friends.
- `tests/sql.test.ts` runs `supabase/schema.sql` in a real Postgres (PGlite) and checks row level security, friend rules and limits. Run the new part of `schema.sql` once in the Supabase SQL editor.

### Online status

Friends see whether you are online and what you are doing ("Online - Solving puzzles", or "Last seen 10 min ago"). While you are signed in and the page is visible, the app calls `set_presence(activity)` once a minute (the server stamps the time; activity is one coarse word from a fixed list). Friends read it only through `friends_overview()`, and only for accepted friendships; the `presence` table itself is closed to everybody. Online means a heartbeat in the last 150 s, so the status can lag by up to a couple of minutes. Turn it off in Settings -> Account (the row is deleted and no more heartbeats are sent). Signing out clears it at once. No Supabase Realtime is used.

## Sounds, effects and knight arrows

- **Sounds** are synthesised in the browser (WebAudio, no audio files): move, capture, castling, check, game end, plus win / lose / draw jingles and puzzle solved / wrong. On by default; Settings → "Move sounds".
- **Win / lose effects** on the board: confetti for a win or solved puzzle, a shake and dimming for a loss or wrong puzzle move, a soft tint for a draw. Settings → "Win / lose animations"; disabled automatically with "reduce motion".
- **Knight arrows** (drawn with right-click, and engine arrows) are bent into an "L" like on Lichess: two squares along the long side, then one across. Chessground only draws straight lines, so its SVG is post-processed (`src/utils/knightArrows.ts`).

## Rating range only after 10 games

The strength rating range (e.g. 900–1300) is shown only once 10 games are analysed (`MIN_GAMES_RATING`). Before that the Strength tab, the start page and the shared profile stats show accuracy and a progress bar instead, because the estimate from `ACPL` swings a lot between single games. Sound volume is a setting (default 35 %).

## Checkmate markers

On a checkmate position the mated king gets a red "#" badge and the piece that moved to give mate a gold star (`src/components/MateMarkers.tsx`). When the mate has just been played, and you were not the one mated in a Play game, confetti bursts around the mating piece (Settings → "Win / lose animations"). The badges stay while the position is shown and follow the board when it is flipped.

## Own puzzles

Train → Puzzles → **My puzzles**: stand on any position, press "Make a puzzle", play the solution on the board (solver, reply, solver …), name it, optionally let Stockfish check the first move (depth 14), save. Solvers get the same rules as other puzzles: other moves are checked with Stockfish unless "Only my move counts" is on, any checkmate counts in mate puzzles. They take part in progress and spaced repetition.

- **Share:** "Share" copies a link (`…#p=cp1.<code>`); opening it adds the puzzle (once, the id comes from the content). A code can also be pasted into the field below the list.
- **Storage:** this browser only (`chess-analysis:my-puzzles:v1`, up to 100, included in backups). Cloud sync of own puzzles is not built yet: it needs one extra allowed name in the `user_data` table.
- Code: `src/puzzles/myPuzzles.ts`, `src/stores/myPuzzlesStore.ts`, `src/components/PuzzleBuilder.tsx`.
