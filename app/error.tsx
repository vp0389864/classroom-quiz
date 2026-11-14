'use client';
// Next.js shows this if a page crashes while rendering: a message and a way out, never a blank screen.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <div className="card">
        <h1>Something went wrong</h1>
        <p className="muted">Your place in the game is saved. Try again.</p>
        <button onClick={() => reset()}>Try again</button>
        <button onClick={() => location.reload()}>Reload page</button>
      </div>
    </main>
  );
}
