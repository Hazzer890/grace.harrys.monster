# grace.harrys.monster design

A live, public leaderboard of Grace's "people". Only Grace can edit. Anyone can watch.

## What it does

- One ranked list of names, #1 at the top. Each entry shows rank, name, and the date it joined.
- Grace may add, remove or move anyone, for any reason. The page says so in one line under the title.
- Every change carries an optional reason. The last 30 changes show under the board as a feed
  ("Sam moved #4 → #1 — 'brought snacks'").
- Live: every open tab updates within a second of a change, no refresh.
- Editing: Grace opens a link of the form `https://grace.harrys.monster/#<key>` once. The page stores
  the key in localStorage, strips it from the URL, and shows the edit controls (add form, up / down /
  remove per row). A wrong or revoked key drops her back to read-only.

## What it does not do

- No accounts, no per-person pages, no scores or points. Rank is the whole story.
- No rename. Remove and re-add.
- No drag and drop. Up, down, and "move to #N" cover it.
- No history beyond the last 200 changes.

## Decisions (made without asking, per Harry's instruction)

- Stack matches send.harrys.monster: one Cloudflare Worker serving static assets plus one Durable Object
  (`Board`, SQLite-backed) holding the whole board as a single JSON value and pushing it to WebSocket
  clients. Deployed with wrangler, custom domain, same as every sibling.
- Auth is a single shared secret (`EDIT_KEY`, a wrangler secret) compared in constant time. Fine for one
  editor who is a friend; rotate by re-running `wrangler secret put`.
- Page shell, fonts, background and CSS are copied from metadata.harrys.monster (the current house style).
- People are keyed by name, unique case-insensitively. Limits: name 40 chars, reason 200 chars,
  200 people, 200 log entries.
- Analytics snippet pasted per `analytics.harrys.monster/SNIPPET.md`, CSP applied.

## Data

```
state = {
  people: [{ name: "Sam", since: 1758500000000 }, ...],   // index 0 is #1
  log:    [{ t, action: "add"|"move"|"remove", name, from?, to?, note }, ...],  // newest first
  updated: 1758500000000
}
op = { op: "add", name, to?, note? }
   | { op: "move", name, to, note? }        // to is a 1-based rank
   | { op: "remove", name, note? }
```

## HTTP

- `GET /api/state` → state (public)
- `GET /api/ws` → WebSocket; server sends the full state on connect and after every change (public)
- `POST /api/op` with `Authorization: Bearer <key>` → applies one op, returns new state; 400 with
  `{error}` on a bad op, 401 on a bad key
