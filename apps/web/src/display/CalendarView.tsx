import {
  type Member,
  type Occurrence,
  type Snapshot,
  addDays,
  dateKey,
  occurrences,
  startOfDay,
  startOfWeek,
} from "@kinboard/shared";
import { useState } from "react";
import {
  Avatar,
  AvatarStack,
  Modal,
  Segmented,
  SourceBadge,
  fmtDay,
  fmtTime,
  tint,
} from "../components/ui.tsx";
import { useDisplay } from "./context.tsx";

type Mode = "week" | "family" | "month";
const H0 = 7;
const H1 = 22;

export function CalendarView({ snapshot, now }: { snapshot: Snapshot; now: Date }) {
  const { filter, withPin, run } = useDisplay();
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(now));
  const [open, setOpen] = useState<Occurrence | null>(null);
  const byId = new Map(snapshot.members.map((m) => [m.id, m]));
  const visible = (ids: string[]) => ids.length === 0 || ids.some((id) => filter.has(id));

  const step = (dir: number) =>
    setAnchor((a) =>
      mode === "month"
        ? new Date(a.getFullYear(), a.getMonth() + dir, 1)
        : addDays(a, dir * (mode === "week" ? 7 : 1)),
    );

  const title =
    mode === "week"
      ? `${fmtDay(startOfWeek(anchor), { day: "numeric", month: "short" })} – ${fmtDay(addDays(startOfWeek(anchor), 6), { day: "numeric", month: "short", year: "numeric" })}`
      : mode === "family"
        ? fmtDay(anchor)
        : fmtDay(anchor, { month: "long", year: "numeric" });

  return (
    <div className="card flex h-full flex-col p-6">
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => step(-1)}
          className="press h-12 w-12 rounded-full bg-paper-2 text-[22px]"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          className="press h-12 w-12 rounded-full bg-paper-2 text-[22px]"
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => setAnchor(startOfDay(now))}
          className="press rounded-full bg-paper-2 px-5 py-2.5 text-[16px] font-semibold"
        >
          Today
        </button>
        <h2 className="ml-3 font-display text-[30px] font-semibold tracking-tight">{title}</h2>
        <div className="flex-1" />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "week", label: "Week" },
            { value: "family", label: "Family day" },
            { value: "month", label: "Month" },
          ]}
        />
      </div>

      {mode === "week" && (
        <TimeGrid
          now={now}
          columns={Array.from({ length: 7 }, (_, i) => {
            const d = addDays(startOfWeek(anchor), i);
            return {
              key: dateKey(d),
              label: (
                <div
                  className={`flex items-baseline gap-2 ${dateKey(d) === dateKey(now) ? "text-accent" : ""}`}
                >
                  <span className="text-[15px] font-semibold uppercase">
                    {fmtDay(d, { weekday: "short" })}
                  </span>
                  <span className="font-display text-[26px] font-semibold">{d.getDate()}</span>
                </div>
              ),
              day: d,
              occ: occurrences(snapshot.events, d, addDays(d, 1)).filter((o) => visible(o.event.memberIds)),
            };
          })}
          byId={byId}
          onOpen={setOpen}
        />
      )}

      {mode === "family" && (
        <TimeGrid
          now={now}
          columns={snapshot.members
            .filter((m) => filter.has(m.id))
            .map((m) => ({
              key: m.id,
              label: (
                <div className="flex items-center gap-2">
                  <Avatar member={m} size={34} />
                  <span className="text-[18px] font-bold">{m.name}</span>
                </div>
              ),
              day: anchor,
              color: m.color,
              occ: occurrences(snapshot.events, anchor, addDays(anchor, 1)).filter(
                (o) => o.event.memberIds.includes(m.id) || o.event.memberIds.length === 0,
              ),
            }))}
          byId={byId}
          onOpen={setOpen}
        />
      )}

      {mode === "month" && (
        <MonthGrid
          snapshot={snapshot}
          anchor={anchor}
          now={now}
          visible={visible}
          byId={byId}
          onOpen={setOpen}
        />
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} width={560}>
        {open && (
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-[32px] font-semibold tracking-tight">{open.event.title}</h2>
              <SourceBadge source={open.event.source} />
            </div>
            <div className="mt-2 text-[19px] text-ink-2">
              {fmtDay(open.start)} {!open.event.allDay && `· ${fmtTime(open.start)}–${fmtTime(open.end)}`}
            </div>
            {open.event.location && (
              <div className="mt-1 text-[18px] text-ink-2">📍 {open.event.location}</div>
            )}
            {open.event.rrule && (
              <div className="mt-1 text-[16px] text-muted">
                🔁 Repeats ({open.event.rrule.replace("FREQ=", "").toLowerCase()})
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              {open.event.memberIds
                .map((id) => byId.get(id))
                .filter(Boolean)
                .map((m) => (
                  <span
                    key={m!.id}
                    className="flex items-center gap-2 rounded-full py-1 pl-1 pr-4 text-[17px] font-semibold"
                    style={{ background: tint(m!.color, 0.14) }}
                  >
                    <Avatar member={m!} size={32} /> {m!.name}
                  </span>
                ))}
            </div>
            <div className="mt-7 flex justify-end gap-3">
              {open.event.source === "local" && (
                <button
                  type="button"
                  onClick={() =>
                    withPin(() => {
                      void run({ type: "event.delete", eventId: open.event.id });
                      setOpen(null);
                    })
                  }
                  className="press rounded-full px-5 py-3 text-[17px] font-semibold text-[#b4413a]"
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="press rounded-full bg-ink px-7 py-3 text-[17px] font-semibold text-white"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

interface Column {
  key: string;
  label: React.ReactNode;
  day: Date;
  color?: string;
  occ: Occurrence[];
}

function TimeGrid({
  columns,
  byId,
  now,
  onOpen,
}: { columns: Column[]; byId: Map<string, Member>; now: Date; onOpen: (o: Occurrence) => void }) {
  const hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);
  const pct = (d: Date) =>
    Math.max(0, Math.min(100, ((d.getHours() + d.getMinutes() / 60 - H0) / (H1 - H0)) * 100));
  const cols = `64px repeat(${columns.length}, minmax(0,1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid border-b border-line pb-2" style={{ gridTemplateColumns: cols }}>
        <div />
        {columns.map((c) => (
          <div key={c.key} className="px-2">
            {c.label}
            <div className="mt-1.5 flex min-h-[30px] flex-col gap-1">
              {c.occ
                .filter((o) => o.event.allDay)
                .map((o) => (
                  <button
                    type="button"
                    key={o.key}
                    onClick={() => onOpen(o)}
                    className="press truncate rounded-lg bg-paper-2 px-2 py-1 text-left text-[13px] font-semibold"
                  >
                    {o.event.title}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="relative grid min-h-0 flex-1" style={{ gridTemplateColumns: cols }}>
        <div className="relative">
          {hours.map((h) => (
            <div
              key={h}
              className="absolute right-3 -translate-y-1/2 text-[13px] font-medium text-muted tabular"
              style={{ top: `${((h - H0) / (H1 - H0)) * 100}%` }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {columns.map((c) => {
          const timed = c.occ.filter((o) => !o.event.allDay);
          const lanes = assignLanes(timed);
          const isToday = dateKey(c.day) === dateKey(now);
          return (
            <div
              key={c.key}
              className="relative border-l border-line"
              style={{
                background: c.color ? tint(c.color, 0.04) : isToday ? "rgba(217,100,63,0.04)" : undefined,
              }}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-line/60"
                  style={{ top: `${((h - H0) / (H1 - H0)) * 100}%` }}
                />
              ))}
              {timed.map((o) => {
                const ms = o.event.memberIds.map((id) => byId.get(id)!).filter(Boolean);
                const color = c.color ?? ms[0]?.color ?? "#858a96";
                const { lane, of } = lanes.get(o.key)!;
                const top = pct(o.start);
                const h = Math.max(pct(o.end) - top, 3.2);
                return (
                  <button
                    type="button"
                    key={o.key}
                    onClick={() => onOpen(o)}
                    className={`press absolute overflow-hidden rounded-xl px-2 py-1 text-left ${o.end < now ? "opacity-50" : ""}`}
                    style={{
                      top: `${top}%`,
                      height: `${h}%`,
                      left: `calc(${(lane / of) * 100}% + 3px)`,
                      width: `calc(${100 / of}% - 6px)`,
                      background: tint(color, 0.18),
                      borderLeft: `4px solid ${color}`,
                    }}
                  >
                    <div className="truncate text-[14px] font-bold leading-tight">{o.event.title}</div>
                    <div className="flex items-center gap-1 text-[12px] text-ink-2 tabular">
                      {fmtTime(o.start)}
                      {!c.color && ms.length > 1 && (
                        <span className="ml-auto">
                          <AvatarStack members={ms} size={18} />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {isToday && now.getHours() >= H0 && now.getHours() < H1 && (
                <div className="absolute inset-x-0 z-10 flex items-center" style={{ top: `${pct(now)}%` }}>
                  <span className="-ml-1.5 h-3 w-3 rounded-full bg-accent" />
                  <span className="h-[2px] flex-1 bg-accent" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Greedy lane assignment for overlapping events within one column. */
function assignLanes(occ: Occurrence[]) {
  const res = new Map<string, { lane: number; of: number }>();
  let cluster: Occurrence[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const laneEnds: number[] = [];
    const tmp: [string, number][] = [];
    for (const o of cluster) {
      let l = laneEnds.findIndex((e) => e <= o.start.getTime());
      if (l < 0) l = laneEnds.length;
      laneEnds[l] = o.end.getTime();
      tmp.push([o.key, l]);
    }
    for (const [k, l] of tmp) res.set(k, { lane: l, of: laneEnds.length });
    cluster = [];
  };
  for (const o of [...occ].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    if (cluster.length && o.start.getTime() >= clusterEnd) flush();
    cluster.push(o);
    clusterEnd = Math.max(clusterEnd, o.end.getTime());
  }
  flush();
  return res;
}

function MonthGrid({
  snapshot,
  anchor,
  now,
  visible,
  byId,
  onOpen,
}: {
  snapshot: Snapshot;
  anchor: Date;
  now: Date;
  visible: (ids: string[]) => boolean;
  byId: Map<string, Member>;
  onOpen: (o: Occurrence) => void;
}) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const occ = occurrences(snapshot.events, start, addDays(start, 42)).filter((o) =>
    visible(o.event.memberIds),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 pb-2">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="px-2 text-[14px] font-semibold uppercase text-muted">
            {fmtDay(d, { weekday: "short" })}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1.5">
        {days.map((d) => {
          const k = dateKey(d);
          const list = occ.filter(
            (o) => dateKey(o.start) === k || (o.event.allDay && o.start <= d && o.end > d),
          );
          const inMonth = d.getMonth() === anchor.getMonth();
          return (
            <div
              key={k}
              className={`overflow-hidden rounded-xl p-1.5 ${inMonth ? "bg-paper" : "opacity-40"}`}
            >
              <div
                className={`mb-0.5 text-[15px] font-bold tabular ${k === dateKey(now) ? "inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white" : ""}`}
              >
                {d.getDate()}
              </div>
              {list.slice(0, 3).map((o) => {
                const c = byId.get(o.event.memberIds[0])?.color ?? "#858a96";
                return (
                  <button
                    type="button"
                    key={o.key}
                    onClick={() => onOpen(o)}
                    className="flex w-full items-center gap-1 truncate text-left text-[12px] font-medium"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
                    <span className="truncate">{o.event.title}</span>
                  </button>
                );
              })}
              {list.length > 3 && (
                <div className="text-[11px] font-semibold text-muted">+{list.length - 3} more</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
