// Source of the Learn tab. Exercises are written in SAN and compiled to public/data/lessons.json by
// scripts/build-lessons.mjs, then re-checked with Stockfish by scripts/verify-lessons.mjs.
//
// exercise: { fen | after, moves, why, exact?, trap?, kind? }
//   fen / after  start position (FEN, or SAN moves played from the standard start position)
//   moves        SAN: solver, opponent reply, solver, ...  (always ends on a solver move)
//   exact        true  -> only the stored first move is accepted (the engine check for alternatives is skipped)
//   trap         true  -> the opponent's scripted reply is a natural mistake being punished (not engine-best)
//   kind         'book' -> an opening line to memorise (checked against the opening book, not the engine)
const S = (x) => x;

export const SKILLS = [
  {
    id: 'forks', title: 'Forks', category: 'tactics',
    blurb: 'One piece attacks two things at once.',
    intro: [
      'A fork is a single move that creates two threats. Your opponent can only answer one of them, so you win the other piece.',
      'Knights are the classic forking pieces because their jump cannot be blocked and the attacked piece cannot capture back. The most powerful fork is a check, because the king must move and cannot also save the second target.',
    ],
    ideas: [
      'Look for two enemy pieces (or a king and a piece) that a knight jump away from the same square.',
      'A forking check leaves no time to rescue the second piece.',
      'Before forking, check that the forking piece is not simply captured.',
    ],
    exercises: [
      { fen: '3q3k/6pp/8/4N3/8/8/PPP5/R3K3 w - - 0 1', moves: 'Nf7+ Kg8 Nxd8', exact: true, why: 'Nf7+ attacks the king on h8 and the queen on d8 at the same time. The king has to move, and the knight takes the queen.' },
      { fen: '4k3/3q4/8/8/4N3/8/8/R5K1 w - - 0 1', moves: 'Nf6+ Ke7 Nxd7', why: 'Nf6+ forks king and queen. The queen is protected by the king, but giving a knight for a queen is a huge win.' },
      { fen: '4k3/8/q7/3N4/8/8/8/4K2R w - - 0 1', moves: 'Nc7+ Kf7 Nxa6', why: 'Nc7+ checks the king and attacks the queen on a6.' },
      { fen: '4k3/5q2/8/8/4N3/8/8/4R1K1 w - - 0 1', moves: 'Nd6+ Kd7 Nxf7', why: 'Nd6+ forks the king on e8 and the queen on f7. The king steps aside and the knight takes the queen.' },
    ],
  },
  {
    id: 'pins', title: 'Pins', category: 'tactics',
    blurb: 'A piece cannot (or should not) move because something more valuable stands behind it.',
    intro: [
      'A pin freezes a piece against a more valuable piece behind it. An absolute pin is against the king: the pinned piece may not legally move at all. A relative pin is against another piece such as the queen: the pinned piece can move, but it would lose the piece behind it.',
      'Pinned pieces are easy targets: attack them again, especially with a pawn, because they cannot run away.',
    ],
    ideas: [
      'Bishops, rooks and queens create pins along their lines.',
      'Attack the pinned piece again; a pinned piece cannot flee.',
      'A pawn is the best attacker: it is worth less than the piece it attacks.',
    ],
    exercises: [
      { fen: '4k3/3p4/4b3/8/5P2/8/8/4R1K1 w - - 0 1', moves: 'f5 Ke7 fxe6', exact: true, why: 'The bishop on e6 is pinned to the king by the rook. The pawn attacks it with f5 and the bishop cannot move away.' },
      { fen: '4k3/4n3/8/8/3N4/8/8/4R1K1 w - - 0 1', moves: 'Nc6 Kd7 Nxe7', why: 'The knight on e7 is pinned against the king by the rook. Nc6 adds a second attacker, so it is attacked twice and defended once.' },
    ],
  },
  {
    id: 'skewers', title: 'Skewers', category: 'tactics',
    blurb: 'The reverse of a pin: the valuable piece is attacked first and must move, exposing the one behind it.',
    intro: [
      'In a skewer you attack a valuable piece (often the king). It has to step aside, and then you capture the less valuable piece standing behind it on the same line.',
      'Only bishops, rooks and queens can skewer, since they move along lines.',
    ],
    ideas: [
      'Look for a king or queen with another piece directly behind it on a rank, file or diagonal.',
      'Check first: a check forces the king to move and gains the piece behind it.',
    ],
    exercises: [
      { fen: '4r3/8/8/8/4k3/8/6K1/R7 w - - 0 1', moves: 'Re1+ Kd4 Rxe8', exact: true, why: 'Re1+ checks the king on e4. When it steps off the e-file, the rook on e8 is attacked and falls.' },
      { fen: '5r2/7p/3k4/8/8/8/PPPB4/4K3 w - - 0 1', moves: 'Bb4+ Kd7 Bxf8', exact: true, why: 'Bb4+ checks the king on d6 along the diagonal. The rook on f8 is on the same diagonal behind it.' },
    ],
  },
  {
    id: 'discovered', title: 'Discovered attacks and checks', category: 'tactics',
    blurb: 'Move one piece to unleash another, often with check.',
    intro: [
      'A discovered attack happens when you move a piece out of the way of another piece of yours, which then attacks something. If the revealed attack is a check, it is a discovered check, and the moving piece is free to do almost anything because the opponent must answer the check.',
      'A double check is the most forcing move in chess: both the moving piece and the revealed piece give check, so the king must move.',
    ],
    ideas: [
      'Line up a rook, bishop or queen behind your own piece, aimed at the enemy king or queen.',
      'The moving piece can capture something or make its own threat while the check is on.',
      'In a double check the only defence is a king move.',
    ],
    exercises: [
      { fen: '1q2k3/8/8/4B3/8/8/8/4R1K1 w - - 0 1', moves: 'Bxb8+ Kd7 Rd1+', why: 'The bishop captures the queen with a discovered check from the rook on e1.' },
      { fen: '4k3/3q4/8/8/4N3/8/8/4R1K1 w - - 0 1', moves: 'Nf6+ Kd8 Nxd7', exact: true, why: 'Nf6+ is a double check (knight and rook), so the king must move. The knight then takes the queen.' },
    ],
  },
  {
    id: 'backrank', title: 'Back-rank mate', category: 'tactics',
    blurb: 'A king boxed in by its own pawns is mated on the first rank.',
    intro: [
      'When a king sits behind its unmoved pawns with no escape square, a single rook or queen check on the back rank can be mate. It is among the most common ways games are lost.',
      'Look for it when the enemy back rank is guarded by only one piece, and give your own king a "luft" (an escape square) by moving a pawn.',
    ],
    ideas: [
      'Count the squares the king can reach. If its own pawns cover them all, a check on the back rank is mate.',
      'Remove or trade the only defender of the back rank, then deliver the check.',
      'Protect yourself: push h3 or g3 early so your own king is not trapped.',
    ],
    exercises: [
      { fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', moves: 'Ra8#', exact: true, why: 'The pawns on f7, g7 and h7 take away every escape square, so the rook check on a8 is mate.' },
      { fen: '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', moves: 'Rxd8#', exact: true, why: 'The rook on d8 was the only defender of the back rank. Taking it is mate.' },
      { fen: '1r4k1/5ppp/8/8/8/8/1Q3PPP/1R4K1 w - - 0 1', moves: 'Qxb8#', why: 'The queen takes the defending rook with check. The king has no square to go to.' },
    ],
  },
  {
    id: 'deflection', title: 'Deflection and removing the defender', category: 'tactics',
    blurb: 'Force a key defender away, then punish what it was guarding.',
    intro: [
      'Many pieces are held up by a single defender. If you can capture it or force it to move, whatever it guarded falls. Often this is done with a sacrifice or an exchange.',
    ],
    ideas: [
      'Ask: what is this piece defending, and what happens if it disappears?',
      'An exchange that removes a defender can be better than winning material directly.',
    ],
    exercises: [
      { fen: '3rq1k1/5ppp/8/3Q4/8/8/5PPP/3R2K1 w - - 0 1', moves: 'Qxd8 Qxd8 Rxd8#', exact: true, trap: true, why: 'The rook on d8 is the only guard of the back rank for the queen. After Qxd8 Black loses a rook at least; if the queen recaptures, Rxd8 is mate because the back rank is empty. Black\'s better defence loses more material but not the game at once.' },
    ],
  },
  {
    id: 'sacrifices', title: 'Sacrifices and mating attacks', category: 'tactics',
    blurb: 'Give material to win the game.',
    intro: [
      'A sacrifice is only good when it leads to something concrete: mate, a larger material gain or an unstoppable attack. Calculate the forcing line to the end before you give anything up.',
      'The following patterns are worth knowing by heart: the smothered mate, where a knight mates a king surrounded by its own pieces, and the queen sacrifice that drags a defender away.',
    ],
    ideas: [
      'Sacrifice only when you can see the forced follow-up (checks, captures, threats).',
      'A king hemmed in by its own pieces is a target for knights.',
      'Queen sacrifices work by forcing a recapture that opens a square for mate.',
    ],
    exercises: [
      { fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', moves: 'Nf7#', exact: true, why: 'Smothered mate: the king on h8 is blocked in by its own rook and pawns, and the knight gives check where nothing can capture it.' },
      { fen: '5r1k/6pp/7N/8/2Q5/8/8/6K1 w - - 0 1', moves: 'Qg8+ Rxg8 Nf7#', why: 'The queen sacrifice drags the rook to g8. That fills the last free square, so Nf7 is smothered mate.' },
      { after: 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6', moves: 'Nxe5 Bxd1 Bxf7+ Ke7 Nd5#', exact: true, trap: true, why: 'Legal\'s mate (a classic opening trap). White leaves the queen en prise on purpose: if Black takes it, the bishop check on f7 and the knight on d5 mate the king.' },
    ],
  },
  {
    id: 'trades', title: 'Favourable trades', category: 'tactics',
    blurb: 'Not every exchange is equal. Count what you give and what you get.',
    intro: [
      'A trade is good when you receive more value than you give. Rough values: pawn 1, knight 3, bishop 3, rook 5, queen 9. Giving a bishop for a rook wins "the exchange" (about two points).',
      'Trades also change the position: they remove an enemy attacker, relieve a pin, or simplify when you are ahead. Always count the full sequence of captures before you start it.',
    ],
    ideas: [
      'Winning the exchange (minor piece for a rook) is worth about two pawns.',
      'When you are ahead in material, trade pieces, not pawns.',
      'Use an exchange to remove an enemy piece that is attacking or pinning you.',
    ],
    exercises: [
      { fen: 'r2qk3/p1pp1ppp/8/8/8/5B2/PPPP1PPP/R2QK3 w - - 0 1', moves: 'Bxa8 Qxa8 Qe2', why: 'Bxa8 trades a bishop for a rook (winning the exchange). Black has no way to avoid the loss.' },
      { fen: 'r2q1rk1/ppp2ppp/2n2n2/3pp3/1bB1P1b1/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 1', moves: 'Nd5 Nxd5 Bxd5', balanced: true, why: 'Nd5 offers a trade of knights that removes the knight that pins and presses on your position. The position stays equal; the alternatives lose roughly a third to a full pawn, so here the trade is the accurate move rather than a way to win material.' },
    ],
  },
  // ------------------------------------------------------------------ openings
  {
    id: 'opening-principles', title: 'Opening principles', category: 'openings',
    blurb: 'Centre, development, castling: the three ideas behind almost every good opening move.',
    intro: [
      'You do not need to memorise much theory to play a sound opening. Control the centre with pawns, develop knights and bishops towards it, castle early to protect the king, and do not move the same piece twice without a reason.',
      'Stockfish confirms that the moves below are among the best in each position.',
    ],
    ideas: [
      'Fight for the centre: e4 or d4 first.',
      'Develop minor pieces before the queen and before wandering pawn moves.',
      'Castle early so the king is safe and the rooks get connected.',
    ],
    exercises: [
      { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: 'e4', why: 'A central pawn move opens lines for the queen and bishop and takes space.' },
      { after: 'e4 e5 Nf3 Nc6', moves: 'Bc4', why: 'Develop a piece towards the centre and aim at the weak f7 square.' },
      { after: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6', moves: 'O-O', why: 'Castle: the king is safe and the rook joins the game.' },
    ],
  },
  {
    id: 'italian', title: 'Italian Game', category: 'openings', color: 'w',
    blurb: 'A classical opening: quick development and pressure on f7.',
    intro: ['White develops the bishop to c4 where it eyes f7, then prepares d4 with c3 and d3. It leads to open, tactical positions with simple plans.'],
    ideas: ['Bc4 targets f7.', 'c3 prepares d4 to build a centre.', 'd3 and castling give a flexible, safe set-up.'],
    expectName: 'Italian Game',
    exercises: [
      { after: '', moves: 'e4 e5 Nf3 Nc6 Bc4', kind: 'book', why: 'The bishop goes to c4 and eyes the weak f7 square. This is the starting position of the Italian Game.' },
      { after: '', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3', kind: 'book', why: 'The quiet "Giuoco Pianissimo" set-up: c3 prepares d4, d3 supports e4, then you castle and play Nbd2 or Re1.' },
    ],
  },
  {
    id: 'ruy-lopez', title: 'Ruy Lopez', category: 'openings', color: 'w',
    blurb: 'The Spanish: pressure on the knight that defends e5.',
    intro: ['White attacks the defender of e5 with Bb5, keeps the bishop with Ba4 and castles. A strategic opening with a lot of history.'],
    ideas: ['Bb5 pressures the c6 knight, which defends e5.', 'After ...a6 retreat to a4 and keep the tension.', 'Castle early.'],
    expectName: 'Ruy Lopez',
    exercises: [
      { after: '', moves: 'e4 e5 Nf3 Nc6 Bb5', kind: 'book', why: 'Bb5 attacks the knight that defends e5. This is the Ruy Lopez (the Spanish Game).' },
      { after: '', moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O', kind: 'book', why: 'The main line: after ...a6 the bishop retreats to a4 and White castles, keeping the pressure on c6 and e5.' },
    ],
  },
  {
    id: 'queens-gambit', title: "Queen's Gambit", category: 'openings', color: 'w',
    blurb: 'White offers a pawn on c4 to win the centre.',
    intro: ['White plays d4 and c4. If Black takes the pawn, White gets a big centre; if Black declines, the game becomes a rich strategic fight.'],
    ideas: ['c4 attacks d5 to undermine Black\'s centre.', 'Develop with Nc3 and Bg5, pinning the knight on f6.'],
    expectName: "Queen's Gambit",
    exercises: [
      { after: '', moves: 'd4 d5 c4', kind: 'book', why: "c4 attacks the d5 pawn: the Queen's Gambit. White is not really sacrificing, since the pawn can be won back." },
      { after: '', moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5', kind: 'book', why: "The Queen's Gambit Declined: develop the knight to c3 and pin the knight on f6 with Bg5." },
    ],
  },
  {
    id: 'london', title: 'London System', category: 'openings', color: 'w',
    blurb: 'A solid set-up that works against almost anything.',
    intro: ['White develops the dark-squared bishop to f4 before closing the pawn chain with e3, then plays Nf3 and c3. Easy to learn and hard to crack.'],
    ideas: ['Bf4 before e3, so the bishop is not locked in.', 'Solid structure with a clear plan.'],
    expectName: 'London System',
    exercises: [
      { after: '', moves: 'd4 d5 Bf4', kind: 'book', why: 'The bishop comes out to f4 before e3 closes the pawn chain: the London System.' },
      { after: '', moves: 'd4 d5 Bf4 Nf6 e3 e6 Nf3', kind: 'book', why: 'The standard London set-up: Bf4, e3 and Nf3, followed by c3, Bd3 and castling.' },
    ],
  },
  {
    id: 'najdorf', title: 'Sicilian: Najdorf', category: 'openings', color: 'b',
    blurb: 'Black fights for the win with an asymmetrical Sicilian.',
    intro: ['After 1.e4 Black answers 1...c5, trading the c-pawn for White\'s central d-pawn. The Najdorf adds ...a6 to prepare ...e5 and ...b5.'],
    ideas: ['...c5 fights the centre from the side.', '...a6 stops Nb5 and prepares queenside play.'],
    expectName: 'Sicilian Defense',
    exercises: [
      { after: 'e4', moves: 'c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', kind: 'book', why: 'The Najdorf: after ...a6 Black stops Nb5 and prepares ...e5 or ...b5. Black plays the first move of this line.' },
    ],
  },
  {
    id: 'french', title: 'French Defence', category: 'openings', color: 'b',
    blurb: 'Solid and counter-attacking: ...e6 and ...d5.',
    intro: ['Black builds a firm pawn chain with ...e6 and ...d5 and attacks White\'s centre later. The light-squared bishop is the main strategic worry.'],
    ideas: ['...d5 challenges e4 directly.', 'Pin the knight with ...Bb4 or break with ...c5.'],
    expectName: 'French Defense',
    exercises: [
      { after: 'e4', moves: 'e6 d4 d5 Nc3 Nf6 Bg5 Be7', kind: 'book', why: 'The Classical French: Black supports the centre with ...e6 and ...d5, develops ...Nf6 and breaks the pin with ...Be7.' },
    ],
  },
  {
    id: 'caro-kann', title: 'Caro-Kann Defence', category: 'openings', color: 'b',
    blurb: 'Rock solid: ...c6 supports ...d5 and the bishop comes out first.',
    intro: ['Black supports the d5 advance with the c-pawn so that the light-squared bishop can leave the pawn chain before ...e6.'],
    ideas: ['...c6 and ...d5 form a solid centre.', 'Develop the c8-bishop before playing ...e6.'],
    expectName: 'Caro-Kann Defense',
    exercises: [
      { after: 'e4', moves: 'c6 d4 d5 Nc3 dxe4 Nxe4 Bf5', kind: 'book', why: 'The Classical Caro-Kann: after the exchange on e4 the bishop comes out to f5 before ...e6 closes the pawn chain.' },
    ],
  },
  // ------------------------------------------------------------------ endgames
  {
    id: 'king-pawn', title: 'King and pawn endings', category: 'endgames',
    blurb: 'The king is a strong piece in the endgame: lead with it.',
    intro: [
      'In king-and-pawn endings the winning idea is to put your king in front of your pawn. If your king reaches the sixth rank ahead of the pawn (on the fifth with the opposition), the pawn queens.',
      'The "opposition" is when the kings face each other with one square between them: the side NOT to move holds it.',
    ],
    ideas: ['Bring the king to the pawn. Do not push the pawn alone.', 'King in front of the pawn on the sixth rank wins.'],
    exercises: [
      { fen: '3k4/8/3K4/3P4/8/8/8/8 w - - 0 1', moves: 'Ke6 Kc7 Ke7', why: 'The king steps ahead of the pawn to e6 and then e7: with the king in front of the pawn on the sixth/seventh rank the pawn will queen. Kc5? would only draw.' },
    ],
  },
  {
    id: 'rook-mate', title: 'Mating with two rooks', category: 'endgames',
    blurb: 'The ladder: rooks take turns pushing the king to the edge.',
    intro: ['With two rooks, one rook cuts off a rank and the other gives check on the next, like climbing a ladder. The king is driven to the edge and mated.'],
    ideas: ['Cut the king off along one rank.', 'Check with the other rook on the edge.'],
    exercises: [
      { fen: '7k/8/8/8/8/8/R7/1R4K1 w - - 0 1', moves: 'Rb7 Kg8 Ra8#', why: 'The rook on b7 cuts the king off on the 7th rank and the rook on a8 gives mate on the edge.' },
    ],
  },
  {
    id: 'opposition', title: 'The opposition', category: 'endgames',
    blurb: 'Kings face each other: the side that does NOT have to move wins the fight.',
    intro: [
      'The kings are in opposition when they stand on the same file (or rank) with one square between them. The player who has to move must give way, so you want to be the one who just moved into opposition.',
      'With a pawn on the board this decides whether the pawn queens or the game is drawn.',
    ],
    ideas: ['Move your king in front of the pawn and take the opposition.', 'The defender wants the opposition too: stay in front of the pawn.'],
    exercises: [
      { fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', moves: 'Kd6 Kd8 e6 Ke8 e7 Kf7 Kd7', why: 'Kd6! steps aside so the king leads the pawn: after Kd6 Kd8 the pawn can advance with the king guarding the queening squares (e6, e7). The natural-looking Kf6 or Kd5 only draw.' },
      { fen: '4k3/8/8/3PK3/8/8/8/8 b - - 0 1', moves: 'Kd7 d6 Kd8 Ke6 Ke8 d7+ Kd8', balanced: true, why: 'Black must meet the pawn with the king in front of it: Kd7! Then after d6 the king retreats to d8 and the game ends in a stalemate trick. Ke8 or Kf7 lose to Kd6/e6 ideas.' },
    ],
  },
  {
    id: 'lucena', title: 'Lucena: building a bridge', category: 'endgames',
    blurb: 'A pawn on the seventh with the king in front wins with a rook, if you shelter the king from checks.',
    intro: [
      'Rook and pawn against rook: if your king is in front of a pawn on the seventh rank, the defending rook can only give checks. The "bridge" is your rook placed on the fourth rank: the king walks out and uses the rook as a shield against the checks.',
      'The first step is to cut the enemy king off along a file with your rook and get the rook to the fourth rank.',
    ],
    ideas: ['Cut the enemy king off with the rook.', 'Rook to the fourth rank: that is the bridge.', 'The king steps out of the pawn\'s way and hides behind the rook.'],
    exercises: [
      { fen: '3K4/3P1k2/8/8/8/8/r7/4R3 w - - 0 1', moves: 'Rd1 Rc2 Rf1 Kg6 Rf4', why: 'The rook cuts the black king off and then goes to the fourth rank (Rf4): this is the bridge. Next the king walks out via the c-file and the rook blocks the checks on the fourth rank.' },
    ],
  },
  {
    id: 'philidor', title: 'Philidor: the defender\'s draw', category: 'endgames',
    blurb: 'Defending rook and pawn against rook: keep the rook on the sixth, then check from behind.',
    intro: [
      'When the attacker has king and pawn against your king, with rooks on, you draw with the Philidor setup: keep your rook on the sixth rank so the enemy king cannot step forward.',
      'As soon as the pawn goes to the sixth rank, switch the rook to the far side and check the king from behind, so it has no shelter.',
    ],
    ideas: ['Rook on the sixth rank until the pawn moves there.', 'Then rook to the back rank and give checks from behind.'],
    exercises: [
      { fen: '4k3/8/r3P3/3K4/8/8/8/7R b - - 0 1', moves: 'Ra2 Rh8+ Ke7 Rh7+ Kd8', balanced: true, why: 'The pawn has reached the sixth, so the rook leaves the sixth rank for the far side (Ra2) and checks from behind. The king steps next to the pawn and the checks keep the attacker from making progress: a draw.' },
    ],
  },
  {
    id: 'mate-patterns', title: 'Mating patterns', category: 'tactics',
    blurb: 'Recognise the shapes that finish a game: smothered, Arabian and Anastasia mates.',
    intro: [
      'Most checkmates repeat a few shapes. Once you recognise the shape, the winning move is easy to find.',
      'In a smothered mate the king is boxed in by its own pieces and a knight gives the final check. In the Arabian mate a rook and a knight together trap a king in the corner. In Anastasia\'s mate a knight takes away the flight squares while a rook checks along the edge.',
    ],
    ideas: [
      'A king surrounded by its own pieces is a target for a knight check.',
      'A knight covers the squares next to the king and also protects the rook that gives the check.',
      'Before you play a check, count the king\'s escape squares one by one.',
    ],
    exercises: [
      { fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', moves: 'Nf7#', exact: true, why: 'The king on h8 is boxed in by its own rook on g8 and its pawns on g7 and h7. The knight check from f7 cannot be captured, and the king has nowhere to go: a smothered mate.' },
      { fen: '7k/R7/5N2/8/8/8/8/6K1 w - - 0 1', moves: 'Rh7#', why: 'The rook checks on h7 and the knight on f6 protects it, so the king cannot take. The same knight also covers g8, so there is no flight square: the Arabian mate.' },
      { fen: '5r2/4N1pk/8/8/8/8/8/K2R4 w - - 0 1', moves: 'Rh1#', exact: true, why: 'The knight on e7 covers g8 and g6, and the pawn on g7 blocks the king\'s own way out. The rook checks along the h-file and nothing can block it: Anastasia\'s mate.' },
    ],
  },
  {
    id: 'pawn-breakthrough', title: 'Pawn breakthrough', category: 'endgames',
    blurb: 'Three pawns against three: sacrifice one to make a passed pawn that cannot be stopped.',
    intro: [
      'When pawns face pawns and nobody can pass, a sacrifice can open the position. The breakthrough gives up one pawn so that another one is left without an enemy pawn in front of it or beside it.',
      'Always count the race before you start: the new passed pawn must queen before the enemy king or pawns can stop it.',
    ],
    ideas: [
      'Push the middle pawn of the three to the sixth rank, so that every capture opens a path for a neighbour.',
      'Count the moves to promotion for both sides before sacrificing.',
    ],
    exercises: [
      { fen: '7k/ppp5/8/PPP5/8/8/8/K7 w - - 0 1', moves: 'b6 axb6 c6 bxc6 a6', why: 'b6! offers a pawn. After axb6 the c-pawn also steps forward with c6, and after bxc6 the a-pawn is free and runs to the eighth rank before the black king arrives. The other recapture, cxb6, is met by a6.' },
    ],
  },
];
