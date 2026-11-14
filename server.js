// One process serves the Next.js pages and the Socket.IO game.
// ponytail: custom server because Vercel-style serverless can't hold live sockets; deploy to any Node host.
const http = require('http');
const createNext = require('next');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QUESTIONS = require('./questions');

const QUESTION_MS = 20_000;     // time players have per question
const GRACE_MS = 500;           // accept answers sent just before the buzzer but delayed by mobile data
const MAX_PLAYERS = 100;
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const PORT = process.env.PORT || 3000;

// Until Next is ready (and in `npm test`, which never starts it) pages answer 503.
let handle = (_req, res) => {
  res.statusCode = 503;
  res.end('Starting, refresh in a moment.');
};
const server = http.createServer((req, res) => handle(req, res));
// Same-origin only (no CORS), so other sites can't open sockets as a player.
// destroyUpgrade: false leaves Next's own dev-reload websocket alone.
const io = new Server(server, { destroyUpgrade: false });

// ponytail: all state in memory, single process. A restart ends running games; add Redis if that matters.
const rooms = new Map();

const newToken = () => crypto.randomBytes(16).toString('hex');
function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, easy to read off a projector
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function leaderboard(room) {
  return [...room.players.values()]
    .map((p) => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

// What everyone may see about the current question. Never includes `answer`.
function questionView(room) {
  const q = QUESTIONS[room.qIndex];
  return {
    index: room.qIndex,
    total: QUESTIONS.length,
    text: q.text,
    options: q.options,
    remainingMs: room.phase === 'question' ? Math.max(0, room.deadline - Date.now()) : 0,
  };
}

function answeredCount(room) {
  let n = 0;
  for (const p of room.players.values()) if (p.answers[room.qIndex]) n++;
  return n;
}

function hostState(room) {
  const s = {
    phase: room.phase,
    code: room.code,
    total: QUESTIONS.length,
    players: [...room.players.values()].map((p) => ({ name: p.name, connected: p.sockets > 0 })),
  };
  if (room.phase === 'question' || room.phase === 'reveal') {
    s.question = questionView(room);
    s.answered = answeredCount(room);
  }
  if (room.phase === 'reveal') {
    const q = QUESTIONS[room.qIndex];
    const counts = q.options.map(() => 0);
    for (const p of room.players.values()) {
      const a = p.answers[room.qIndex];
      if (a) counts[a.choice]++;
    }
    s.reveal = { correct: q.answer, source: q.source, counts };
  }
  if (room.phase === 'reveal' || room.phase === 'final') s.leaderboard = leaderboard(room);
  return s;
}

// A player only ever sees their own score, never anyone else's.
function playerState(room, p) {
  const s = { phase: room.phase, code: room.code, name: p.name, score: p.score, total: QUESTIONS.length };
  if (room.phase === 'question' || room.phase === 'reveal') {
    s.question = questionView(room);
    const a = p.answers[room.qIndex];
    s.myChoice = a ? a.choice : null;
  }
  if (room.phase === 'reveal') {
    const a = p.answers[room.qIndex];
    s.correct = QUESTIONS[room.qIndex].answer;
    s.gained = a ? a.points : 0;
  }
  if (room.phase === 'final') {
    s.rank = leaderboard(room).findIndex((x) => x.name === p.name) + 1;
    s.playerCount = room.players.size;
  }
  return s;
}

function broadcast(room) {
  room.lastActivity = Date.now();
  io.to(`host:${room.code}`).emit('state', hostState(room));
  for (const p of room.players.values()) io.to(`player:${p.token}`).emit('state', playerState(room, p));
}

function openQuestion(room, index) {
  room.phase = 'question';
  room.qIndex = index;
  room.deadline = Date.now() + QUESTION_MS;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => closeQuestion(room), QUESTION_MS + GRACE_MS);
  broadcast(room);
}

function closeQuestion(room) {
  if (room.phase !== 'question') return;
  clearTimeout(room.timer);
  room.phase = 'reveal';
  broadcast(room);
}

function next(room) {
  if (room.phase === 'lobby') openQuestion(room, 0);
  else if (room.phase === 'question') closeQuestion(room); // host skips the wait
  else if (room.phase === 'reveal') {
    if (room.qIndex + 1 < QUESTIONS.length) openQuestion(room, room.qIndex + 1);
    else {
      room.phase = 'final';
      broadcast(room);
    }
  }
}

function score(room, p, choice) {
  const now = Date.now();
  if (room.phase !== 'question' || now > room.deadline + GRACE_MS) return { error: 'Time is up for this question.' };
  if (p.answers[room.qIndex]) return { ok: true }; // already answered; retries are harmless
  const correct = choice === QUESTIONS[room.qIndex].answer;
  const left = Math.max(0, room.deadline - now);
  // 500 for a right answer, plus up to 500 more for answering quickly.
  const points = correct ? 500 + Math.round((500 * left) / QUESTION_MS) : 0;
  p.answers[room.qIndex] = { choice, points };
  p.score += points;
  // Only the host's counter and this player's screen change; don't redraw everyone mid-tap.
  room.lastActivity = now;
  io.to(`host:${room.code}`).emit('state', hostState(room));
  io.to(`player:${p.token}`).emit('state', playerState(room, p));
  return { ok: true };
}

const isStr = (v, max) => typeof v === 'string' && v.length <= max;

io.on('connection', (socket) => {
  const reply = (ack, data) => typeof ack === 'function' && ack(data);
  const hostRoom = () => socket.data.hostOf && rooms.get(socket.data.hostOf);

  socket.on('host:create', (_data, ack) => {
    if (rooms.size >= 1000) return reply(ack, { error: 'Server is full, try again later.' });
    const room = {
      code: newCode(),
      hostToken: newToken(),
      players: new Map(), // token -> player
      phase: 'lobby',
      qIndex: 0,
      deadline: 0,
      timer: null,
      lastActivity: Date.now(),
    };
    rooms.set(room.code, room);
    socket.data.hostOf = room.code;
    socket.join(`host:${room.code}`);
    reply(ack, { ok: true, code: room.code, hostToken: room.hostToken });
    socket.emit('state', hostState(room));
  });

  socket.on('host:resume', (data, ack) => {
    const room = data && isStr(data.code, 8) && rooms.get(data.code);
    if (!room || !isStr(data.hostToken, 64) || data.hostToken !== room.hostToken) {
      return reply(ack, { error: 'That game has ended.' });
    }
    socket.data.hostOf = room.code;
    socket.join(`host:${room.code}`);
    reply(ack, { ok: true });
    socket.emit('state', hostState(room));
  });

  socket.on('host:next', (_data, ack) => {
    const room = hostRoom();
    if (!room) return reply(ack, { error: 'Not the host of a game.' });
    if (room.phase === 'lobby' && room.players.size === 0) return reply(ack, { error: 'Wait for at least one player.' });
    next(room);
    reply(ack, { ok: true });
  });

  socket.on('player:join', (data, ack) => {
    if (!data) return reply(ack, { error: 'Bad request.' });
    const code = isStr(data.code, 8) ? data.code.trim().toUpperCase() : '';
    const room = rooms.get(code);
    if (!room) return reply(ack, { error: 'No game with that code. Check the code on the screen.', gone: true });

    // Rejoin after refresh / dropped connection: the token from localStorage identifies the player.
    let p = isStr(data.token, 64) ? room.players.get(data.token) : null;
    if (!p) {
      if (data.token) return reply(ack, { error: 'Your earlier session is gone. Join again.', gone: true });
      const name = isStr(data.name, 100) ? data.name.trim().replace(/\s+/g, ' ') : '';
      if (!name || name.length > 20) return reply(ack, { error: 'Enter a name of 1 to 20 characters.' });
      if ([...room.players.values()].some((x) => x.name.toLowerCase() === name.toLowerCase())) {
        return reply(ack, { error: 'Someone already has that name. Pick another.' });
      }
      if (room.players.size >= MAX_PLAYERS) return reply(ack, { error: 'This game is full.' });
      p = { token: newToken(), name, score: 0, answers: {}, sockets: 0 };
      room.players.set(p.token, p);
    }
    if (socket.data.player !== p) {
      p.sockets++;
      socket.data.player = p;
      socket.data.playerRoom = room.code;
      socket.join(`player:${p.token}`);
    }
    reply(ack, { ok: true, token: p.token, name: p.name });
    broadcast(room);
  });

  socket.on('player:answer', (data, ack) => {
    const p = socket.data.player;
    const room = p && rooms.get(socket.data.playerRoom);
    if (!room) return reply(ack, { error: 'You are not in a game.' });
    const choice = data && data.choice;
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) return reply(ack, { error: 'Bad answer.' });
    if (data.index !== room.qIndex) return reply(ack, { error: 'That question has closed.' });
    reply(ack, score(room, p, choice));
  });

  socket.on('player:leave', (_data, ack) => {
    const p = socket.data.player;
    const room = p && rooms.get(socket.data.playerRoom);
    if (room && p) {
      p.sockets = Math.max(0, p.sockets - 1);
      if (room.phase === 'lobby') {
        room.players.delete(p.token);
      }
      socket.leave(`player:${p.token}`);
      delete socket.data.player;
      delete socket.data.playerRoom;
      io.to(`host:${room.code}`).emit('state', hostState(room));
    }
    reply(ack, { ok: true });
  });

  socket.on('host:restart', (_data, ack) => {
    const room = hostRoom();
    if (room) {
      clearTimeout(room.timer);
      for (const p of room.players.values()) {
        io.to(`player:${p.token}`).emit('state', { phase: 'ended' });
      }
      rooms.delete(room.code);
      delete socket.data.hostOf;
    }
    reply(ack, { ok: true });
  });

  socket.on('disconnect', () => {
    const p = socket.data.player;
    const room = p && rooms.get(socket.data.playerRoom);
    if (!room) return;
    p.sockets--;
    io.to(`host:${room.code}`).emit('state', hostState(room));
  });
});

setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if (room.lastActivity < cutoff) {
      clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  const dev = process.argv.includes('--dev');
  const app = createNext({ dev, dir: __dirname });
  app.prepare().then(() => {
    handle = app.getRequestHandler();
    server.on('upgrade', (req, socket, head) => {
      if (!req.url.startsWith('/socket.io')) app.getUpgradeHandler()(req, socket, head);
    });
    server.listen(PORT, () => console.log(`Quiz on http://localhost:${PORT}${dev ? ' (dev)' : ''}`));
  });
}

module.exports = { server, QUESTION_MS };
