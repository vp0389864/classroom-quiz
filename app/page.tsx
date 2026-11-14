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
const SHAPES = ['▲', '◆', '●', '■'];

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
    <div className="app-shell">
      <Banner net={net} />
      <header className="navbar">
        <div className="nav-brand">
          <span className="brand-dot" />
          <span className="brand-title">Classroom Quiz</span>
        </div>
        <a href="/host" className="nav-action">Host Screen ↗</a>
      </header>
      <main className="container">
        {view.kind === 'loading' && <Loading />}
        {view.kind === 'join' && <JoinForm message={view.message} />}
        {view.kind === 'retry' && <RetryCard message={view.message} onRetry={rejoin} />}
        {view.kind === 'game' && <Game s={view.s} onReset={handleReset} />}
      </main>
    </div>
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
    <div className="panel join-panel">
      <div className="panel-header">
        <h1>Join Quiz</h1>
        <p className="subtitle">Enter the 4-letter room code to play</p>
      </div>
      <form onSubmit={submit} className="form-stack">
        <div className="field">
          <label htmlFor="code">Room Code</label>
          <input
            id="code"
            className="input-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABCD"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="name">Your Nickname</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoComplete="nickname"
            placeholder="e.g. Alex"
            required
          />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Joining…' : 'Enter Game'}
        </button>
      </form>
      <div className="panel-footer">
        <span>Running a quiz as host?</span>
        <a href="/host" className="link-subtle">Open Host Screen</a>
      </div>
    </div>
  );
}

function Game({ s, onReset }: { s: PlayerState; onReset: (name: string) => void }) {
  const showTopBar = s.phase === 'question' || s.phase === 'reveal';

  return (
    <>
      {showTopBar && (
        <div className="game-bar">
          <span className="player-badge">{s.name}</span>
          <span className="score-badge">{s.score.toLocaleString()} pts</span>
        </div>
      )}

      <div className="panel game-panel">
        {s.phase === 'lobby' && (
          <div className="lobby-content">
            <div className="badge-pill">Connected to Room {s.code}</div>
            <h2>You&apos;re in, {s.name}!</h2>
            <p className="subtitle">Waiting for the host to start the quiz…</p>

            {s.players && s.players.length > 0 && (
              <div className="player-roster">
                <div className="roster-header">
                  <span>Players in Room</span>
                  <span className="roster-count">{s.players.length}</span>
                </div>
                <div className="roster-tags">
                  {s.players.map((p) => (
                    <span key={p.name} className={`player-chip ${p.name === s.name ? 'is-self' : ''}`}>
                      {p.name} {p.name === s.name ? '(You)' : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button className="btn btn-ghost" type="button" onClick={() => onReset(s.name)}>
              Change Nickname / Leave
            </button>
          </div>
        )}

        {s.phase === 'question' && s.question && (
          <Ask key={s.question.index} q={s.question} myChoice={s.myChoice ?? null} />
        )}

        {s.phase === 'reveal' && s.question && s.correct !== undefined && (
          <div className="reveal-content">
            {s.myChoice == null ? (
              <div className="result-card result-timeout">
                <span className="result-title">Time Expired</span>
                <span className="result-desc">No answer submitted</span>
              </div>
            ) : s.myChoice === s.correct ? (
              <div className="result-card result-correct">
                <span className="result-title">Correct</span>
                <span className="result-points">+{s.gained} pts</span>
              </div>
            ) : (
              <div className="result-card result-wrong">
                <span className="result-title">Incorrect</span>
                <span className="result-points">+0 pts</span>
              </div>
            )}

            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">Current Rank</span>
                <span className="stat-value">
                  #{s.rank ?? '—'} <small>/ {s.playerCount ?? '—'}</small>
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Total Score</span>
                <span className="stat-value highlight">{s.score.toLocaleString()}</span>
              </div>
            </div>

            <div className="correct-answer-box">
              <span className="box-label">Correct Option:</span>
              <span className="box-value">{s.question.options[s.correct]}</span>
            </div>

            <p className="waiting-note">Waiting for host to proceed…</p>
          </div>
        )}

        {s.phase === 'final' && (
          <div className="final-content">
            <div className="badge-pill">Quiz Complete</div>
            <h2>Final Result</h2>
            <div className="final-rank-box">
              <span className="final-rank-number">#{s.rank}</span>
              <span className="final-rank-label">out of {s.playerCount} players</span>
            </div>
            <p className="final-score-display">{s.score.toLocaleString()} pts</p>

            <button className="btn btn-primary" type="button" onClick={() => onReset(s.name)}>
              Play Again / Join New Quiz
            </button>
          </div>
        )}

        {s.phase === 'ended' && (
          <div className="ended-content">
            <h2>Game Concluded</h2>
            <p className="subtitle">The host has ended this game session.</p>
            <button className="btn btn-primary" type="button" onClick={() => onReset(s.name)}>
              Join New Game
            </button>
          </div>
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
      try { navigator.vibrate(30); } catch {}
    }
    setPending(i);
    setMsg('Sending…');
    const res = await call('player:answer', { index: q.index, choice: i });
    if (res.ok) return setMsg('');
    setMsg(res.error ?? 'Could not send.');
    if (res.timeout) setPending(null);
  }

  return (
    <div className="question-content">
      <div className="qhead">
        <span className="qprogress">Question {q.index + 1} of {q.total}</span>
        <Countdown ms={q.remainingMs} />
      </div>

      <h2 className="question-title">{q.text}</h2>

      <div className="options-grid">
        {q.options.map((text, i) => (
          <button
            key={i}
            className={`opt-btn opt-${i} ${picked === i ? 'is-selected' : ''}`}
            disabled={picked !== null}
            onClick={() => answer(i)}
          >
            <span className="opt-shape">{SHAPES[i]}</span>
            <span className="opt-label">{text}</span>
          </button>
        ))}
      </div>

      {msg && <p className="form-error">{msg}</p>}

      {picked !== null && (
        <div className="lock-indicator">
          <span className="lock-dot" />
          <span>Answer submitted. Waiting for timer…</span>
        </div>
      )}
    </div>
  );
}
