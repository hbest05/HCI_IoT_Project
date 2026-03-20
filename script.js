const PIECES = {
  wK:'♚', wQ:'♛', wR:'♜', wB:'♝', wN:'♞', wP:'♟',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PI_BASE_URL = 'http://10.54.157.54:8000';
const PI_FEN_ENDPOINT = PI_BASE_URL + '/fen';
const PI_RESET_ENDPOINT = PI_BASE_URL + '/reset';
const EXAMPLES = [
  '{"e2":"","e4":"wP"}',
  '{"e7":"","e5":"bP"}',
  '{"g1":"","f3":"wN"}',
  '{"b8":"","c6":"bN"}',
  '{"f1":"","c4":"wB"}',
];

let boardState = {};
let moveHistory = [];
let lastFrom = null, lastTo = null;
let bestFrom = null, bestTo = null;
let inCheck = null;
let currentTurn = 'w';
let moveCount = 1;
let exampleStep = 0;
let capturedByWhite = []; // black pieces white has taken
let capturedByBlack = []; // white pieces black has taken

const PIECE_ORDER = ['Q','R','B','N','P'];

function updateCaptures() {
  function render(pieces, elId) {
    const el = document.getElementById(elId);
    el.innerHTML = [...pieces]
      .sort((a, b) => PIECE_ORDER.indexOf(a[1]) - PIECE_ORDER.indexOf(b[1]))
      .map(p => `<span class="${p[0] === 'w' ? 'cap-white' : 'cap-black'}">${PIECES[p]}</span>`)
      .join('');
  }
  render(capturedByBlack, 'captures-by-black'); // white pieces lost → shown near black's side (top)
  render(capturedByWhite, 'captures-by-white'); // black pieces lost → shown near white's side (bottom)
}

// --- FEN helpers ---

function fenToBoard(fen) {
  const boardPart = String(fen || '').trim().split(/\s+/)[0];
  const rows = boardPart.split('/');
  if (rows.length !== 8) throw new Error('Invalid FEN board segment');
  const b = {};
  const files = 'abcdefgh';
  rows.forEach((row, ri) => {
    let fi = 0;
    for (const c of row) {
      if (/\d/.test(c)) { fi += parseInt(c); }
      else {
        const color = c === c.toUpperCase() ? 'w' : 'b';
        b[files[fi] + (8 - ri)] = color + c.toUpperCase();
        fi++;
      }
    }
  });
  return b;
}

function boardToFen(b) {
  const files = 'abcdefgh';
  let fen = '';
  for (let rank = 8; rank >= 1; rank--) {
    let empty = 0;
    for (let fi = 0; fi < 8; fi++) {
      const p = b[files[fi] + rank];
      if (!p) { empty++; }
      else {
        if (empty) { fen += empty; empty = 0; }
        fen += p[0] === 'w' ? p[1].toUpperCase() : p[1].toLowerCase();
      }
    }
    if (empty) fen += empty;
    if (rank > 1) fen += '/';
  }
  return fen + ' ' + currentTurn + ' KQkq - 0 ' + moveCount;
}

// --- Board rendering ---

function buildBoard() {
  const board = document.getElementById('board');
  const files = 'abcdefgh';
  board.innerHTML = '';
  for (let rank = 8; rank >= 1; rank--) {
    for (let fi = 0; fi < 8; fi++) {
      const sq = files[fi] + rank;
      const div = document.createElement('div');
      div.className = 'sq ' + ((fi + rank) % 2 === 0 ? 'light' : 'dark');
      div.id = 'sq-' + sq;
      const p = boardState[sq];
      if (p && PIECES[p]) {
        div.textContent = PIECES[p];
        div.classList.add(p[0] === 'w' ? 'piece-white' : 'piece-black');
      }
      board.appendChild(div);
    }
  }

  const rankLabels = document.getElementById('rank-labels');
  rankLabels.innerHTML = '';
  for (let r = 8; r >= 1; r--) {
    const s = document.createElement('span');
    s.textContent = r;
    rankLabels.appendChild(s);
  }

  const fileLabels = document.getElementById('file-labels');
  fileLabels.innerHTML = '';
  for (const f of files) {
    const s = document.createElement('div');
    s.className = 'coord-file';
    s.textContent = f;
    fileLabels.appendChild(s);
  }

  applyHighlights();
}

function applyHighlights() {
  document.querySelectorAll('.sq').forEach(el =>
    el.classList.remove('highlight-from', 'highlight-to', 'best-from', 'best-to', 'check')
  );
  if (lastFrom) document.getElementById('sq-' + lastFrom)?.classList.add('highlight-from');
  if (lastTo)   document.getElementById('sq-' + lastTo)?.classList.add('highlight-to');
  if (bestFrom) document.getElementById('sq-' + bestFrom)?.classList.add('best-from');
  if (bestTo)   document.getElementById('sq-' + bestTo)?.classList.add('best-to');
  if (inCheck) {
    const kSq = findKing(inCheck);
    if (kSq) document.getElementById('sq-' + kSq)?.classList.add('check');
  }
}

// --- Chess logic ---

function findKing(color) {
  return Object.entries(boardState).find(([, p]) => p === color + 'K')?.[0];
}

function isClearPath(from, to) {
  const files = 'abcdefgh';
  const [f1, r1] = [files.indexOf(from[0]), parseInt(from[1])];
  const [f2, r2] = [files.indexOf(to[0]), parseInt(to[1])];
  const df = Math.sign(f2 - f1), dr = Math.sign(r2 - r1);
  let cf = f1 + df, cr = r1 + dr;
  while (cf !== f2 || cr !== r2) {
    if (boardState[files[cf] + cr]) return false;
    cf += df; cr += dr;
  }
  return true;
}

function isAttacked(sq, byColor) {
  const files = 'abcdefgh';
  const fi = files.indexOf(sq[0]);
  const r  = parseInt(sq[1]);
  for (const [sqB, piece] of Object.entries(boardState)) {
    if (!piece.startsWith(byColor)) continue;
    const type = piece[1];
    const fib = files.indexOf(sqB[0]);
    const rb  = parseInt(sqB[1]);
    const df = fi - fib, dr = r - rb;
    if (type === 'P') {
      const dir = byColor === 'w' ? 1 : -1;
      if (dr === dir && Math.abs(df) === 1) return true;
    } else if (type === 'N') {
      if ((Math.abs(df) === 2 && Math.abs(dr) === 1) || (Math.abs(df) === 1 && Math.abs(dr) === 2)) return true;
    } else if (type === 'K') {
      if (Math.abs(df) <= 1 && Math.abs(dr) <= 1) return true;
    } else if (type === 'R' || type === 'Q') {
      if ((df === 0 || dr === 0) && isClearPath(sqB, sq)) return true;
    }
    if ((type === 'B' || type === 'Q') && Math.abs(df) === Math.abs(dr) && isClearPath(sqB, sq)) return true;
  }
  return false;
}

function detectCheck() {
  for (const c of ['w', 'b']) {
    const kSq = findKing(c);
    if (kSq && isAttacked(kSq, c === 'w' ? 'b' : 'w')) return c;
  }
  return null;
}

// --- Status & analysis ---

function updateStatus() {
  const badge = document.getElementById('status-badge');
  inCheck = detectCheck();
  if (inCheck) {
    badge.textContent = (inCheck === 'w' ? 'White' : 'Black') + ' in check!';
    badge.className = 'err';
  } else {
    badge.textContent = (currentTurn === 'w' ? 'White' : 'Black') + ' to move';
    badge.className = 'ok';
  }
  const fen = boardToFen(boardState);
  document.getElementById('fen-out').textContent = 'FEN: ' + fen;
  runAnalysis(fen);
}

async function runAnalysis(fen) {
  const box = document.getElementById('analysis-box');
  box.innerHTML = '<span style="color:var(--color-text-tertiary)">Analysing...</span>';
  bestFrom = null; bestTo = null;

  try {
    const resp = await fetch('https://stockfish.online/api/s/v2.php?fen=' + encodeURIComponent(fen) + '&depth=12');
    const data = await resp.json();
    if (!data?.success) throw new Error('no result');

    const bm = data.bestmove?.replace('bestmove ', '').split(' ')[0] ?? null;
    const score = data.evaluation;
    const mate  = data.mate;
    bestFrom = bm ? bm.slice(0, 2) : null;
    bestTo   = bm ? bm.slice(2, 4) : null;
    applyHighlights();

    let scoreLabel = '', barPct = 50;
    if (mate != null) {
      scoreLabel = 'Mate in ' + Math.abs(mate);
      barPct = mate > 0 ? 85 : 15;
    } else if (score != null) {
      const s = parseFloat(score);
      scoreLabel = (s > 0 ? '+' : '') + s.toFixed(2);
      barPct = Math.min(95, Math.max(5, 50 + s * 5));
    }

    box.innerHTML =
      '<div class="best">' + (bm ? 'Best move: <code>' + bm + '</code>' : 'No move found') + '</div>' +
      (scoreLabel ? '<div style="color:var(--color-text-secondary);font-size:12px">Eval: ' + scoreLabel + '</div>' : '') +
      '<div class="score-bar-wrap"><div class="score-bar" style="width:' + barPct.toFixed(0) + '%"></div></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-text-tertiary)"><span>Black</span><span>White</span></div>';
  } catch {
    box.innerHTML = '<span style="color:var(--color-text-tertiary)">Analysis unavailable (offline?)</span>';
  }
}

// --- Input handling ---

function applyJson() {
  const raw = document.getElementById('json-in').value.trim();
  const errEl = document.getElementById('json-err');
  errEl.textContent = '';
  if (!raw) { errEl.textContent = 'Paste JSON or a FEN string'; return; }

  let detectedFrom = null, detectedTo = null;

  if (raw.startsWith('{')) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { errEl.textContent = 'Invalid JSON: ' + e.message; return; }

    const flat = parsed.board || parsed.position || parsed;
    if (typeof flat !== 'object') { errEl.textContent = 'JSON must be an object of square→piece'; return; }

    const oldBoard = { ...boardState };
    const merged   = { ...oldBoard };

    for (const [sq, val] of Object.entries(flat)) {
      const sqKey = sq.toLowerCase();
      if (!/^[a-h][1-8]$/.test(sqKey)) { errEl.textContent = 'Bad square: ' + sq; return; }
      if (val === '' || val === null) { delete merged[sqKey]; }
      else {
        if (!PIECES[val]) { errEl.textContent = 'Unknown piece "' + val + '". Use wP, bK, etc.'; return; }
        merged[sqKey] = val;
      }
    }

    const gained = Object.entries(merged).filter(([sq, p]) => !oldBoard[sq] || oldBoard[sq] !== p);
    const lost   = Object.keys(oldBoard).filter(sq => !merged[sq]);
    if (gained.length === 1 && lost.length === 1) {
      detectedFrom = lost[0];
      detectedTo   = gained[0][0];
      const captured = oldBoard[detectedTo];
      if (captured) {
        if (captured[0] === 'b') capturedByWhite.push(captured);
        else capturedByBlack.push(captured);
        updateCaptures();
      }
    }

    boardState = merged;
  } else {
    try {
      boardState = fenToBoard(raw);
      const turnPart = raw.split(' ')[1];
      if (turnPart === 'w' || turnPart === 'b') currentTurn = turnPart;
    } catch { errEl.textContent = 'Could not parse as FEN'; return; }
  }

  if (detectedFrom) { lastFrom = detectedFrom; lastTo = detectedTo; }
  logMove(detectedFrom, detectedTo);
  buildBoard();
  updateStatus();
}

function logMove(from, to) {
  if (!from && !to) return;
  const log   = document.getElementById('move-log');
  const piece = boardState[to] || '?';
  const label = moveCount + '. ' + (PIECES[piece] || piece) + ' ' + from + '→' + to;
  moveHistory.push(label);
  const entry = document.createElement('div');
  entry.className = 'move-entry';
  entry.textContent = label;
  if (log.querySelector('[style]')) log.innerHTML = '';
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  moveCount++;
  currentTurn = currentTurn === 'w' ? 'b' : 'w';
}

function loadExample() {
  document.getElementById('json-in').value = EXAMPLES[exampleStep % EXAMPLES.length];
  exampleStep++;
}

async function resetPiBoard() {
  try {
    await fetch(PI_RESET_ENDPOINT, { method: 'POST' });
  } catch {
    try {
      await fetch(PI_RESET_ENDPOINT);
    } catch {
      // Pi unreachable - ignore and keep local reset behavior.
    }
  }
}

function resetBoard(options = {}) {
  if (options.syncPi) {
    void resetPiBoard();
  }
  boardState = fenToBoard(START_FEN);
  lastFrom = null; lastTo = null; bestFrom = null; bestTo = null; inCheck = null;
  currentTurn = 'w'; moveCount = 1; moveHistory = [];
  capturedByWhite = []; capturedByBlack = [];
  updateCaptures();
  document.getElementById('move-log').innerHTML = '<span style="color:var(--color-text-tertiary)">No moves yet</span>';
  document.getElementById('json-in').value = '';
  document.getElementById('json-err').textContent = '';
  buildBoard();
  updateStatus();
}

// --- Pi polling ---

let pollingActive = false;
let lastFen = null;

function renderBoard(fen) {
  const normalizedFen = String(fen || '').trim();
  const newBoard = fenToBoard(normalizedFen);
  // detect move: one square lost, one gained
  const lost   = Object.keys(boardState).filter(sq => !newBoard[sq]);
  const gained = Object.keys(newBoard).filter(sq => newBoard[sq] !== boardState[sq]);
  if (lost.length === 1 && gained.length === 1) {
    lastFrom = lost[0];
    lastTo   = gained[0];
    const captured = boardState[lastTo];
    if (captured) {
      if (captured[0] === 'b') capturedByWhite.push(captured);
      else capturedByBlack.push(captured);
      updateCaptures();
    }
    logMove(lastFrom, lastTo);
  }
  boardState = newBoard;
  const turnPart = normalizedFen.split(/\s+/)[1];
  if (turnPart === 'w' || turnPart === 'b') currentTurn = turnPart;
  buildBoard();
  updateStatus();
}

function flashBoard(cls) {
  const board = document.getElementById('board');
  board.classList.add(cls);
  board.addEventListener('animationend', () => board.classList.remove(cls), { once: true });
}

function showGameOver(reason) {
  pollingActive = false;
  const badge = document.getElementById('status-badge');
  const label = reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : 'Game over';
  badge.textContent = 'Game over: ' + label;
  badge.className = 'err';
}

async function pollState() {
  try {
    const res = await fetch(PI_FEN_ENDPOINT);
    const rawBody = await res.text();
    let payload = rawBody;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Plain-text FEN is valid; keep raw string payload.
    }

    // Accept multiple payload formats:
    // 1) { type: 'fen', data: '<fen>' }
    // 2) { fen: '<fen>' }
    // 3) '<fen>'
    let type = null;
    let data = null;

    if (typeof payload === 'string') {
      type = 'fen';
      data = payload;
    } else if (payload && typeof payload === 'object') {
      if (typeof payload.type === 'string') type = payload.type;
      if (typeof payload.data === 'string') data = payload.data;
      if (type == null && typeof payload.fen === 'string') {
        type = 'fen';
        data = payload.fen;
      }
    }

    switch (type) {
      case 'fen':
        if (!data) break;
        data = data.trim();
        if (data !== lastFen) { lastFen = data; renderBoard(data); }
        break;
      case 'illegal_move':
        flashBoard('flash-red');
        break;
      case 'check':
        flashBoard('flash-yellow');
        break;
      case 'game_over':
        showGameOver(data);
        break;
      case 'new_game':
        resetBoard();
        lastFen = null;
        pollingActive = true;
        break;
    }
  } catch {
    // Pi unreachable — silent fail, keep polling
  }
}

function startPolling() {
  pollingActive = true;
  setInterval(() => { if (pollingActive) pollState(); }, 300);
}

// --- Init ---
resetBoard();
startPolling();
