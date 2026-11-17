// Deadly Dungeon — HTTP + WebSocket server
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Game, COLORS } from './game.js';
import { getQuestions } from './questions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3799);
const REJOIN_GRACE_MS = 3 * 60 * 1000; // หลุดแล้วกลับเข้าเกมได้ภายใน 3 นาที

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const rooms = new Map(); // code -> room

function createRoom({ name, size, key, demonEvery }) {
  let code = genCode();
  while (rooms.has(code)) code = genCode();
  const room = {
    code,
    key: key || '',
    size: size || 6,
    demonEvery: [1, 2, 3].includes(demonEvery) ? demonEvery : 2,
    hostId: null,
    status: 'lobby',
    players: [], // { id, name, color, socket, isHost, roomCode }
    game: null,
    questions: shuffle(getQuestions()),
  };
  rooms.set(code, room);
  return room;
}

function lobbyView(room) {
  return {
    type: 'lobby',
    code: room.code,
    key: room.key,
    size: room.size,
    demonEvery: room.demonEvery,
    hostId: room.hostId,
    status: room.status,
    players: room.players.map((p) => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost })),
  };
}

function send(socket, obj) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(obj));
}

function broadcastLobby(room) {
  for (const p of room.players) send(p.socket, lobbyView(room));
}

function broadcastState(room) {
  if (!room.game) return;
  for (const p of room.players) {
    const s = room.game.serializeFor(p.id);
    if (s) send(p.socket, s);
  }
}

function broadcastChat(room, { from, fromName, text }, toIds = null) {
  for (const p of room.players) {
    if (toIds && !toIds.includes(p.id)) continue;
    send(p.socket, { type: 'chat', from, fromName, text, ts: Date.now() });
  }
}

function roomOf(client) {
  return rooms.get(client.roomCode);
}

function handleMessage(client, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  const room = roomOf(client);

  switch (msg.type) {
    case 'create_room': {
      if (client.roomCode) return;
      const name = String(msg.name || 'ผู้เล่น').slice(0, 16);
      const size = [6, 7, 8].includes(Number(msg.size)) ? Number(msg.size) : 6;
      const key = String(msg.key || '').slice(0, 32);
      const demonEvery = Number(msg.demonEvery);
      const room = createRoom({ name, size, key, demonEvery });
      const player = {
        id: randomUUID(), token: randomUUID(), name, color: COLORS[0], socket: client, isHost: true, roomCode: room.code,
      };
      client.roomCode = room.code;
      client.playerId = player.id;
      room.hostId = player.id;
      room.players.push(player);
      send(client, { type: 'joined', playerId: player.id, token: player.token, code: room.code, key: room.key });
      broadcastLobby(room);
      break;
    }
    // กลับเข้าเกมด้วยข้อมูลที่เบราว์เซอร์จำไว้ (รีเฟรช/เน็ตหลุด)
    case 'rejoin': {
      if (client.roomCode) return;
      const room = rooms.get(String(msg.code || '').toUpperCase());
      const player = room?.players.find((x) => x.id === msg.playerId && x.token === msg.token);
      if (!room || !player || !room.game) return send(client, { type: 'rejoin_failed' });
      if (player.socket && player.socket !== client) { try { player.socket.close(); } catch {} }
      player.socket = client;
      clearTimeout(player.leaveTimer);
      client.roomCode = room.code;
      client.playerId = player.id;
      room.game.reconnectPlayer(player.id);
      send(client, { type: 'joined', playerId: player.id, token: player.token, code: room.code, key: room.key, rejoined: true });
      broadcastLobby(room);
      broadcastState(room);
      break;
    }
    case 'join_room': {
      if (client.roomCode) return;
      const name = String(msg.name || 'ผู้เล่น').slice(0, 16);
      const code = String(msg.code || '').trim().toUpperCase();
      const key = String(msg.key || '');
      const room = rooms.get(code);
      if (!room) return send(client, { type: 'error', message: 'ไม่พบห้องนี้' });
      if (room.key !== key) return send(client, { type: 'error', message: 'คีย์ห้องไม่ถูกต้อง' });
      if (room.status !== 'lobby') return send(client, { type: 'error', message: 'เกมเริ่มไปแล้ว เข้าไม่ได้' });
      if (room.players.length >= 6) return send(client, { type: 'error', message: 'ห้องเต็ม (สูงสุด 6 คน)' });
      const player = {
        id: randomUUID(), token: randomUUID(), name, color: COLORS[room.players.length % COLORS.length],
        socket: client, isHost: false, roomCode: room.code,
      };
      client.roomCode = room.code;
      client.playerId = player.id;
      room.players.push(player);
      send(client, { type: 'joined', playerId: player.id, token: player.token, code: room.code, key: room.key });
      broadcastLobby(room);
      break;
    }
    case 'start_game': {
      if (!room || room.status !== 'lobby') return;
      if (client.playerId !== room.hostId) return send(client, { type: 'error', message: 'เฉพาะโฮสต์เท่านั้นที่เริ่มเกมได้' });
      if (room.players.length < 2) return send(client, { type: 'error', message: 'ต้องมีผู้เล่นอย่างน้อย 2 คน' });
      room.status = 'playing';
      const gamePlayers = room.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, isHost: p.isHost,
      }));
      room.game = new Game({
        rows: room.size, cols: room.size,
        players: gamePlayers,
        questionBank: room.questions,
        demonEvery: room.demonEvery,
      });
      broadcastLobby(room);
      broadcastState(room);
      break;
    }
    case 'move': {
      if (!room?.game) return;
      const res = room.game.move(client.playerId, msg.dir);
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      broadcastState(room);
      break;
    }
    case 'end_turn': {
      if (!room?.game) return;
      const res = room.game.endTurn(client.playerId);
      if (res && !res.ok) return send(client, { type: 'error', message: res.msg });
      broadcastState(room);
      break;
    }
    case 'use_item': {
      if (!room?.game) return;
      const res = room.game.useItem(client.playerId, msg.item, msg.payload || {});
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      broadcastState(room);
      break;
    }
    case 'answer_question': {
      if (!room?.game) return;
      const res = room.game.answerQuestion(client.playerId, Number(msg.choice));
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      broadcastState(room);
      break;
    }
    case 'submit_win': {
      if (!room?.game) return;
      const res = room.game.submitWin(client.playerId, msg.cells);
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      broadcastState(room);
      break;
    }
    case 'cancel_win': {
      if (!room?.game) return;
      const res = room.game.cancelWin(client.playerId);
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      broadcastState(room);
      break;
    }
    case 'end_meeting': {
      if (!room?.game) return;
      const res = room.game.endMeeting(client.playerId);
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      broadcastState(room);
      break;
    }
    case 'chat': {
      if (!room) return;
      const p = room.players.find((x) => x.id === client.playerId);
      if (!p) return;
      const text = String(msg.text || '').slice(0, 500);
      if (!text.trim()) return;
      if (room.status === 'lobby') {
        broadcastChat(room, { from: p.id, fromName: p.name, text });
      } else if (room.game && room.game.pending && room.game.pending.type === 'meeting' && room.game.pending.participants.includes(p.id)) {
        broadcastChat(room, { from: p.id, fromName: p.name, text }, room.game.pending.participants);
      } else {
        send(client, { type: 'error', message: 'คุยได้เฉพาะตอนเจอกันเท่านั้น' });
      }
      break;
    }
    case 'propose_contract': {
      if (!room?.game) return;
      const res = room.game.proposeContract(client.playerId, msg.to, msg.give, msg.want);
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      const toPlayer = room.players.find((x) => x.id === msg.to);
      if (toPlayer) send(toPlayer.socket, {
        type: 'contract_proposal',
        contractId: res.contract.id,
        from: client.playerId,
        fromName: res.contract.fromName,
        give: res.contract.give,
        want: res.contract.want,
      });
      broadcastState(room);
      break;
    }
    // ---- แชร์ / แลกข้อมูลห้อง ระหว่างผู้เล่นที่ยังมีชีวิต (ตอนเจอกัน) ----
    case 'share_rooms': {
      if (!room?.game) return;
      const res = room.game.shareRooms(client.playerId, msg.to, msg.cells, { numbers: msg.numbers, doors: msg.doors });
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      const toPlayer = room.players.find((x) => x.id === msg.to);
      if (toPlayer) send(toPlayer.socket, { type: 'notice', message: res.count ? `🗺️ ${res.fromName} แชร์ข้อมูลห้องใหม่ให้คุณ ${res.count} ห้อง` : `🗺️ ${res.fromName} แชร์ข้อมูลให้ แต่คุณรู้อยู่แล้วทั้งหมด` });
      send(client, { type: 'notice', message: res.count ? `แชร์แล้ว — อีกฝ่ายได้ข้อมูลใหม่ ${res.count} ห้อง` : 'แชร์แล้ว — แต่อีกฝ่ายรู้ข้อมูลนี้อยู่แล้ว' });
      broadcastState(room);
      break;
    }
    case 'trade_offer': {
      if (!room?.game) return;
      const res = room.game.setTradeOffer(client.playerId, msg.to, msg.cells, { numbers: msg.numbers, doors: msg.doors });
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      broadcastState(room);
      break;
    }
    case 'trade_reject': {
      if (!room?.game) return;
      const res = room.game.rejectTrade(client.playerId, msg.to);
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      const toPlayer = room.players.find((x) => x.id === res.toId);
      if (toPlayer) send(toPlayer.socket, { type: 'notice', message: `❌ ${res.fromName} ปฏิเสธการแลกข้อมูล` });
      send(client, { type: 'notice', message: 'ปฏิเสธการแลกแล้ว' });
      broadcastState(room);
      break;
    }
    case 'trade_confirm': {
      if (!room?.game) return;
      const res = room.game.confirmTrade(client.playerId, msg.to);
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      if (res.done) {
        for (const [id, n] of [[res.a, res.nToA], [res.b, res.nToB]]) {
          const pl = room.players.find((x) => x.id === id);
          if (pl) send(pl.socket, { type: 'notice', message: n ? `🤝 แลกข้อมูลสำเร็จ — ได้ข้อมูลห้องใหม่ ${n} ห้อง` : '🤝 แลกข้อมูลสำเร็จ — แต่ข้อมูลที่ได้ คุณรู้อยู่แล้ว' });
        }
      }
      broadcastState(room);
      break;
    }
    case 'respond_contract': {
      if (!room?.game) return;
      const res = room.game.respondContract(msg.contractId, client.playerId, !!msg.accept);
      if (!res.ok) return send(client, { type: 'error', message: res.msg });
      broadcastState(room);
      break;
    }
    default:
      break;
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/ws')) {
    res.writeHead(400);
    res.end('WebSocket only');
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  socket.roomCode = null;
  socket.playerId = null;
  socket.on('message', (raw) => handleMessage(socket, raw));
  socket.on('close', () => {
    const room = roomOf(socket);
    if (!room) return;
    if (room.status === 'lobby') {
      room.players = room.players.filter((p) => p.id !== socket.playerId);
      if (room.players.length === 0) { rooms.delete(room.code); }
      else {
        if (room.hostId === socket.playerId && room.players.length) {
          room.hostId = room.players[0].id;
          room.players[0].isHost = true;
        }
        broadcastLobby(room);
      }
    } else if (room.game) {
      const player = room.players.find((p) => p.id === socket.playerId);
      if (!player || player.socket !== socket) return; // แท็บเก่าที่ถูกแทนที่แล้ว
      player.socket = null;
      room.game.disconnectPlayer(player.id);
      // รอให้กลับเข้าเกม ถ้าไม่กลับภายในเวลา → ถือว่าออกจากเกม
      player.leaveTimer = setTimeout(() => {
        if (player.socket) return;
        room.game.markLeft(player.id);
        if (room.players.every((p) => !p.socket)) { rooms.delete(room.code); return; }
        broadcastState(room);
      }, REJOIN_GRACE_MS);
      broadcastState(room);
    }
  });
});

// จับเวลาต่อตา: เช็กทุก 1 วินาที
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.game && room.game.status === 'playing' && room.game.tick(Date.now())) broadcastState(room);
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`Deadly Dungeon server running at http://localhost:${PORT}`);
  console.log(`WebSocket at ws://localhost:${PORT}/ws`);
});
