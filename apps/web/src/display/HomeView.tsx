import {
  type Snapshot,
  activeRoutineId,
  addDays,
  dateKey,
  isDone,
  memberProgress,
  occurrences,
  startOfDay,
  tasksForDay,
} from "@kinboard/shared";
import { Avatar, AvatarStack, ProgressRing, SourceBadge, fmtTime, tint } from "../components/ui.tsx";
import { TaskChip } from "./TaskChip.tsx";
import { useDisplay } from "./context.tsx";

export function HomeView({ snapshot, now }: { snapshot: Snapshot; now: Date }) {
  const { filter, setView, run } = useDisplay();
  const today = startOfDay(now);
  const byId = new Map(snapshot.members.map((m) => [m.id, m]));
  const visible = (ids: string[]) => ids.length === 0 || ids.some((id) => filter.has(id));

  const occ = occurrences(snapshot.events, today, addDays(today, 1)).filter((o) =>
    visible(o.event.memberIds),
  );
  const allDay = occ.filter((o) => o.event.allDay);
  const timed = occ.filter((o) => !o.event.allDay);
  const tomorrow = occurrences(snapshot.events, addDays(today, 1), addDays(today, 2)).filter((o) =>
    visible(o.event.memberIds),
  );

  const routineId = activeRoutineId(snapshot, now);
  const routine = snapshot.routines.find((r) => r.id === routineId);
  const todays = tasksForDay(snapshot.tasks, today);
  const people = snapshot.members.filter(
    (m) =>
      filter.has(m.id) &&
      todays.some((t) => t.memberIds.includes(m.id) && (!routineId || t.routineId === routineId)),
  );

  const dinner = snapshot.meals.find((m) => m.date === dateKey(today) && m.slot === "dinner");
  const shop = snapshot.lists.find((l) => l.kind === "shopping");
  const shopItems = snapshot.items
    .filter((i) => i.listId === shop?.id && !i.checked)
    .sort((a, b) => a.sort - b.sort);

  const nowIdx = timed.findIndex((o) => o.end > now);

  return (
    <div className="grid h-full grid-cols-[1.05fr_1.35fr_0.85fr] gap-6">
      {/* Today agenda */}
      <div className="card flex min-h-0 flex-col p-6">
        <SectionTitle icon="📅" title="Today" action="Week →" onAction={() => setView("calendar")} />
        {allDay.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {allDay.map((o) => (
              <span key={o.key} className="rounded-xl bg-paper-2 px-3 py-1.5 text-[16px] font-semibold">
                {o.event.title}
              </span>
            ))}
          </div>
        )}
        <div className="no-scrollbar -mx-2 flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-2">
          {timed.length === 0 && <Empty text="Nothing planned today. Enjoy! ☀️" />}
          {timed.map((o, i) => {
            const ms = o.event.memberIds.map((id) => byId.get(id)!).filter(Boolean);
            const color = ms[0]?.color ?? "#858a96";
            const past = o.end <= now;
            const live = o.start <= now && now < o.end;
            return (
              <div key={o.key}>
                {i === nowIdx && !live && <NowLine now={now} />}
                <div
                  className={`flex items-stretch gap-4 rounded-2xl p-3 transition-opacity ${past ? "opacity-45" : ""}`}
                  style={{ background: live ? tint(color, 0.12) : undefined }}
                >
                  <div className="w-[64px] shrink-0 pt-0.5 text-right">
                    <div className="text-[19px] font-semibold tabular">{fmtTime(o.start)}</div>
                    <div className="text-[14px] text-muted tabular">{fmtTime(o.end)}</div>
                  </div>
                  <div className="w-[5px] shrink-0 rounded-full" style={{ background: color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[20px] font-semibold">{o.event.title}</span>
                      <SourceBadge source={o.event.source} />
                      {live && (
                        <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-bold text-white">
                          NOW
                        </span>
                      )}
                    </div>
                    {o.event.location && (
                      <div className="truncate text-[15px] text-ink-2">📍 {o.event.location}</div>
                    )}
                  </div>
                  <AvatarStack members={ms} size={34} />
                </div>
              </div>
            );
          })}
        </div>
        {tomorrow.length > 0 && (
          <div className="mt-3 border-t border-line pt-3 text-[15px] text-ink-2">
            <span className="font-semibold text-ink">Tomorrow:</span>{" "}
            {tomorrow
              .slice(0, 3)
              .map((o) => (o.event.allDay ? o.event.title : `${fmtTime(o.start)} ${o.event.title}`))
              .join(" · ")}
            {tomorrow.length > 3 && ` · +${tomorrow.length - 3}`}
          </div>
        )}
      </div>

      {/* Routines */}
      <div className="card flex min-h-0 flex-col p-6">
        <SectionTitle
          icon={routine?.icon ?? "✅"}
          title={routine ? `${routine.name} routine` : "Today's chores"}
          sub={routine ? `${routine.from}–${routine.to}` : undefined}
          action="All chores →"
          onAction={() => setView("tasks")}
        />
        <div className="no-scrollbar grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-4 overflow-auto">
          {people.length === 0 && <Empty text="All clear for now 🎉" />}
          {people.map((m) => {
            const tasks = todays.filter(
              (t) => t.memberIds.includes(m.id) && (!routineId || t.routineId === routineId),
            );
            const p = memberProgress(snapshot, m.id, today);
            return (
              <div key={m.id} className="rounded-3xl p-4" style={{ background: tint(m.color, 0.07) }}>
                <div className="mb-3 flex items-center gap-3">
                  <ProgressRing ratio={p.ratio} color={m.color} size={60} stroke={6}>
                    <Avatar member={m} size={44} />
                  </ProgressRing>
                  <div className="flex-1">
                    <div className="text-[21px] font-bold">{m.name}</div>
                    <div className="text-[14px] text-ink-2 tabular">
                      {p.done}/{p.total} done today
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {tasks.map((t) => (
                    <TaskChip
                      key={t.id}
                      task={t}
                      member={m}
                      day={today}
                      done={isDone(snapshot, t.id, m.id, today)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right column */}
      <div className="flex min-h-0 flex-col gap-6">
        <button type="button" onClick={() => setView("meals")} className="card press p-6 text-left">
          <div className="text-[13px] font-bold uppercase tracking-wider text-muted">Dinner tonight</div>
          <div className="mt-2 flex items-center gap-4">
            <span className="text-[56px] leading-none">{dinner?.icon ?? "🍽️"}</span>
            <span className="font-display text-[28px] font-semibold leading-tight">
              {dinner?.title ?? "Not planned yet"}
            </span>
          </div>
        </button>
        <div className="card flex min-h-0 flex-1 flex-col p-6">
          <SectionTitle
            icon={shop?.icon ?? "🛒"}
            title={shop?.name ?? "Shopping"}
            action="Lists →"
            onAction={() => setView("lists")}
          />
          <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
            {shopItems.length === 0 && <Empty text="Nothing to buy 🎉" />}
            {shopItems.map((i) => (
              <button
                type="button"
                key={i.id}
                onClick={() => run({ type: "item.toggle", itemId: i.id })}
                className="press flex items-center gap-3 rounded-xl px-2 py-2.5 text-left text-[19px] hover:bg-paper"
              >
                <span className="h-7 w-7 shrink-0 rounded-lg border-[2.5px] border-line" />
                {i.text}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SectionTitle({
  icon,
  title,
  sub,
  action,
  onAction,
}: { icon: string; title: string; sub?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="text-[26px] leading-none">{icon}</span>
      <h2 className="font-display text-[28px] font-semibold tracking-tight">{title}</h2>
      {sub && <span className="text-[16px] text-muted tabular">{sub}</span>}
      <div className="flex-1" />
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="press rounded-full px-3 py-1.5 text-[15px] font-semibold text-ink-2 hover:bg-paper-2"
        >
          {action}
        </button>
      )}
    </div>
  );
}

function NowLine({ now }: { now: Date }) {
  return (
    <div className="my-1 flex items-center gap-2 pl-2">
      <span className="text-[13px] font-bold text-accent tabular">{fmtTime(now)}</span>
      <span className="h-[2px] flex-1 rounded bg-accent" />
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="col-span-full py-10 text-center text-[18px] text-muted">{text}</div>;
}
