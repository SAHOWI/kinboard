import { type Snapshot, balanceOf, isDone, memberProgress, startOfDay, tasksForDay } from "@kinboard/shared";
import { Avatar, ProgressRing, tint } from "../components/ui.tsx";
import { TaskChip } from "./TaskChip.tsx";
import { useDisplay } from "./context.tsx";

export function TasksView({ snapshot, now }: { snapshot: Snapshot; now: Date }) {
  const { filter } = useDisplay();
  const today = startOfDay(now);
  const todays = tasksForDay(snapshot.tasks, today);
  const members = snapshot.members.filter(
    (m) => filter.has(m.id) && todays.some((t) => t.memberIds.includes(m.id)),
  );
  const groups = [
    ...snapshot.routines.map((r) => ({ id: r.id as string | undefined, label: `${r.icon} ${r.name}` })),
    { id: undefined, label: "📌 Anytime" },
  ];

  return (
    <div
      className="grid h-full gap-5"
      style={{ gridTemplateColumns: `repeat(${Math.max(members.length, 1)}, minmax(0,1fr))` }}
    >
      {members.map((m) => {
        const p = memberProgress(snapshot, m.id, today);
        const mine = todays.filter((t) => t.memberIds.includes(m.id));
        const allDone = p.total > 0 && p.done === p.total;
        return (
          <div key={m.id} className="card flex min-h-0 flex-col overflow-hidden">
            <div className="flex items-center gap-4 p-5" style={{ background: tint(m.color, 0.1) }}>
              <ProgressRing ratio={p.ratio} color={m.color} size={78} stroke={7}>
                <Avatar member={m} size={58} />
              </ProgressRing>
              <div className="flex-1">
                <div className="font-display text-[30px] font-semibold leading-none">{m.name}</div>
                <div className="mt-1.5 text-[16px] text-ink-2 tabular">
                  {allDone ? "All done! 🎉" : `${p.done} of ${p.total} done`}
                </div>
              </div>
              {m.role === "child" && (
                <div className="rounded-2xl bg-white px-3 py-2 text-center shadow-sm">
                  <div className="text-[24px] font-bold tabular leading-none" style={{ color: m.color }}>
                    {balanceOf(snapshot, m.id)}
                  </div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted">points</div>
                </div>
              )}
            </div>
            <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
              {groups.map((g) => {
                const ts = mine.filter((t) => t.routineId === g.id);
                if (!ts.length) return null;
                return (
                  <div key={g.label}>
                    <div className="mb-2 text-[14px] font-bold uppercase tracking-wider text-muted">
                      {g.label}
                    </div>
                    <div className="flex flex-col gap-2">
                      {ts.map((t) => (
                        <TaskChip
                          key={t.id}
                          task={t}
                          member={m}
                          day={today}
                          done={isDone(snapshot, t.id, m.id, today)}
                          size="lg"
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
