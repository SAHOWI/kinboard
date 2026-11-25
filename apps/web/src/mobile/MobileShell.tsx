import {
  type Member,
  type Snapshot,
  addDays,
  balanceOf,
  dateKey,
  isDone,
  memberProgress,
  newId,
  occurrences,
  startOfDay,
  tasksForDay,
} from "@kinboard/shared";
import { useMemo, useState } from "react";
import { QuickAdd } from "../components/QuickAdd.tsx";
import {
  Avatar,
  AvatarStack,
  Burst,
  ProgressRing,
  SourceBadge,
  Toasts,
  fmtDay,
  fmtTime,
  tint,
  useNow,
} from "../components/ui.tsx";
import { useStore } from "../data/store.ts";

type Tab = "today" | "calendar" | "chores" | "lists" | "more";
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "today", icon: "☀️", label: "Today" },
  { id: "calendar", icon: "📅", label: "Calendar" },
  { id: "chores", icon: "✅", label: "Chores" },
  { id: "lists", icon: "📝", label: "Lists" },
  { id: "more", icon: "⋯", label: "More" },
];

/** Companion app (Capacitor in production). Fills its parent; no viewport units. */
export function MobileShell() {
  const snapshot = useStore((s) => s.snapshot);
  const dispatch = useStore((s) => s.dispatch);
  const [tab, setTab] = useState<Tab>("today");
  const [meId, setMeId] = useState("m_anna");
  const [sheet, setSheet] = useState(false);
  const now = useNow(15_000);

  if (!snapshot) return <div className="p-6 text-ink-2">Loading…</div>;
  const me = snapshot.members.find((m) => m.id === meId) ?? snapshot.members[0];
  const actor = { memberId: me.id, elevated: me.role === "adult", device: "app" as const };
  const run = (input: Parameters<typeof dispatch>[0]) => dispatch(input, actor);
  const myLists = snapshot.lists.filter((l) => !l.hidden || l.visibleTo.includes(me.id));
  const hour = now.getHours();
  const greet = hour < 11 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const props = { snapshot, me, run, now };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-paper text-ink">
      <header className="flex items-center gap-3 px-5 pt-5 pb-3">
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-muted">
            {fmtDay(now, { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <div className="font-display text-[26px] font-semibold leading-tight tracking-tight">
            {tab === "today" ? `${greet}, ${me.name}` : TABS.find((t) => t.id === tab)?.label}
          </div>
        </div>
        <button type="button" onClick={() => setTab("more")} className="press">
          <Avatar member={me} size={42} />
        </button>
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-auto px-5 pb-28">
        {tab === "today" && <TodayTab {...props} goto={setTab} />}
        {tab === "calendar" && <CalendarTab {...props} />}
        {tab === "chores" && <ChoresTab {...props} />}
        {tab === "lists" && <ListsTab {...props} lists={myLists} />}
        {tab === "more" && <MoreTab {...props} setMe={setMeId} />}
      </div>

      <button
        type="button"
        onClick={() => setSheet(true)}
        className="press absolute right-5 bottom-[92px] z-20 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-[30px] font-light text-white shadow-[0_10px_24px_-8px_rgba(29,35,48,.6)]"
        aria-label="Add"
      >
        +
      </button>

      <nav className="absolute inset-x-0 bottom-0 z-20 flex border-t border-line bg-white/90 px-2 pt-2 pb-5 backdrop-blur">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`press flex flex-1 flex-col items-center gap-0.5 text-[11px] font-semibold ${tab === t.id ? "text-ink" : "text-muted"}`}
          >
            <span className={`text-[22px] leading-none ${tab === t.id ? "" : "grayscale opacity-70"}`}>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {sheet && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-[#1d2330]/35 cursor-default"
            onClick={() => setSheet(false)}
          />
          <div className="rise relative max-h-[88%] overflow-auto rounded-t-[28px] bg-white p-5 pb-8">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" />
            <QuickAdd
              compact
              snapshot={snapshot}
              lists={myLists}
              onCancel={() => setSheet(false)}
              onSubmit={(input) => {
                void run(input).then(
                  (ok) => ok && useStore.getState().toast("Added ✓ — synced to the display", "success"),
                );
                setSheet(false);
              }}
            />
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}

type TabProps = {
  snapshot: Snapshot;
  me: Member;
  now: Date;
  run: (input: Parameters<ReturnType<typeof useStore.getState>["dispatch"]>[0]) => Promise<boolean>;
};

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line bg-white p-4 ${className}`}>{children}</div>;
}
function H({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mt-5 mb-2 flex items-center">
      <h3 className="flex-1 text-[13px] font-bold uppercase tracking-wider text-muted">{children}</h3>
      {right}
    </div>
  );
}

function EventRow({ o, byId }: { o: ReturnType<typeof occurrences>[number]; byId: Map<string, Member> }) {
  const ms = o.event.memberIds.map((id) => byId.get(id)!).filter(Boolean);
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-[46px] text-right text-[13px] font-semibold tabular">
        {o.event.allDay ? "all-day" : fmtTime(o.start)}
      </div>
      <div className="h-9 w-1 rounded-full" style={{ background: ms[0]?.color ?? "#858a96" }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold">{o.event.title}</span>
          <SourceBadge source={o.event.source} />
        </div>
        {o.event.location && <div className="truncate text-[12px] text-ink-2">{o.event.location}</div>}
      </div>
      <AvatarStack members={ms} size={22} />
    </div>
  );
}

function TodayTab({ snapshot, me, run, now, goto }: TabProps & { goto: (t: Tab) => void }) {
  const today = startOfDay(now);
  const byId = new Map(snapshot.members.map((m) => [m.id, m]));
  const occ = occurrences(snapshot.events, today, addDays(today, 1));
  const upcoming = occ.filter((o) => o.event.allDay || o.end > now);
  const pending = snapshot.redemptions.filter((r) => r.status === "requested");
  const kids = snapshot.members.filter((m) => m.role === "child");
  const shop = snapshot.lists.find((l) => l.kind === "shopping");
  const open = snapshot.items.filter((i) => i.listId === shop?.id && !i.checked);

  return (
    <div>
      {me.role === "adult" && pending.length > 0 && (
        <button
          type="button"
          onClick={() => goto("more")}
          className="press mb-3 flex w-full items-center gap-3 rounded-3xl bg-accent p-4 text-left text-white"
        >
          <span className="text-[26px]">🙋</span>
          <span className="flex-1 text-[15px] font-semibold">
            {pending.length} reward request{pending.length > 1 ? "s" : ""} waiting for you
          </span>
          <span className="text-[20px]">›</span>
        </button>
      )}
      <Card>
        <div className="mb-1 flex items-center">
          <span className="flex-1 text-[17px] font-bold">Today</span>
          <span className="text-[13px] text-muted">{upcoming.length} left</span>
        </div>
        {upcoming.length === 0 && <div className="py-3 text-[14px] text-muted">Nothing else today.</div>}
        {upcoming.map((o) => (
          <EventRow key={o.key} o={o} byId={byId} />
        ))}
      </Card>

      <H>Kids today</H>
      <div className="grid grid-cols-2 gap-3">
        {kids.map((k) => {
          const p = memberProgress(snapshot, k.id, today);
          return (
            <button
              type="button"
              key={k.id}
              onClick={() => goto("chores")}
              className="press rounded-3xl border border-line bg-white p-4 text-left"
            >
              <ProgressRing ratio={p.ratio} color={k.color} size={56} stroke={5}>
                <Avatar member={k} size={40} />
              </ProgressRing>
              <div className="mt-2 text-[16px] font-bold">{k.name}</div>
              <div className="text-[13px] text-ink-2 tabular">
                {p.done}/{p.total} chores · {balanceOf(snapshot, k.id)} pts
              </div>
            </button>
          );
        })}
      </div>

      <H
        right={
          <button
            type="button"
            onClick={() => goto("lists")}
            className="text-[13px] font-semibold text-ink-2"
          >
            All lists ›
          </button>
        }
      >
        {shop?.icon} {shop?.name}
      </H>
      <Card className="py-2">
        {open.slice(0, 5).map((i) => (
          <button
            type="button"
            key={i.id}
            onClick={() => run({ type: "item.check", itemId: i.id, checked: !i.checked })}
            className="press flex w-full items-center gap-3 py-2 text-left text-[15px]"
          >
            <span className="h-6 w-6 rounded-lg border-2 border-line" />
            {i.text}
          </button>
        ))}
        {open.length > 5 && <div className="py-1 text-[13px] text-muted">+{open.length - 5} more</div>}
      </Card>
    </div>
  );
}

function CalendarTab({ snapshot, now }: TabProps) {
  const [only, setOnly] = useState<string | null>(null);
  const today = startOfDay(now);
  const byId = new Map(snapshot.members.map((m) => [m.id, m]));
  const occ = occurrences(snapshot.events, today, addDays(today, 14)).filter(
    (o) => !only || o.event.memberIds.includes(only) || o.event.memberIds.length === 0,
  );
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  return (
    <div>
      <div className="no-scrollbar -mx-5 mb-2 flex gap-2 overflow-auto px-5">
        <button
          type="button"
          onClick={() => setOnly(null)}
          className={`press shrink-0 rounded-full px-4 py-2 text-[14px] font-semibold ${!only ? "bg-ink text-white" : "bg-white border border-line"}`}
        >
          Everyone
        </button>
        {snapshot.members.map((m) => (
          <button
            type="button"
            key={m.id}
            onClick={() => setOnly(m.id)}
            className="press flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-[14px] font-semibold"
            style={{
              borderColor: only === m.id ? m.color : "var(--color-line)",
              background: only === m.id ? tint(m.color, 0.15) : "white",
            }}
          >
            <Avatar member={m} size={26} /> {m.name}
          </button>
        ))}
      </div>
      {days.map((d) => {
        const list = occ.filter(
          (o) => dateKey(o.start) === dateKey(d) || (o.event.allDay && o.start <= d && o.end > d),
        );
        if (!list.length) return null;
        return (
          <div key={dateKey(d)}>
            <H>
              {dateKey(d) === dateKey(today)
                ? "Today"
                : dateKey(d) === dateKey(addDays(today, 1))
                  ? "Tomorrow"
                  : fmtDay(d, { weekday: "long", day: "numeric", month: "short" })}
            </H>
            <Card className="py-1">
              {list.map((o) => (
                <EventRow key={o.key} o={o} byId={byId} />
              ))}
            </Card>
          </div>
        );
      })}
    </div>
  );
}

function ChoresTab({ snapshot, me, run, now }: TabProps) {
  const today = startOfDay(now);
  const todays = tasksForDay(snapshot.tasks, today);
  const people = snapshot.members.filter((m) => todays.some((t) => t.memberIds.includes(m.id)));
  const [who, setWho] = useState(people.find((p) => p.role === "child")?.id ?? me.id);
  const member = snapshot.members.find((m) => m.id === who)!;
  const mine = todays.filter((t) => t.memberIds.includes(who));
  const p = memberProgress(snapshot, who, today);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {people.map((m) => (
          <button
            type="button"
            key={m.id}
            onClick={() => setWho(m.id)}
            className="press flex flex-1 flex-col items-center gap-1 rounded-2xl py-2"
            style={{ background: who === m.id ? tint(m.color, 0.15) : "transparent" }}
          >
            <Avatar member={m} size={40} dim={who !== m.id} />
            <span className="text-[12px] font-semibold">{m.name}</span>
          </button>
        ))}
      </div>
      <Card className="mb-3 flex items-center gap-4">
        <ProgressRing ratio={p.ratio} color={member.color} size={64} stroke={6}>
          <span className="text-[15px] font-bold tabular">{Math.round(p.ratio * 100)}%</span>
        </ProgressRing>
        <div>
          <div className="text-[18px] font-bold">{member.name}'s day</div>
          <div className="text-[13px] text-ink-2 tabular">
            {p.done} of {p.total} done
            {member.role === "child" ? ` · ${balanceOf(snapshot, member.id)} points` : ""}
          </div>
        </div>
      </Card>
      <div className="flex flex-col gap-2">
        {mine.map((t) => (
          <MobileTask
            key={t.id}
            done={isDone(snapshot, t.id, who, today)}
            icon={t.icon}
            title={t.title}
            points={t.points}
            color={member.color}
            routine={snapshot.routines.find((r) => r.id === t.routineId)?.name}
            onToggle={(done) =>
              run({
                type: done ? "task.uncomplete" : "task.complete",
                taskId: t.id,
                memberId: who,
                date: dateKey(today),
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function MobileTask({
  done,
  icon,
  title,
  points,
  color,
  routine,
  onToggle,
}: {
  done: boolean;
  icon: string;
  title: string;
  points: number;
  color: string;
  routine?: string;
  onToggle: (done: boolean) => void;
}) {
  const [burst, setBurst] = useState(0);
  return (
    <button
      type="button"
      onClick={() => {
        if (!done) setBurst(Date.now());
        onToggle(done);
      }}
      className="press flex items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left"
      style={{
        background: done ? tint(color, 0.12) : "white",
        borderColor: done ? "transparent" : undefined,
      }}
    >
      <span className={`text-[24px] ${done ? "opacity-50" : ""}`}>{icon}</span>
      <span className="flex-1">
        <span className={`block text-[15px] font-semibold ${done ? "text-ink-2 line-through" : ""}`}>
          {title}
        </span>
        {routine && <span className="text-[12px] text-muted">{routine}</span>}
      </span>
      {points > 0 && <span className="text-[12px] font-bold text-accent">+{points}</span>}
      <span
        className="relative flex h-8 w-8 items-center justify-center rounded-full"
        style={{
          background: done ? color : "transparent",
          boxShadow: done ? "none" : `inset 0 0 0 2px ${tint(color, 0.6)}`,
        }}
      >
        {done && <span className="text-[15px] font-bold text-white">✓</span>}
        <Burst seed={burst} />
      </span>
    </button>
  );
}

function ListsTab({ snapshot, run, lists }: TabProps & { lists: Snapshot["lists"] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const list = lists.find((l) => l.id === openId);

  if (list) {
    const items = snapshot.items
      .filter((i) => i.listId === list.id)
      .sort((a, b) => Number(a.checked) - Number(b.checked) || a.sort - b.sort);
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpenId(null)}
          className="mb-2 text-[14px] font-semibold text-ink-2"
        >
          ‹ All lists
        </button>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[30px]">{list.icon}</span>
          <span className="font-display text-[24px] font-semibold">{list.name}</span>
          {list.hidden && (
            <span className="rounded-md bg-paper-2 px-2 py-0.5 text-[11px] font-bold text-ink-2">
              🔒 PRIVATE
            </span>
          )}
        </div>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void run({
              type: "item.add",
              item: {
                id: newId("i"),
                listId: list.id,
                text: text.trim(),
                checked: false,
                sort: Date.now(),
              },
            });
            setText("");
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add item…"
            className="flex-1 rounded-2xl border border-line bg-white px-4 py-3 text-[16px] outline-none"
          />
          <button type="submit" className="press rounded-2xl bg-ink px-5 font-semibold text-white">
            Add
          </button>
        </form>
        <Card className="py-1">
          {items.map((i) => (
            <button
              type="button"
              key={i.id}
              onClick={() => run({ type: "item.check", itemId: i.id, checked: !i.checked })}
              className="press flex w-full items-center gap-3 py-2.5 text-left"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-lg text-[13px] font-bold ${i.checked ? "bg-ok text-white" : "border-2 border-line"}`}
              >
                {i.checked && "✓"}
              </span>
              <span className={`text-[15px] ${i.checked ? "text-muted line-through" : ""}`}>{i.text}</span>
            </button>
          ))}
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {lists.map((l) => {
        const n = snapshot.items.filter((i) => i.listId === l.id && !i.checked).length;
        return (
          <button
            type="button"
            key={l.id}
            onClick={() => setOpenId(l.id)}
            className="press rounded-3xl border border-line bg-white p-4 text-left"
          >
            <div className="flex items-start">
              <span className="flex-1 text-[32px]">{l.icon}</span>
              {l.hidden && <span className="text-[14px]">🔒</span>}
            </div>
            <div className="mt-2 text-[16px] font-bold">{l.name}</div>
            <div className="text-[13px] text-ink-2">{n} open</div>
          </button>
        );
      })}
    </div>
  );
}

function MoreTab({ snapshot, me, run, setMe }: TabProps & { setMe: (id: string) => void }) {
  const byId = new Map(snapshot.members.map((m) => [m.id, m]));
  const pending = snapshot.redemptions.filter((r) => r.status === "requested");
  const qr = useMemo(() => fakeQr("KB-7Q4-XM2"), []);

  return (
    <div>
      {me.role === "adult" && (
        <>
          <H>Reward requests</H>
          <Card>
            {pending.length === 0 && <div className="text-[14px] text-muted">No open requests</div>}
            {pending.map((p) => {
              const r = snapshot.rewards.find((x) => x.id === p.rewardId)!;
              const m = byId.get(p.memberId)!;
              return (
                <div key={p.id} className="flex items-center gap-3 py-2">
                  <Avatar member={m} size={36} />
                  <div className="flex-1 text-[14px]">
                    <div className="font-semibold">
                      {r.icon} {r.title}
                    </div>
                    <div className="text-ink-2">
                      {m.name} · {r.cost} pts
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => run({ type: "reward.decide", redemptionId: p.id, approve: false })}
                    className="press h-9 w-9 rounded-full bg-paper-2"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    onClick={() => run({ type: "reward.decide", redemptionId: p.id, approve: true })}
                    className="press h-9 rounded-full bg-ok px-3 text-[13px] font-semibold text-white"
                  >
                    Approve
                  </button>
                </div>
              );
            })}
          </Card>
        </>
      )}

      <H>Signed in as (demo switch)</H>
      <div className="flex gap-2">
        {snapshot.members.map((m) => (
          <button
            type="button"
            key={m.id}
            onClick={() => setMe(m.id)}
            className="press flex flex-1 flex-col items-center gap-1 rounded-2xl py-2"
            style={{ background: me.id === m.id ? tint(m.color, 0.15) : "transparent" }}
          >
            <Avatar member={m} size={40} dim={me.id !== m.id} />
            <span className="text-[12px] font-semibold">{m.name}</span>
            <span className="text-[10px] uppercase text-muted">{m.role}</span>
          </button>
        ))}
      </div>

      <H>Connected calendars</H>
      <Card className="py-1">
        {[
          ["Tom", "Google Calendar", "google", "Synced 1 min ago"],
          ["Anna", "iCloud (CalDAV)", "caldav", "Synced 3 min ago"],
          ["Family", "Waste collection (ICS)", "ics", "Synced 12 min ago"],
        ].map(([who, name, src, s]) => (
          <div key={name} className="flex items-center gap-3 py-2.5 text-[14px]">
            <SourceBadge source={src} />
            <div className="flex-1">
              <div className="font-semibold">{name}</div>
              <div className="text-[12px] text-ink-2">
                {who} · {s}
              </div>
            </div>
            <span className="h-2 w-2 rounded-full bg-ok" />
          </div>
        ))}
      </Card>

      <H>Pair a display</H>
      <Card className="flex items-center gap-4">
        <svg
          viewBox="0 0 25 25"
          className="h-24 w-24 shrink-0 rounded-lg bg-white"
          shapeRendering="crispEdges"
          role="img"
          aria-label="Pairing QR (illustration)"
        >
          <title>Pairing QR</title>
          {qr.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#1d2330" />
          ))}
        </svg>
        <div className="text-[13px] leading-snug text-ink-2">
          New display? It shows a QR code on first boot. Scan it here, or enter the code{" "}
          <b className="text-ink tabular">KB-7Q4-XM2</b>.
        </div>
      </Card>
      <div className="mt-6 text-center text-[12px] text-muted">Kinboard MVP · open source · v0.1.0</div>
    </div>
  );
}

/** Deterministic QR-looking pattern for the mock pairing card (real codes are generated server-side). */
function fakeQr(seed: string): [number, number][] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const out: [number, number][] = [];
  const finder = (x: number, y: number) => {
    for (let i = 0; i < 7; i++)
      for (let j = 0; j < 7; j++)
        if (i === 0 || j === 0 || i === 6 || j === 6 || (i > 1 && i < 5 && j > 1 && j < 5))
          out.push([x + i, y + j]);
  };
  finder(0, 0);
  finder(18, 0);
  finder(0, 18);
  for (let x = 0; x < 25; x++)
    for (let y = 0; y < 25; y++) {
      if ((x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16)) continue;
      h = (h * 1103515245 + 12345) >>> 0;
      if ((h >> 16) % 2) out.push([x, y]);
    }
  return out;
}
