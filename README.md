# Classroom Quiz

A live five-question personal-finance quiz. The teacher puts the host screen on a projector, and students play on their phones.

Built with **Next.js 16** (App Router, React 19, TypeScript) and **Socket.IO**, running in one Node process (`server.js`). A custom server is needed because serverless hosting such as Vercel can't hold the live connections a timed quiz needs. It deploys to any Node host, and `render.yaml` is included.

- **Host:** `/host` shows a room code, the live answer count, the correct answer with a leaderboard after each question, and the final ranking.
- **Players:** `/` lets players join with the code and a name, answer on their phone, and see only their own score.

## Run locally

```
npm install
npm run dev      # http://localhost:3000 with hot reload
npm run build && npm start   # production
npm test         # 10 simulated players, answer secrecy, refresh-rejoin, no public scores
```

## Files

| File | What it does |
|---|---|
| `server.js` | Starts Next.js and Socket.IO. All game logic: rooms, timer, scoring, what each screen is allowed to see |
| `questions.js` | The 5 questions, the correct answers and the source links. Server-only, never bundled for the browser |
| `app/page.tsx` | Player phone page |
| `app/host/page.tsx` | Projector page |
| `app/error.tsx` | Fallback screen with Try again if a page crashes |
| `lib/client.tsx` | Shared client code: socket hook, calls with timeouts, connection banner, countdown |
| `test.js` | End-to-end check of the six rules over real sockets |

## Common changes

- **Longer timer:** change `QUESTION_MS` in `server.js`.
- **Sixth question:** append an object to `questions.js`. The "of N" counts update automatically.

## How each rule is met

1. **Answers stay on the server.** Only `server.js` imports `questions.js`, so it never enters the browser bundle (verified by searching `.next/static`). During a question the server sends only the text and the options. The correct index is sent only after the question closes (`questionView` / `playerState` in `server.js`).
2. **Ten players.** Socket.IO falls back to long-polling when a mobile network blocks WebSockets. `npm test` runs 10 concurrent players.
3. **Refresh keeps the player.** On join the server issues a random token, which the phone keeps in `localStorage`. On every (re)connect the phone rejoins with that token and gets its name, its score and the current question with the time left.
4. **No frozen screens.** A banner shows "Reconnecting…" and then, after 10 s, a clear message with a Retry button. Every server call has an 8 s timeout that turns into a message plus Retry. The first screen is server-rendered with a plain Reload link, so it still works if the JavaScript never loads. `app/error.tsx` catches render crashes.
5. **No secrets.** None exist. The host and player tokens are generated at runtime and held in memory.
6. **Scores are not public.** There is no HTTP endpoint for game data. The leaderboard goes only to the host's socket, which needs the host token issued when the game was created. A player receives only their own score and rank.

## Limits

- State is in memory on one process. A server restart ends running games, and players see "Your earlier session is gone. Join again."
- Render's free plan sleeps after 15 min idle. Open the host page about a minute before class.
