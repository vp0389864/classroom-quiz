'use client';
// Shared by the host and player pages: one socket, calls with timeouts, connection banner, countdown.
import { useEffect, useEffectEvent, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export type Net = 'connecting' | 'online' | 'reconnecting' | 'offline';
export type Reply = { ok?: boolean; error?: string; timeout?: boolean; gone?: boolean; [k: string]: unknown };

let socket: Socket | null = null;
function getSocket() {
  socket ??= io({ reconnectionDelayMax: 3000 });
  return socket;
}

// Emit and wait for the server's reply. Resolves {error} on timeout instead of hanging.
export function call(event: string, data?: unknown): Promise<Reply> {
  return new Promise((resolve) => {
    getSocket()
      .timeout(8000)
      .emit(event, data, (err: Error | null, res: Reply) =>
        resolve(err ? { error: 'The server did not answer. Try again.', timeout: true } : res)
      );
  });
}

// Connects, calls onConnect on every (re)connect, forwards 'state' pushes, and reports connection health.
export function useQuiz<S>(onConnect: () => void, onState: (s: S) => void): Net {
  const [net, setNet] = useState<Net>('connecting');
  const connected = useEffectEvent(onConnect);
  const gotState = useEffectEvent(onState);

  useEffect(() => {
    const s = getSocket();
    let offline: ReturnType<typeof setTimeout> | undefined;
    const lost = () => {
      setNet('reconnecting');
      offline ??= setTimeout(() => !s.connected && setNet('offline'), 10000);
    };
    const up = () => {
      clearTimeout(offline);
      offline = undefined;
      setNet('online');
      connected();
    };
    const state = (st: S) => gotState(st);
    s.on('connect', up);
    s.on('disconnect', lost);
    s.on('connect_error', lost);
    s.on('state', state);
    if (s.connected) up();
    return () => {
      clearTimeout(offline);
      s.off('connect', up);
      s.off('disconnect', lost);
      s.off('connect_error', lost);
      s.off('state', state);
    };
  }, []);
  return net;
}

export function Banner({ net }: { net: Net }) {
  if (net === 'online' || net === 'connecting') return null;
  return (
    <div id="banner" role="alert">
      {net === 'offline' ? (
        <>
          <span>Can&apos;t reach the quiz server. Check your connection.</span>
          <button onClick={() => location.reload()}>Retry</button>
        </>
      ) : (
        <span>Connection lost. Reconnecting…</span>
      )}
    </div>
  );
}

// Plain link, so it still works if the page's JavaScript never loaded.
export function Loading() {
  return (
    <div className="card">
      <p className="muted">Connecting…</p>
      <p className="muted">
        Taking too long? <a href="">Reload</a>
      </p>
    </div>
  );
}

export function RetryCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card">
      <p className="error">{message}</p>
      <button onClick={onRetry}>Retry</button>
    </div>
  );
}

// Counts down locally from the server's "ms remaining", so the phone's clock doesn't matter.
export function Countdown({ ms }: { ms: number }) {
  const [left, setLeft] = useState(Math.ceil(ms / 1000));
  useEffect(() => {
    const end = performance.now() + ms;
    const draw = () => setLeft(Math.max(0, Math.ceil((end - performance.now()) / 1000)));
    draw();
    const t = setInterval(draw, 200);
    return () => clearInterval(t);
  }, [ms]);
  return <span className={`timer${left <= 5 && left > 0 ? ' urgent' : ''}`}>{left}</span>;
}

export function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null; // private mode: refresh-recovery won't work, the game still does
  }
}
export function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export type Question = { index: number; total: number; text: string; options: string[]; remainingMs: number };
