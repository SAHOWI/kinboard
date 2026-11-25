import { type CommandInput, addDays, occurrences, projectForDisplay, startOfDay } from "@kinboard/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PinPad } from "../components/PinPad.tsx";
import { QuickAdd } from "../components/QuickAdd.tsx";
import { Avatar, Modal, Toasts, fmtDay, fmtTime, useNow } from "../components/ui.tsx";
import { useStore } from "../data/store.ts";
import { CalendarView } from "./CalendarView.tsx";
import { HomeView } from "./HomeView.tsx";
import { ListsView } from "./ListsView.tsx";
import { MealsView } from "./MealsView.tsx";
import { RewardsView } from "./RewardsView.tsx";
import { TasksView } from "./TasksView.tsx";
import { DisplayContext, type DisplayCtx, type DisplayView } from "./context.tsx";

const NAV: { id: DisplayView; icon: string; label: string }[] = [
  { id: "home", icon: "🏠", label: "Today" },
  { id: "calendar", icon: "📅", label: "Calendar" },
  { id: "tasks", icon: "✅", label: "Chores" },
  { id: "lists", icon: "📝", label: "Lists" },
  { id: "meals", icon: "🍲", label: "Meals" },
  { id: "rewards", icon: "⭐", label: "Rewards" },
];

const IDLE_MS = 3 * 60_000; // photo-frame / standby after 3 minutes (FR-PHO-02)

/** The 1920×1080 kiosk UI. Fills its parent box; never uses viewport units, so it can be scaled in the studio. */
export function DisplayShell() {
  const raw = useStore((s) => s.snapshot);
  const dispatch = useStore((s) => s.dispatch);
  const status = useStore((s) => s.status);
  const pending = useStore((s) => s.pending);
  const mode = useStore((s) => s.backend?.mode);
  const snapshot = useMemo(() => (raw ? projectForDisplay(raw) : null), [raw]);

  const [view, setView] = useState<DisplayView>("home");
  const [filter, setFilter] = useState<Set<string>>(new Set());
  const [elevatedUntil, setElevatedUntilState] = useState(0);
  const elevatedRef = useRef(0); // read synchronously by actor() right after PIN success
  const setElevatedUntil = (t: number) => {
    elevatedRef.current = t;
    setElevatedUntilState(t);
  };
  const [pinFor, setPinFor] = useState<null | (() => void)>(null);
  const [adding, setAdding] = useState(false);
  const [idle, setIdle] = useState(false);
  const now = useNow(1000);
  const lastTouch = useRef(Date.now());

  useEffect(() => {
    if (snapshot && filter.size === 0) setFilter(new Set(snapshot.members.map((m) => m.id)));
  }, [snapshot, filter.size]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluated on every clock tick
  useEffect(() => {
    if (!idle && Date.now() - lastTouch.current > IDLE_MS) setIdle(true);
  }, [now, idle]);

  const elevated = elevatedUntil > now.getTime();
  const actor = useCallback(
    (memberId: string | null = null) => ({
      memberId,
      elevated: elevatedRef.current > Date.now(),
      device: "display" as const,
    }),
    [],
  );

  const ctx: DisplayCtx = {
    view,
    setView,
    filter,
    toggleFilter: (id) =>
      setFilter((f) => {
        const n = new Set(f);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n.size ? n : f;
      }),
    elevated,
    withPin: (fn) => (elevatedRef.current > Date.now() ? fn() : setPinFor(() => fn)),
    lock: () => {
      setElevatedUntil(0);
      useStore.getState().lock();
    },
    run: (input: CommandInput, memberId = null) => dispatch(input, actor(memberId)),
    actor,
  };

  if (!snapshot) return <div className="flex h-full items-center justify-center text-ink-2">Loading…</div>;

  return (
    <DisplayContext.Provider value={ctx}>
      <div
        className="relative flex h-full w-full overflow-hidden bg-paper text-ink"
        onPointerDown={() => {
          lastTouch.current = Date.now();
        }}
      >
        {/* Side navigation */}
        <nav className="flex w-[132px] shrink-0 flex-col items-center gap-2 border-r border-line bg-paper-2/60 py-7">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-[26px] text-white shadow-md">
            ✿
          </div>
          {NAV.map((n) => (
            <button
              type="button"
              key={n.id}
              onClick={() => setView(n.id)}
              className={`press flex w-[104px] flex-col items-center gap-1 rounded-2xl py-3 text-[14px] font-semibold ${
                view === n.id ? "bg-white text-ink shadow-sm" : "text-ink-2 hover:bg-white/50"
              }`}
            >
              <span className="text-[30px] leading-none">{n.icon}</span>
              {n.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => (elevated ? ctx.lock() : ctx.withPin(() => {}))}
            className="press flex w-[104px] flex-col items-center gap-1 rounded-2xl py-3 text-[13px] font-semibold text-ink-2"
            title={elevated ? "Lock" : "Unlock adult mode"}
          >
            <span className="text-[26px] leading-none">{elevated ? "🔓" : "🔒"}</span>
            {elevated ? "Adult mode" : "Child-safe"}
          </button>
          <button
            type="button"
            onClick={() => setIdle(true)}
            className="press flex w-[104px] flex-col items-center gap-1 rounded-2xl py-3 text-[13px] font-semibold text-ink-2"
          >
            <span className="text-[26px] leading-none">🌙</span>
            Standby
          </button>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          {/* Header: clock · date · weather · member filter */}
          <header className="flex items-center gap-8 px-10 pt-7 pb-5">
            <div className="font-display text-[76px] font-semibold leading-none tracking-tight tabular">
              {fmtTime(now)}
            </div>
            <div>
              <div className="text-[26px] font-semibold leading-tight">
                {fmtDay(now, { weekday: "long" })}
              </div>
              <div className="text-[20px] text-ink-2">
                {fmtDay(now, { day: "numeric", month: "long", year: "numeric" })}
              </div>
            </div>
            <div className="ml-2 flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-2.5 border border-line">
              <span className="text-[34px] leading-none">⛅</span>
              <div className="leading-tight">
                <div className="text-[22px] font-semibold tabular">4°</div>
                <div className="text-[13px] text-muted">Zürich · demo</div>
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-3">
              {snapshot.members.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => ctx.toggleFilter(m.id)}
                  className="press flex flex-col items-center gap-1"
                >
                  <Avatar member={m} size={58} dim={!filter.has(m.id)} />
                  <span
                    className={`text-[13px] font-semibold ${filter.has(m.id) ? "text-ink" : "text-muted"}`}
                  >
                    {m.name}
                  </span>
                </button>
              ))}
            </div>
            <span
              title={mode === "demo" ? "Demo mode (no server)" : status}
              className="ml-2 flex items-center gap-1.5 rounded-full bg-white/70 border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-2"
            >
              <span
                className={`live-dot h-2 w-2 rounded-full ${status === "offline" ? "bg-[#b4413a]" : "bg-ok"}`}
              />
              {mode === "demo"
                ? "Demo"
                : status === "offline"
                  ? pending
                    ? `Offline · ${pending} waiting`
                    : "Offline"
                  : pending
                    ? "Syncing…"
                    : "Live"}
            </span>
          </header>

          <section className="min-h-0 flex-1 px-10 pb-8">
            {view === "home" && <HomeView snapshot={snapshot} now={now} />}
            {view === "calendar" && <CalendarView snapshot={snapshot} now={now} />}
            {view === "tasks" && <TasksView snapshot={snapshot} now={now} />}
            {view === "lists" && <ListsView snapshot={snapshot} />}
            {view === "meals" && <MealsView snapshot={snapshot} now={now} />}
            {view === "rewards" && <RewardsView snapshot={snapshot} />}
          </section>
        </main>

        {/* Floating quick-add */}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="press absolute right-10 bottom-9 z-30 flex h-[84px] items-center gap-3 rounded-full bg-ink pl-7 pr-9 text-[22px] font-semibold text-white shadow-[0_12px_30px_-10px_rgba(29,35,48,.6)]"
        >
          <span className="text-[34px] leading-none font-light">+</span> Add
        </button>

        <Modal open={adding} onClose={() => setAdding(false)} width={860} title="Add to the family board">
          <QuickAdd
            snapshot={snapshot}
            lists={snapshot.lists}
            onCancel={() => setAdding(false)}
            onSubmit={(input, kind) => {
              const go = () => {
                ctx.run(input).then((ok) => ok && useStore.getState().toast("Added ✓", "success"));
                setAdding(false);
              };
              // List items are child-safe; events and chores need the adult PIN (FR-TSK-04).
              if (kind === "item") go();
              else ctx.withPin(go);
            }}
          />
        </Modal>

        <Modal open={!!pinFor} onClose={() => setPinFor(null)} width={420}>
          <PinPad
            onCancel={() => setPinFor(null)}
            verify={async (pin) => {
              const ttlMs = await useStore.getState().verifyPin(pin);
              if (ttlMs) setElevatedUntil(Date.now() + ttlMs);
              return !!ttlMs;
            }}
            onSuccess={() => {
              const fn = pinFor;
              setPinFor(null);
              // run after state update so the actor is elevated
              setTimeout(() => fn?.(), 0);
            }}
          />
        </Modal>

        {idle && (
          <Standby
            snapshot={snapshot}
            now={now}
            onWake={() => {
              lastTouch.current = Date.now();
              setIdle(false);
            }}
          />
        )}
        <Toasts />
      </div>
    </DisplayContext.Provider>
  );
}

/** Standby / photo-frame mode. Photos arrive in v1.0; the MVP shows an ambient gradient scene. */
function Standby({
  snapshot,
  now,
  onWake,
}: { snapshot: NonNullable<ReturnType<typeof projectForDisplay>>; now: Date; onWake: () => void }) {
  const next = occurrences(snapshot.events, now, addDays(startOfDay(now), 2)).find(
    (o) => !o.event.allDay && o.start > now,
  );
  return (
    <button
      type="button"
      onClick={onWake}
      className="absolute inset-0 z-[70] overflow-hidden bg-[#141821] text-left text-white"
    >
      <div className="drift absolute -inset-[10%]">
        <div className="absolute left-[8%] top-[12%] h-[60%] w-[45%] rounded-full bg-[#E8596F] opacity-40 blur-[120px]" />
        <div className="absolute right-[6%] top-[25%] h-[55%] w-[40%] rounded-full bg-[#4F8EF7] opacity-35 blur-[130px]" />
        <div className="absolute left-[35%] bottom-[0%] h-[45%] w-[40%] rounded-full bg-[#F5A524] opacity-30 blur-[120px]" />
      </div>
      <div className="absolute left-24 bottom-24">
        <div className="font-display text-[220px] font-semibold leading-none tracking-tight tabular">
          {fmtTime(now)}
        </div>
        <div className="mt-4 text-[38px] font-medium opacity-85">{fmtDay(now)}</div>
        {next && (
          <div className="mt-10 inline-flex items-center gap-4 rounded-3xl bg-white/10 px-7 py-4 text-[26px] backdrop-blur">
            <span className="opacity-70">Next</span>
            <span className="font-semibold">{next.event.title}</span>
            <span className="opacity-70 tabular">{fmtTime(next.start)}</span>
          </div>
        )}
      </div>
      <div className="absolute right-24 bottom-24 text-[18px] opacity-60">
        Tap anywhere to wake · Photo frame in v1.0
      </div>
    </button>
  );
}
