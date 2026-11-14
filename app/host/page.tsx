'use client';
// Host / Projector page. Only this page (holding the host token) ever receives the leaderboard.
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
const SHAPES = ['▲', '◆', '●', '■'];

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

  const restart = async () => {
    await call('host:restart');
    save(KEY, null);
    return newGame();
  };

  return (
    <div className="app-shell host-shell">
      <Banner net={net} />
      <header className="navbar host-navbar">
        <div className="nav-brand">
          <span className="brand-dot host-dot" />
          <span className="brand-title">Classroom Quiz <small className="tag">Host</small></span>
        </div>
        <div className="nav-controls">
          {view.kind === 'game' && (
            <span className="code-pill">Room: <strong>{view.s.code}</strong></span>
          )}
          <a href="/" target="_blank" rel="noopener" className="nav-action">
            Open Player View ↗
          </a>
        </div>
      </header>
      <main className="container host-container">
        {view.kind === 'loading' && <Loading />}
        {view.kind === 'retry' && <RetryCard message={view.message} onRetry={view.retry} />}
        {view.kind === 'game' && <Screen s={view.s} restart={restart} />}
      </main>
    </div>
  );
}

function Screen({ s, restart }: { s: HostState; restart: () => Promise<unknown> }) {
  const next = () => call('host:next');
  const q = s.question;
  const [copied, setCopied] = useState(false);

  const origin = typeof location === 'undefined' ? '' : location.origin;
  const joinUrl = origin ? `${origin}/?code=${s.code}` : '';
  const qrUrl = joinUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinUrl)}` : '';

  function copyLink() {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (s.phase === 'lobby') {
    return (
      <div className="panel host-panel">
        <div className="lobby-hero">
          <div className="lobby-details">
            <span className="section-eyebrow">Classroom Session</span>
            <h1>Join on any phone or browser</h1>
            <p className="subtitle">
              Go to <strong className="highlight-text">{typeof location === 'undefined' ? '' : location.host}</strong>
            </p>

            <div className="room-code-card">
              <span className="room-code-label">GAME PIN</span>
              <span className="room-code-value">{s.code}</span>
              <button type="button" className="copy-btn" onClick={copyLink}>
                {copied ? '✓ Link Copied' : 'Copy Join Link'}
              </button>
            </div>

            <div className="roster-section">
              <div className="roster-header">
                <h3>Connected Players ({s.players.length})</h3>
                {s.players.length === 0 && <span className="waiting-pulse">Waiting for players…</span>}
              </div>
              <div className="roster-chips">
                {s.players.map((p) => (
                  <span key={p.name} className={`player-chip ${p.connected ? '' : 'is-offline'}`}>
                    <span className="status-indicator" />
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {qrUrl && (
            <div className="qr-panel">
              <div className="qr-frame">
                <img src={qrUrl} alt={`QR code for ${s.code}`} width={160} height={160} />
              </div>
              <span className="qr-caption">Scan with camera to join</span>
            </div>
          )}
        </div>

        <div className="lobby-action-bar">
          <ActionButton
            label={s.players.length === 0 ? 'Waiting for at least 1 player…' : `Start Quiz (${s.players.length} joined)`}
            action={next}
            disabled={s.players.length === 0}
          />
        </div>
      </div>
    );
  }

  if ((s.phase === 'question' || s.phase === 'reveal') && q) {
    const totalVotes = s.reveal ? s.reveal.counts.reduce((a, b) => a + b, 0) : 0;

    return (
      <div className="panel host-panel">
        <div className="qhead host-qhead">
          <span className="qprogress">
            Question {q.index + 1} of {q.total}
          </span>
          {s.phase === 'question' && <Countdown ms={q.remainingMs} />}
          {s.phase === 'reveal' && <span className="badge-pill">Round Complete</span>}
        </div>

        <h1 className="host-question-title">{q.text}</h1>

        <div className="host-options-grid">
          {q.options.map((text, i) => {
            const count = s.reveal ? s.reveal.counts[i] : 0;
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const isCorrect = s.reveal && i === s.reveal.correct;
            const isDim = s.reveal && i !== s.reveal.correct;

            return (
              <div
                key={i}
                className={`host-opt opt-${i} ${isCorrect ? 'is-correct' : ''} ${isDim ? 'is-dim' : ''}`}
              >
                {s.reveal && <div className="vote-fill" style={{ width: `${pct}%` }} />}
                <div className="opt-content">
                  <span className="opt-shape">{SHAPES[i]}</span>
                  <span className="opt-text">{text}</span>
                </div>
                {s.reveal && (
                  <div className="vote-count-badge">
                    {isCorrect && <span className="check-badge">✓</span>}
                    <span>{count} ({pct}%)</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {s.phase === 'question' ? (
          <div className="host-question-footer">
            <span className="answered-status">
              <strong>{s.answered}</strong> of <strong>{s.players.length}</strong> answered
            </span>
            <div className="action-wrapper">
              <ActionButton key={q.index} label="End Question Now" action={next} />
            </div>
          </div>
        ) : (
          <div className="host-reveal-section">
            <div className="source-row">
              <span className="source-label">Source Reference:</span>
              <a className="source-link" href={s.reveal!.source} target="_blank" rel="noopener">
                {s.reveal!.source} ↗
              </a>
            </div>

            <div className="leaderboard-section">
              <h2>Leaderboard</h2>
              <Ranking list={s.leaderboard!.slice(0, 10)} />
            </div>

            <div className="host-action-footer">
              <ActionButton
                key={'r' + q.index}
                label={q.index + 1 < q.total ? 'Next Question →' : 'View Final Standings →'}
                action={next}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="panel host-panel final-panel">
      <div className="final-header">
        <span className="section-eyebrow">Tournament Concluded</span>
        <h1>Final Leaderboard</h1>
      </div>
      <Ranking list={s.leaderboard ?? []} />
      <div className="final-action-footer">
        <ActionButton label="Start New Game" action={restart} />
      </div>
    </div>
  );
}

function Ranking({ list }: { list: Entry[] }) {
  return (
    <div className="leaderboard-list">
      {list.map((p, idx) => (
        <div key={p.name} className={`leaderboard-row rank-${idx + 1}`}>
          <div className="row-left">
            <span className="rank-position">
              {idx === 0 ? '1' : idx === 1 ? '2' : idx === 2 ? '3' : idx + 1}
            </span>
            <span className="player-name">{p.name}</span>
          </div>
          <span className="player-score">{p.score.toLocaleString()} pts</span>
        </div>
      ))}
      {list.length === 0 && <p className="subtitle">No scores recorded.</p>}
    </div>
  );
}

function ActionButton({
  label,
  action,
  disabled,
}: {
  label: string;
  action: () => Promise<Reply | unknown>;
  disabled?: boolean;
}) {
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
    <div className="action-button-group">
      <button className="btn btn-primary btn-large" disabled={disabled || busy} onClick={click}>
        {busy ? 'Processing…' : label}
      </button>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
