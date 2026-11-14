'use client';
// Player phone page.
import { useEffect, useState, type FormEvent } from 'react';
import { Banner, call, Countdown, load, Loading, RetryCard, save, useQuiz, type Question } from '@/lib/client';

type PlayerState = {
  phase: 'lobby' | 'question' | 'reveal' | 'final' | 'ended';
  code: string;
  name: string;
  score: number;
  total: number;
  question?: Question;
  myChoice?: number | null;
  correct?: number; // only present after the question closes
  gained?: number;
  rank?: number;
  playerCount?: number;
};
type Saved = { code: string; token?: string; name: string };
type View = { kind: 'loading' } | { kind: 'join'; message?: string } | { kind: 'retry'; message: string } | { kind: 'game'; s: PlayerState };

const KEY = 'quiz:player';

export default function PlayerPage() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  // Runs on every (re)connect: a saved token puts the player back in their game with their score.
  async function rejoin() {
    const saved = load<Saved>(KEY);
    if (!saved?.token) return setView({ kind: 'join' });
    const res = await call('player:join', { code: saved.code, token: saved.token });
    if (res.ok) return; // the server pushes our state
    if (res.gone) {
      save(KEY, { code: '', name: saved.name });
      return setView({ kind: 'join', message: res.error });
    }
    setView({ kind: 'retry', message: res.error ?? 'Something went wrong.' });
  }

  function handleReset(name: string) {
    save(KEY, { code: '', name });
    call('player:leave');
    setView({ kind: 'join' });
  }

  const net = useQuiz<PlayerState>(rejoin, (s) => setView({ kind: 'game', s }));

  return (
    <>
      <Banner net={net} />
      <main>
        {view.kind === 'loading' && <Loading />}
        {view.kind === 'join' && <JoinForm message={view.message} />}
        {view.kind === 'retry' && <RetryCard message={view.message} onRetry={rejoin} />}
        {view.kind === 'game' && <Game s={view.s} onReset={handleReset} />}
      </main>
    </>
  );
}

function JoinForm({ message }: { message?: string }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(message ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = load<Saved>(KEY);
    setCode(new URLSearchParams(location.search).get('code') || saved?.code || '');
    setName(saved?.name ?? '');
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await call('player:join', { code, name });
    if (res.ok) {
      save(KEY, { code: code.trim().toUpperCase(), token: res.token, name: res.name });
      return; // state push switches the view
    }
    setError(res.error ?? 'Could not join.');
    setBusy(false);
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>Join the quiz</h1>
      <label htmlFor="code">Room code</label>
      <input id="code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={4}
        autoCapitalize="characters" autoComplete="off" placeholder="e.g. ABCD" required />
      <label htmlFor="name">Name</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20}
        autoComplete="nickname" placeholder="Your nickname" required />
      <p className="error">{error}</p>
      <button disabled={busy}>{busy ? 'Joining…' : 'Join'}</button>
    </form>
  );
}

function Game({ s, onReset }: { s: PlayerState; onReset: (name: string) => void }) {
  return (
    <>
      {s.phase !== 'ended' && (
        <div className="topline">
          <span>{s.name}</span>
          <span>{s.score.toLocaleString()} pts</span>
        </div>
      )}
      <div className="card">
        {s.phase === 'lobby' && (
          <>
            <h1>You&apos;re in!</h1>
            <p className="muted">Watch the big screen. The quiz starts soon.</p>
            <button className="subtle-btn" type="button" onClick={() => onReset(s.name)}>
              Change name / Leave
            </button>
          </>
        )}
        {s.phase === 'question' && s.question && (
          <Ask key={s.question.index} q={s.question} myChoice={s.myChoice ?? null} />
        )}
        {s.phase === 'reveal' && s.question && s.correct !== undefined && (
          <>
            {s.myChoice == null ? <h1>Time&apos;s up</h1>
              : s.myChoice === s.correct ? <h1 className="good">Correct! +{s.gained}</h1>
              : <h1 className="bad">Not quite</h1>}
            <p>The answer was: {s.question.options[s.correct]}</p>
            <p className="muted">Look at the big screen for the leaderboard.</p>
          </>
        )}
        {s.phase === 'final' && (
          <>
            <h1>You finished #{s.rank} of {s.playerCount}</h1>
            <p className="big">{s.score.toLocaleString()} points</p>
            <p className="muted">Thanks for playing!</p>
            <button type="button" onClick={() => onReset(s.name)}>
              Play again / Join another game
            </button>
          </>
        )}
        {s.phase === 'ended' && (
          <>
            <h1>Quiz Finished</h1>
            <p className="muted">The host has closed this room or started a new game.</p>
            <button type="button" onClick={() => onReset(s.name)}>
              Join next game
            </button>
          </>
        )}
      </div>
    </>
  );
}

function Ask({ q, myChoice }: { q: Question; myChoice: number | null }) {
  const [pending, setPending] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const picked = myChoice ?? pending;

  async function answer(i: number) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(40); } catch {}
    }
    setPending(i);
    setMsg('Sending…');
    const res = await call('player:answer', { index: q.index, choice: i });
    if (res.ok) return setMsg('');
    setMsg(res.error ?? 'Could not send.');
    if (res.timeout) setPending(null); // let them tap again; the server ignores duplicates
  }

  return (
    <>
      <div className="qhead">
        <span className="muted">Question {q.index + 1} of {q.total}</span>
        <Countdown ms={q.remainingMs} />
      </div>
      <h2>{q.text}</h2>
      <div className="options">
        {q.options.map((text, i) => (
          <button key={i} className={`opt opt${i}${picked === i ? ' picked' : ''}`}
            disabled={picked !== null} onClick={() => answer(i)}>
            {text}
          </button>
        ))}
      </div>
      <p className="error">{msg}</p>
      {myChoice !== null && <p className="muted">Answer locked in. Wait for the others…</p>}
    </>
  );
}
