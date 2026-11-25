import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Command, DomainError, canSeeList, hiddenListOf, projectForMember } from "@kinboard/shared";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { type Identity, PinGate, actorFor, bearerToken, parseDevToken } from "./auth.ts";
import { InMemoryRepository, type Repository } from "./repository.ts";

/** MVP: single demo household. M2: household resolved from the auth / device token. */
const HOUSEHOLD = "hh_1";

export interface AppOptions {
  /** Accept unsigned `dev:` identity tokens. Default: on unless NODE_ENV=production (override: KINBOARD_DEV_AUTH=1). */
  devAuth?: boolean;
  /** Adult PIN for shared displays. Default: KINBOARD_PIN, or "1234" while dev auth is on. Unset → PIN elevation off. */
  pin?: string;
  now?: () => number;
}

const problem = (reply: FastifyReply, status: number, title: string, detail?: string) =>
  reply.code(status).type("application/problem+json").send({ type: "about:blank", title, status, detail });

export function buildApp(repo: Repository = new InMemoryRepository(), opts: AppOptions = {}) {
  const devAuth =
    opts.devAuth ?? (process.env.NODE_ENV !== "production" || process.env.KINBOARD_DEV_AUTH === "1");
  const pin = "pin" in opts ? opts.pin : (process.env.KINBOARD_PIN ?? (devAuth ? "1234" : undefined));
  const now = opts.now ?? Date.now;
  const pins = new PinGate(pin, now);

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const sockets = new Set<{ ws: WebSocket; identity: Identity }>();
  if (devAuth) app.log.warn("dev auth is ON: unsigned dev: tokens are accepted. Never expose this server.");

  app.register(cors, { origin: true });
  app.register(websocket);

  /** Resolves the caller from the bearer token (or `?token=` for WebSockets, which cannot set headers). */
  const identify = async (req: FastifyRequest): Promise<Identity | null> => {
    if (!devAuth) return null; // real auth lands in M2 step 3
    const token = bearerToken(req.headers.authorization, (req.query as { token?: string }).token);
    return parseDevToken(token, await repo.snapshot(HOUSEHOLD));
  };

  app.get("/health", async () => ({ ok: true }));

  /** Full snapshot, projected per viewer: hidden lists reach only members in `visibleTo` (spec §9, gap #3). */
  app.get("/api/v1/snapshot", async (req, reply) => {
    const id = await identify(req);
    if (!id) return problem(reply, 401, "unauthorized");
    const s = await repo.snapshot(HOUSEHOLD);
    return projectForMember(s, id.memberId); // displays are memberId null → no hidden lists
  });

  /** Adult PIN on a shared display → short-lived elevation token for `x-kinboard-elevation`. */
  app.post("/api/v1/pin/verify", async (req, reply) => {
    const id = await identify(req);
    if (!id) return problem(reply, 401, "unauthorized");
    if (id.device !== "display" || !pins.enabled)
      return problem(reply, 403, "forbidden", "PIN elevation is only available on displays");
    const attempt = (req.body as { pin?: unknown } | null)?.pin;
    const result = pins.verify(id, typeof attempt === "string" ? attempt : "");
    if (result === "locked") return problem(reply, 429, "too_many_attempts", "Try again in a minute");
    if (!result) return problem(reply, 401, "wrong_pin");
    return result;
  });

  /** Command endpoint: identify → build actor → validate → apply → broadcast. Idempotent by command id. */
  app.post("/api/v1/commands", async (req, reply) => {
    const id = await identify(req);
    if (!id) return problem(reply, 401, "unauthorized");
    const before = await repo.snapshot(HOUSEHOLD);
    const elevation = req.headers["x-kinboard-elevation"];
    const actor = actorFor(
      id,
      before,
      pins.isElevated(id, typeof elevation === "string" ? elevation : undefined),
    );
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    // Whatever actor the client sent is replaced by the one the server derived.
    const parsed = Command.safeParse({ ...body, actor });
    if (!parsed.success) return problem(reply, 400, "Invalid command", parsed.error.message);
    try {
      const { state, replay } = await repo.apply(HOUSEHOLD, parsed.data);
      if (!replay) {
        const c = parsed.data;
        const msg = JSON.stringify({ type: "applied", rev: state.rev, command: c });
        // Viewers who may not see the touched hidden list only learn that something changed and
        // resync their projected /snapshot. Resolved on the state before the command (gap #7).
        const hidden = hiddenListOf(before, c);
        const bump = JSON.stringify({ type: "rev", rev: state.rev });
        for (const s of sockets) {
          if (s.ws.readyState !== 1) continue;
          s.ws.send(hidden && !canSeeList(hidden, s.identity.memberId) ? bump : msg);
        }
      }
      return { rev: state.rev, replay };
    } catch (e) {
      if (e instanceof DomainError) {
        const status = e.code === "forbidden" ? 403 : e.code === "not_found" ? 404 : 422;
        return problem(reply, status, e.code, e.message);
      }
      throw e;
    }
  });

  /** Realtime channel: server pushes applied commands; clients replay them through the shared reducer. */
  app.register(async (scope) => {
    scope.get("/api/v1/realtime", { websocket: true }, async (socket, req) => {
      const identity = await identify(req);
      if (!identity) return socket.close(4401, "unauthorized");
      const entry = { ws: socket, identity };
      sockets.add(entry);
      socket.on("close", () => sockets.delete(entry));
      socket.on("message", (raw) => {
        if (raw.toString() === "ping") socket.send("pong");
      });
    });
  });

  return app;
}
