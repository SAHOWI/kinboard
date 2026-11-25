import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Command, DomainError, projectForDisplay } from "@kinboard/shared";
import Fastify from "fastify";
import type { WebSocket } from "ws";
import { InMemoryRepository, type Repository } from "./repository.ts";

/** MVP: single demo household. M2: household resolved from the auth / device token. */
const HOUSEHOLD = "hh_1";

export function buildApp(repo: Repository = new InMemoryRepository()) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const sockets = new Set<{ ws: WebSocket; device: "display" | "app" }>();

  app.register(cors, { origin: true });
  app.register(websocket);

  app.get("/health", async () => ({ ok: true }));

  /** Full snapshot. Display tokens get the projection without hidden lists (spec §9). */
  app.get<{ Querystring: { device?: string } }>("/api/v1/snapshot", async (req) => {
    const s = await repo.snapshot(HOUSEHOLD);
    return req.query.device === "display" ? projectForDisplay(s) : s;
  });

  /** Command endpoint: validate → apply → broadcast. Idempotent by command id. */
  app.post("/api/v1/commands", async (req, reply) => {
    const parsed = Command.safeParse(req.body);
    if (!parsed.success)
      return reply
        .code(400)
        .type("application/problem+json")
        .send({ type: "about:blank", title: "Invalid command", status: 400, detail: parsed.error.message });
    try {
      const { state, replay } = await repo.apply(HOUSEHOLD, parsed.data);
      if (!replay) {
        const c = parsed.data;
        const msg = JSON.stringify({ type: "applied", rev: state.rev, command: c });
        // Never leak hidden-list activity to shared displays; they resync via /snapshot.
        const listId =
          c.type === "item.add"
            ? c.item.listId
            : c.type === "list.add"
              ? c.list.id
              : c.type === "item.toggle" || c.type === "item.remove"
                ? state.items.find((i) => i.id === c.itemId)?.listId
                : undefined;
        const touchesHidden = !!listId && !!state.lists.find((l) => l.id === listId)?.hidden;
        for (const s of sockets) {
          if (s.ws.readyState !== 1) continue;
          s.ws.send(
            touchesHidden && s.device === "display" ? JSON.stringify({ type: "rev", rev: state.rev }) : msg,
          );
        }
      }
      return { rev: state.rev, replay };
    } catch (e) {
      if (e instanceof DomainError) {
        const status = e.code === "forbidden" ? 403 : e.code === "not_found" ? 404 : 422;
        return reply
          .code(status)
          .type("application/problem+json")
          .send({ type: "about:blank", title: e.code, status, detail: e.message });
      }
      throw e;
    }
  });

  /** Realtime channel: server pushes applied commands; clients replay them through the shared reducer. */
  app.register(async (scope) => {
    scope.get<{ Querystring: { device?: string } }>(
      "/api/v1/realtime",
      { websocket: true },
      (socket, req) => {
        const entry = {
          ws: socket,
          device: req.query.device === "display" ? ("display" as const) : ("app" as const),
        };
        sockets.add(entry);
        socket.on("close", () => sockets.delete(entry));
        socket.on("message", (raw) => {
          if (raw.toString() === "ping") socket.send("pong");
        });
      },
    );
  });

  return app;
}
