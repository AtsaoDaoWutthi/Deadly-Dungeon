// Deadly Dungeon — client
'use strict';

const ITEM_META = {
  revive:        { name: 'ใบชุบ',       icon: '🌿', desc: 'ชุบผู้เล่นที่ตายแล้ว 1 คนกลับมามีชีวิต (ใช้ก่อนเริ่มเดินในตานั้น)' },
  dash:          { name: 'ใบเร่ง',       icon: '💨', desc: 'เดินเพิ่ม 2–4 ช่องในตานี้' },
  reveal_number: { name: 'ใบส่องเลข',   icon: '🔢', desc: 'เปิดเผยเลข + ตำแหน่งห้องที่ยังไม่รู้' },
  reveal_wall:   { name: 'ใบส่องกำแพง', icon: '🧱', desc: 'เปิดเผยตำแหน่งห้องตันที่ยังไม่รู้' },
  freeze:        { name: 'ใบแช่แข็ง',   icon: '❄️', desc: 'เลือกผู้เล่น 1 คนให้หยุดเดิน 1 ตา' },
  banish_demon:  { name: 'ใบย้ายปีศาจ', icon: '😈', desc: 'ย้ายปีศาจไปห้องสุ่ม' },
  demon_sense:   { name: 'ใบรับรู้ปีศาจ', icon: '👁️', desc: 'เห็นตำแหน่งปีศาจตลอดเกม' },
  shield:        { name: 'ใบโล่',       icon: '🛡️', desc: 'กันปีศาจฆ่าได้ 1 ครั้ง' },
  warp:          { name: 'ใบวาร์ป',     icon: '🌀', desc: 'วาร์ปไปห้องที่เคยไปแล้ว' },
};

const S = {
  ws: null,
  playerId: null,
  code: null,
  key: null,
  screen: 'lobby',
  lobby: null,
  state: null,
  chat: { lobby: [], meeting: [] },
  contractProposals: [],
  targetFor: null,       // { item } waiting for target
  contractDraft: null,   // { to, giveRooms: Set } ghost contract draft
  connected: false,
  showHelp: false,       // หน้าต่างวิธีเล่น
  share: null,
  noteMode: false,       // โหมดจดบนกระดาน
  noteCell: null,        // ช่องที่กำลังจด
  deadline: null,        // เวลาสิ้นสุดตาปัจจุบัน (ms ของเครื่องนี้)           // ร่างการแชร์/แลก/สัญญา ตอนเจอกัน { to, cells:Set, numbers, doors } — เก็บไว้ไม่ให้หายตอนจอรีเฟรช
};

const $ = (id) => document.getElementById(id);

// ---- เก็บข้อมูลในเบราว์เซอร์ (ใส่ try เผื่อเบราว์เซอร์ปิด storage) ----
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const loadSession = () => store.get('dd-session');
const saveSession = (s) => store.set('dd-session', s);
const clearSession = () => store.del('dd-session');

// ---- สมุดจดส่วนตัว (เก็บในเครื่องนี้เท่านั้น แยกตามเกม+ผู้เล่น) ----
const notesKey = () => `dd-notes:${S.state?.gameId}:${S.playerId}`;
function loadNotes() { const n = store.get(notesKey()) || {}; return { cells: n.cells || {}, text: n.text || '' }; }
function saveNotes(n) { store.set(notesKey(), n); }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3200);
}

// ---------------- WebSocket ----------------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  S.ws = new WebSocket(`${proto}://${location.host}/ws`);
  S.ws.onopen = () => {
    S.connected = true;
    // กลับเข้าเกมเดิม (รีเฟรช/เน็ตหลุด) ด้วยข้อมูลที่เบราว์เซอร์จำไว้
    const sess = loadSession();
    if (sess) send({ type: 'rejoin', code: sess.code, playerId: sess.playerId, token: sess.token });
  };
  S.ws.onclose = () => {
    S.connected = false;
    toast('การเชื่อมต่อขาดหาย กำลังเชื่อมใหม่…', true);
    setTimeout(connect, 1500);
  };
  S.ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  };
}
function send(obj) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj));
}

function handle(msg) {
  switch (msg.type) {
    case 'joined':
      S.playerId = msg.playerId;
      S.code = msg.code;
      S.key = msg.key;
      saveSession({ code: msg.code, playerId: msg.playerId, token: msg.token });
      if (msg.rejoined) toast('กลับเข้าเกมแล้ว');
      break;
    case 'rejoin_failed':
      clearSession();
      break;
    case 'lobby':
      S.lobby = msg;
      S.screen = 'lobby';
      render();
      break;
    case 'state':
      S.state = msg;
      S.deadline = msg.turnEndsIn != null ? Date.now() + msg.turnEndsIn : null;
      S.screen = 'game';
      if (msg.status === 'ended' && msg.winner) {
        // เกมจบ
      }
      render();
      break;
    case 'chat': {
      const scope = (S.screen === 'game' && S.state?.pending?.type === 'meeting') ? 'meeting' : 'lobby';
      S.chat[scope].push(msg);
      // อัปเดตเฉพาะกล่องข้อความ ไม่วาดทั้งหน้าใหม่ → ข้อความที่กำลังพิมพ์ไม่หาย
      const box = document.querySelector(`.msgs[data-chat="${scope}"]`);
      if (box) { box.innerHTML = chatMsgsHtml(scope); box.scrollTop = box.scrollHeight; }
      else render();
      break;
    }
    case 'contract_proposal':
      S.contractProposals.push(msg);
      render();
      break;
    case 'error':
      toast(msg.message, true);
      break;
    case 'notice':
      toast(msg.message);
      break;
  }
}

// ---------------- Render ----------------
function render() {
  // เปลี่ยนหน้า (ห้องรอ ↔ เกม) → เลื่อนกลับบนสุด ไม่ให้ค้างตำแหน่งเลื่อนจากหน้าก่อน (สำคัญบนมือถือ)
  const screen = S.screen === 'game' && S.state ? 'game' : 'lobby';
  if (S.lastScreen && S.lastScreen !== screen) window.scrollTo(0, 0);
  S.lastScreen = screen;
  keepChatState(() => {
    if (S.screen === 'game' && S.state) renderGame();
    else renderLobby();
    renderModalInner();
  });
}

function renderModal() { keepChatState(renderModalInner); }

// ก่อนวาดจอใหม่: จำข้อความที่พิมพ์ค้าง / เคอร์เซอร์ / ตำแหน่งเลื่อนของแชท แล้วคืนให้หลังวาดเสร็จ
function keepChatState(draw) {
  const drafts = {}, scrolls = {};
  document.querySelectorAll('form[data-form=chat][data-scope] input').forEach((i) => { drafts[i.form.dataset.scope] = i.value; });
  document.querySelectorAll('.msgs[data-chat]').forEach((m) => {
    scrolls[m.dataset.chat] = { atBottom: m.scrollHeight - m.scrollTop - m.clientHeight < 24, top: m.scrollTop };
  });
  const a = document.activeElement;
  const keep = a && a.dataset?.keep ? { id: a.dataset.keep, start: a.selectionStart, end: a.selectionEnd, scroll: a.scrollTop } : null;
  const focus = a && a.matches?.('form[data-form=chat][data-scope] input')
    ? { scope: a.form.dataset.scope, start: a.selectionStart, end: a.selectionEnd } : null;

  draw();

  for (const [scope, v] of Object.entries(drafts)) {
    const i = document.querySelector(`form[data-form=chat][data-scope="${scope}"] input`);
    if (i && !i.value && v) i.value = v;
  }
  document.querySelectorAll('.msgs[data-chat]').forEach((m) => {
    const prev = scrolls[m.dataset.chat];
    m.scrollTop = !prev || prev.atBottom ? m.scrollHeight : prev.top; // อยู่ล่างสุด → ตามข้อความใหม่, เลื่อนขึ้นอ่าน → อยู่ที่เดิม
  });
  if (keep) {
    const i = document.querySelector(`[data-keep="${keep.id}"]`);
    if (i) { i.focus(); try { i.setSelectionRange(keep.start, keep.end); } catch {} i.scrollTop = keep.scroll; }
  }
  if (focus) {
    const i = document.querySelector(`form[data-form=chat][data-scope="${focus.scope}"] input`);
    if (i) { i.focus(); try { i.setSelectionRange(focus.start, focus.end); } catch {} }
  }
}

function chatMsgsHtml(scope) {
  const msgs = (S.chat[scope] || []).slice(-60).map((m) => `
    <div class="m${m.from === S.playerId ? ' mine' : ''}"><span class="who">${esc(m.fromName)}:</span> ${esc(m.text)}</div>`).join('');
  return msgs || `<div class="m sys">${scope === 'meeting' ? 'เริ่มสนทนา…' : 'ยังไม่มีข้อความ'}</div>`;
}

function renderLobby() {
  const app = $('app');
  const me = S.lobby?.players.find((p) => p.id === S.playerId);
  const inRoom = !!S.lobby && !!me;
  app.innerHTML = `
    <div class="lobby">
      <div class="brand">
        <div class="logo">🏰</div>
        <h1>Deadly Dungeon</h1>
        <p>เกมกระดานสุดอันตราย — เล่นหลายคนผ่านเว็บ</p>
        <button class="btn help-btn" data-action="open_help">📖 วิธีเล่น</button>
      </div>
      ${inRoom ? renderLobbyRoom(me) : renderLobbyForms()}
    </div>`;
}

function renderLobbyForms() {
  return `
    <div class="card">
      <h2>🎮 สร้างห้อง</h2>
      <form data-form="create">
        <div class="field"><label>ชื่อของคุณ</label><input name="name" maxlength="16" placeholder="เช่น นักผจญภัย" required /></div>
        <div class="row">
          <div class="field"><label>ขนาดกระดาน</label>
            <select name="size">
              <option value="6">6 × 6</option>
              <option value="7" selected>7 × 7</option>
              <option value="8">8 × 8</option>
            </select>
          </div>
          <div class="field"><label>คีย์ห้อง (รหัสลับ)</label><input name="key" maxlength="32" placeholder="ตั้งรหัสลับ" /></div>
        </div>
        <div class="field"><label>ความเร็วปีศาจ</label>
          <select name="demonEvery">
            <option value="1">เดินทุกรอบ (ยาก)</option>
            <option value="2" selected>เดินทุก 2 รอบ (ปกติ)</option>
            <option value="3">เดินทุก 3 รอบ (ง่าย)</option>
          </select>
        </div>
        <button class="btn primary" style="width:100%">สร้างห้อง</button>
      </form>
    </div>
    <div class="card">
      <h2>🔑 เข้าร่วมห้อง</h2>
      <form data-form="join">
        <div class="field"><label>ชื่อของคุณ</label><input name="name" maxlength="16" placeholder="เช่น นักผจญภัย" required /></div>
        <div class="row">
          <div class="field"><label>รหัสห้อง</label><input name="code" maxlength="6" placeholder="ABC123" required /></div>
          <div class="field"><label>คีย์ห้อง</label><input name="key" maxlength="32" placeholder="รหัสลับ" /></div>
        </div>
        <button class="btn" style="width:100%">เข้าร่วม</button>
      </form>
    </div>`;
}

function renderLobbyRoom(me) {
  const pls = S.lobby.players.map((p) => `
    <span class="pl-chip"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.isHost ? ' 👑' : ''}${p.id === S.playerId ? ' (คุณ)' : ''}</span>`).join('');
  return `
    <div class="card">
      <h2>📡 ห้องของคุณ</h2>
      <div class="code-line">${esc(S.code)}</div>
      <div class="hint">รหัสห้อง <b>${esc(S.code)}</b> · คีย์ห้อง <b>${esc(S.key || '—')}</b> — ส่งให้เพื่อนเพื่อเข้าร่วม</div>
      <div class="hint">ขนาด ${S.lobby.size}×${S.lobby.size} · 👹 ปีศาจเดินทุก ${S.lobby.demonEvery || 1} รอบ · ⏱️ ตาละ 120 วินาที</div>
      <div class="player-list">${pls}</div>
      <div class="mt">
        ${me.isHost
          ? `<button class="btn gold" data-action="start_game" ${S.lobby.players.length < 2 ? 'disabled' : ''}>เริ่มเกม (${S.lobby.players.length}/6 คน)</button>`
          : `<div class="hint">รอโฮสต์เริ่มเกม…</div>`}
      </div>
      ${chatPanel('lobby')}
    </div>`;
}

function chatPanel(scope) {
  return `
    <div class="chat" style="margin-top:14px">
      <h3 style="margin-bottom:6px">💬 แชทห้อง</h3>
      <div class="msgs" data-chat="${scope}">${chatMsgsHtml(scope)}</div>
      <form class="chat-input" data-form="chat" data-scope="${scope}">
        <input name="text" maxlength="500" placeholder="พิมพ์ข้อความ…" autocomplete="off" />
        <button class="btn" type="submit">ส่ง</button>
      </form>
    </div>`;
}

// ---------------- Game ----------------
function renderGame() {
  const st = S.state;
  const me = st.me;
  const app = $('app');
  const isMyTurn = st.currentPlayerId === me.id;

  app.innerHTML = `
    <div class="game">
      <div class="board-wrap"><div class="board${S.noteMode ? ' note-mode' : ''}" id="board" style="grid-template-columns:repeat(${st.cols},1fr);width:min(84vmin,660px)">${boardCells(st)}</div></div>
      <div class="sidebar">
        <div class="side-top">
          <span class="side-title">Deadly Dungeon</span>
          <button class="btn help-btn small" data-action="open_help" title="วิธีเล่น">? วิธีเล่น</button>
        </div>
        ${turnBanner(st)}
        ${st.demonNear ? '<div class="demon-alert">⚠️ ปีศาจอยู่ใกล้ผู้เล่นบางคน (ในระยะ 1 ช่องรอบตัว) — ระวังตัว!</div>' : ''}
        ${meStatus(st)}
        ${playersPanel(st)}
        ${inventoryPanel(st)}
        ${notesPanel(st)}
        ${legendPanel(st)}
        ${logPanel(st)}
        ${meetingChatInline(st)}
      </div>
    </div>`;
}

function boardCells(st) {
  const me = st.me;
  const notes = loadNotes();
  const myKey = (r, c) => `${r},${c}`;
  const playersAt = {};
  for (const p of st.players) {
    if (!p.pos) continue; // ตำแหน่งที่ server ซ่อนไว้
    const k = myKey(p.pos.r, p.pos.c);
    (playersAt[k] = playersAt[k] || []).push(p);
  }
  const demonKey = st.demon ? myKey(st.demon.r, st.demon.c) : null;

  let html = '';
  for (let r = 0; r < st.rows; r++) {
    for (let c = 0; c < st.cols; c++) {
      const k = myKey(r, c);
      const knownNum = me.known[k];
      const revealed = me.revealed[k];
      let cls = 'cell fog', inner = '';
      const note = notes.cells[k];
      if (knownNum != null) { cls = 'cell room'; inner = `<span class="num">${knownNum}</span>`; }
      else if (revealed === 'room') { cls = 'cell room unknown'; inner = note && note !== 'w' ? '' : '<span class="num">?</span>'; }
      // ช่องที่ยังไม่รู้ → แสดงสิ่งที่จดเดาไว้ (คนละแบบกับเลขจริง)
      const noteable = knownNum == null;
      if (noteable && note) inner += `<span class="note${note === 'w' ? ' w' : ''}" title="ที่คุณจดไว้">${note === 'w' ? 'w?' : esc(note)}</span>`;
      if (noteable) cls += ' noteable';

      // เป้าหมายเดินได้
      if (isMovable(st, r, c)) {
        cls += ' move-target';
      }
      if (me.pos.r === r && me.pos.c === c) cls += ' me';

      // ประตูที่เปิดของห้องที่เคยเข้าไปเอง (แสดงเฉพาะทางที่เปิด ทางปิดไม่แสดง)
      const doors = me.doors?.[k];
      if (doors) {
        for (const d of ['n', 's', 'e', 'w']) {
          if (doors.includes(d)) inner += `<i class="door d-${d}"></i>`;
        }
      }

      // tokens
      const here = playersAt[k] || [];
      let tokens = '';
      for (const p of here) {
        if (p.id === me.id) {
          tokens += `<span class="token me" style="background:${p.color}">${p.alive ? '😎' : '👻'}</span>`;
        } else if (revealed || knownNum != null) {
          // สถานะคนอื่นถูกซ่อน (alive = null) → แสดงเหมือนคนปกติ; รู้ว่าเป็นผีเฉพาะตอนเจอกัน
          const ghost = p.alive === false;
          tokens += `<span class="token other ${ghost ? 'ghost-token dead' : ''}" style="background:${ghost ? 'rgba(148,163,184,.6)' : p.color}" title="${esc(p.name)}">${ghost ? '👻' : esc(p.name[0])}</span>`;
        }
      }
      if (demonKey === k) {
        tokens += `<span class="token other demon-token" style="background:#7f1d1d" title="ปีศาจ">👹</span>`;
      }

      const act = isMovable(st, r, c) ? ` data-action="move" data-dir="${dirTo(st, r, c)}"` : '';
      html += `<div class="${cls}"${act} data-key="${k}">${inner}${tokens}</div>`;
    }
  }
  return html;
}

function dirTo(st, r, c) {
  const me = st.me;
  const dr = r - me.pos.r, dc = c - me.pos.c;
  // ต้องเป็นช่องที่ติดกันเท่านั้น (บน/ล่าง/ซ้าย/ขวา)
  if (Math.abs(dr) + Math.abs(dc) !== 1) return '';
  if (dr === -1) return 'n';
  if (dr === 1) return 's';
  if (dc === 1) return 'e';
  if (dc === -1) return 'w';
  return '';
}

function isMovable(st, r, c) {
  const me = st.me;
  if (st.currentPlayerId !== me.id || st.pending || me.movesLeft <= 0) return false;
  const d = dirTo(st, r, c);
  return !!d && me.validMoves.includes(d);
}

function turnBanner(st) {
  const me = st.me;
  const cur = st.players.find((p) => p.id === st.currentPlayerId);
  const isMine = st.currentPlayerId === me.id;
  let txt;
  if (st.pending?.type === 'question') txt = `❓ ${esc(cur?.name)} กำลังตอบคำถาม…`;
  else if (st.pending?.type === 'win') txt = `🏆 ${esc(cur?.name)} กำลังยื่นคำตอบ…`;
  else if (st.pending?.type === 'meeting') txt = `💬 กำลังสนทนากัน…`;
  else if (isMine) txt = `ตาของคุณ (รอบ ${st.round})`;
  else txt = `รอ ${esc(cur?.name)} เดิน… (รอบ ${st.round})`;
  return `<div class="turn-banner ${isMine && !st.pending ? 'mine' : ''}">
    <div class="tb-main">${txt}${st.status === 'playing' ? '<span class="tb-timer" data-timer></span>' : ''}</div>
    <div class="tb-hint">${nextStepHint(st)}</div>
  </div>`;
}

// ข้อความ "ตอนนี้ต้องทำอะไร" ให้ผู้เล่นอ่านแล้วรู้ทันที
function nextStepHint(st) {
  const me = st.me;
  const pend = st.pending;
  const cur = st.players.find((p) => p.id === st.currentPlayerId);
  const curName = esc(cur?.name || '');
  if (st.status === 'ended') return 'เกมจบแล้ว';
  if (pend?.type === 'question') {
    return pend.playerId === me.id ? 'เลือกคำตอบในหน้าต่างคำถาม — ตอบถูกได้ไอเทม' : `รอ ${curName} ตอบคำถาม`;
  }
  if (pend?.type === 'win') {
    return pend.playerId === me.id ? 'กรอกเลขทุกห้องแล้วกด "ยื่นคำตอบ"' : `${curName} เจอห้องชนะ! กำลังยื่นคำตอบ`;
  }
  if (pend?.type === 'meeting') {
    return pend.participants?.includes(me.id)
      ? 'คุยกันในหน้าต่างสนทนา แล้วกด "จบการสนทนา" เพื่อเล่นต่อ'
      : 'มีผู้เล่นเจอกัน เกมหยุดชั่วคราวจนกว่าจะคุยเสร็จ';
  }
  if (st.currentPlayerId !== me.id) {
    return st.round < 2
      ? 'ระหว่างรอ: ดูเลขห้องที่รู้แล้ววางแผนเส้นทาง'
      : 'ปีศาจจะเดินหลังทุกคนเดินครบรอบ — ระวังตัว';
  }
  if (me.movesLeft > 0) {
    if (!me.validMoves.length) return 'ไม่มีทางเดินจากห้องนี้ — ใช้ไอเทม หรือกด "จบตา"';
    const step = me.movesLeft > 1 ? ` (เหลือ ${me.movesLeft} ก้าว)` : '';
    return me.alive
      ? `① กดช่องที่เรืองแสงข้างตัวเพื่อเดิน${step} ② กด "จบตา"`
      : `① คุณเป็นผี เดินทะลุกำแพงได้ กดช่องที่เรืองแสง${step} ② กด "จบตา"`;
  }
  return me.alive
    ? 'เดินแล้ว — ใช้ไอเทมได้ หรือกด "จบตา" เพื่อส่งตาให้คนต่อไป'
    : 'เดินแล้ว — กด "จบตา" เพื่อส่งตาให้คนต่อไป';
}

// สมุดจดส่วนตัว: สลับโหมดจดบนกระดาน + กล่องโน้ตอิสระ
function notesPanel(st) {
  const n = loadNotes();
  const count = Object.keys(n.cells).length;
  return `<div class="panel notes-panel">
    <h3>📝 สมุดจด <small>(เห็นคนเดียว)</small></h3>
    <button class="btn ${S.noteMode ? 'gold' : ''} small-btn" data-action="toggle_note_mode">
      ${S.noteMode ? '✏️ โหมดจด: เปิด — กดช่องบนกระดานเพื่อจด' : '✏️ จดบนกระดาน'}</button>
    <div class="hint">${S.noteMode ? 'ระหว่างโหมดจด การกดช่องจะไม่เดิน · กดปุ่มอีกครั้งเพื่อกลับไปเดิน' : `จดเดาเลข/กำแพงของช่องที่ยังไม่รู้ได้ (จดไว้ ${count} ช่อง) — ตอนยื่นคำตอบจะเติมให้อัตโนมัติ`}</div>
    <textarea class="notes-text" data-notes data-keep="notes" rows="4" placeholder="จดอะไรก็ได้ เช่น ใครน่าจะตายแล้ว, ห้องไหนน่าสงสัย">${esc(n.text)}</textarea>
  </div>`;
}

function noteModal(st) {
  const k = S.noteCell;
  const cur = loadNotes().cells[k] || '';
  const pos = k.split(',').map((x) => +x + 1).join(',');
  return `<div class="overlay" data-action="note_cancel_bg"><div class="modal note-modal">
    <h2>✏️ จดช่อง (${pos})</h2>
    <div class="sub">ใส่เลขที่เดา <b>1–99</b> หรือ <b>w</b> ถ้าคิดว่าเป็นกำแพง — เห็นคนเดียว</div>
    <form data-form="note"><input name="note" maxlength="2" value="${esc(cur)}" placeholder="เช่น 42 หรือ w" autocomplete="off" />
      <div class="mt">
        <button class="btn primary" type="submit">บันทึก</button>
        ${cur ? '<button class="btn danger" type="button" data-action="note_clear">ลบที่จด</button>' : ''}
        <button class="btn" type="button" data-action="note_cancel">ยกเลิก</button>
      </div>
    </form>
  </div></div>`;
}

// คำอธิบายสัญลักษณ์บนกระดาน
function legendPanel(st) {
  const row = (sw, txt) => `<div class="lg-row">${sw}<span>${txt}</span></div>`;
  return `<div class="panel legend">
    <h3>🗺️ สัญลักษณ์</h3>
    <div class="lg-grid">
      ${row('<span class="lg-sw cell fog"></span>', 'ยังไม่สำรวจ (มืด)')}
      ${row('<span class="lg-sw cell room unknown"><span class="num">?</span></span>', 'ห้องที่เห็นแต่ยังไม่เข้า')}
      ${row('<span class="lg-sw cell room"><span class="num">42</span></span>', 'ห้องที่รู้เลขแล้ว')}
      ${row('<span class="lg-sw cell wall"></span>', 'ห้องตัน (กำแพง)')}
      ${row('<span class="lg-sw cell room move-target"></span>', 'เดินไปได้ (กดเลย)')}
      ${row('<span class="lg-sw cell room me"></span>', 'ตำแหน่งของคุณ')}
      ${row('<span class="lg-sw cell room"><i class="door d-e"></i></span>', 'ประตู (ผ่านได้)')}
      ${row('<span class="lg-sw cell room"><i class="shut s-e"></i></span>', 'ผนังปิด (ผ่านไม่ได้)')}
      ${row('<span class="lg-sw cell fog"><span class="note">42</span></span>', 'เลขที่คุณจดเดาไว้')}
      ${row('<span class="lg-sw lg-ic">👹</span>', 'ปีศาจ (ผีเท่านั้นที่เห็น)')}
      ${row('<span class="lg-sw lg-ic">❔</span>', 'ไม่รู้ว่าใครตาย จนกว่าจะเจอตัว')}
    </div>
  </div>`;
}

function meStatus(st) {
  const me = st.me;
  const chips = [];
  chips.push(`<span class="sc">${me.alive ? '🧍 มีชีวิต' : '👻 ผี'}</span>`);
  chips.push(`<span class="sc">📍 ห้อง (${me.pos.r + 1},${me.pos.c + 1})</span>`);
  if (me.alive && me.shield) chips.push(`<span class="sc">🛡️ โล่</span>`);
  if (me.demonSense || !me.alive) chips.push(`<span class="sc">👁️ รู้ตำแหน่งปีศาจ</span>`);
  if (me.frozen) chips.push(`<span class="sc">❄️ ถูกแช่แข็ง</span>`);
  const knownCount = Object.keys(me.known).length;
  chips.push(`<span class="sc">🔢 รู้ ${knownCount} ห้อง</span>`);
  return `
    <div class="panel">
      <h3>คุณ — ${esc(me.name)}</h3>
      ${!me.alive ? `<div class="ghost-banner">👻 คุณเป็นผี — ชนะไม่ได้ แต่เดินต่อ, เห็นปีศาจ, และทำสัญญา/ขายข้อมูลให้ผู้เล่นได้</div>` : ''}
      <div class="status-chips">${chips.join('')}</div>
    </div>`;
}

function playersPanel(st) {
  const rows = st.players.map((p) => {
    const cur = p.id === st.currentPlayerId ? 'cur' : '';
    return `<div class="pl-row ${cur}">
      <span class="dot" style="background:${p.color}"></span>
      <span class="name">${esc(p.name)}${p.id === st.me.id ? ' (คุณ)' : ''}</span>
      ${p.alive === true && p.id === st.me.id ? '<span class="badge alive-b">มีชีวิต</span>' : ''}
      ${p.alive === false ? '<span class="badge ghost-b">👻 ผี</span>' : ''}
      ${p.offline ? '<span class="badge" title="ตาจะถูกข้ามจนกว่าจะกลับมา (รอได้ 3 นาที)">📴 หลุด</span>' : ''}
    </div>`;
  }).join('');
  return `<div class="panel"><h3>ผู้เล่น (${st.players.length}/6)</h3>${rows}</div>`;
}

function inventoryPanel(st) {
  const me = st.me;
  if (!me.alive) {
    const ghostCanAct = st.currentPlayerId === me.id && !st.pending;
    return `<div class="panel inv-panel"><h3>กระเป๋าไอเทม</h3><div class="hint">ผีใช้ไอเทมไม่ได้ (จะกลับมาใช้ได้เมื่อถูกชุบ)</div>${ghostCanAct ? `<div class="mt"><button class="btn" data-action="end_turn">จบตา ➜</button></div>` : ''}</div>`;
  }
  const items = me.inventory.map((id) => {
    const m = ITEM_META[id] || { name: id, icon: '❔' };
    const needs = ['revive', 'freeze', 'warp'].includes(id);
    // คำอธิบาย (inv-desc) แสดงเฉพาะจอเล็ก/จอสัมผัส เพราะชี้เมาส์ค้างไม่ได้
    return `<span class="inv-item" data-action="use_item" data-item="${id}" title="${esc(m.desc)}">${m.icon} ${esc(m.name)}${needs ? ' ⤷' : ''}<span class="inv-desc">${esc(m.desc)}</span></span>`;
  }).join('');
  const canAct = st.currentPlayerId === me.id && !st.pending;
  return `<div class="panel inv-panel">
    <h3>🎒 ไอเทม</h3>
    <div class="inv">${items || '<span class="hint">ยังไม่มีไอเทม — ตอบคำถามให้ถูกในห้องคำถามเพื่อรับไอเทม</span>'}</div>
    ${items ? '<div class="hint">กดไอเทมเพื่อใช้ (เฉพาะตาของคุณ) · ⤷ = ต้องเลือกเป้าหมาย · ชี้ค้างเพื่อดูคำอธิบาย</div>' : ''}
    ${canAct ? `<div class="mt"><button class="btn" data-action="end_turn">จบตา ➜</button></div>` : ''}
  </div>`;
}

function logPanel(st) {
  const lines = st.log.map((l) => `<div class="ln">${esc(l)}</div>`).join('');
  return `<div class="panel"><h3>📜 เหตุการณ์</h3><div class="log">${lines || '<div class="ln">—</div>'}</div></div>`;
}

function meetingChatInline(st) {
  // แชทเฉพาะในห้อง lobby จะไม่แสดงในเกม (ใช้ modal แทน)
  return '';
}

// ---------------- Modal ----------------
function renderModalInner() {
  const root = $('modal-root');
  const st = S.state;
  // 0) วิธีเล่น (เปิดเองจากปุ่ม — ใช้ได้ทั้งหน้าแรกและในเกม)
  if (S.showHelp) { root.innerHTML = helpModal(); return; }
  if (S.noteCell && st && !st.pending && st.status === 'playing') { root.innerHTML = noteModal(st); root.querySelector('input[name=note]')?.focus(); return; }
  if (S.noteCell && (!st || st.pending)) S.noteCell = null;
  if (S.screen !== 'game' || !st) { root.innerHTML = ''; return; }

  // 1) เกมจบ
  if (st.status === 'ended' && st.winner) {
    root.innerHTML = gameOverModal(st);
    return;
  }

  // 2) item target
  if (S.targetFor) { root.innerHTML = targetModal(st); return; }

  const me = st.me;
  const pend = st.pending;
  // ไม่ได้อยู่ในวงสนทนาแล้ว → ล้างร่างแชร์ และแชทของการเจอกันครั้งก่อน (ไม่ให้ไปโผล่ตอนเจอคนอื่น)
  if (!(pend?.type === 'meeting' && pend.participants?.includes(me.id))) { S.share = null; S.chat.meeting = []; }
  if (!pend) { root.innerHTML = ''; return; }

  // 3) meeting
  if (pend.type === 'meeting' && pend.participants?.includes(me.id)) {
    root.innerHTML = meetingModal(st);
    return;
  }

  // 4) question (เฉพาะผู้ตอบ)
  if (pend.type === 'question' && pend.playerId === me.id && pend.question) {
    root.innerHTML = questionModal(st, pend);
    return;
  }

  // 5) win (เฉพาะผู้ยื่น)
  if (pend.type === 'win' && pend.playerId === me.id) {
    root.innerHTML = winModal(st);
    return;
  }

  root.innerHTML = '';
}

function helpModal() {
  const items = Object.values(ITEM_META)
    .map((m) => `<div class="help-item"><span class="ic">${m.icon}</span><b>${esc(m.name)}</b><span>${esc(m.desc)}</span></div>`).join('');
  return `<div class="overlay" data-action="close_help_bg"><div class="modal help-modal">
    <button class="modal-x" data-action="close_help" title="ปิด">✕</button>
    <h2>📖 วิธีเล่น</h2>
    <div class="sub">อ่านจบใน 1 นาที — 2–6 คน ผลัดกันเดินทีละตา</div>

    <section class="help-sec goal">
      <h4>🎯 เป้าหมาย</h4>
      <p>ทุกห้องในดันเจี้ยนมี <b>เลขลับ 1–99</b> (ไม่ซ้ำกัน) ส่วนห้องตันคือกำแพง
      หา <b>ห้องชนะ</b> ที่ซ่อนอยู่ให้เจอเป็นคนแรก แล้ว <b>ตอบเลขของทุกห้องให้ถูกครบ</b> = ชนะทันที
      ถ้าตอบผิด ห้องชนะจะย้ายไปซ่อนที่ใหม่</p>
    </section>

    <section class="help-sec">
      <h4>👣 ในตาของคุณ</h4>
      <ol>
        <li>กด <b>ช่องที่เรืองแสง</b> ข้างตัวเพื่อเดิน 1 ช่อง (ผ่านประตูเท่านั้น)</li>
        <li>เข้าห้องแล้วจะรู้ <b>เลขห้อง</b> และเห็นว่าห้องนี้ <b>มีประตูทางไหนบ้าง</b> — แต่ละห้องสุ่มประตูไม่เหมือนกัน บางด้านปิด (เส้นทึบ) เดินผ่านไม่ได้</li>
        <li>ใช้ไอเทมได้ถ้ามี แล้วกด <b>"จบตา"</b> เพื่อส่งตาให้คนต่อไป</li>
      </ol>
      <p class="tip">เคล็ดลับ: เลขห้องที่คุณเคยเข้าจะแสดงค้างบนกระดาน ส่วนห้องที่ยังไม่เคยเข้า ต้องไปเอง ใช้ไอเทม หรือแลกข้อมูลกับผี
      · ใช้ <b>📝 สมุดจด</b> จดเดาเลข/กำแพงบนกระดานได้ (เห็นคนเดียว) แล้วตอนยื่นคำตอบจะเติมให้อัตโนมัติ</p>
      <p class="tip">⏱️ แต่ละตามีเวลา <b>120 วินาที</b> (รวมตอนตอบคำถาม/ยื่นคำตอบ/คุยกัน) — หมดเวลาจะจบตาให้อัตโนมัติ (คำถามที่ยังไม่ตอบนับว่าผิด)
      · ถ้ารีเฟรชหรือเน็ตหลุด กลับมาเปิดหน้าเว็บเดิมภายใน 3 นาทีจะเข้าเกมต่อได้</p>
    </section>

    <section class="help-sec danger">
      <h4>👹 ปีศาจ</h4>
      <p>มีปีศาจ 1 ตัว <b>มองไม่เห็น</b> เริ่มเดินสุ่มตั้งแต่รอบ 2 หลังทุกคนเดินครบ (เดินทุก 1–3 รอบ ตามที่โฮสต์ตั้ง)
      ถ้ามันเดินมาเจอคุณ = <b>ตายกลายเป็นผี</b>
      — และ <b>ไม่มีใครรู้ว่าใครตาย</b> จนกว่าจะเดินมาเจอตัวกัน
      ถ้าผู้รอดชีวิตตายหมด = <b>ปีศาจชนะ</b> เกมจบทันที</p>
      <p class="tip">⚠️ ระบบจะเตือนทุกคน (ไม่บอกชื่อ) เมื่อปีศาจเข้ามาในระยะ 1 ช่องรอบตัวผู้เล่นคนใดคนหนึ่ง (รวมช่องทแยง)</p>
    </section>

    <section class="help-sec ghost">
      <h4>👻 ผี</h4>
      <p>ผีชนะเองไม่ได้ แต่ <b>เดินทะลุกำแพงและประตูปิดได้</b> และ <b>เห็นปีศาจตลอด</b>
      เมื่อเจอผู้เล่น ผีขายข้อมูลได้ — <b>เลขห้อง</b>, <b>แผนที่ทางเดิน (ประตู)</b> หรือ <b>ตำแหน่งปีศาจ</b>
      แลกกับ <b>"ชนะร่วม"</b> (ถ้าเขาชนะ ผีชนะด้วย) หรือ <b>"สัญญาชุบ"</b> (ใบชุบใบแรกของเขาต้องชุบผี)</p>
    </section>

    <section class="help-sec">
      <h4>🚪 ห้องพิเศษ (ซ่อนอยู่ จะรู้เมื่อเดินเข้า)</h4>
      <ul>
        <li><b>❓ ห้องคำถาม</b> — ตอบถูกได้ไอเทมสุ่ม ตอบผิดห้องหมดสภาพ</li>
        <li><b>🏆 ห้องชนะ</b> — ได้สิทธิ์ยื่นคำตอบเลขทุกห้อง</li>
        <li><b>💬 เจอกัน</b> — ถ้าอยู่ห้องเดียวกับคนอื่น เกมจะหยุดให้คุยกันส่วนตัวก่อน
          ระหว่างนั้น <b>แชร์ข้อมูลห้องให้กัน</b> (เลขห้อง/ประตู) หรือ <b>เสนอแลก</b> (แลกจริงเมื่อยืนยันทั้งคู่) ได้
          — จะเป็นพันธมิตรกันก็ตกลงกันเองในแชท</li>
      </ul>
    </section>

    <section class="help-sec">
      <h4>🎒 ไอเทม</h4>
      <div class="help-items">${items}</div>
    </section>

    <div class="mt"><button class="btn primary" data-action="close_help">เข้าใจแล้ว</button></div>
  </div></div>`;
}

function gameOverModal(st) {
  const w = st.winner;
  const sum = st.summary;
  const isMeWin = w.id === S.playerId || w.coWinners?.some((c) => c.id === S.playerId);
  const co = w.coWinners?.length ? w.coWinners.map((c) => esc(c.name)).join(', ') : '';
  const title = w.demon ? '👹 ปีศาจชนะ' : isMeWin ? '🏆 คุณชนะ!' : '🏁 จบเกม';
  const subline = w.demon
    ? 'ไม่มีผู้รอดชีวิตเหลืออยู่ในดันเจี้ยน'
    : `ผู้ชนะ: <b>${esc(w.name)}</b>${co ? ` · ชนะร่วม: <b>${co}</b>` : ''}`;
  if (!sum) {
    return `<div class="overlay"><div class="modal"><h2>${title}</h2><div class="sub">${subline}</div>
      <div class="mt"><button class="btn primary" data-action="leave_game">กลับหน้าแรก</button></div></div></div>`;
  }

  // เรียง: ผู้ชนะ → ชนะร่วม → รอด → เปิดห้องเยอะ
  const players = sum.players.slice().sort((a, b) =>
    (b.isWinner - a.isWinner) || (b.isCoWinner - a.isCoWinner) || (b.alive - a.alive) || (b.roomsVisited - a.roomsVisited));
  const total = sum.totalRooms;
  const rows = players.map((p) => {
    const tag = p.isWinner ? '<span class="sum-tag win">👑 ผู้ชนะ</span>'
      : p.isCoWinner ? '<span class="sum-tag co">🤝 ชนะร่วม</span>' : '';
    const status = p.alive
      ? '<span class="sum-ok">🧍 รอดชีวิต</span>'
      : `<span class="sum-dead">👻 ตาย${p.diedRound ? ` (รอบ ${p.diedRound})` : ''}</span>`;
    const revived = p.revived ? `<div class="sum-mini">ถูกชุบ ${p.revived} ครั้ง</div>` : '';
    const left = p.disconnected ? '<div class="sum-mini">ออกจากเกม</div>' : '';
    const pct = total ? Math.round((p.roomsKnown / total) * 100) : 0;
    return `<tr class="${p.id === S.playerId ? 'me' : ''}">
      <td class="sum-name"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === S.playerId ? ' (คุณ)' : ''} ${tag}</td>
      <td>${status}${revived}${left}</td>
      <td class="num">${p.roomsVisited}<span class="of">/${total}</span></td>
      <td class="num">${p.roomsKnown}<span class="of">/${total}</span><div class="sum-bar"><i style="width:${pct}%"></i></div></td>
      <td class="num">${p.steps}</td>
      <td class="num"><span class="sum-ok">${p.questionsRight}</span> / <span class="sum-dead">${p.questionsWrong}</span></td>
      <td class="num">${p.itemsGot} / ${p.itemsUsed}</td>
      <td class="num">${p.winAttempts}</td>
      <td class="num">${p.meetings}</td>
    </tr>`;
  }).join('');

  const contracts = sum.contracts.length
    ? sum.contracts.map((c) => {
        const give = c.give === 'demon' ? 'ตำแหน่งปีศาจ' : `ข้อมูล ${c.giveCount} ห้อง (${infoKind(c.giveNumbers, c.giveDoors)})`;
        const want = c.want === 'cowin' ? 'ชนะร่วม' : `สัญญาชุบ${c.fulfilled ? ' ✓ ทำตามแล้ว' : ' ✗ ยังไม่ได้ชุบ'}`;
        return `<div class="ln">📜 ผี <b>${esc(c.fromName)}</b> ให้${give} แก่ <b>${esc(c.toName)}</b> แลกกับ ${want}</div>`;
      }).join('')
    : '<div class="ln">ไม่มีการทำสัญญา</div>';

  // เฉลยกระดานทั้งหมด
  const cells = sum.board.map((row, r) => row.map((c, ci) => {
    if (c.type !== 'room') return '<div class="cell wall"></div>';
    const doors = ['n', 's', 'e', 'w'].map((d) => (c.doors.includes(d) ? `<i class="door d-${d}"></i>` : `<i class="shut s-${d}"></i>`)).join('');
    const demon = sum.demon.r === r && sum.demon.c === ci ? '<span class="sum-mark demon" title="ปีศาจ">👹</span>' : '';
    const win = c.win ? '<span class="sum-mark win" title="ห้องชนะ">🏆</span>' : '';
    return `<div class="cell room${c.win ? ' sum-win' : ''}"><span class="num">${c.number}</span>${doors}${win}${demon}</div>`;
  }).join('')).join('');

  return `<div class="overlay"><div class="modal summary-modal">
    <div class="sum-head ${w.demon ? 'demon' : ''}">
      <h2>${title}</h2>
      <div class="sub">${subline}</div>
      <div class="sum-meta">
        <span>⏳ เล่นไป <b>${sum.rounds}</b> รอบ</span>
        <span>🚪 ห้องทั้งหมด <b>${total}</b> ห้อง</span>
        <span>👥 ผู้เล่น <b>${sum.players.length}</b> คน · รอด <b>${sum.players.filter((p) => p.alive).length}</b></span>
      </div>
    </div>

    <h3 class="sum-h">สรุปผู้เล่น</h3>
    <div class="sum-table-wrap"><table class="sum-table">
      <thead><tr>
        <th>ผู้เล่น</th><th>สถานะ</th><th>เข้าห้องเอง</th><th>รู้เลขห้อง</th><th>ก้าว</th>
        <th>คำถาม<br/><small>ถูก / ผิด</small></th><th>ไอเทม<br/><small>ได้ / ใช้</small></th><th>ยื่นคำตอบ</th><th>เจอคนอื่น</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>

    <div class="sum-cols">
      <div>
        <h3 class="sum-h">เฉลยดันเจี้ยน</h3>
        <div class="board sum-board" style="grid-template-columns:repeat(${sum.board[0].length},1fr)">${cells}</div>
        <div class="hint">🏆 ห้องชนะ (ตำแหน่งล่าสุด) · 👹 ตำแหน่งปีศาจตอนจบ</div>
      </div>
      <div>
        <h3 class="sum-h">สัญญากับผี</h3>
        <div class="log sum-log">${contracts}</div>
      </div>
    </div>

    <div class="mt"><button class="btn primary" data-action="leave_game">กลับหน้าแรก</button></div>
  </div></div>`;
}

function questionModal(st, pend) {
  const opts = pend.question.options.map((o, i) => `<button class="option" data-action="answer" data-choice="${i}">${String.fromCharCode(65 + i)}. ${esc(o)}</button>`).join('');
  return `<div class="overlay"><div class="modal">
    <h2>❓ ห้องคำถาม</h2>
    <div class="sub">ตอบถูกได้ไอเทมสุ่ม · ตอบผิดห้องนี้จะกลายเป็นห้องธรรมดา</div>
    <div style="font-size:17px;font-weight:600;margin-bottom:4px">${esc(pend.question.text)}</div>
    <div class="options">${opts}</div>
  </div></div>`;
}

function winModal(st) {
  const me = st.me;
  const winNotes = loadNotes(); // เติมค่าที่จดไว้ให้อัตโนมัติ
  const cols = st.cols;
  let cells = '';
  for (let r = 0; r < st.rows; r++) {
    for (let c = 0; c < st.cols; c++) {
      const k = `${r},${c}`;
      if (me.known[k] != null) {
        cells += `<div class="win-cell locked"><input readonly data-k="${k}" data-locked="1" data-room="1" value="${me.known[k]}" /></div>`;
      } else if (me.revealed[k] === 'wall') {
        cells += `<div class="win-cell wall" data-k="${k}" data-locked="1" data-wall="1"></div>`;
      } else {
        const isRoom = me.revealed[k] === 'room';
        const guess = winNotes.cells[k] || '';
        cells += `<div class="win-cell${guess ? ' from-note' : ''}"><input data-k="${k}" data-locked="0" ${isRoom ? 'data-room="1"' : ''} placeholder="${isRoom ? 'เลข' : 'เลข/w'}" value="${esc(guess)}" inputmode="text" /></div>`;
      }
    }
  }
  return `<div class="overlay"><div class="modal" style="max-width:760px">
    <h2>🏆 ห้องชนะ</h2>
    <div class="sub">ตอบเลขของทุกห้องให้ถูกต้องครบทั้งหมดเพื่อชนะ! ช่องที่สำรวจแล้วถูกล็อกไว้<br/>
    ในช่องว่าง: พิมพ์ <b>ตัวเลข 1–99</b> (ห้องทะลุได้) หรือ <b>w</b> (ห้องตัน/กำแพง) · ช่องสีฟ้า = เติมจากสมุดจดของคุณ (แก้ได้)</div>
    <div class="win-grid" id="win-grid" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>
    <div class="mt">
      <button class="btn primary" data-action="submit_win">ยื่นคำตอบ</button>
      <button class="btn" data-action="cancel_win">ปิด (ยังไม่ยื่น)</button>
    </div>
  </div></div>`;
}

function targetModal(st) {
  const me = st.me;
  const item = S.targetFor.item;
  const meta = ITEM_META[item] || { name: item, icon: '❔' };
  let list = '';
  if (item === 'revive') {
    // รายชื่อคนตาย — server ส่งมาให้เฉพาะคนที่ถือใบชุบ
    const dead = me.reviveTargets || [];
    if (me.movedThisTurn) {
      list = '<div class="hint">ใบชุบต้องใช้ <b>ก่อนเริ่มเดิน</b> ในตานั้น — เก็บไว้ใช้ตาหน้าได้</div>';
    } else {
      // มีสัญญาชุบค้าง → ต้องชุบผีตามสัญญาก่อน
      const owed = dead.filter((p) => p.owed);
      const pickable = owed.length ? owed : dead;
      list = (owed.length ? '<div class="hint">📜 คุณมีสัญญาชุบค้างอยู่ — ใบชุบใบนี้ต้องใช้กับผีตามสัญญา</div>' : '')
        + pickable.map((p) => `<button class="target-btn btn" data-action="target_pick" data-target="${p.id}">👻 ชุบ ${esc(p.name)}${p.owed ? ' (ตามสัญญา)' : ''}</button>`).join('');
      if (!dead.length) list = '<div class="hint">ตอนนี้ยังไม่มีใครตาย — เก็บใบชุบไว้ก่อนได้</div>';
    }
  } else if (item === 'freeze') {
    const others = st.players.filter((p) => p.id !== me.id);
    list = others.map((p) => `<button class="target-btn btn" data-action="target_pick" data-target="${p.id}">${esc(p.name)}${p.frozen ? ' (แช่แข็งอยู่แล้ว)' : ''}</button>`).join('');
  } else if (item === 'warp') {
    const keys = Object.keys(me.known);
    list = keys.map((k) => `<button class="target-btn btn" data-action="target_pick" data-room="${k}">🌀 ไปห้อง ${me.known[k]} (${k.split(',').map((x) => +x + 1).join(',')})</button>`).join('');
    if (!keys.length) list = '<div class="hint">คุณยังไม่รู้ตำแหน่งห้องเลย</div>';
  }
  return `<div class="overlay"><div class="modal">
    <h2>${meta.icon} ใช้ ${esc(meta.name)}</h2>
    <div class="sub">${esc(meta.desc)}</div>
    <div class="target-list">${list}</div>
    <div class="mt"><button class="btn" data-action="cancel_target">${item === 'revive' ? 'เก็บไว้ก่อน' : 'ยกเลิก'}</button></div>
  </div></div>`;
}

// ---- แชร์ / แลก / สัญญา: ตัวเลือกห้อง ----
function infoKind(numbers, doors) {
  return [numbers ? 'เลขห้อง' : '', doors ? 'ประตู' : ''].filter(Boolean).join(' + ') || '—';
}

// ร่างการเลือก เก็บใน S.share เพื่อไม่ให้หายเวลาจอวาดใหม่
function shareDraft(livingOthers) {
  if (!S.share) S.share = { to: null, cells: new Set(), numbers: true, doors: false };
  if (!livingOthers.some((o) => o.id === S.share.to)) S.share.to = livingOthers[0]?.id || null;
  return S.share;
}

function roomPicker(st, draft) {
  const me = st.me;
  const keys = [...new Set([...Object.keys(me.known), ...Object.keys(me.doors || {})])]
    .sort((a, b) => { const [ar, ac] = a.split(',').map(Number), [br, bc] = b.split(',').map(Number); return ar - br || ac - bc; });
  if (!keys.length) return '<div class="hint">คุณยังไม่มีข้อมูลห้องให้แชร์</div>';
  const rows = keys.map((k) => {
    const num = me.known[k];
    const hasDoors = !!me.doors?.[k];
    const pos = k.split(',').map((x) => +x + 1).join(',');
    return `<label class="room-pick"><input type="checkbox" data-share-room="${k}" ${draft.cells.has(k) ? 'checked' : ''} />
      <span class="rp-num">${num != null ? num : '?'}</span><span class="rp-pos">(${pos})</span>
      <span class="rp-tags">${num != null ? '<i>เลข</i>' : ''}${hasDoors ? '<i>ประตู</i>' : ''}</span></label>`;
  }).join('');
  return `<div class="room-picks">${rows}</div>
    <div class="share-opts">
      <span>ให้ข้อมูล:</span>
      <label><input type="checkbox" data-share-opt="numbers" ${draft.numbers ? 'checked' : ''} /> เลขห้อง</label>
      <label><input type="checkbox" data-share-opt="doors" ${draft.doors ? 'checked' : ''} /> ประตู (แผนที่ทางเดิน)</label>
    </div>`;
}

function sharePanel(st, livingOthers, draft) {
  const t = (st.trades || []).find((x) => x.with === draft.to);
  const partner = livingOthers.find((o) => o.id === draft.to);
  const pName = esc(partner?.name || '');
  const mine = t?.mine ? `${t.mine.cells.length} ห้อง (${infoKind(t.mine.numbers, t.mine.doors)})` : 'ยังไม่ได้เสนอ';
  const theirs = t?.theirs ? `${t.theirs.count} ห้อง (${infoKind(t.theirs.numbers, t.theirs.doors)})` : 'ยังไม่ได้เสนอ';
  const canConfirm = t?.mine && t?.theirs && !t.myConfirmed;
  return `<div class="panel share-panel" style="margin:10px 0">
    <h3>🗺️ แบ่งปันข้อมูลห้อง</h3>
    ${livingOthers.length > 1 ? `<div class="field"><label>กับ</label><select data-share-to>${livingOthers.map((o) => `<option value="${o.id}" ${o.id === draft.to ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></div>` : `<div class="hint" style="margin:0 0 8px">กับ <b>${pName}</b></div>`}
    ${roomPicker(st, draft)}
    <div class="mt">
      <button class="btn" data-action="share_send" title="อีกฝ่ายได้ข้อมูลทันที ไม่ต้องให้อะไรคืน">🎁 แชร์ให้เลย</button>
      <button class="btn gold" data-action="trade_set" title="ตั้งห้องที่เลือกเป็นข้อเสนอแลก">🤝 ตั้งเป็นข้อเสนอแลก</button>
    </div>
    <div class="trade-box">
      <div class="tb-row"><span>ข้อเสนอของคุณ</span><b>${mine}</b>${t?.myConfirmed ? '<em>✓ ยืนยันแล้ว</em>' : ''}</div>
      <div class="tb-row"><span>ข้อเสนอของ ${pName}</span><b>${theirs}</b>${t?.theirConfirmed ? '<em>✓ ยืนยันแล้ว</em>' : ''}</div>
      <div class="hint">แลกจะเกิดขึ้นเมื่อ <b>ทั้งสองฝ่ายกดยืนยัน</b> — ถ้าใครแก้ข้อเสนอ ต้องยืนยันใหม่ทั้งคู่ · คุณเห็นแค่จำนวนห้องของอีกฝ่าย ไม่เห็นว่าห้องไหน</div>
      <div class="mt">
        <button class="btn primary" data-action="trade_confirm" ${canConfirm ? '' : 'disabled'}>ยืนยันแลก</button>
        ${t?.mine ? '<button class="btn" data-action="trade_clear">ยกเลิกข้อเสนอ</button>' : ''}
        ${t?.theirs ? '<button class="btn danger" data-action="trade_reject" title="ไม่แลก — ล้างข้อเสนอของทั้งสองฝ่าย">❌ ปฏิเสธการแลก</button>' : ''}
      </div>
    </div>
  </div>`;
}

function meetingModal(st) {
  const me = st.me;
  const pend = st.pending;
  const others = (pend.participants || []).filter((id) => id !== me.id)
    .map((id) => st.players.find((p) => p.id === id)).filter(Boolean);
  const otherNames = others.map((o) => `${o.alive ? '🧍' : '👻'} ${esc(o.name)}`).join(', ');


  let contractUI = '';
  const livingOthers = others.filter((o) => o.alive);
  const draft = shareDraft(livingOthers);
  if (!me.alive) {
    // ผี → เสนอสัญญาให้ผู้เล่นเป็นๆ
    if (livingOthers.length) {
      contractUI = `<div class="panel" style="margin:10px 0">
        <h3>📜 เสนอสัญญา (คุณคือผี)</h3>
        <div class="field"><label>ให้ข้อมูลห้อง: เลือกห้อง แล้วเลือกว่าจะให้อะไร</label>${roomPicker(st, draft)}</div>
        <div class="field"><label>หรือให้: รู้ตำแหน่งปีศาจ</label><label class="pl-row" style="cursor:pointer"><input type="checkbox" data-contract-demon="1" /> บอกตำแหน่งปีศาจ (แทนข้อมูลห้อง)</label></div>
        <div class="field"><label>แลกกับ</label>
          <select data-contract-want>
            <option value="cowin">ชนะร่วม (ถ้าเขาชนะ คุณชนะด้วย)</option>
            <option value="revive">สัญญาชุบ (ใบชุบใบแรกที่เขาใช้ ต้องชุบคุณ)</option>
          </select>
        </div>
        <div class="field"><label>ผู้เล่นเป้าหมาย</label>
          <select data-contract-to data-share-to>${livingOthers.map((o) => `<option value="${o.id}" ${o.id === draft.to ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
        </div>
        <button class="btn gold" data-action="contract_submit">เสนอสัญญา</button>
      </div>`;
    } else {
      contractUI = `<div class="hint" style="margin:10px 0">ไม่มีผู้เล่นเป็นๆ อยู่ในห้องนี้ให้ทำสัญญาด้วย</div>`;
    }
  } else {
    // ผู้เล่นเป็น → รับสัญญาจากผี
    const props = S.contractProposals.filter((c) => c.want !== undefined);
    if (props.length) {
      contractUI = props.map((c) => {
        const giveTxt = c.give.type === 'demon' ? '👁️ บอกตำแหน่งปีศาจ'
          : `🗺️ ข้อมูล ${c.give.cells?.length || 0} ห้อง (${infoKind(c.give.numbers !== false, !!c.give.doors)})`;
        const wantTxt = c.want === 'cowin' ? 'ชนะร่วม' : 'สัญญาชุบ';
        return `<div class="panel" style="margin:10px 0;border-color:var(--gold)">
          <h3>📜 ผี ${esc(c.fromName)} เสนอสัญญา</h3>
          <div class="hint">ให้: ${giveTxt}<br/>แลกกับ: ${wantTxt}</div>
          <div class="mt"><button class="btn primary" data-action="contract_respond" data-id="${c.contractId}" data-accept="1">ตกลง</button>
          <button class="btn danger" data-action="contract_respond" data-id="${c.contractId}" data-accept="0">ปฏิเสธ</button></div>
        </div>`;
      }).join('');
    } else {
      contractUI = `<div class="hint" style="margin:10px 0">ถ้ามีผีอยู่ในห้อง ผีอาจเสนอสัญญาให้คุณ</div>`;
    }
    // ผู้เล่นเป็น ↔ ผู้เล่นเป็น → แชร์ / แลกข้อมูล
    if (livingOthers.length) contractUI = sharePanel(st, livingOthers, draft) + contractUI;
  }

  return `<div class="overlay"><div class="modal">
    <h2>💬 สนทนาส่วนตัว</h2>
    <div class="sub">คุยกับ ${otherNames || '—'}</div>
    <div class="chat">
      <div class="msgs" data-chat="meeting" style="max-height:180px">${chatMsgsHtml('meeting')}</div>
      <form class="chat-input" data-form="chat" data-scope="meeting">
        <input name="text" maxlength="500" placeholder="พิมพ์ข้อความ…" autocomplete="off" />
        <button class="btn" type="submit">ส่ง</button>
      </form>
    </div>
    ${contractUI}
    <div class="mt"><button class="btn" data-action="end_meeting">จบการสนทนา ➜</button></div>
  </div></div>`;
}

// ---------------- Actions ----------------
document.addEventListener('click', (e) => {
  // โหมดจด: กดช่องบนกระดาน = เปิดที่จด (ไม่เดิน)
  if (S.noteMode) {
    const cell = e.target.closest('#board .cell[data-key]');
    if (cell) {
      if (cell.classList.contains('noteable')) { S.noteCell = cell.dataset.key; renderModal(); }
      else toast('ช่องนี้รู้แล้ว ไม่ต้องจด');
      return;
    }
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset;
  // คลิกพื้นหลังมืดของหน้าต่าง = ปิด (แต่คลิกในกล่องไม่ปิด)
  if ((a.action === 'close_help_bg' || a.action === 'note_cancel_bg') && e.target !== el) return;
  switch (a.action) {
    case 'leave_game': clearSession(); location.reload(); break;
    case 'toggle_note_mode': S.noteMode = !S.noteMode; render(); break;
    case 'note_clear': { const n = loadNotes(); delete n.cells[S.noteCell]; saveNotes(n); S.noteCell = null; render(); break; }
    case 'note_cancel':
    case 'note_cancel_bg': S.noteCell = null; renderModal(); break;
    case 'open_help': S.showHelp = true; renderModal(); break;
    case 'close_help':
    case 'close_help_bg': S.showHelp = false; renderModal(); break;
    case 'start_game': send({ type: 'start_game' }); break;
    case 'move': send({ type: 'move', dir: a.dir }); break;
    case 'end_turn': send({ type: 'end_turn' }); break;
    case 'use_item': {
      const item = a.item;
      if (['revive', 'freeze', 'warp'].includes(item)) { S.targetFor = { item }; render(); }
      else send({ type: 'use_item', item });
      break;
    }
    case 'answer': send({ type: 'answer_question', choice: Number(a.choice) }); break;
    case 'end_meeting': send({ type: 'end_meeting' }); break;
    case 'cancel_target': S.targetFor = null; render(); break;
    case 'cancel_win': send({ type: 'cancel_win' }); break;
    case 'close_modal': break;
    case 'target_pick': {
      const item = S.targetFor?.item;
      if (item === 'warp') send({ type: 'use_item', item, payload: { roomKey: a.room } });
      else send({ type: 'use_item', item, payload: { targetId: a.target } });
      S.targetFor = null;
      break;
    }
    case 'contract_respond': send({ type: 'respond_contract', contractId: a.id, accept: a.accept === '1' }); S.contractProposals = S.contractProposals.filter((c) => c.contractId !== a.id); break;
    case 'contract_submit': {
      const to = document.querySelector('[data-contract-to]')?.value;
      const want = document.querySelector('[data-contract-want]')?.value;
      const demon = document.querySelector('[data-contract-demon]')?.checked;
      const d = S.share;
      const rooms = d ? [...d.cells] : [];
      if (demon) send({ type: 'propose_contract', to, give: { type: 'demon' }, want });
      else if (rooms.length && (d.numbers || d.doors)) send({ type: 'propose_contract', to, give: { type: 'rooms', cells: rooms, numbers: d.numbers, doors: d.doors }, want });
      else toast('เลือกห้องและชนิดข้อมูลที่จะให้ หรือเลือกบอกตำแหน่งปีศาจ', true);
      break;
    }
    case 'share_send':
    case 'trade_set': {
      const d = S.share;
      if (!d?.to) break;
      if (!d.cells.size) { toast('เลือกห้องอย่างน้อย 1 ห้อง', true); break; }
      if (!d.numbers && !d.doors) { toast('เลือกว่าจะให้เลขห้อง หรือประตู (หรือทั้งคู่)', true); break; }
      send({ type: a.action === 'share_send' ? 'share_rooms' : 'trade_offer', to: d.to, cells: [...d.cells], numbers: d.numbers, doors: d.doors });
      if (a.action === 'share_send') d.cells.clear();
      break;
    }
    case 'trade_clear': if (S.share?.to) send({ type: 'trade_offer', to: S.share.to, cells: [] }); break;
    case 'trade_confirm': if (S.share?.to) send({ type: 'trade_confirm', to: S.share.to }); break;
    case 'trade_reject': if (S.share?.to) send({ type: 'trade_reject', to: S.share.to }); break;
    case 'submit_win': submitWin(); break;
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  const f = form.dataset.form;
  if (f === 'create') send({ type: 'create_room', name: fd.get('name'), size: Number(fd.get('size')), key: fd.get('key'), demonEvery: Number(fd.get('demonEvery')) });
  else if (f === 'join') send({ type: 'join_room', name: fd.get('name'), code: fd.get('code'), key: fd.get('key') });
  else if (f === 'note') {
    const v = String(fd.get('note') || '').trim().toLowerCase();
    const n = loadNotes();
    if (v === '') delete n.cells[S.noteCell];
    else if (v === 'w' || (/^\d{1,2}$/.test(v) && +v >= 1 && +v <= 99)) n.cells[S.noteCell] = v === 'w' ? 'w' : String(+v);
    else { toast('ใส่เลข 1–99 หรือ w', true); return; }
    saveNotes(n); S.noteCell = null; render();
  }
  else if (f === 'chat') {
    const t = fd.get('text');
    if (t.trim()) send({ type: 'chat', text: t });
    form.reset();
  }
});

function submitWin() {
  const cells = [];
  const st = S.state;
  const me = st.me;
  for (let r = 0; r < st.rows; r++) {
    for (let c = 0; c < st.cols; c++) {
      const k = `${r},${c}`;
      if (me.known[k] != null) { cells.push({ r, c, value: me.known[k] }); continue; }
      if (me.revealed[k] === 'wall') { cells.push({ r, c, value: 'wall' }); continue; }
      const inp = document.querySelector(`#win-grid input[data-k="${k}"]`);
      const raw = (inp?.value || '').trim().toLowerCase();
      if (raw === 'w' || raw === 'wall') cells.push({ r, c, value: 'wall' });
      else if (raw !== '' && !isNaN(Number(raw))) cells.push({ r, c, value: Number(raw) });
      else { toast(`ช่อง (${r + 1},${c + 1}) ยังกรอกไม่ถูกต้อง`, true); return; }
    }
  }
  send({ type: 'submit_win', cells });
}

// สมุดจดอิสระ: บันทึกทุกครั้งที่พิมพ์
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-notes]')) { const n = loadNotes(); n.text = e.target.value; saveNotes(n); }
});

// นับถอยหลังเวลาต่อตา (อัปเดตเฉพาะตัวเลข ไม่วาดจอใหม่)
setInterval(() => {
  const left = S.deadline ? Math.max(0, Math.ceil((S.deadline - Date.now()) / 1000)) : null;
  document.querySelectorAll('[data-timer]').forEach((el) => {
    el.textContent = left == null ? '' : `⏱️ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('low', left != null && left <= 20);
  });
}, 250);

// เก็บการเลือกห้อง/ตัวเลือกไว้ใน S.share (ไม่วาดจอใหม่ เพื่อไม่ให้ช่องแชทที่พิมพ์ค้างหาย)
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!S.share) return;
  if (el.matches('[data-share-room]')) {
    if (el.checked) S.share.cells.add(el.dataset.shareRoom); else S.share.cells.delete(el.dataset.shareRoom);
  } else if (el.matches('[data-share-opt]')) {
    S.share[el.dataset.shareOpt] = el.checked;
  } else if (el.matches('[data-share-to]')) {
    S.share.to = el.value;
    renderModal(); // เปลี่ยนคู่ → แสดงสถานะข้อเสนอของคู่ใหม่
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.showHelp) { S.showHelp = false; renderModal(); }
});

// boot
connect();
render();
