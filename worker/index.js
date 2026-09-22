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
        const op = await request.json();
        next = apply(await this.state(), op);
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
  webSocketClose(ws, code) { try { ws.close(code, "closing"); } catch {} }
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
      if (!(await authed(request, env))) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return board.fetch(new Request("https://board/op", request));
    }

    return new Response("Not found", { status: 404 });
  },
};
