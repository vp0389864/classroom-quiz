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
  players?: { name: string; connected: boolean }[];
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
      <header className="site-header">
        <span className="logo">⚡ Classroom Quiz</span>
        <a href="/host" className="header-link">🖥️ Host Screen</a>
      </header>
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
    <div className="card">
      <form onSubmit={submit}>
        <h1>Join the quiz</h1>
        <p className="muted">Enter the room code from the projector screen to play.</p>
        <label htmlFor="code">Room code</label>
        <input id="code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={4}
          autoCapitalize="characters" autoComplete="off" placeholder="e.g. ABCD" required />
        <label htmlFor="name">Your Name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20}
          autoComplete="nickname" placeholder="e.g. Rahul" required />
        <p className="error">{error}</p>
        <button disabled={busy}>{busy ? 'Joining…' : 'Join Game'}</button>
      </form>
      <div className="host-prompt">
        <p className="muted">Hosting this quiz on a projector?</p>
        <a href="/host" className="secondary-link">Open Teacher / Host Screen →</a>
      </div>
    </div>
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
            <div className="status-pill">● Waiting for host</div>
            <h1>You&apos;re in, {s.name}!</h1>
            <p className="muted">Look at the projector screen. The teacher will start the quiz soon.</p>
            {s.players && s.players.length > 0 && (
              <div className="players-lobby-box">
                <p className="lobby-count">{s.players.length} player{s.players.length === 1 ? '' : 's'} in room:</p>
                <ul className="names names-small">
                  {s.players.map((p) => (
                    <li key={p.name} className={p.name === s.name ? 'is-me' : ''}>
                      {p.name} {p.name === s.name ? '(You)' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button className="subtle-btn" type="button" onClick={() => onReset(s.name)}>
              Change name / Leave room
            </button>
          </>
        )}
        {s.phase === 'question' && s.question && (
          <Ask key={s.question.index} q={s.question} myChoice={s.myChoice ?? null} />
        )}
        {s.phase === 'reveal' && s.question && s.correct !== undefined && (
          <div className="reveal-player-card">
            {s.myChoice == null ? (
              <div className="result-banner timeout">
                <span className="result-icon">⏰</span>
                <h2>Time&apos;s up!</h2>
                <p className="muted">No answer selected in time</p>
              </div>
            ) : s.myChoice === s.correct ? (
              <div className="result-banner good">
                <span className="result-icon">🎉</span>
                <h2>Correct!</h2>
                <span className="pts-badge">+{s.gained} pts</span>
              </div>
            ) : (
              <div className="result-banner bad">
                <span className="result-icon">❌</span>
                <h2>Not quite</h2>
                <span className="pts-badge">+0 pts</span>
              </div>
            )}

            <div className="standing-box">
              <div className="standing-item">
                <span className="standing-label">Current Rank</span>
                <span className="standing-val">#{s.rank ?? '—'} <small>of {s.playerCount ?? '—'}</small></span>
              </div>
              <div className="standing-item">
                <span className="standing-label">Total Score</span>
                <span className="standing-val gold">{s.score.toLocaleString()} pts</span>
              </div>
            </div>

            <p className="answer-note">The correct answer was: <strong>{s.question.options[s.correct]}</strong></p>

            <div className="projector-callout">
              <span className="proj-icon">📺</span>
              <div>
                <strong>Leaderboard is live on the big screen!</strong>
                <p className="muted">Look at the projector to see the top rankings.</p>
              </div>
            </div>
          </div>
        )}
        {s.phase === 'final' && (
          <div className="final-screen">
            <span className="final-medal">{s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : '🏆'}</span>
            <h1>You finished #{s.rank} of {s.playerCount}</h1>
            <p className="big gold">{s.score.toLocaleString()} points</p>
            <p className="muted">Great job! Thanks for playing.</p>
            <button type="button" onClick={() => onReset(s.name)}>
              Play again / Join new game
            </button>
          </div>
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
