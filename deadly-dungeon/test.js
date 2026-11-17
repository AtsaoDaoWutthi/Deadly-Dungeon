// Smoke test — ทดสอบ Game engine + WebSocket flow
import WebSocket from 'ws';
import { Game } from './server/game.js';
import { getQuestions } from './server/questions.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗ FAIL:', label); }
}

console.log('== 1) Game engine (board gen + invariants) ==');
const qs = getQuestions();
console.log('  questions loaded:', qs.length);

const players = [
  { id: 'p1', name: 'อาลิซ', color: '#ff5f92', isHost: true },
  { id: 'p2', name: 'บ๊อบ', color: '#4da3ff', isHost: false },
  { id: 'p3', name: 'ชาร์ลี', color: '#ffb020', isHost: false },
];
const g = new Game({ rows: 7, cols: 7, players, questionBank: qs });

// invariants
ok(g.rooms.length >= 10, `มีห้องทะลุได้เพียงพอ (${g.rooms.length} ห้อง)`);

// numbers unique 1-99
const nums = g.rooms.map((r) => r.number);
ok(new Set(nums).size === nums.length, 'เลขห้องไม่ซ้ำ');
ok(nums.every((n) => n >= 1 && n <= 99), 'เลขอยู่ 1–99');

// connectivity (BFS ผ่านประตู)
function connectedCount() {
  const seen = new Set();
  const q = [g.rooms[0]];
  seen.add(`${g.rooms[0].r},${g.rooms[0].c}`);
  while (q.length) {
    const cur = q.shift();
    for (const d of g.doorsOf(cur)) {
      const dr = d === 'n' ? -1 : d === 's' ? 1 : 0;
      const dc = d === 'e' ? 1 : d === 'w' ? -1 : 0;
      const nr = cur.r + dr, nc = cur.c + dc;
      const k = `${nr},${nc}`;
      if (seen.has(k)) continue;
      seen.add(k);
      q.push(g.cells[nr][nc]);
    }
  }
  return seen.size;
}
ok(connectedCount() === g.rooms.length, `ทุกห้องเชื่อมถึงกัน (${connectedCount()}/${g.rooms.length})`);

// spawns distinct + ไม่เป็นห้องอีเวนต์
const spawnKeys = g.players.map((p) => `${p.pos.r},${p.pos.c}`);
ok(new Set(spawnKeys).size === g.players.length, 'ห้องเกิดคนละห้อง');
const spawnEvents = g.players.map((p) => g.cells[p.pos.r][p.pos.c].event);
ok(spawnEvents.every((e) => e === null), 'ห้องเกิดไม่เป็นห้องอีเวนต์');

// มีห้องชนะ 1 ห้อง + ห้องคำถาม >=3
const winRooms = g.rooms.filter((r) => r.event === 'win');
const qRooms = g.rooms.filter((r) => r.event === 'question');
ok(winRooms.length === 1, 'มีห้องชนะ 1 ห้อง');
ok(qRooms.length >= 3, `มีห้องคำถาม >= 3 (${qRooms.length})`);

// ผู้เล่นรู้เลขห้องเกิดตัวเอง
ok(g.players.every((p) => g.cells[p.pos.r][p.pos.c].number === p.known[`${p.pos.r},${p.pos.c}`]), 'ผู้เล่นรู้เลขห้องเกิด');

// เดินถูกกฎ: หา door ที่ valid แล้ว move
const cur = g.currentPlayer();
const doors = g.doorsOf(g.cells[cur.pos.r][cur.pos.c]);
ok(doors.length >= 1, 'ผู้เล่นคนแรกมีทางเดิน');
const mv = g.move(cur.id, doors[0]);
ok(mv.ok, 'move ผ่าน');
const movedCell = g.cells[cur.pos.r][cur.pos.c];
ok(movedCell.number === cur.known[`${cur.pos.r},${cur.pos.c}`], 'หลังเดินรู้เลขห้องใหม่');

// end turn → คนถัดไป (ถ้าเดินไปเจอห้องคำถาม/ห้องชนะ/เจอกัน ต้องจบสถานการณ์นั้นก่อน ถึงจะจบตาได้)
g.pending = null;
g.endTurn(cur.id);
ok(g.currentPlayer().id === 'p2', 'เปลี่ยนเป็นตาคนถัดไป');

// submitWin ถูกต้อง → ชนะ
const correct = [];
for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
  const cell = g.cells[r][c];
  correct.push({ r, c, value: cell.type === 'wall' ? 'wall' : cell.number });
}
g.pending = { type: 'win', playerId: 'p2' };
const winRes = g.submitWin('p2', correct);
ok(winRes.ok && winRes.won === true, 'submitWin ถูกต้อง → ชนะ');
ok(g.status === 'ended' && g.winner.id === 'p2', 'สถานะ ended + ผู้ชนะถูกต้อง');

// submitWin ผิด → ย้ายห้องชนะ
const g2 = new Game({ rows: 6, cols: 6, players: [{ id: 'x', name: 'X', color: '#fff', isHost: true }, { id: 'y', name: 'Y', color: '#fff', isHost: false }], questionBank: qs });
const wrong = correct.map((c) => ({ ...c, value: c.value === 'wall' ? 7 : 'wall' }));
const beforeWin = g2.rooms.find((r) => r.event === 'win');
const winKey = `${beforeWin.r},${beforeWin.c}`;
g2.pending = { type: 'win', playerId: g2.currentPlayer().id, cellKey: winKey };
const failRes = g2.submitWin(g2.currentPlayer().id, wrong);
ok(failRes.ok && failRes.won === false, 'submitWin ผิด → ไม่ชนะ');
ok(beforeWin.event === null && g2.rooms.some((r) => r.event === 'win' && `${r.r},${r.c}` !== winKey), 'ห้องชนะถูกย้ายไปที่ใหม่');

console.log('== 2) WebSocket lobby/start/move flow ==');
function client() {
  const ws = new WebSocket('ws://localhost:3799/ws');
  const queue = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const w = waiters.findIndex((x) => x.type === m.type);
    if (w >= 0) { waiters.splice(w, 1)[0].resolve(m); }
    else queue.push(m);
  });
  const next = (type, timeout = 8000) => {
    const i = queue.findIndex((m) => m.type === type);
    if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout ' + type)), timeout);
      waiters.push({ type, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  };
  const send = (o) => ws.send(JSON.stringify(o));
  return new Promise((resolve) => ws.on('open', () => resolve({ ws, next, send })));
}

try {
  const A = await client();
  const B = await client();

  A.send({ type: 'create_room', name: 'อาลิซ', size: 6, key: 'secret' });
  const joinedA = await A.next('joined');
  const code = joinedA.code;
  ok(!!code && joinedA.key === 'secret', `create_room ได้รหัส ${code}`);

  B.send({ type: 'join_room', name: 'บ๊อบ', code, key: 'secret' });
  const joinedB = await B.next('joined');
  ok(joinedB.playerId !== joinedA.playerId, 'join_room สำเร็จ');

  await A.next('lobby');
  const lobbyB = await B.next('lobby');
  ok(lobbyB.players.length === 2, 'lobby มี 2 คน');

  // join ผิดคีย์
  const C = await client();
  C.send({ type: 'join_room', name: 'ชาร์ลี', code, key: 'WRONG' });
  const errC = await C.next('error');
  ok(errC.message.includes('คีย์'), 'join ผิดคีย์ถูกปฏิเสธ');

  A.send({ type: 'start_game' });
  const stA = await A.next('state');
  const stB = await B.next('state');
  ok(stA.status === 'playing' && stA.rows === 6, 'เริ่มเกมได้ board 6x6');
  ok(stA.currentPlayerId === joinedA.playerId, 'โฮสต์ได้เดินก่อน');

  // โฮสต์เดิน + จบตา
  const dir = stA.me.validMoves[0];
  ok(!!dir, 'โฮสต์มีทิศทางเดิน');
  A.send({ type: 'move', dir });
  const mvState = await A.next('state');
  // ถ้าเดินไปเจอห้องคำถาม/ห้องชนะ ต้องจบสถานการณ์นั้นก่อน ถึงจะจบตาได้
  if (mvState.pending?.type === 'question') { A.send({ type: 'answer_question', choice: 0 }); await A.next('state'); }
  else if (mvState.pending?.type === 'win') { A.send({ type: 'cancel_win' }); await A.next('state'); }
  else if (mvState.pending?.type === 'meeting') { A.send({ type: 'end_meeting' }); await A.next('state'); }
  A.send({ type: 'end_turn' });
  const stAfter = await A.next('state');
  ok(stAfter.currentPlayerId === joinedB.playerId, 'ตาต่อไปเป็นบ๊อบ');

  console.log('\nผลลัพธ์: pass=' + pass + ' fail=' + fail);
  A.ws.close(); B.ws.close(); C.ws.close();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('WS test error:', e.message);
  process.exit(2);
}
