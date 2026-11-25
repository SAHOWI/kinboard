import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Command, DomainError, projectChanges, projectForMember } from "@kinboard/shared";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import {
  type Identity,
  PinFormatError,
  PinGate,
  actorFor,
  bearerToken,
  parseDevToken,
  pinPepper,
} from "./auth.ts";
import { InMemoryRepository, type Repository } from "./repository.ts";

/** MVP: single demo household. M2: household resolved from the auth / device token. */
const HOUSEHOLD = "hh_1";

export interface AppOptions {
  /** Accept unsigned `dev:` identity tokens. Default: on unless NODE_ENV=production (override: KINBOARD_DEV_AUTH=1). */
  devAuth?: boolean;
  /**
   * Initial adult PIN, set only if the household has none yet (an adult can change it in the app).
   * Default: KINBOARD_PIN, or "1234" while dev auth is on. Without any PIN, display elevation is off.
   */
  pin?: string;
  /** Argon2 pepper for the PIN hash. Default: derived from KINBOARD_MASTER_KEY. */
  pepper?: Buffer;
  now?: () => number;
}

const problem = (reply: FastifyReply, status: number, title: string, detail?: string) =>
  reply.code(status).type("application/problem+json").send({ type: "about:blank", title, status, detail });

export function buildApp(repo: Repository = new InMemoryRepository(), opts: AppOptions = {}) {
  const devAuth =
    opts.devAuth ?? (process.env.NODE_ENV !== "production" || process.env.KINBOARD_DEV_AUTH === "1");
  const pin = "pin" in opts ? opts.pin : (process.env.KINBOARD_PIN ?? (devAuth ? "1234" : undefined));
  const now = opts.now ?? Date.now;
  const pepper = "pepper" in opts ? opts.pepper : pinPepper(process.env.KINBOARD_MASTER_KEY);
  const pins = new PinGate(repo, { pepper, now });

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const sockets = new Set<{ ws: WebSocket; identity: Identity }>();
  if (devAuth) app.log.warn("dev auth is ON: unsigned dev: tokens are accepted. Never expose this server.");
  if (!pepper) app.log.warn("KINBOARD_MASTER_KEY is not set: the PIN hash is not peppered.");
  if (pin) app.addHook("onReady", () => pins.ensurePin(HOUSEHOLD, pin));

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

  /**
   * Delta sync (spec §5.3): the changes after `since`, filtered for this viewer. `{ reset: true }` when
   * that history is not available, in which case the client reloads `/snapshot`.
   */
  app.get("/api/v1/sync", async (req, reply) => {
    const id = await identify(req);
    if (!id) return problem(reply, 401, "unauthorized");
    const since = Number((req.query as { since?: string }).since);
    if (!Number.isSafeInteger(since) || since < 0)
      return problem(reply, 400, "Invalid since", "`since` must be a non-negative integer revision");
    const feed = await repo.changesSince(HOUSEHOLD, since);
    if (!feed) return { reset: true };
    const state = await repo.snapshot(HOUSEHOLD);
    return { rev: feed.rev, changes: projectChanges(feed.changes, state, id.memberId) };
  });

  /** Adult PIN on a shared display → short-lived elevation token for `x-kinboard-elevation`. */
  app.post("/api/v1/pin/verify", async (req, reply) => {
    const id = await identify(req);
    if (!id) return problem(reply, 401, "unauthorized");
    if (id.device !== "display")
      return problem(reply, 403, "forbidden", "PIN elevation is only available on displays");
    const attempt = (req.body as { pin?: unknown } | null)?.pin;
    const result = await pins.verify(HOUSEHOLD, id, typeof attempt === "string" ? attempt : "");
    if (result === "unset") return problem(reply, 403, "no_pin", "No adult PIN is set for this household");
    if (result === "locked")
      return problem(reply, 429, "too_many_attempts", "Too many wrong PINs. Try again later");
    if (!result) return problem(reply, 401, "wrong_pin");
    return result;
  });

  /** An adult on the app sets the household PIN (FR-HH-08). Stored only as an Argon2id hash. */
  app.put("/api/v1/pin", async (req, reply) => {
    const id = await identify(req);
    if (!id) return problem(reply, 401, "unauthorized");
    const actor = actorFor(id, await repo.snapshot(HOUSEHOLD), false);
    if (actor.device !== "app" || !actor.elevated)
      return problem(reply, 403, "forbidden", "Only an adult in the app can change the PIN");
    const pin = (req.body as { pin?: unknown } | null)?.pin;
    try {
      await pins.setPin(HOUSEHOLD, typeof pin === "string" ? pin : "");
    } catch (e) {
      if (e instanceof PinFormatError) return problem(reply, 400, "invalid_pin", e.message);
      throw e;
    }
    return reply.code(204).send();
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
      pins.isElevated(HOUSEHOLD, id, typeof elevation === "string" ? elevation : undefined),
    );
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    // Whatever actor the client sent is replaced by the one the server derived.
    const parsed = Command.safeParse({ ...body, actor });
    if (!parsed.success) return problem(reply, 400, "Invalid command", parsed.error.message);
    try {
      const { state, fromRev, replay, changes } = await repo.apply(HOUSEHOLD, parsed.data);
      // Every new revision reaches every socket, filtered per viewer. A batch may be empty (e.g. only
      // hidden-list changes), which still advances the client's rev so it can detect gaps.
      if (state.rev > fromRev)
        for (const s of sockets) {
          if (s.ws.readyState !== 1) continue;
          const batch = projectChanges(changes, state, s.identity.memberId);
          s.ws.send(JSON.stringify({ type: "changes", rev: state.rev, changes: batch }));
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

  /** Realtime channel: the server pushes `{ type: "changes", rev, changes }` per new revision, per viewer. */
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
