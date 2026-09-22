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
