// Deadly Dungeon — เกมเอนจิน (server-authoritative)
import { randomUUID } from 'node:crypto';

const DIRS = {
  n: { dr: -1, dc: 0 },
  s: { dr: 1, dc: 0 },
  e: { dr: 0, dc: 1 },
  w: { dr: 0, dc: -1 },
};
const ALL_DIRS = ['n', 's', 'e', 'w'];

const COLORS = ['#ff5f92', '#4da3ff', '#ffb020', '#3ddc84', '#a06bff', '#ff7a4d'];

export const ITEMS = {
  revive:        { id: 'revive',        name: 'ใบชุบ',       icon: '🌿', desc: 'ชุบผู้เล่นที่ตายแล้ว 1 คนกลับมามีชีวิต' },
  dash:          { id: 'dash',          name: 'ใบเร่ง',       icon: '💨', desc: 'เดินเพิ่ม 2–4 ช่องในตานี้' },
  reveal_number: { id: 'reveal_number', name: 'ใบส่องเลข',   icon: '🔢', desc: 'เปิดเผยเลข + ตำแหน่งห้องทะลุได้ที่ยังไม่รู้ (สุ่ม)' },
  reveal_wall:   { id: 'reveal_wall',   name: 'ใบส่องกำแพง', icon: '🧱', desc: 'เปิดเผยตำแหน่งห้องตันที่ยังไม่รู้ (สุ่ม)' },
  freeze:        { id: 'freeze',        name: 'ใบแช่แข็ง',   icon: '❄️', desc: 'เลือกผู้เล่น 1 คนให้หยุดเดิน 1 ตา' },
  banish_demon:  { id: 'banish_demon',  name: 'ใบย้ายปีศาจ', icon: '😈', desc: 'ย้ายปีศาจไปห้องสุ่ม' },
  demon_sense:   { id: 'demon_sense',   name: 'ใบรับรู้ปีศาจ', icon: '👁️', desc: 'เห็นตำแหน่งปีศาจตลอดเกมที่เหลือ' },
  shield:        { id: 'shield',        name: 'ใบโล่',       icon: '🛡️', desc: 'กันปีศาจฆ่าได้ 1 ครั้ง' },
  warp:          { id: 'warp',          name: 'ใบวาร์ป',     icon: '🌀', desc: 'วาร์ปไปห้องที่เคยไปแล้ว' },
};

// น้ำหนักสุ่มไอเทมจากห้องคำถาม (ใบชุบหายากสุด)
const ITEM_POOL = [
  ['revive', 7], ['dash', 15], ['reveal_number', 15], ['reveal_wall', 15],
  ['freeze', 12], ['banish_demon', 10], ['demon_sense', 10], ['shield', 10], ['warp', 10],
];

const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const keyOf = (r, c) => `${r},${c}`;
const parseKey = (k) => { const [r, c] = k.split(',').map(Number); return { r, c }; };

function weightedItem() {
  const total = ITEM_POOL.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [id, w] of ITEM_POOL) {
    roll -= w;
    if (roll <= 0) return id;
  }
  return ITEM_POOL[0][0];
}

export class Game {
  constructor({ rows, cols, players, questionBank = [], demonEvery = 1, turnMs = 120000, now = () => Date.now() }) {
    this.demonEvery = [1, 2, 3].includes(Number(demonEvery)) ? Number(demonEvery) : 1; // ปีศาจเดินทุกกี่รอบ (โฮสต์เลือก)
    this.turnMs = turnMs;      // เวลาต่อตา (รวมหน้าต่างคำถาม/ห้องชนะ/เจอกัน)
    this.now = now;
    this.turnDeadline = null;
    this.id = randomUUID();
    this.rows = rows;
    this.cols = cols;
    this.questionBank = questionBank;
    this.qCursor = 0;
    this.round = 1;
    this.currentIndex = 0;
    this.status = 'playing'; // 'playing' | 'ended'
    this.pending = null;      // null | {type:'question'|'win'|'meeting', ...}
    this.winner = null;       // { id, name, coWinners: [...] }
    this.contracts = [];
    this.trades = new Map(); // ข้อเสนอแลกข้อมูลระหว่างผู้เล่นที่ยังมีชีวิต (เฉพาะตอนเจอกัน)
    this.demonWasNear = false;
    this.log = [];
    this.demon = { r: 0, c: 0 };

    this.cells = this.generateBoard();
    this.rooms = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c].type === 'room') this.rooms.push(this.cells[r][c]);
      }
    }
    this.assignNumbers();
    this.players = players;
    this.placeSpawns(players);
    this.placeEvents();

    this.players.forEach((p, i) => {
      p.seat = i;
      p.alive = true;
      p.inventory = [];
      p.known = {};      // key -> number
      p.revealed = {};   // key -> 'room' | 'wall'
      p.frozen = false;
      p.shield = false;
      p.demonSense = false;
      p.movesLeft = 0;
      p.movedThisTurn = false;
      p.visited = {};    // key -> true (ห้องที่เคยเข้าเอง → รู้ประตู)
      p.doorKnown = {};  // key -> true (รู้ประตูจากการแชร์/สัญญา)
      p.stats = {        // สถิติสำหรับหน้าสรุปตอนจบเกม
        steps: 0, questionsRight: 0, questionsWrong: 0, itemsGot: 0, itemsUsed: 0,
        deaths: 0, diedRound: null, revived: 0, revivedOthers: 0, winAttempts: 0, meetings: 0,
      };
      p.disconnected = false;
      this.enterCell(p, this.cells[p.pos.r][p.pos.c], { silent: true });
      this.log.push(`ผู้เล่น ${p.name} เข้าสู่ดันเจี้ยน`);
    });

    // ปีศาจเริ่มที่ห้องสุ่ม (ไม่ทับห้องเกิดผู้เล่น)
    const spawnKeys = new Set(this.players.map((p) => keyOf(p.pos.r, p.pos.c)));
    const demonCandidates = this.rooms.filter((rm) => !spawnKeys.has(keyOf(rm.r, rm.c)));
    const d = pick(demonCandidates.length ? demonCandidates : this.rooms);
    this.demon = { r: d.r, c: d.c };

    this.beginTurn();
  }

  // ---------------- บอร์ด ----------------
  generateBoard() {
    const { rows, cols } = this;
    const cells = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ({
        r, c, type: 'wall', number: null, event: null, question: null,
      }))
    );

    // 1) สุ่มห้อง/กำแพง
    const ROOM_P = 0.62;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells[r][c].type = Math.random() < ROOM_P ? 'room' : 'wall';
      }
    }
    // กันกรณีไม่มีห้องเลย
    if (!cells.some((row) => row.some((x) => x.type === 'room'))) {
      cells[randInt(0, rows - 1)][randInt(0, cols - 1)].type = 'room';
    }

    // 2) เชื่อมทุก component ให้เป็นก้อนเดียว
    this.connectAll(cells);

    // 3) เพิ่มทางลัด (loop) ลดทางตัน
    this.addLoops(cells);

    // 4) สุ่มประตูระหว่างห้องที่ติดกัน (เปิดทั้งสองฝั่ง) โดยการันตีว่าทุกห้องเดินถึงกัน
    this.generateDoors(cells);

    return cells;
  }

  generateDoors(cells) {
    const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
    const EXTRA_DOOR_P = 0.35; // โอกาสเปิดประตูเพิ่ม (นอกเหนือจากทางหลัก) → มีทางวน ไม่ตันเกินไป
    const rooms = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        cells[r][c].doors = { n: false, s: false, e: false, w: false };
        if (cells[r][c].type === 'room') rooms.push(cells[r][c]);
      }
    }
    // ขอบระหว่างห้องที่ติดกัน (นับครั้งเดียวต่อคู่: ใช้แค่ทิศ s และ e)
    const edges = [];
    for (const rm of rooms) {
      for (const d of ['s', 'e']) {
        const nr = rm.r + DIRS[d].dr, nc = rm.c + DIRS[d].dc;
        if (nr < this.rows && nc < this.cols && cells[nr][nc].type === 'room') edges.push({ a: rm, b: cells[nr][nc], d });
      }
    }
    // Union-Find → ต้นไม้สุ่ม (Kruskal) ให้ทุกห้องเชื่อมถึงกัน
    const parent = new Map(rooms.map((rm) => [keyOf(rm.r, rm.c), keyOf(rm.r, rm.c)]));
    const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    const open = ({ a, b, d }) => { a.doors[d] = true; b.doors[OPP[d]] = true; };
    const rest = [];
    for (const e of shuffle(edges)) {
      const ra = find(keyOf(e.a.r, e.a.c)), rb = find(keyOf(e.b.r, e.b.c));
      if (ra !== rb) { parent.set(ra, rb); open(e); }
      else rest.push(e);
    }
    for (const e of rest) if (Math.random() < EXTRA_DOOR_P) open(e);
  }

  neighbors(r, c, cells = this.cells) {
    const out = [];
    for (const d of ALL_DIRS) {
      const nr = r + DIRS[d].dr, nc = c + DIRS[d].dc;
      if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) out.push({ r: nr, c: nc, d });
    }
    return out;
  }

  connectAll(cells) {
    const { rows, cols } = this;
    const compId = Array.from({ length: rows }, () => Array(cols).fill(-1));
    const comps = []; // list of Set of room cells (key -> {r,c})
    let id = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cells[r][c].type !== 'room' || compId[r][c] !== -1) continue;
        const stack = [{ r, c }];
        const set = [];
        compId[r][c] = id;
        while (stack.length) {
          const cur = stack.pop();
          set.push(cur);
          for (const nb of this.neighbors(cur.r, cur.c, cells)) {
            if (cells[nb.r][nb.c].type === 'room' && compId[nb.r][nb.c] === -1) {
              compId[nb.r][nb.c] = id;
              stack.push(nb);
            }
          }
        }
        comps.push(set);
        id++;
      }
    }

    // เชื่อม component i+1 เข้าหา component 0 ด้วย BFS ผ่านช่องใดก็ได้
    for (let i = 1; i < comps.length; i++) {
      const target = new Set(comps[i].map((c) => keyOf(c.r, c.c)));
      const start = comps[0];
      const prev = new Map();
      const queue = [...start.map((c) => ({ r: c.r, c: c.c }))];
      const seen = new Set(start.map((c) => keyOf(c.r, c.c)));
      let found = null;
      while (queue.length && !found) {
        const cur = queue.shift();
        for (const nb of this.neighbors(cur.r, cur.c, cells)) {
          const k = keyOf(nb.r, nb.c);
          if (seen.has(k)) continue;
          seen.add(k);
          prev.set(k, keyOf(cur.r, cur.c));
          if (target.has(k)) { found = { r: nb.r, c: nb.c }; break; }
          queue.push({ r: nb.r, c: nb.c });
        }
      }
      if (found) {
        // ย้อนรอย carve ทาง
        let k = keyOf(found.r, found.c);
        while (prev.has(k)) {
          const { r, c } = parseKey(k);
          cells[r][c].type = 'room';
          k = prev.get(k);
        }
      }
    }
  }

  addLoops(cells) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (cells[r][c].type === 'wall' && Math.random() < 0.18) {
          const roomNbs = this.neighbors(r, c, cells).filter((n) => cells[n.r][n.c].type === 'room').length;
          if (roomNbs >= 2) cells[r][c].type = 'room';
        }
      }
    }
  }

  assignNumbers() {
    // เลข 1–99 ไม่ซ้ำ
    const pool = shuffle(Array.from({ length: 99 }, (_, i) => i + 1));
    this.rooms.forEach((rm, i) => { rm.number = pool[i]; });
  }

  placeEvents() {
    const spawnKeys = new Set(this.players.map((p) => keyOf(p.pos.r, p.pos.c)));
    let eligible = this.rooms.filter((rm) => !spawnKeys.has(keyOf(rm.r, rm.c)));
    if (!eligible.length) eligible = this.rooms.slice();
    // ห้องชนะ 1 ห้อง
    const win = pick(eligible);
    win.event = 'win';
    // ห้องคำถาม ~6 ห้อง (หรือ 25% ของห้อง แต่ไม่เกิน 6)
    const qCount = Math.min(6, Math.max(3, Math.floor(this.rooms.length * 0.2)));
    let placed = 0;
    for (const rm of shuffle(eligible)) {
      if (placed >= qCount) break;
      if (rm.event) continue;
      rm.event = 'question';
      rm.question = this.nextQuestion();
      placed++;
    }
  }

  nextQuestion() {
    if (this.questionBank.length) {
      const q = this.questionBank[this.qCursor % this.questionBank.length];
      this.qCursor++;
      return q;
    }
    return null;
  }

  placeSpawns(players) {
    const roomCells = this.rooms.slice();
    const spawns = shuffle(roomCells).slice(0, players.length);
    players.forEach((p, i) => { p.pos = { r: spawns[i].r, c: spawns[i].c }; });
  }

  // ทิศที่มีประตูเปิด (ไปห้องติดกันได้)
  doorsOf(cell) {
    if (!cell || cell.type !== 'room' || !cell.doors) return [];
    return ALL_DIRS.filter((d) => cell.doors[d]);
  }

  // ---------------- เปิดเผย/ความรู้ ----------------
  revealCellType(p, r, c) {
    if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
      p.revealed[keyOf(r, c)] = this.cells[r][c].type;
    }
  }

  revealAround(p, r, c) {
    this.revealCellType(p, r, c);
    for (const d of ALL_DIRS) this.revealCellType(p, r + DIRS[d].dr, c + DIRS[d].dc);
  }

  enterCell(p, cell, { silent = false } = {}) {
    this.revealAround(p, cell.r, cell.c);
    if (cell.type === 'room') {
      p.known[keyOf(cell.r, cell.c)] = cell.number;
      if (p.visited) p.visited[keyOf(cell.r, cell.c)] = true;
    }
  }

  // ---------------- เทิร์น ----------------
  beginTurn() {
    if (this.status === 'ended') return;
    // ข้ามผู้เล่นที่ถูกแช่แข็ง
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[this.currentIndex];
      if (p.frozen) { p.frozen = false; this.currentIndex = (this.currentIndex + 1) % this.players.length; this.afterWrap(); continue; }
      if (p.disconnected) { this.currentIndex = (this.currentIndex + 1) % this.players.length; this.afterWrap(); continue; }
      p.movesLeft = 1;
      p.movedThisTurn = false;
      this.turnDeadline = this.now() + this.turnMs;
      return;
    }
  }

  afterWrap() {
    if (this.currentIndex === 0) {
      this.round++;
      // ปีศาจเริ่มเดินรอบ 2 แล้วเดินทุก demonEvery รอบ
      if (this.round >= 2 && (this.round - 2) % this.demonEvery === 0) this.moveDemon();
    }
  }

  currentPlayer() { return this.players[this.currentIndex]; }

  endTurn(playerId) {
    if (this.status === 'ended') return { ok: false, msg: 'เกมจบแล้ว' };
    const p = this.player(playerId);
    if (!p || this.currentPlayer().id !== playerId) return { ok: false, msg: 'ไม่ใช่ตาคุณ' };
    if (this.pending) return { ok: false, msg: 'รอสถานการณ์ปัจจุบันให้จบก่อน' };
    this.currentIndex = (this.currentIndex + 1) % this.players.length;
    this.afterWrap();
    if (this.status === 'ended') return { ok: true };
    this.beginTurn();
    return { ok: true };
  }

  player(id) { return this.players.find((p) => p.id === id); }

  disconnectPlayer(id) {
    const p = this.player(id);
    if (!p) return;
    p.disconnected = true;
    if (this.pending && this.pending.type === 'meeting' && this.pending.participants.includes(id)) {
      this.pending = null;
    }
    // คนหลุดระหว่างตอบคำถาม/ยื่นคำตอบ → ยกเลิก ไม่ให้เกมค้าง (ห้องยังคงเป็นห้องเดิม)
    if (this.pending && this.pending.playerId === id) this.pending = null;
    // ไม่จบเกมทันที — รอให้กลับเข้ามาได้ (ถ้าไม่กลับภายในเวลาที่กำหนด server จะเรียก markLeft)
    if (this.currentPlayer() && this.currentPlayer().id === id) {
      this.currentIndex = (this.currentIndex + 1) % this.players.length;
      this.afterWrap();
      this.beginTurn();
    }
  }

  // กลับเข้าเกม (รีเฟรช/เน็ตหลุดแล้วกลับมา)
  reconnectPlayer(id) {
    const p = this.player(id);
    if (!p) return false;
    const wasIdle = this.currentPlayer()?.disconnected; // ทุกคนหลุด → ไม่มีใครถือตาอยู่
    p.disconnected = false;
    p.left = false;
    if (wasIdle && this.status !== 'ended') this.beginTurn();
    return true;
  }

  // หลุดเกินเวลาที่รอ → ถือว่าออกจากเกม
  markLeft(id) {
    const p = this.player(id);
    if (!p || !p.disconnected) return;
    p.left = true;
    this.checkAllDead();
  }

  // จับเวลาต่อตา: หมดเวลา → จัดการหน้าต่างที่ค้าง แล้วจบตาให้
  tick(now = this.now()) {
    if (this.status !== 'playing' || !this.turnDeadline || now < this.turnDeadline) return false;
    const p = this.currentPlayer();
    if (!p || p.disconnected) return false;
    const pend = this.pending;
    if (pend?.type === 'question' && pend.playerId === p.id) this.answerQuestion(p.id, -1); // หมดเวลา = ตอบผิด
    else if (pend?.type === 'win' && pend.playerId === p.id) this.cancelWin(p.id);           // ปิด ไม่ยื่น
    else if (pend) { this.pending = null; this.trades.clear(); }                             // จบการสนทนา
    this.log.push(`⏰ หมดเวลาของ ${p.name}`);
    this.endTurn(p.id);
    return true;
  }

  // ---------------- การเดิน ----------------
  move(playerId, dir) {
    const res = this.moveInner(playerId, dir);
    if (res.ok) this.updateDemonAlert();
    return res;
  }

  moveInner(playerId, dir) {
    const out = { ok: true };
    if (this.status === 'ended') return { ok: false, msg: 'เกมจบแล้ว' };
    if (this.pending) return { ok: false, msg: 'รอสถานการณ์ปัจจุบันให้จบก่อน' };
    const p = this.player(playerId);
    if (!p) return { ok: false, msg: 'ไม่พบผู้เล่น' };
    if (this.currentPlayer().id !== playerId) return { ok: false, msg: 'ไม่ใช่ตาคุณ' };
    if (!p.movesLeft || p.movesLeft <= 0) return { ok: false, msg: 'คุณเดินครบแล้ว' };
    if (!DIRS[dir]) return { ok: false, msg: 'ทิศทางไม่ถูกต้อง' };

    const tr = p.pos.r + DIRS[dir].dr;
    const tc = p.pos.c + DIRS[dir].dc;
    if (tr < 0 || tr >= this.rows || tc < 0 || tc >= this.cols) return { ok: false, msg: 'ออกนอกขอบแมพ' };
    const cell = this.cells[tr][tc];
    if (p.alive && cell.type !== 'room') return { ok: false, msg: 'นั่นคือห้องตัน (กำแพง) ทะลุไม่ได้' };
    if (p.alive && !this.doorsOf(this.cells[p.pos.r][p.pos.c]).includes(dir)) return { ok: false, msg: 'ทางนี้ไม่มีประตู เดินผ่านไม่ได้' };

    p.pos = { r: tr, c: tc };
    p.movesLeft -= 1;
    p.movedThisTurn = true;
    this.enterCell(p, cell);
    const k = keyOf(tr, tc);
    p.stats.steps++;
    // ไม่บอกเลขห้อง และ log ทุกการเดิน (รวมผีที่เดินเข้ากำแพง) เพื่อไม่ให้ใครรู้ข้อมูลฟรี
    this.log.push(`👣 ${p.name} เดิน 1 ก้าว`);

    // ปีศาจฆ่า
    if (p.alive && this.demon.r === tr && this.demon.c === tc) {
      this.kill(p, 'ปีศาจ'); // ไม่ประกาศใน log — ผู้เล่นอื่นต้องไม่รู้ว่าใครตาย
      return out;
    }

    // อีเวนต์
    if (p.alive && cell.event === 'win') {
      this.pending = { type: 'win', playerId: p.id, cellKey: k };
      this.log.push(`🏆 ${p.name} พบห้องชนะ!`);
      return out;
    }
    if (p.alive && cell.event === 'question') {
      this.pending = { type: 'question', playerId: p.id, cellKey: k, question: cell.question };
      this.log.push(`❓ ${p.name} เจอห้องคำถาม`);
      return out;
    }

    // เจอกัน
    const cohab = this.players.filter((q) => q.id !== p.id && q.pos.r === tr && q.pos.c === tc);
    if (cohab.length) {
      this.pending = {
        type: 'meeting',
        playerId: p.id,
        participants: [p.id, ...cohab.map((q) => q.id)],
      };
      for (const q of [p, ...cohab]) q.stats.meetings++;
      this.log.push(`💬 ${p.name} เจอกับ ${cohab.map((q) => q.name).join(', ')}`);
    }
    return out;
  }

  kill(p, cause) {
    if (p.shield) {
      p.shield = false;
      this.log.push(`🛡️ ${p.name} ใช้ใบโล่รอดจากปีศาจ!`);
      return;
    }
    p.alive = false;
    p.stats.deaths++;
    p.stats.diedRound = this.round;
    this.checkAllDead();
  }

  // ผู้เล่นที่ยังมีชีวิต (และยังต่ออยู่) หมด = ไม่มีใครชนะได้แล้ว → ปีศาจชนะ
  checkAllDead() {
    if (this.status === 'ended') return;
    if (this.players.some((q) => q.alive && !q.left)) return; // หลุดชั่วคราวยังนับว่าอยู่ (กลับมาได้)
    this.status = 'ended';
    this.pending = null;
    this.winner = { id: null, name: 'ปีศาจ', demon: true, coWinners: [] };
    this.log.push('👹 ไม่มีผู้รอดชีวิตเหลืออยู่ — ปีศาจชนะ!');
  }

  // ปีศาจอยู่ในระยะ 1 ช่องรอบตัว (รวมทแยง) ของผู้เล่นที่ยังมีชีวิตคนใดคนหนึ่ง
  isDemonNear() {
    return this.players.some((q) => q.alive && !q.disconnected
      && Math.max(Math.abs(q.pos.r - this.demon.r), Math.abs(q.pos.c - this.demon.c)) <= 1);
  }

  // ระบบเตือนกลาง: ประกาศทุกคน ไม่บอกชื่อ เมื่อปีศาจเพิ่งเข้าใกล้
  updateDemonAlert() {
    const near = this.status !== 'ended' && this.isDemonNear();
    if (near && !this.demonWasNear) this.log.push('⚠️ ปีศาจเข้าใกล้ผู้เล่นบางคนแล้ว — ระวังตัว!');
    this.demonWasNear = near;
  }

  moveDemon() {
    const dc = this.cells[this.demon.r][this.demon.c];
    const doors = this.doorsOf(dc);
    if (doors.length) {
      const d = pick(doors);
      this.demon = { r: dc.r + DIRS[d].dr, c: dc.c + DIRS[d].dc };
    }
    for (const p of this.players) {
      if (p.alive && p.pos.r === this.demon.r && p.pos.c === this.demon.c) {
        this.kill(p, 'ปีศาจ'); // ไม่ประกาศใน log — ผู้เล่นอื่นต้องไม่รู้ว่าใครตาย
      }
    }
    this.updateDemonAlert();
  }

  // ---------------- ไอเทม ----------------
  useItem(playerId, itemId, payload = {}) {
    const res = this.useItemInner(playerId, itemId, payload);
    if (res.ok) this.updateDemonAlert();
    return res;
  }

  useItemInner(playerId, itemId, payload = {}) {
    const p = this.player(playerId);
    if (!p) return { ok: false, msg: 'ไม่พบผู้เล่น' };
    if (this.status === 'ended') return { ok: false, msg: 'เกมจบแล้ว' };
    if (this.pending) return { ok: false, msg: 'รอสถานการณ์ปัจจุบันให้จบก่อน' };
    if (this.currentPlayer().id !== playerId) return { ok: false, msg: 'ไม่ใช่ตาคุณ' };
    if (!p.alive) return { ok: false, msg: 'ผีใช้ไอเทมไม่ได้' };
    if (!p.inventory.includes(itemId)) return { ok: false, msg: 'ไม่มีไอเทมนี้' };
    if (!ITEMS[itemId]) return { ok: false, msg: 'ไอเทมไม่รู้จัก' };

    const consume = () => { p.inventory.splice(p.inventory.indexOf(itemId), 1); p.stats.itemsUsed++; };
    const err = (msg) => ({ ok: false, msg });

    switch (itemId) {
      case 'revive': {
        const target = this.player(payload.targetId);
        if (!target) return err('ระบุเป้าหมาย');
        if (target.alive) return err('เป้าหมายยังไม่ตาย');
        if (p.movedThisTurn) return err('ใบชุบต้องใช้ก่อนเริ่มเดินในตานั้น');
        // สัญญาชุบ: ถ้าค้างสัญญากับผีอยู่ ใบชุบต้องใช้กับผีตามสัญญาก่อน
        const owed = this.owedRevives(p);
        if (owed.length && !owed.some((c) => c.fromId === target.id)) {
          return err(`คุณมีสัญญาชุบค้างอยู่ ต้องชุบ ${owed.map((c) => c.fromName).join(' / ')} ก่อน`);
        }
        target.alive = true;
        // ถ้าอยู่บนกำแพง ให้ย้ายไปห้องใกล้สุด
        const cell = this.cells[target.pos.r][target.pos.c];
        if (cell.type !== 'room') {
          const near = this.nearestRoom(target.pos.r, target.pos.c);
          if (near) target.pos = { r: near.r, c: near.c };
        }
        this.enterCell(target, this.cells[target.pos.r][target.pos.c]);
        consume(); // ไม่ประกาศใน log — ซ่อนว่าใครเคยตาย
        target.stats.revived++;
        p.stats.revivedOthers++;
        for (const c of owed) if (c.fromId === target.id) c.fulfilled = true;
        return { ok: true };
      }
      case 'dash': {
        const extra = randInt(2, 4);
        p.movesLeft += extra;
        consume();
        this.log.push(`💨 ${p.name} ใช้ใบเร่ง ได้เดินเพิ่ม ${extra} ช่อง`);
        return { ok: true };
      }
      case 'reveal_number': {
        const unknown = this.rooms.filter((rm) => !(keyOf(rm.r, rm.c) in p.known));
        if (!unknown.length) return err('คุณรู้เลขทุกห้องแล้ว');
        const rm = pick(unknown);
        const k = keyOf(rm.r, rm.c);
        p.known[k] = rm.number;
        this.revealAround(p, rm.r, rm.c);
        consume();
        this.log.push(`🔢 ${p.name} ใช้ใบส่องเลข`);
        return { ok: true };
      }
      case 'reveal_wall': {
        const unknown = [];
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
          const k = keyOf(r, c);
          if (this.cells[r][c].type === 'wall' && !(k in p.revealed)) unknown.push({ r, c });
        }
        if (!unknown.length) return err('คุณเห็นกำแพงครบแล้ว');
        const w = pick(unknown);
        p.revealed[keyOf(w.r, w.c)] = 'wall';
        consume();
        this.log.push(`🧱 ${p.name} ใช้ใบส่องกำแพง`);
        return { ok: true };
      }
      case 'freeze': {
        const target = this.player(payload.targetId);
        if (!target) return err('ระบุเป้าหมาย');
        if (target.id === p.id) return err('เลือกตัวเองไม่ได้');
        target.frozen = true;
        consume();
        this.log.push(`❄️ ${p.name} แช่แข็ง ${target.name} ให้หยุด 1 ตา`);
        return { ok: true };
      }
      case 'banish_demon': {
        const rm = pick(this.rooms);
        this.demon = { r: rm.r, c: rm.c };
        consume();
        this.log.push(`😈 ${p.name} ย้ายปีศาจไปห้องสุ่ม`);
        return { ok: true };
      }
      case 'demon_sense': {
        p.demonSense = true;
        consume();
        this.log.push(`👁️ ${p.name} เริ่มรับรู้ตำแหน่งปีศาจ`);
        return { ok: true };
      }
      case 'shield': {
        p.shield = true;
        consume();
        this.log.push(`🛡️ ${p.name} ติดใบโล่`);
        return { ok: true };
      }
      case 'warp': {
        const k = payload.roomKey;
        if (!k || !(k in p.known)) return err('เลือกห้องที่เคยไปแล้ว');
        const { r, c } = parseKey(k);
        p.pos = { r, c };
        p.movesLeft -= 1;
        p.movedThisTurn = true;
        this.enterCell(p, this.cells[r][c]);
        consume();
        this.log.push(`🌀 ${p.name} ใช้ใบวาร์ป`);
        return { ok: true };
      }
      default:
        return err('ไอเทมไม่รู้จัก');
    }
  }

  // ห้องที่ผู้เล่นรู้ประตู (เข้าเอง หรือได้รับข้อมูลมา)
  knowsDoors(p, k) { return !!(p.visited?.[k] || p.doorKnown?.[k]); }

  // มอบข้อมูลห้อง: เลือกได้ว่าให้เลขห้อง และ/หรือ ประตู
  giveRoomInfo(from, to, cells, { numbers = true, doors = false } = {}) {
    let n = 0;
    for (const k of cells) {
      const { r, c } = parseKey(k);
      let got = false;
      let isNew = false; // นับเฉพาะข้อมูลที่อีกฝ่ายยังไม่รู้
      if (numbers && k in from.known) { if (!(k in to.known)) isNew = true; to.known[k] = from.known[k]; got = true; }
      if (doors && this.knowsDoors(from, k) && this.cells[r][c].type === 'room') { if (!this.knowsDoors(to, k)) isNew = true; to.doorKnown[k] = true; got = true; }
      if (got) { this.revealCellType(to, r, c); if (isNew) n++; }
    }
    return n;
  }

  // ตรวจว่าผู้ให้ "มี" ข้อมูลที่จะให้จริง
  validateRoomGive(from, cells, { numbers, doors }) {
    if (!Array.isArray(cells) || !cells.length) return 'เลือกห้องอย่างน้อย 1 ห้อง';
    if (!numbers && !doors) return 'เลือกว่าจะให้เลขห้อง หรือประตู (หรือทั้งคู่)';
    for (const k of cells) {
      if (typeof k !== 'string' || !/^\d+,\d+$/.test(k)) return 'ห้องไม่ถูกต้อง';
      if (numbers && !(k in from.known)) return 'คุณยังไม่รู้เลขของบางห้องที่เลือก';
      if (doors && !this.knowsDoors(from, k)) return 'คุณยังไม่รู้ประตูของบางห้องที่เลือก';
    }
    return null;
  }

  // ---------------- แชร์ / แลกข้อมูล (ผู้เล่นที่ยังมีชีวิต ตอนเจอกัน) ----------------
  checkMeetingPair(aId, bId) {
    const a = this.player(aId), b = this.player(bId);
    if (!a || !b || a.id === b.id) return { err: 'ไม่พบผู้เล่น' };
    const pend = this.pending;
    if (!pend || pend.type !== 'meeting' || !pend.participants.includes(a.id) || !pend.participants.includes(b.id)) {
      return { err: 'แชร์/แลกได้เฉพาะตอนเจอกันในห้องเดียวกัน' };
    }
    if (!a.alive || !b.alive) return { err: 'แชร์/แลกได้เฉพาะผู้เล่นที่ยังมีชีวิต (ผีใช้สัญญาแทน)' };
    return { a, b };
  }

  shareRooms(fromId, toId, cells, opts = {}) {
    const { a, b, err } = this.checkMeetingPair(fromId, toId);
    if (err) return { ok: false, msg: err };
    const o = { numbers: !!opts.numbers, doors: !!opts.doors };
    const bad = this.validateRoomGive(a, cells, o);
    if (bad) return { ok: false, msg: bad };
    const n = this.giveRoomInfo(a, b, cells, o);
    return { ok: true, count: n, fromName: a.name, toId: b.id };
  }

  tradeKey(aId, bId) { return [aId, bId].sort().join('|'); }

  setTradeOffer(fromId, toId, cells, opts = {}) {
    const { a, b, err } = this.checkMeetingPair(fromId, toId);
    if (err) return { ok: false, msg: err };
    const o = { numbers: !!opts.numbers, doors: !!opts.doors };
    const empty = !Array.isArray(cells) || !cells.length;
    if (!empty) {
      const bad = this.validateRoomGive(a, cells, o);
      if (bad) return { ok: false, msg: bad };
    }
    const key = this.tradeKey(a.id, b.id);
    const t = this.trades.get(key) || { offers: {}, confirmed: {} };
    if (empty) delete t.offers[a.id];
    else t.offers[a.id] = { cells: cells.slice(), ...o };
    t.confirmed = {}; // เปลี่ยนข้อเสนอ → ต้องยืนยันใหม่ทั้งคู่
    this.trades.set(key, t);
    return { ok: true };
  }

  confirmTrade(fromId, toId) {
    const { a, b, err } = this.checkMeetingPair(fromId, toId);
    if (err) return { ok: false, msg: err };
    const key = this.tradeKey(a.id, b.id);
    const t = this.trades.get(key);
    if (!t || !t.offers[a.id] || !t.offers[b.id]) return { ok: false, msg: 'ทั้งสองฝ่ายต้องเสนอห้องก่อน ถึงจะยืนยันแลกได้' };
    t.confirmed[a.id] = true;
    if (!t.confirmed[b.id]) return { ok: true, done: false };
    // ยืนยันทั้งคู่ → แลกพร้อมกัน
    const oa = t.offers[a.id], ob = t.offers[b.id];
    const badA = this.validateRoomGive(a, oa.cells, oa), badB = this.validateRoomGive(b, ob.cells, ob);
    if (badA || badB) { this.trades.delete(key); return { ok: false, msg: 'ข้อเสนอไม่ถูกต้องแล้ว ลองเสนอใหม่' }; }
    const nToB = this.giveRoomInfo(a, b, oa.cells, oa);
    const nToA = this.giveRoomInfo(b, a, ob.cells, ob);
    this.trades.delete(key);
    return { ok: true, done: true, a: a.id, b: b.id, nToA, nToB };
  }

  // อีกฝ่ายไม่อยากแลก → ล้างข้อเสนอทั้งสองฝั่ง
  rejectTrade(fromId, toId) {
    const { a, b, err } = this.checkMeetingPair(fromId, toId);
    if (err) return { ok: false, msg: err };
    const key = this.tradeKey(a.id, b.id);
    if (!this.trades.has(key)) return { ok: false, msg: 'ไม่มีข้อเสนอให้ปฏิเสธ' };
    this.trades.delete(key);
    return { ok: true, fromName: a.name, toId: b.id };
  }

  // สัญญาชุบที่ผู้เล่น p ยังต้องทำ (ผียังตายอยู่)
  owedRevives(p) {
    return this.contracts.filter((c) => c.status === 'accepted' && c.want === 'revive' && c.toId === p.id
      && !c.fulfilled && this.player(c.fromId) && !this.player(c.fromId).alive);
  }

  nearestRoom(r, c) {
    const seen = new Set([keyOf(r, c)]);
    const q = [{ r, c }];
    while (q.length) {
      const cur = q.shift();
      for (const d of ALL_DIRS) {
        const nr = cur.r + DIRS[d].dr, nc = cur.c + DIRS[d].dc;
        const k = keyOf(nr, nc);
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols || seen.has(k)) continue;
        if (this.cells[nr][nc].type === 'room') return { r: nr, c: nc };
        seen.add(k);
        q.push({ r: nr, c: nc });
      }
    }
    return null;
  }

  // ---------------- คำถาม / ชนะ ----------------
  answerQuestion(playerId, choice) {
    if (!this.pending || this.pending.type !== 'question') return { ok: false, msg: 'ไม่มีคำถามค้างอยู่' };
    if (this.pending.playerId !== playerId) return { ok: false, msg: 'ไม่ใช่ตาคุณ' };
    const q = this.pending.question;
    const cell = this.cells[parseKey(this.pending.cellKey).r][parseKey(this.pending.cellKey).c];
    this.pending = null;
    if (!q) { cell.event = null; return { ok: true, result: 'noquestion' }; }
    const correct = choice === q.answer;
    cell.event = null; // ใช้ครั้งเดียว → กลายเป็นห้องธรรมดา
    if (correct) {
      const item = weightedItem();
      const p = this.player(playerId);
      p.inventory.push(item);
      p.stats.questionsRight++;
      p.stats.itemsGot++;
      this.log.push(`✅ ${p.name} ตอบถูก ได้รับ ${ITEMS[item].icon} ${ITEMS[item].name}`);
      return { ok: true, result: 'correct', item };
    } else {
      this.player(playerId).stats.questionsWrong++;
      this.log.push(`❌ ${this.player(playerId).name} ตอบผิด ห้องคำถามกลายเป็นห้องธรรมดา`);
      return { ok: true, result: 'wrong' };
    }
  }

  submitWin(playerId, cells) {
    if (!this.pending || this.pending.type !== 'win') return { ok: false, msg: 'ไม่มีการยื่นคำตอบ' };
    if (this.pending.playerId !== playerId) return { ok: false, msg: 'ไม่ใช่ตาคุณ' };
    const p = this.player(playerId);
    const winKey = this.pending.cellKey || keyOf(p.pos.r, p.pos.c);

    // ตรวจว่าครบทุกช่อง
    const grid = {};
    for (const it of cells) grid[keyOf(it.r, it.c)] = it.value;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const k = keyOf(r, c);
        const truth = this.cells[r][c];
        const claim = grid[k];
        if (claim === undefined || claim === null || claim === '') return { ok: false, msg: 'ยังกรอกไม่ครบทุกช่อง' };
        if (truth.type === 'wall') {
          if (claim !== 'wall') return this.failWin(p, winKey);
        } else {
          if (claim === 'wall' || Number(claim) !== truth.number) return this.failWin(p, winKey);
        }
      }
    }

    // ถูกหมด → ชนะ
    p.stats.winAttempts++;
    this.pending = null;
    this.status = 'ended';
    const coWinners = [];
    for (const c of this.contracts) {
      if (c.status === 'accepted' && c.want === 'cowin' && c.toId === p.id) {
        const ghost = this.player(c.fromId);
        if (ghost) coWinners.push({ id: ghost.id, name: ghost.name });
      }
    }
    this.winner = { id: p.id, name: p.name, coWinners };
    this.log.push(`🏆 ${p.name} ตอบเลขทุกห้องถูกต้อง ชนะเกม!`);
    return { ok: true, won: true };
  }

  failWin(p, winKey) {
    p.stats.winAttempts++;
    const { r: wr, c: wc } = parseKey(winKey);
    const oldCell = this.cells[wr][wc];
    if (oldCell.event === 'win') oldCell.event = null;
    // ห้องชนะใหม่ต้องไม่ใช่ห้องเดิม
    const candidates = this.rooms.filter((rm) => !rm.event && rm !== oldCell);
    if (candidates.length) {
      const nr = pick(candidates);
      nr.event = 'win';
    }
    this.pending = null;
    this.log.push(`❌ ${p.name} ตอบเลขห้องผิด ห้องชนะถูกย้ายไปที่ใหม่!`);
    return { ok: true, won: false };
  }

  cancelWin(playerId) {
    if (!this.pending || this.pending.type !== 'win' || this.pending.playerId !== playerId) return { ok: false, msg: 'ไม่มีการยื่นคำตอบ' };
    this.pending = null;
    return { ok: true };
  }

  // ---------------- เจอกัน / แชท / สัญญา ----------------
  endMeeting(playerId) {
    if (!this.pending || this.pending.type !== 'meeting') return { ok: false, msg: 'ไม่มีเจอกันค้างอยู่' };
    if (!this.pending.participants.includes(playerId)) return { ok: false, msg: 'คุณไม่ได้อยู่ในการสนทนา' };
    this.pending = null;
    this.trades.clear(); // ข้อเสนอแลกที่ยังไม่ยืนยัน หมดอายุเมื่อจบการสนทนา
    return { ok: true };
  }

  chat(playerId, text) {
    const p = this.player(playerId);
    if (!p) return { ok: false };
    // เฉพาะใน lobby (server เป็นคนจัดการ) — ในเกมต้องอยู่ใน meeting
    if (this.pending && this.pending.type === 'meeting' && this.pending.participants.includes(playerId)) {
      return { ok: true, scope: 'meeting', participants: this.pending.participants };
    }
    return { ok: true, scope: 'game' };
  }

  proposeContract(fromId, toId, give, want) {
    const from = this.player(fromId);
    const to = this.player(toId);
    if (!from || !to) return { ok: false, msg: 'ไม่พบผู้เล่น' };
    if (from.alive) return { ok: false, msg: 'เฉพาะผีเท่านั้นที่เสนอสัญญาได้' };
    if (!to.alive) return { ok: false, msg: 'เป้าหมายต้องเป็นผู้เล่นที่ยังมีชีวิต' };
    if (from.pos.r !== to.pos.r || from.pos.c !== to.pos.c) return { ok: false, msg: 'ต้องอยู่ห้องเดียวกัน' };
    if (!['cowin', 'revive'].includes(want)) return { ok: false, msg: 'เงื่อนไขไม่ถูกต้อง' };
    if (!give || !['rooms', 'demon'].includes(give.type)) return { ok: false, msg: 'สิ่งที่ให้ไม่ถูกต้อง' };
    if (give.type === 'rooms') {
      // เลือกได้ว่าให้เลขห้อง และ/หรือ แผนที่ทางเดิน (ประตู) — ค่าเริ่มต้นคือให้เลขห้อง
      const opts = { numbers: give.numbers !== undefined ? !!give.numbers : true, doors: !!give.doors };
      const bad = this.validateRoomGive(from, give.cells, opts);
      if (bad) return { ok: false, msg: bad };
      give = { type: 'rooms', cells: give.cells.slice(), ...opts };
    }
    const contract = {
      id: randomUUID(), fromId, toId, give, want, status: 'pending',
      fromName: from.name, toName: to.name,
    };
    this.contracts.push(contract);
    return { ok: true, contract };
  }

  respondContract(contractId, playerId, accept) {
    const c = this.contracts.find((x) => x.id === contractId);
    if (!c) return { ok: false, msg: 'ไม่พบสัญญา' };
    if (c.toId !== playerId) return { ok: false, msg: 'ไม่ใช่สัญญาที่ส่งให้คุณ' };
    if (c.status !== 'pending') return { ok: false, msg: 'สัญญานี้ถูกตอบไปแล้ว' };
    c.status = accept ? 'accepted' : 'rejected';
    if (accept) {
      const to = this.player(c.toId);
      const from = this.player(c.fromId);
      if (c.give.type === 'rooms') {
        this.giveRoomInfo(from, to, c.give.cells, c.give);
      } else if (c.give.type === 'demon') {
        to.demonSense = true;
      }
    }
    return { ok: true, contract: c };
  }

  // ---------------- serialize ----------------
  serializeFor(playerId) {
    const me = this.player(playerId);
    if (!me) return null;
    const seesDemon = !me.alive || me.demonSense;
    return {
      type: 'state',
      gameId: this.id,
      status: this.status,
      round: this.round,
      rows: this.rows,
      cols: this.cols,
      currentPlayerId: this.currentPlayer()?.id || null,
      demonEvery: this.demonEvery,
      turnEndsIn: this.status === 'playing' && this.turnDeadline ? Math.max(0, this.turnDeadline - this.now()) : null,
      pending: this.pending ? {
        type: this.pending.type,
        playerId: this.pending.playerId,
        participants: this.pending.participants || null,
        question: this.pending.type === 'question' && this.pending.playerId === playerId
          ? { text: this.pending.question?.question, options: this.pending.question?.options }
          : null,
      } : null,
      me: {
        id: me.id, name: me.name, color: me.color, alive: me.alive,
        pos: me.pos, inventory: me.inventory.slice(),
        frozen: me.frozen, shield: me.shield, demonSense: me.demonSense,
        movesLeft: me.movesLeft,
        movedThisTurn: !!me.movedThisTurn,
        known: { ...me.known },
        // ประตูของห้องที่เคยเข้าไปเอง
        doors: Object.fromEntries([...new Set([...Object.keys(me.visited || {}), ...Object.keys(me.doorKnown || {})])].map((k) => {
          const { r, c } = parseKey(k);
          return [k, this.doorsOf(this.cells[r][c])];
        })),
        // รายชื่อคนที่ตาย — ส่งให้เฉพาะคนที่ถือใบชุบ
        reviveTargets: me.alive && me.inventory.includes('revive')
          ? this.players.filter((q) => !q.alive && q.id !== me.id).map((q) => ({
              id: q.id, name: q.name, owed: this.owedRevives(me).some((c) => c.fromId === q.id),
            }))
          : [],
        revealed: { ...me.revealed },
        validMoves: me.id === this.currentPlayer()?.id && !this.pending && me.movesLeft > 0
          ? (me.alive ? this.doorsOf(this.cells[me.pos.r][me.pos.c])
                      : ALL_DIRS.filter((d) => {
                          const nr = me.pos.r + DIRS[d].dr, nc = me.pos.c + DIRS[d].dc;
                          return nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols;
                        }))
          : [],
        isHost: me.isHost,
      },
      // ซ่อนสถานะตาย/มีชีวิตของคนอื่น — รู้ได้เฉพาะตอนเจอกัน (อยู่ในวงสนทนาเดียวกัน) หรือเกมจบแล้ว
      players: this.players.map((q) => {
        const meetingTogether = this.pending?.type === 'meeting'
          && this.pending.participants?.includes(me.id) && this.pending.participants.includes(q.id);
        const showAlive = q.id === me.id || this.status === 'ended' || meetingTogether;
        // ผีที่ยืนอยู่ในกำแพงจะฟ้องว่าตายแล้ว → ไม่ส่งตำแหน่ง
        const onWall = this.cells[q.pos.r][q.pos.c].type !== 'room';
        return {
          id: q.id, name: q.name, color: q.color,
          alive: showAlive ? q.alive : null,
          pos: q.id !== me.id && onWall && !showAlive ? null : q.pos,
          frozen: q.frozen, shield: q.shield,
          offline: !!q.disconnected, // หลุดอยู่ (ตาจะถูกข้ามจนกว่าจะกลับมา)
        };
      }),
      demon: seesDemon ? { r: this.demon.r, c: this.demon.c } : null,
      winner: this.winner,
      contracts: this.contracts
        .filter((c) => (c.fromId === playerId || c.toId === playerId) && c.status === 'accepted')
        .map((c) => ({
          id: c.id, fromName: c.fromName, toName: c.toName,
          give: c.give.type, want: c.want,
        })),
      log: this.log.slice(-40),
      summary: this.status === 'ended' ? this.buildSummary() : null,
      // ระบบเตือนกลาง: ปีศาจอยู่ใกล้ผู้เล่นบางคน (ไม่บอกว่าใคร)
      demonNear: this.status !== 'ended' && this.isDemonNear(),
      // ข้อเสนอแลกข้อมูลที่เกี่ยวกับฉัน (เห็นแค่จำนวนห้องและชนิดข้อมูลของอีกฝ่าย ไม่เห็นว่าห้องไหน)
      trades: [...this.trades.entries()].filter(([k]) => k.split('|').includes(me.id)).map(([k, t]) => {
        const other = k.split('|').find((id) => id !== me.id);
        const mine = t.offers[me.id], theirs = t.offers[other];
        return {
          with: other,
          mine: mine ? { cells: mine.cells, numbers: mine.numbers, doors: mine.doors } : null,
          theirs: theirs ? { count: theirs.cells.length, numbers: theirs.numbers, doors: theirs.doors } : null,
          myConfirmed: !!t.confirmed[me.id], theirConfirmed: !!t.confirmed[other],
        };
      }),
    };
  }

  // หน้าสรุปตอนจบเกม: สถิติทุกคน + เฉลยกระดานทั้งหมด
  buildSummary() {
    const w = this.winner || {};
    return {
      reason: w.demon ? 'demon' : 'win',
      rounds: this.round,
      totalRooms: this.rooms.length,
      players: this.players.map((q) => ({
        id: q.id, name: q.name, color: q.color, alive: q.alive, disconnected: !!q.left,
        isWinner: q.id === w.id,
        isCoWinner: !!w.coWinners?.some((c) => c.id === q.id),
        roomsVisited: Object.keys(q.visited || {}).length,
        roomsKnown: Object.keys(q.known).length,
        items: q.inventory.slice(),
        ...q.stats,
      })),
      contracts: this.contracts.filter((c) => c.status === 'accepted').map((c) => ({
        fromName: c.fromName, toName: c.toName, want: c.want, give: c.give.type,
        giveNumbers: !!c.give.numbers, giveDoors: !!c.give.doors, giveCount: c.give.cells?.length || 0,
        fulfilled: c.want === 'revive' ? !!c.fulfilled : null,
      })),
      board: this.cells.map((row) => row.map((c) => ({
        type: c.type, number: c.number, win: c.event === 'win', doors: this.doorsOf(c),
      }))),
      demon: { ...this.demon },
    };
  }
}

export { COLORS };
