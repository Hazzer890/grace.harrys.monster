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
  let t = seed("N");
  for (let i = 0; i < LIMITS.log + 5; i++) t = apply(t, { op: "move", name: "N", to: 1 });
  assert.equal(t.log.length, LIMITS.log);
  assert.throws(() => apply(empty(), { op: "zap" }), /unknown/);
  assert.throws(() => apply(empty(), null), /unknown/);
});

test("announce logs a note and leaves people alone", () => {
  const s = apply(seed("A"), { op: "announce", note: " hello all " }, 3);
  assert.deepEqual(names(s), ["A"]);
  assert.deepEqual(s.log[0], { t: 3, action: "announce", note: "hello all" });
  assert.throws(() => apply(empty(), { op: "announce", note: "  " }), /message/);
});

test("apply does not mutate its input", () => {
  const s = seed("A");
  apply(s, { op: "add", name: "B" });
  assert.deepEqual(names(s), ["A"]);
});
