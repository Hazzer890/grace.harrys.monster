# grace.harrys.monster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live public leaderboard of Grace's people at grace.harrys.monster that only Grace can edit, with a reason attached to every change.

**Architecture:** One Cloudflare Worker (`worker/index.js`) serves `public/` as static assets and proxies `/api/*` to a single Durable Object `Board` that keeps the whole board as one JSON value in its storage and pushes it to every WebSocket client after each change. `worker/board.js` is the pure reducer (validate an op, return the next state) and is the only thing with unit tests. `public/js/app.js` renders state, keeps a WebSocket open, and shows edit controls when a key is in localStorage.

**Tech Stack:** Cloudflare Workers + Durable Objects (SQLite-backed, WebSocket hibernation), wrangler, plain HTML/CSS/ES modules, `node --test` (Node 24). Same shape as `../send.harrys.monster`.

**Spec:** `docs/superpowers/specs/2026-09-22-grace-leaderboard-design.md`

## Global Constraints

- Site lives in `/home/harry/Documents/harrys.monster-sites/grace.harrys.monster`, its own git repo (initialised, spec committed). Public GitHub repo `Hazzer890/grace.harrys.monster` created in Task 5.
- No dependencies, no framework, no build step. `wrangler` runs via `npx` like the siblings.
- People keyed by name, unique case-insensitively. Limits: name 40, note 200, people 200, log 200.
- Rank is 1-based everywhere the user sees it; `people[0]` is #1.
- Analytics snippet is byte-identical to `../analytics.harrys.monster/snippet.html`; its CSP hash is `'sha256-uRJXG8QMWf4FHC1Ze7+fprkjML2qie/Av5xLCAafg3A='`.
- Page copy: title `Grace's people`, the one-line rule under it reads exactly: `Grace may add, remove or move anyone, for any reason.`
- Never use `window.prompt`/`alert`/`confirm`; the reason is collected in a native `<dialog>`.
- Local dev: `npx wrangler dev` on :8787 with `EDIT_KEY=dev` from `.dev.vars` (gitignored).

---

### Task 1: Scaffold the repo and page shell

**Files:**
- Create: `package.json`, `.gitignore`, `wrangler.jsonc`, `.dev.vars`, `public/_headers`, `public/index.html`, `public/css/*` (copied), `public/js/background.js` (copied), `public/css/app.css` (empty for now), `worker/index.js` (stub)

**Interfaces:**
- Produces: the page shell with ids `board`, `empty`, `log`, `add-form`, `add-name`, `add-note`, `why` (dialog), `why-title`, `why-note`, `toast`, and template `row-tpl` that Task 4 fills.

- [ ] **Step 1: Copy shared assets and write config**

```bash
cd /home/harry/Documents/harrys.monster-sites/grace.harrys.monster
M=../metadata.harrys.monster
mkdir -p public/css public/js worker test
cp $M/css/reset.css $M/css/variables.css $M/css/layout.css $M/css/components.css $M/css/responsive.css public/css/
cp $M/js/background.js public/js/
: > public/css/app.css
cat > package.json <<'EOF'
{
  "name": "grace-harrys-monster",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": { "test": "node --test", "dev": "wrangler dev", "deploy": "wrangler deploy" }
}
EOF
printf 'node_modules/\n.wrangler/\n.dev.vars\n' > .gitignore
printf 'EDIT_KEY=dev\n' > .dev.vars
cat > wrangler.jsonc <<'EOF'
{
  "name": "grace",
  "main": "worker/index.js",
  "compatibility_date": "2026-07-01",
  "assets": { "directory": "./public" },
  "durable_objects": { "bindings": [{ "name": "BOARD", "class_name": "Board" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Board"] }],
  "routes": [{ "pattern": "grace.harrys.monster", "custom_domain": true }],
  "observability": { "enabled": true }
}
EOF
```

- [ ] **Step 2: Write `public/_headers`**

Same as `../send.harrys.monster/public/_headers` with the site's own WebSocket origin and without `'unsafe-inline'` in `style-src`:

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-uRJXG8QMWf4FHC1Ze7+fprkjML2qie/Av5xLCAafg3A='; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' wss://grace.harrys.monster ws://localhost:8787 https://analytics.harrys.monster; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://analytics.harrys.monster
```

- [ ] **Step 3: Write `public/index.html`**

Copy `$M/index.html`. Keep the `<head>` verbatim (fonts, favicon, the five CSS links, `css/app.css`, and the analytics inline script byte for byte) except: description meta `A live leaderboard of Grace's people. Grace may add, remove or move anyone, for any reason.`, canonical `https://grace.harrys.monster/`, title `Grace's people`. Keep the SVG filter defs, background mount, and header (nav-title `Grace's people`). Replace everything from `<main>` to the closing `</footer>` with:

```html
  <main class="app container">
    <div class="intro">
      <h1>Grace's people</h1>
      <p class="rule">Grace may add, remove or move anyone, for any reason.</p>
    </div>

    <form class="add glass" id="add-form" hidden>
      <input id="add-name" name="name" placeholder="Name" maxlength="40" required autocomplete="off">
      <input id="add-note" name="note" placeholder="Reason (optional)" maxlength="200" autocomplete="off">
      <button type="submit" class="btn btn-primary">Add to the bottom</button>
    </form>

    <ol class="board glass" id="board" aria-live="polite"></ol>
    <p class="empty" id="empty">Nobody yet.</p>

    <section class="changes">
      <h2>Recent changes</h2>
      <ul id="log"></ul>
    </section>
  </main>

  <template id="row-tpl">
    <li class="row">
      <span class="rank"></span>
      <span class="name"></span>
      <span class="since"></span>
      <span class="controls">
        <button type="button" class="btn btn-ghost up" aria-label="Move up">↑</button>
        <button type="button" class="btn btn-ghost down" aria-label="Move down">↓</button>
        <button type="button" class="btn btn-ghost to" aria-label="Move to rank">#</button>
        <button type="button" class="btn btn-ghost remove" aria-label="Remove">✕</button>
      </span>
    </li>
  </template>

  <dialog id="why" class="glass">
    <form method="dialog" id="why-form">
      <h2 id="why-title"></h2>
      <label class="why-rank" id="why-rank-wrap" hidden>New rank <input type="number" id="why-rank" min="1" step="1"></label>
      <textarea id="why-note" maxlength="200" rows="3" placeholder="Reason (optional)"></textarea>
      <div class="why-actions">
        <button type="button" class="btn btn-ghost" id="why-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Do it</button>
      </div>
    </form>
  </dialog>

  <div id="toast" class="toast" role="status" hidden></div>

  <footer class="footer">
    <div class="container">
      <p>Updates live. Only Grace can change it.</p>
      <p>Harry Cassidy &copy; <span id="year">2026</span> ·
         <a href="https://harrys.monster">harrys.monster</a></p>
    </div>
  </footer>

  <script src="js/background.js" defer></script>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Stub the worker so `wrangler dev` starts**

`worker/index.js`:

```js
import { DurableObject } from "cloudflare:workers";
export class Board extends DurableObject {}
export default { fetch() { return new Response("Not found", { status: 404 }); } };
```

- [ ] **Step 5: Verify the shell serves**

Run: `npx wrangler dev` in one shell, then `curl -s localhost:8787/ | grep -c "Grace's people"` in another.
Expected: `3` (title, nav-title, h1). Then `curl -sI localhost:8787/ | grep -i content-security` shows the CSP. Stop wrangler.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Scaffold grace.harrys.monster from the metadata shell"
```

---

### Task 2: Board reducer with tests

**Files:**
- Create: `worker/board.js`, `test/board.test.js`

**Interfaces:**
- Produces: `apply(state, op, now = Date.now()) → state` (throws `Error` with a user-readable message on a bad op), `empty() → state`, `LIMITS`. Task 3 calls `apply` and `empty`.

- [ ] **Step 1: Write the failing tests**

`test/board.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, empty, LIMITS } from "../worker/board.js";

const names = (s) => s.people.map((p) => p.name);
const seed = (...ns) => ns.reduce((s, n) => apply(s, { op: "add", name: n }, 1), empty());

test("add appends, trims, and logs", () => {
  const s = apply(empty(), { op: "add", name: "  Sam ", note: " snacks " }, 5);
  assert.deepEqual(s.people, [{ name: "Sam", since: 5 }]);
  assert.deepEqual(s.log, [{ t: 5, action: "add", name: "Sam", to: 1, note: "snacks" }]);
  assert.equal(s.updated, 5);
});

test("add at a rank inserts there", () => {
  const s = apply(seed("A", "B", "C"), { op: "add", name: "X", to: 2 });
  assert.deepEqual(names(s), ["A", "X", "B", "C"]);
});

test("add rejects empty, duplicate (case-insensitive), and full board", () => {
  assert.throws(() => apply(empty(), { op: "add", name: "  " }), /name/);
  assert.throws(() => apply(seed("Sam"), { op: "add", name: "sam" }), /already/);
  const full = { ...empty(), people: Array.from({ length: LIMITS.people }, (_, i) => ({ name: `p${i}`, since: 0 })) };
  assert.throws(() => apply(full, { op: "add", name: "one more" }), /full/);
});

test("move to a rank reorders and logs from/to", () => {
  const s = apply(seed("A", "B", "C", "D"), { op: "move", name: "D", to: 1, note: "why not" }, 9);
  assert.deepEqual(names(s), ["D", "A", "B", "C"]);
  assert.deepEqual(s.log[0], { t: 9, action: "move", name: "D", from: 4, to: 1, note: "why not" });
});

test("move rejects unknown names and out-of-range ranks", () => {
  const s = seed("A", "B");
  assert.throws(() => apply(s, { op: "move", name: "Z", to: 1 }), /nobody/i);
  assert.throws(() => apply(s, { op: "move", name: "A", to: 0 }), /rank/);
  assert.throws(() => apply(s, { op: "move", name: "A", to: 3 }), /rank/);
  assert.throws(() => apply(s, { op: "move", name: "A", to: "x" }), /rank/);
});

test("remove drops the person and logs from", () => {
  const s = apply(seed("A", "B", "C"), { op: "remove", name: "B" }, 7);
  assert.deepEqual(names(s), ["A", "C"]);
  assert.deepEqual(s.log[0], { t: 7, action: "remove", name: "B", from: 2, note: "" });
});

test("names and notes are clipped, log is capped, unknown op throws", () => {
  const s = apply(empty(), { op: "add", name: "x".repeat(99), note: "y".repeat(999) });
  assert.equal(s.people[0].name.length, LIMITS.name);
  assert.equal(s.log[0].note.length, LIMITS.note);
  let t = empty();
  for (let i = 0; i < LIMITS.log + 5; i++) t = apply(t, { op: "add", name: `n${i}` });
  assert.equal(t.log.length, LIMITS.log);
  assert.throws(() => apply(empty(), { op: "zap" }), /unknown/);
  assert.throws(() => apply(empty(), null), /unknown/);
});

test("apply does not mutate its input", () => {
  const s = seed("A");
  apply(s, { op: "add", name: "B" });
  assert.deepEqual(names(s), ["A"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: fails with `Cannot find module '../worker/board.js'`.

- [ ] **Step 3: Write `worker/board.js`**

```js
// Pure reducer for the board. The Durable Object is the only caller that
// persists the result; the client only ever renders what the server sends.
export const LIMITS = { name: 40, note: 200, people: 200, log: 200 };

export const empty = () => ({ people: [], log: [], updated: 0 });

const clean = (s, max) => String(s ?? "").trim().slice(0, max);

function rank(v, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`rank must be 1 to ${max}`);
  return n;
}

function find(people, name) {
  const key = clean(name, LIMITS.name).toLowerCase();
  const i = people.findIndex((p) => p.name.toLowerCase() === key);
  if (i < 0) throw new Error("nobody by that name");
  return i;
}

export function apply(state, op, now = Date.now()) {
  const people = state.people.slice();
  const note = clean(op?.note, LIMITS.note);
  let entry;

  if (op?.op === "add") {
    const name = clean(op.name, LIMITS.name);
    if (!name) throw new Error("name required");
    if (people.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already on the board`);
    if (people.length >= LIMITS.people) throw new Error("board is full");
    const to = op.to == null ? people.length + 1 : rank(op.to, people.length + 1);
    people.splice(to - 1, 0, { name, since: now });
    entry = { action: "add", name, to };
  } else if (op?.op === "move") {
    const i = find(people, op.name);
    const to = rank(op.to, people.length);
    const [p] = people.splice(i, 1);
    people.splice(to - 1, 0, p);
    entry = { action: "move", name: p.name, from: i + 1, to };
  } else if (op?.op === "remove") {
    const i = find(people, op.name);
    const [p] = people.splice(i, 1);
    entry = { action: "remove", name: p.name, from: i + 1 };
  } else {
    throw new Error("unknown op");
  }

  const log = [{ t: now, ...entry, note }, ...state.log].slice(0, LIMITS.log);
  return { people, log, updated: now };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 8 passing. If the "add appends" test fails on key order, note that `deepEqual` ignores key order; check values.

- [ ] **Step 5: Commit**

```bash
git add worker/board.js test/board.test.js && git commit -m "Board reducer: add, move, remove with limits and a change log"
```

---

### Task 3: Worker and Durable Object

**Files:**
- Modify: `worker/index.js` (replace the stub)

**Interfaces:**
- Consumes: `apply`, `empty` from `worker/board.js`.
- Produces: `GET /api/state`, `GET /api/ws` (WebSocket, sends full state JSON on connect and after every change), `POST /api/op` (Bearer `EDIT_KEY`; 200 with new state, 400 `{error}`, 401). Task 4 uses all three.

- [ ] **Step 1: Write `worker/index.js`**

```js
import { DurableObject } from "cloudflare:workers";
import { apply, empty } from "./board.js";

// One Board for the whole site (getByName("main")). The entire state is a
// single JSON value in storage; every change is written whole and pushed to
// every connected socket. Sockets use hibernation so idle tabs cost nothing.
// ponytail: single value, 128 KB storage cap — at LIMITS that is ~70 KB. Split
// people/log into two keys if the limits ever grow.
export class Board extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify(await this.state()));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === "/state") return Response.json(await this.state());

    if (url.pathname === "/op") {
      let next;
      try {
        next = apply(await this.state(), await request.json());
      } catch (e) {
        return Response.json({ error: e.message }, { status: 400 });
      }
      await this.ctx.storage.put("state", next);
      const msg = JSON.stringify(next);
      for (const ws of this.ctx.getWebSockets()) try { ws.send(msg); } catch {}
      return Response.json(next);
    }

    return new Response("Not found", { status: 404 });
  }

  async state() {
    return (await this.ctx.storage.get("state")) ?? empty();
  }

  webSocketMessage() {} // clients never send; ignore
  webSocketClose() {}
  webSocketError() {}
}

async function authed(request, env) {
  const key = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.EDIT_KEY || !key) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([key, env.EDIT_KEY].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const board = env.BOARD.getByName("main");

    if (url.pathname === "/api/state") return board.fetch("https://board/state");

    if (url.pathname === "/api/ws" && request.headers.get("Upgrade") === "websocket") {
      return board.fetch(new Request("https://board/ws", request));
    }

    if (url.pathname === "/api/op" && request.method === "POST") {
      if (!(await authed(request, env))) return new Response("Unauthorized", { status: 401 });
      return board.fetch(new Request("https://board/op", request));
    }

    return new Response("Not found", { status: 404 });
  },
};
```

Static files never reach this handler: Workers static assets answer any path that matches a file in `public/` before the Worker runs, exactly as in send.

- [ ] **Step 2: Verify with curl**

Start `npx wrangler dev` (reads `EDIT_KEY=dev` from `.dev.vars`). In another shell:

```bash
curl -s localhost:8787/api/state
# {"people":[],"log":[],"updated":0}
curl -s -X POST localhost:8787/api/op -H 'Content-Type: application/json' -d '{"op":"add","name":"Sam"}' -w '\n%{http_code}\n'
# Unauthorized 401
curl -s -X POST localhost:8787/api/op -H 'Authorization: Bearer dev' -H 'Content-Type: application/json' -d '{"op":"add","name":"Sam","note":"first"}'
# {"people":[{"name":"Sam","since":...}],"log":[{"t":...,"action":"add","name":"Sam","to":1,"note":"first"}],"updated":...}
curl -s -X POST localhost:8787/api/op -H 'Authorization: Bearer dev' -H 'Content-Type: application/json' -d '{"op":"move","name":"Sam","to":9}' -w '\n%{http_code}\n'
# {"error":"rank must be 1 to 1"} 400
curl -s localhost:8787/api/state | grep -c Sam
# 1  (persisted across requests)
```

WebSocket check with Node (no extra deps, Node 22+ has a global `WebSocket`):

```bash
node -e 'const ws=new WebSocket("ws://localhost:8787/api/ws");ws.onmessage=e=>{console.log(e.data);process.exit()}'
```
Expected: the same state JSON printed. Stop wrangler when done. Local DO state lives in `.wrangler/` and is gitignored.

- [ ] **Step 3: Commit**

```bash
git add worker/index.js && git commit -m "Worker + Board Durable Object: state, op, live WebSocket"
```

---

### Task 4: Client

**Files:**
- Create: `public/js/app.js`
- Modify: `public/css/app.css`

**Interfaces:**
- Consumes: `GET /api/ws` messages (full state), `POST /api/op`, ids and template from Task 1.

- [ ] **Step 1: Write `public/js/app.js`**

```js
const $ = (s) => document.querySelector(s);

// Grace's key arrives once as a URL fragment (never sent to the server as a
// URL), is kept in localStorage, and is stripped from the address bar.
let key = null;
try {
  if (location.hash.length > 1) {
    localStorage.setItem("key", location.hash.slice(1));
    history.replaceState(null, "", location.pathname);
  }
  key = localStorage.getItem("key");
} catch {}
const editing = Boolean(key);
document.body.classList.toggle("editing", editing);
$("#add-form").hidden = !editing;

const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" });
const when = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function describe(e) {
  const what =
    e.action === "add" ? `joined at #${e.to}` :
    e.action === "remove" ? `removed from #${e.from}` :
    `moved #${e.from} → #${e.to}`;
  return `${e.name} ${what}`;
}

function render(state) {
  const board = $("#board");
  board.replaceChildren();
  state.people.forEach((p, i) => {
    const li = $("#row-tpl").content.firstElementChild.cloneNode(true);
    li.querySelector(".rank").textContent = i + 1;
    li.querySelector(".name").textContent = p.name;
    li.querySelector(".since").textContent = `since ${day.format(p.since)}`;
    if (editing) {
      const n = state.people.length;
      li.querySelector(".up").disabled = i === 0;
      li.querySelector(".down").disabled = i === n - 1;
      li.querySelector(".up").onclick = () => ask(`Move ${p.name} up to #${i}`, { op: "move", name: p.name, to: i });
      li.querySelector(".down").onclick = () => ask(`Move ${p.name} down to #${i + 2}`, { op: "move", name: p.name, to: i + 2 });
      li.querySelector(".to").onclick = () => ask(`Move ${p.name} to…`, { op: "move", name: p.name }, n);
      li.querySelector(".remove").onclick = () => ask(`Remove ${p.name}`, { op: "remove", name: p.name });
    }
    board.append(li);
  });
  $("#empty").hidden = state.people.length > 0;

  const log = $("#log");
  log.replaceChildren();
  for (const e of state.log.slice(0, 30)) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = describe(e);
    li.append(b);
    if (e.note) {
      const q = document.createElement("q");
      q.textContent = e.note;
      li.append(" ", q);
    }
    const t = document.createElement("time");
    t.dateTime = new Date(e.t).toISOString();
    t.textContent = when.format(e.t);
    li.append(" ", t);
    log.append(li);
  }
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

async function send(op) {
  const r = await fetch("/api/op", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(op),
  });
  if (r.status === 401) {
    try { localStorage.removeItem("key"); } catch {}
    toast("That key doesn't work any more.");
    setTimeout(() => location.reload(), 1500);
    return;
  }
  if (!r.ok) toast((await r.json().catch(() => ({}))).error || "Something went wrong");
  // On success the new state arrives over the socket; nothing to do here.
}

// One dialog for every op that needs a reason. `maxRank` > 0 also asks for a rank.
let pending = null;
function ask(title, op, maxRank = 0) {
  pending = op;
  $("#why-title").textContent = title;
  $("#why-note").value = "";
  $("#why-rank-wrap").hidden = !maxRank;
  const rank = $("#why-rank");
  rank.required = Boolean(maxRank);
  rank.max = maxRank || "";
  rank.value = "";
  $("#why").showModal();
  (maxRank ? rank : $("#why-note")).focus();
}
$("#why-cancel").onclick = () => { pending = null; $("#why").close(); };
$("#why-form").onsubmit = () => {
  if (!pending) return;
  const op = { ...pending, note: $("#why-note").value };
  if (!$("#why-rank-wrap").hidden) op.to = Number($("#why-rank").value);
  pending = null;
  send(op);
};

$("#add-form").onsubmit = (e) => {
  e.preventDefault();
  send({ op: "add", name: $("#add-name").value, note: $("#add-note").value });
  e.target.reset();
  $("#add-name").focus();
};

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
  ws.onmessage = (e) => render(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 2000);
}
connect();
```

- [ ] **Step 2: Write `public/css/app.css`**

Only what the shared sheets don't cover. Use the tokens from `variables.css`.

```css
.intro { text-align: center; margin-bottom: 1.5rem; }
.rule { color: var(--ink-soft); }

.add { display: flex; flex-wrap: wrap; gap: .5rem; padding: 1rem; margin-bottom: 1rem; }
.add input { flex: 1 1 12rem; padding: .6rem .8rem; border: 1px solid var(--glass-brd); border-radius: 10px; background: var(--glass-fill-strong); font: inherit; color: var(--ink); }

.board { list-style: none; padding: .5rem; margin: 0; }
.row { display: grid; grid-template-columns: 3ch 1fr auto; align-items: center; gap: .75rem; padding: .7rem .9rem; border-radius: 12px; }
.row + .row { border-top: 1px solid var(--glass-brd); }
.row:first-child .rank { color: var(--accent); }
.rank { font-family: var(--font-mono); font-weight: 600; text-align: right; }
.rank::before { content: "#"; opacity: .5; }
.name { font-weight: 600; font-size: 1.1rem; }
.since { color: var(--ink-mute); font-size: .85rem; }
.controls { display: none; gap: .25rem; grid-column: 1 / -1; justify-content: flex-end; }
.editing .controls { display: flex; }
.controls .btn { padding: .3rem .6rem; }
.controls .btn:disabled { opacity: .3; }
@media (min-width: 640px) { .row { grid-template-columns: 3ch 1fr auto auto; } .controls { grid-column: auto; } }

.empty { text-align: center; color: var(--ink-mute); padding: 2rem; }
.empty[hidden] { display: none; }

.changes { margin-top: 2rem; }
.changes h2 { font-size: 1rem; color: var(--ink-soft); margin-bottom: .5rem; }
.changes ul { list-style: none; padding: 0; margin: 0; }
.changes li { padding: .4rem 0; border-top: 1px solid var(--glass-brd); font-size: .95rem; }
.changes q { color: var(--ink-soft); }
.changes time { color: var(--ink-mute); font-size: .8rem; margin-left: .5rem; }

dialog { border: 0; border-radius: var(--radius); padding: 1.5rem; max-width: 26rem; width: calc(100% - 2rem); color: var(--ink); }
dialog::backdrop { background: rgba(17, 24, 50, .4); backdrop-filter: blur(4px); }
dialog h2 { font-size: 1.1rem; margin-bottom: 1rem; }
dialog textarea, dialog input[type=number] { width: 100%; padding: .6rem .8rem; border: 1px solid var(--glass-brd); border-radius: 10px; font: inherit; margin-bottom: 1rem; background: var(--glass-fill-strong); color: var(--ink); }
.why-rank { display: block; margin-bottom: .5rem; }
.why-actions { display: flex; justify-content: flex-end; gap: .5rem; }

.toast { position: fixed; left: 50%; bottom: 1.5rem; transform: translateX(-50%); background: var(--ink); color: #fff; padding: .7rem 1rem; border-radius: 999px; font-size: .9rem; z-index: 10; }
```

- [ ] **Step 3: Verify in a browser with Playwright (use the webapp-testing skill)**

Start `npx wrangler dev`. Reset local state by deleting `.wrangler/state` first if Task 3's "Sam" should not be there. Then, with Playwright, do the following and confirm each expectation:

1. Open `http://localhost:8787/` in page A. Expect: heading `Grace's people`, the rule line, `Nobody yet.`, no add form, no console errors (the CSP is applied by wrangler dev; a violation would show as an error).
2. Open `http://localhost:8787/#dev` in page B. Expect: the URL becomes `http://localhost:8787/` and the add form is visible.
3. In B, add `Sam` with reason `first`. Expect: within 2 s, both A and B show `#1 Sam`, and the log shows `Sam joined at #1 “first”`.
4. In B, add `Alex`, then click Alex's ↑, type `overtook` in the dialog, submit. Expect: both pages show Alex at #1, Sam at #2, log top entry `Alex moved #2 → #1`.
5. In B, click Sam's `#`, enter rank `1`, submit. Expect: Sam back at #1.
6. In B, click Alex's ✕, submit. Expect: Alex gone from both pages, log top entry `Alex removed from #2`.
7. In B, try adding `sam`. Expect: toast `Sam is already on the board`, list unchanged.
8. In B's console set `localStorage.key = "wrong"`, reload, add `Zed`. Expect: toast `That key doesn't work any more.`, page reloads read-only.
9. Screenshot A at 390 px wide and at 1200 px wide. Expect: nothing overflows horizontally.

- [ ] **Step 4: Commit**

```bash
git add public && git commit -m "Client: live board, edit mode from a fragment key, reasons via dialog"
```

---

### Task 5: Deploy, secret, docs, GitHub

**Files:**
- Create: `README.md`, `docs/DEPLOY.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# grace.harrys.monster

A live leaderboard of Grace's people. Anyone can watch; only Grace can edit.
Grace may add, remove or move anyone, for any reason, and each change can
carry a reason that shows in the feed under the board.

## How it works

- One Cloudflare Worker serves `public/` and proxies `/api/*` to a single
  `Board` Durable Object that holds the board as one JSON value and pushes it
  to every open WebSocket after each change (`worker/index.js`).
- `worker/board.js` is the reducer: add, move, remove, with limits and a
  capped change log. It is the only tested code (`npm test`).
- Editing needs the `EDIT_KEY` secret. Grace opens
  `https://grace.harrys.monster/#<key>` once; the page keeps it in
  localStorage and strips it from the URL.

## Develop

```sh
npm test            # reducer tests (node --test)
npx wrangler dev    # :8787, EDIT_KEY=dev from .dev.vars → open /#dev to edit
```

## Deploy

See `docs/DEPLOY.md`.
```

- [ ] **Step 2: Write `docs/DEPLOY.md`**

```markdown
# Deploying grace.harrys.monster

Same pattern as send.harrys.monster: a Worker with static assets and a
Durable Object, custom domain declared in `wrangler.jsonc`, so the first
deploy also creates the DNS record and certificate.

```bash
npx wrangler deploy
```

Once, set Grace's key and hand her the link it prints:

```bash
KEY=$(openssl rand -base64 18 | tr -d '/+=')
printf %s "$KEY" | npx wrangler secret put EDIT_KEY
echo "https://grace.harrys.monster/#$KEY"
```

Re-run those three lines to rotate the key; every old copy stops working on
its next edit.

Check after a deploy:

```bash
curl -sI https://grace.harrys.monster | grep -i content-security-policy
curl -s https://grace.harrys.monster/api/state
```

Then visit the site with an ad-blocker off and confirm the pageview appears in
the analytics dashboard's Live tab (per `analytics.harrys.monster/SNIPPET.md`).

## If wrangler reports "The request to Cloudflare's API timed out"

On Harry's desktop the first nameserver in `/etc/resolv.conf` does not answer.
Either fix the resolver or run:

```bash
RES_OPTIONS="timeout:1 attempts:1" CLOUDFLARE_ACCOUNT_ID=816b6de463b497eebff6c1287c0950ed npx wrangler deploy
```
```

- [ ] **Step 3: Deploy and set the secret**

```bash
cd /home/harry/Documents/harrys.monster-sites/grace.harrys.monster
RES_OPTIONS="timeout:1 attempts:1" CLOUDFLARE_ACCOUNT_ID=816b6de463b497eebff6c1287c0950ed npx wrangler deploy
KEY=$(openssl rand -base64 18 | tr -d '/+=')
printf %s "$KEY" | RES_OPTIONS="timeout:1 attempts:1" CLOUDFLARE_ACCOUNT_ID=816b6de463b497eebff6c1287c0950ed npx wrangler secret put EDIT_KEY
echo "GRACE LINK: https://grace.harrys.monster/#$KEY"
```

Put the printed link in the final report to Harry. Do not commit it anywhere.

- [ ] **Step 4: Verify production**

```bash
curl -sI https://grace.harrys.monster | grep -i content-security-policy   # CSP present
curl -s https://grace.harrys.monster/api/state                            # {"people":[],...}
curl -s -X POST https://grace.harrys.monster/api/op -H 'Content-Type: application/json' -d '{"op":"add","name":"x"}' -w '%{http_code}\n'   # 401
```

Then open `https://grace.harrys.monster/` in Playwright: no console errors, `Nobody yet.` shown. Open the Grace link in a second page, add `Test`, confirm the first page updates live, then remove `Test` with reason `deploy check` so the board is empty for Grace but the feed proves it works. Confirm the pageview in the analytics Live tab (dashboard is behind basic auth; Harry can do this step if credentials are not at hand, say so in the report).

- [ ] **Step 5: Commit and publish the repo**

```bash
git add -A && git commit -m "Docs and deploy notes for grace.harrys.monster"
gh repo create Hazzer890/grace.harrys.monster --public --source=. --push
```

---

## Self-review

- Spec coverage: ranked list (T1/T4), rule line (T1), reasons + feed (T2/T4), live updates (T3/T4), fragment key + read-only fallback (T4), limits (T2), shell/styling (T1/T4), analytics + CSP (T1), deploy + secret (T5). No gaps.
- Placeholders: none.
- Names match across tasks: `apply`, `empty`, `LIMITS`; ops `add/move/remove` with `name`, `to`, `note`; routes `/api/state`, `/api/ws`, `/api/op`; ids `board`, `empty`, `log`, `add-form`, `add-name`, `add-note`, `why`, `why-form`, `why-title`, `why-rank`, `why-rank-wrap`, `why-note`, `why-cancel`, `toast`, template `row-tpl` with classes `rank name since up down to remove`.
