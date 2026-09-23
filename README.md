# grace.harrys.monster

A live leaderboard of Grace's people. Anyone can watch; only Grace can edit.
Grace may add, remove or move anyone, for any reason, and each change can
carry a reason that shows in the feed under the board.

## How it works

- One Cloudflare Worker serves `public/` and proxies `/api/*` to a single
  `Board` Durable Object that holds the board as one JSON value and pushes it
  to every open WebSocket after each change (`worker/index.js`).
- `worker/board.js` is the reducer: add, move, remove, with limits and a
  capped change log, plus `announce`, a bare message that goes in the log
  without touching the board. It is the only tested code (`npm test`).
- Editing needs the `EDIT_KEY` secret. Grace opens
  `https://grace.harrys.monster/#<key>` once; `public/js/key.js` runs before
  the analytics snippet, moves the key into localStorage and strips it from
  the URL, so the key is never beaconed.
- `POST /api/op` answers with the new state, or JSON `{error}` with 401 for a
  bad key and 400 for an op the reducer refuses.

## Develop

```sh
npm test            # reducer tests (node --test)
npx wrangler dev    # :8787, EDIT_KEY=dev from .dev.vars → open /#dev to edit
```

## Deploy

See `docs/DEPLOY.md`.
