const $ = (s) => document.querySelector(s);

// Grace's key arrives once as a URL fragment and is stripped from the address
// bar by js/key.js, which runs first so the analytics beacon never sees it.
let key = null;
try { key = localStorage.getItem("key"); } catch {}
const editing = Boolean(key);
document.body.classList.toggle("editing", editing);
$("#add-form").hidden = $("#say-form").hidden = !editing;

const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" });
const when = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// The public page shows the top TOP ranks; everyone else is an unranked name
// in the cloud, and the feed says "the cloud" instead of their number.
const TOP = 10;
const r = (n) => (editing || n <= TOP ? `#${n}` : "the cloud");

function describe(e) {
  if (e.action === "announce") return "";
  const what =
    e.action === "add" ? `joined ${e.to > TOP && !editing ? "" : "at "}${r(e.to)}` :
    e.action === "remove" ? `removed from ${r(e.from)}` :
    r(e.from) === r(e.to) && e.from !== e.to ? "moved within the cloud" :
    `moved ${r(e.from)} → ${r(e.to)}`;
  return `${e.name} ${what}`;
}

function render(state) {
  const board = $("#board");
  board.replaceChildren();
  const shown = editing ? state.people : state.people.slice(0, TOP);
  shown.forEach((p, i) => {
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

  const cloud = $("#cloud");
  cloud.replaceChildren();
  const rest = editing ? [] : state.people.slice(TOP).map((p) => p.name).sort((a, b) => a.localeCompare(b));
  rest.forEach((name, i) => {
    const s = document.createElement("span");
    s.textContent = name;
    s.style.setProperty("--i", i % 7);
    cloud.append(s);
  });
  cloud.hidden = rest.length === 0;

  const log = $("#log");
  log.replaceChildren();
  for (const e of state.log.slice(0, 30)) {
    const li = document.createElement("li");
    li.className = e.action;
    if (e.action !== "announce") {
      const b = document.createElement("b");
      b.textContent = describe(e);
      li.append(b);
    }
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
  el.hidden = false;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

async function send(op) {
  const r = await fetch("/api/op", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(op),
  }).catch(() => null);
  if (!r) return toast("Couldn't reach the server. Try again.");
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
$("#why").onclose = () => { pending = null; };
$("#why-cancel").onclick = () => { $("#why").close(); };
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

$("#say-form").onsubmit = (e) => {
  e.preventDefault();
  send({ op: "announce", note: $("#say-note").value });
  e.target.reset();
};

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
  ws.onmessage = (e) => render(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 2000);
}
connect();
