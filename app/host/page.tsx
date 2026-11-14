'use client';
// Projector page. Only this page (holding the host token) ever receives the leaderboard.
import { useState } from 'react';
import { Banner, call, Countdown, load, Loading, RetryCard, save, useQuiz, type Question, type Reply } from '@/lib/client';

type Entry = { name: string; score: number };
type HostState = {
  phase: 'lobby' | 'question' | 'reveal' | 'final';
  code: string;
  total: number;
  players: { name: string; connected: boolean }[];
  question?: Question;
  answered?: number;
  reveal?: { correct: number; source: string; counts: number[] };
  leaderboard?: Entry[];
};
type View = { kind: 'loading' } | { kind: 'retry'; message: string; retry: () => void } | { kind: 'game'; s: HostState };

const KEY = 'quiz:host';

export default function HostPage() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  async function newGame() {
    const res = await call('host:create');
    if (!res.ok) return setView({ kind: 'retry', message: res.error ?? 'Could not create a game.', retry: newGame });
    save(KEY, { code: res.code, hostToken: res.hostToken });
  }

  // On every (re)connect: resume our game if we have one, otherwise start a new one.
  async function resume() {
    const saved = load<{ code: string; hostToken: string }>(KEY);
    if (!saved) return newGame();
    const res = await call('host:resume', saved);
    if (res.ok) return;
    if (res.timeout) return setView({ kind: 'retry', message: res.error!, retry: resume });
    save(KEY, null);
    newGame();
  }

  const net = useQuiz<HostState>(resume, (s) => setView({ kind: 'game', s }));
  const restart = () => {
    save(KEY, null);
    return newGame();
  };

  return (
    <>
      <Banner net={net} />
      <main className="host">
        {view.kind === 'loading' && <Loading />}
        {view.kind === 'retry' && <RetryCard message={view.message} onRetry={view.retry} />}
        {view.kind === 'game' && <Screen s={view.s} restart={restart} />}
      </main>
    </>
  );
}

function Screen({ s, restart }: { s: HostState; restart: () => Promise<unknown> }) {
  const next = () => call('host:next');
  const q = s.question;

  if (s.phase === 'lobby') {
    const joinAt = typeof location === 'undefined' ? '' : location.host;
    return (
      <div className="card">
        <p className="muted">Join at {joinAt}</p>
        <p className="muted">Room code</p>
        <div className="code">{s.code}</div>
        <h2>{s.players.length} player{s.players.length === 1 ? '' : 's'} joined</h2>
        <ul className="names">
          {s.players.map((p) => <li key={p.name} className={p.connected ? '' : 'offline'}>{p.name}</li>)}
        </ul>
        <ActionButton label="Start quiz" action={next} />
      </div>
    );
  }

  if ((s.phase === 'question' || s.phase === 'reveal') && q) {
    return (
      <div className="card">
        <div className="qhead">
          <span className="muted">Question {q.index + 1} of {q.total} · Room {s.code}</span>
          {s.phase === 'question' && <Countdown ms={q.remainingMs} />}
        </div>
        <h1>{q.text}</h1>
        <div className="options">
          {q.options.map((text, i) => (
            <div key={i} className={`opt opt${i}${s.reveal ? (i === s.reveal.correct ? ' right' : ' dim') : ''}`}>
              {text}
              {s.reveal && <small> · {s.reveal.counts[i]}</small>}
            </div>
          ))}
        </div>
        {s.phase === 'question' ? (
          <>
            <p className="big">{s.answered} of {s.players.length} answered</p>
            <ActionButton key={q.index} label="Close question now" action={next} />
          </>
        ) : (
          <>
            <a className="muted" href={s.reveal!.source} target="_blank" rel="noopener">Source</a>
            <h2>Leaderboard</h2>
            <Ranking list={s.leaderboard!.slice(0, 10)} />
            <ActionButton key={'r' + q.index} label={q.index + 1 < q.total ? 'Next question' : 'Final results'} action={next} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Final ranking</h1>
      <Ranking list={s.leaderboard ?? []} />
      <ActionButton label="New game" action={restart} />
    </div>
  );
}

function Ranking({ list }: { list: Entry[] }) {
  return (
    <ol className="board">
      {list.map((p) => (
        <li key={p.name}><span>{p.name}</span><span>{p.score.toLocaleString()}</span></li>
      ))}
    </ol>
  );
}

// Disables itself while waiting; shows the server's error (or timeout) and re-enables.
function ActionButton({ label, action }: { label: string; action: () => Promise<Reply | unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function click() {
    setBusy(true);
    setError('');
    const res = (await action()) as Reply | undefined;
    if (res?.error) {
      setError(res.error);
      setBusy(false);
    }
  }
  return (
    <>
      <button disabled={busy} onClick={click}>{label}</button>
      <p className="error">{error}</p>
    </>
  );
}
