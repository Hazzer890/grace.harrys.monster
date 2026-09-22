import { DurableObject } from "cloudflare:workers";
export class Board extends DurableObject {}
export default { fetch() { return new Response("Not found", { status: 404 }); } };
