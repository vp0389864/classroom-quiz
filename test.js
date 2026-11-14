// End-to-end check: 10 players, answer secrecy, refresh-rejoin, no public scores. Run: npm test
const assert = require('assert');
const { io } = require('socket.io-client');
const { server } = require('./server');
const QUESTIONS = require('./questions');

const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
const nextState = (s, pred = () => true) =>
  new Promise((r) => s.on('state', function h(st) { if (pred(st)) { s.off('state', h); r(st); } }));

server.listen(0, async () => {
  const url = `http://localhost:${server.address().port}`;
  const clients = [];
  const connect = () => { const s = io(url, { transports: ['websocket'], forceNew: true }); clients.push(s); return s; };
  const leaks = [];
  const watch = (s, who) => s.on('state', (st) => {
    if (st.phase === 'question' && (st.correct !== undefined || st.reveal || JSON.stringify(st).includes('"answer"'))) leaks.push(who);
  });

  const host = connect();
  watch(host, 'host');
  const { code, hostToken } = await call(host, 'host:create');
  assert.match(code, /^[A-Z]{4}$/);

  const players = [];
  for (let i = 0; i < 10; i++) {
    const s = connect();
    watch(s, 'p' + i);
    const res = await call(s, 'player:join', { code, name: 'Player ' + i });
    assert.ok(res.ok, res.error);
    players.push({ s, token: res.token });
  }
  assert.ok((await call(connect(), 'player:join', { code, name: 'player 0' })).error, 'duplicate name rejected');
  assert.ok((await call(connect(), 'host:next')).error, 'non-host cannot start');

  for (let q = 0; q < QUESTIONS.length; q++) {
    const reveal = nextState(host, (st) => st.phase === 'reveal');
    const asked = await Promise.all([
      call(host, 'host:next'),
      ...players.map((p) => nextState(p.s, (st) => st.phase === 'question' && st.question.index === q)),
    ]);
    assert.strictEqual(asked[1].question.remainingMs > 15000, true);

    if (q === 2) {
      // Player 0 "refreshes": new socket, same token, mid-question.
      const scoreBefore = asked[1].score;
      players[0].s.disconnect();
      const s = connect();
      watch(s, 'p0-rejoined');
      const st = nextState(s);
      const res = await call(s, 'player:join', { code, token: players[0].token });
      assert.ok(res.ok && res.name === 'Player 0', 'rejoin keeps identity');
      const back = await st;
      assert.strictEqual(back.phase, 'question', 'rejoins straight into the open question');
      assert.strictEqual(back.score, scoreBefore, 'rejoin keeps score');
      assert.ok(scoreBefore > 0);
      players[0].s = s;
    }

    // Players 0-4 answer right, 5-9 answer wrong.
    await Promise.all(players.map((p, i) =>
      call(p.s, 'player:answer', { index: q, choice: i < 5 ? QUESTIONS[q].answer : (QUESTIONS[q].answer + 1) % 4 })));
    await call(host, 'host:next');
    const r = await reveal;
    assert.strictEqual(r.reveal.correct, QUESTIONS[q].answer);
    assert.strictEqual(r.reveal.counts[QUESTIONS[q].answer], 5);
  }

  // Score survived the refresh: player 0 got 5 right answers worth 500-1000 each.
  const finalState = nextState(players[0].s, (st) => st.phase === 'final');
  await call(host, 'host:next');
  const fin = await finalState;
  assert.ok(fin.score >= 2500 && fin.score <= 5000, 'score kept after rejoin: ' + fin.score);
  assert.ok(fin.rank >= 1 && fin.rank <= 5);
  assert.strictEqual(fin.leaderboard, undefined, 'players never get the leaderboard');

  assert.deepStrictEqual(leaks, [], 'answer leaked during question to: ' + leaks);

  // Nothing readable over plain HTTP: no source files, no score endpoint.
  for (const path of ['/questions.js', '/server.js', '/package.json', '/api/scores', '/scores', `/${code}`]) {
    const res = await fetch(url + path);
    const body = await res.text();
    assert.ok(!body.includes('Player 0') && !body.includes('answer:'), path + ' leaks data');
  }
  // Wrong host token can't take over the game.
  assert.ok((await call(connect(), 'host:resume', { code, hostToken: 'x' + hostToken.slice(1) })).error);

  console.log('All checks passed: 10 players, no answer leak, rejoin keeps score, scores not public.');
  clients.forEach((s) => s.disconnect());
  server.close();
  server.closeAllConnections();
  process.exitCode = 0;
});
setTimeout(() => { console.error('Timed out'); process.exit(1); }, 30000).unref();
