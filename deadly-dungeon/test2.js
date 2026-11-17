// Test 2 — ไอเทม, ปีศาจ, ผี/เจอกัน, สัญญา, คำถาม
import { Game } from './server/game.js';
import { getQuestions } from './server/questions.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗ FAIL:', label); }
}
const qs = getQuestions();
const mk = () => new Game({
  rows: 6, cols: 6,
  players: [
    { id: 'p1', name: 'อาลิซ', color: '#f00', isHost: true },
    { id: 'p2', name: 'บ๊อบ', color: '#0f0', isHost: false },
    { id: 'p3', name: 'ชาร์ลี', color: '#00f', isHost: false },
  ],
  questionBank: qs,
});

console.log('== ไอเทม ==');
{
  const g = mk();
  const p1 = g.player('p1'), p2 = g.player('p2');
  // revive
  p2.alive = false;
  p1.inventory.push('revive');
  let r = g.useItem('p1', 'revive', { targetId: 'p2' });
  ok(r.ok && p2.alive === true && !p1.inventory.includes('revive'), 'ใบชุบชุบผู้ตาย');
  // dash
  p1.inventory.push('dash');
  const before = p1.movesLeft;
  r = g.useItem('p1', 'dash');
  ok(r.ok && p1.movesLeft >= before + 2 && p1.movesLeft <= before + 4, 'ใบเร่ง +2..4');
  // reveal_number
  p1.inventory.push('reveal_number');
  const knownBefore = Object.keys(p1.known).length;
  r = g.useItem('p1', 'reveal_number');
  ok(r.ok && Object.keys(p1.known).length === knownBefore + 1, 'ใบส่องเลข +1 ห้อง');
  // reveal_wall
  p1.inventory.push('reveal_wall');
  r = g.useItem('p1', 'reveal_wall');
  ok(r.ok, 'ใบส่องกำแพงใช้ได้');
  // freeze
  p1.inventory.push('freeze');
  r = g.useItem('p1', 'freeze', { targetId: 'p2' });
  ok(r.ok && p2.frozen === true, 'ใบแช่แข็ง');
  // banish_demon
  const demonBefore = { ...g.demon };
  p1.inventory.push('banish_demon');
  r = g.useItem('p1', 'banish_demon');
  ok(r.ok, 'ใบย้ายปีศาจใช้ได้');
  // demon_sense
  p1.inventory.push('demon_sense');
  r = g.useItem('p1', 'demon_sense');
  ok(r.ok && p1.demonSense === true, 'ใบรับรู้ปีศาจ');
  // shield
  p1.inventory.push('shield');
  r = g.useItem('p1', 'shield');
  ok(r.ok && p1.shield === true, 'ใบโล่');
  // warp
  p1.inventory.push('warp');
  const otherRoom = Object.keys(p1.known).find((k) => k !== `${p1.pos.r},${p1.pos.c}`);
  if (otherRoom) {
    r = g.useItem('p1', 'warp', { roomKey: otherRoom });
    ok(r.ok, 'ใบวาร์ป');
  } else ok(true, 'ใบวาร์ป (ไม่มีห้องอื่นให้วาร์ป, ข้าม)');
  // ผีใช้ไอเทมไม่ได้
  const p3 = g.player('p3');
  p3.alive = false;
  p3.inventory.push('dash');
  r = g.useItem('p3', 'dash');
  ok(!r.ok, 'ผีใช้ไอเทมไม่ได้');
}

console.log('== ปีศาจ ==');
{
  const delta = { n: [-1, 0], s: [1, 0], e: [0, 1], w: [0, -1] };
  // ผู้เล่นเดินไปชนปีศาจ → ตาย
  const g = mk();
  const p1 = g.player('p1');
  const d = g.doorsOf(g.cells[p1.pos.r][p1.pos.c])[0];
  const tr = p1.pos.r + delta[d][0], tc = p1.pos.c + delta[d][1];
  g.demon = { r: tr, c: tc };
  const r = g.move('p1', d);
  ok(r.ok && p1.alive === false, 'ผู้เล่นเดินไปชนปีศาจ → ตาย');

  // ปีศาจเดินไปหาผู้เล่น (leaf room ที่มีทางเดียว)
  const g2 = mk();
  const leaf = g2.rooms.find((rm) => g2.doorsOf(rm).length === 1);
  if (leaf) {
    const dd = g2.doorsOf(leaf)[0];
    const nr = leaf.r + delta[dd][0], nc = leaf.c + delta[dd][1];
    const q1 = g2.player('p1');
    q1.pos = { r: nr, c: nc };
    g2.demon = { r: leaf.r, c: leaf.c };
    g2.moveDemon();
    ok(q1.alive === false, 'ปีศาจเดินไปหาผู้เล่น → ตาย');
  } else ok(true, 'ไม่มี leaf room (ข้าม)');

  // โล่กันตาย
  const g3 = mk();
  const p3 = g3.player('p1');
  p3.shield = true;
  const d3 = g3.doorsOf(g3.cells[p3.pos.r][p3.pos.c])[0];
  const tr3 = p3.pos.r + delta[d3][0], tc3 = p3.pos.c + delta[d3][1];
  g3.demon = { r: tr3, c: tc3 };
  g3.move('p1', d3);
  ok(p3.alive === true && p3.shield === false, 'ใบโล่กันปีศาจได้ครั้งเดียว');
}

console.log('== ผีเดินทะลุกำแพง + เจอกัน ==');
{
  const g = mk();
  const p1 = g.player('p1');
  p1.alive = false;
  // หาทิศในขอบแมพที่ไปช่องกำแพง
  const delta = { n: [-1, 0], s: [1, 0], e: [0, 1], w: [0, -1] };
  let wallDir = null;
  for (const d of ['n', 's', 'e', 'w']) {
    const nr = p1.pos.r + delta[d][0], nc = p1.pos.c + delta[d][1];
    if (nr >= 0 && nr < g.rows && nc >= 0 && nc < g.cols && g.cells[nr][nc].type === 'wall') { wallDir = d; break; }
  }
  if (wallDir) {
    const r = g.move('p1', wallDir);
    ok(r.ok && g.cells[p1.pos.r][p1.pos.c].type === 'wall', 'ผีเดินเข้าไปในกำแพงได้');
  } else {
    console.log('  - ไม่มีกำแพงติดห้องเกิด (ข้ามการทดสอบผีทะลุกำแพง)');
  }

  // เจอกัน: วาง p2 ไว้ห้องติดกัน แล้ว p1 (ยังเป็นผี) เดินไป
  const p2 = g.player('p2');
  const dirs = ['n', 's', 'e', 'w'];
  let meetDir = null;
  for (const d of dirs) {
    const nr = p1.pos.r + delta[d][0], nc = p1.pos.c + delta[d][1];
    if (nr >= 0 && nr < g.rows && nc >= 0 && nc < g.cols) { p2.pos = { r: nr, c: nc }; meetDir = d; break; }
  }
  p1.movesLeft = 1;
  if (meetDir) {
    const r = g.move('p1', meetDir);
    ok(r.ok && g.pending?.type === 'meeting' && g.pending.participants.includes('p1') && g.pending.participants.includes('p2'), 'เดินไปเจอกัน → เปิด meeting');
    const er = g.endMeeting('p1');
    ok(er.ok && g.pending === null, 'จบการสนทนา');
  }
}

console.log('== สัญญาผี ==');
{
  const g = mk();
  const p1 = g.player('p1'), p2 = g.player('p2');
  p2.alive = false; // p2 เป็นผี
  p1.pos = { r: p2.pos.r, c: p2.pos.c }; // อยู่ห้องเดียวกัน
  const rooms = Object.keys(p2.known);
  const res = g.proposeContract('p2', 'p1', { type: 'rooms', cells: rooms }, 'cowin');
  ok(res.ok && res.contract.status === 'pending', 'ผีเสนอสัญญาได้');
  const knownBefore = Object.keys(p1.known).length;
  const res2 = g.respondContract(res.contract.id, 'p1', true);
  ok(res2.ok && res2.contract.status === 'accepted', 'ผู้เล่นตกลงสัญญา');
  ok(Object.keys(p1.known).length === knownBefore + rooms.length, 'ข้อมูลเลขห้องถูกส่งให้ผู้เล่น');
  // ชนะร่วม
  const correct = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const cell = g.cells[r][c];
    correct.push({ r, c, value: cell.type === 'wall' ? 'wall' : cell.number });
  }
  const wc = g.rooms.find((x) => x.event === 'win');
  g.pending = { type: 'win', playerId: 'p1', cellKey: `${wc.r},${wc.c}` };
  g.submitWin('p1', correct);
  ok(g.winner?.coWinners?.some((c) => c.id === 'p2'), 'ผีที่ทำสัญญา "ชนะร่วม" ได้ชนะร่วม');
}

console.log('== ห้องคำถาม ==');
{
  const g = mk();
  const p1 = g.player('p1');
  const qcell = g.rooms.find((x) => x.event === 'question');
  const invBefore = p1.inventory.length;
  g.pending = { type: 'question', playerId: 'p1', cellKey: `${qcell.r},${qcell.c}`, question: qcell.question };
  const r = g.answerQuestion('p1', qcell.question.answer);
  ok(r.ok && r.result === 'correct' && p1.inventory.length === invBefore + 1 && qcell.event === null, 'ตอบถูกได้ไอเทม + ห้องกลายเป็นธรรมดา');
  // ตอบผิด
  const g2 = mk();
  const q2 = g2.player('p1');
  const qcell2 = g2.rooms.find((x) => x.event === 'question');
  g2.pending = { type: 'question', playerId: 'p1', cellKey: `${qcell2.r},${qcell2.c}`, question: qcell2.question };
  const wrong = (qcell2.question.answer + 1) % 4;
  const r2 = g2.answerQuestion('p1', wrong);
  ok(r2.ok && r2.result === 'wrong' && qcell2.event === null, 'ตอบผิด ห้องกลายเป็นธรรมดา (ไม่มีไอเทม)');
}

console.log('\nผลลัพธ์: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
