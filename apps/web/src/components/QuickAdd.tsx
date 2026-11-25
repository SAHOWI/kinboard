import { type CommandInput, type Member, type Snapshot, dateKey, newId, pad } from "@kinboard/shared";
import { useState } from "react";
import { Avatar, Segmented } from "./ui.tsx";

type Kind = "event" | "task" | "item";

const ICONS = ["⭐", "🧹", "🪥", "📚", "🐶", "🪴", "🧺", "🍽️", "🎹", "⚽"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** One form for display and mobile: event, task/chore, or list item (FR-CAL-05, FR-TSK-01, FR-LST-02). */
export function QuickAdd({
  snapshot,
  lists,
  onSubmit,
  onCancel,
  compact = false,
  initialKind = "event",
}: {
  snapshot: Snapshot;
  lists: Snapshot["lists"];
  onSubmit: (input: CommandInput, kind: Kind) => void;
  onCancel: () => void;
  compact?: boolean;
  initialKind?: Kind;
}) {
  const now = new Date();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(dateKey(now));
  const [start, setStart] = useState(`${pad(Math.min(now.getHours() + 1, 22))}:00`);
  const [end, setEnd] = useState(`${pad(Math.min(now.getHours() + 2, 23))}:00`);
  const [allDay, setAllDay] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [who, setWho] = useState<string[]>([]);
  const [icon, setIcon] = useState(ICONS[0]);
  const [points, setPoints] = useState(10);
  const [days, setDays] = useState<number[]>([now.getDay()]);
  const [listId, setListId] = useState(lists[0]?.id ?? "");

  const toggleWho = (id: string) => setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));
  const valid = title.trim().length > 0 && (kind !== "task" || who.length > 0) && (kind !== "item" || listId);

  const submit = () => {
    if (!valid) return;
    const t = title.trim();
    if (kind === "event") {
      const byday = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][new Date(`${date}T12:00`).getDay()];
      const endDate = dateKey(new Date(new Date(`${date}T12:00`).getTime() + 86_400_000));
      onSubmit(
        {
          type: "event.add",
          event: {
            id: newId("e"),
            title: t,
            start: allDay ? date : `${date}T${start}:00`,
            end: allDay ? endDate : `${date}T${end > start ? end : start}:00`,
            allDay,
            memberIds: who,
            rrule: weekly ? `FREQ=WEEKLY;BYDAY=${byday}` : undefined,
            source: "local",
          },
        },
        kind,
      );
    } else if (kind === "task") {
      onSubmit(
        {
          type: "task.add",
          task: {
            id: newId("t"),
            title: t,
            icon,
            memberIds: who,
            points,
            days,
            date: days.length ? undefined : date,
          },
        },
        kind,
      );
    } else {
      onSubmit(
        { type: "item.add", item: { id: newId("i"), listId, text: t, checked: false, sort: Date.now() } },
        kind,
      );
    }
  };

  const label = "block text-[13px] font-semibold uppercase tracking-wider text-muted mb-2";
  const input =
    "w-full rounded-2xl border border-line bg-paper px-4 py-3 text-[18px] outline-none focus:border-ink-2 focus:bg-white";

  return (
    <div className="flex flex-col gap-5">
      <Segmented
        value={kind}
        onChange={setKind}
        size={compact ? "sm" : "md"}
        options={[
          { value: "event", label: "📅 Event" },
          { value: "task", label: "✅ Chore" },
          { value: "item", label: "🛒 List item" },
        ]}
      />
      <input
        // biome-ignore lint/a11y/noAutofocus: modal primary field
        autoFocus
        className={`${input} text-[22px] font-medium`}
        placeholder={
          kind === "event" ? "What's happening?" : kind === "task" ? "What needs doing?" : "Add an item…"
        }
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />

      {kind !== "item" && (
        <div>
          <span className={label}>{kind === "task" ? "Who does it?" : "Who's involved?"}</span>
          <div className="flex flex-wrap gap-2">
            {snapshot.members.map((m: Member) => (
              <button
                type="button"
                key={m.id}
                onClick={() => toggleWho(m.id)}
                className="press flex items-center gap-2 rounded-full border py-1 pl-1 pr-4 text-[16px] font-medium"
                style={{
                  borderColor: who.includes(m.id) ? m.color : "var(--color-line)",
                  background: who.includes(m.id) ? `${m.color}1f` : "white",
                }}
              >
                <Avatar member={m} size={32} dim={!who.includes(m.id)} />
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {kind === "event" && (
        <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-4"}`}>
          <label className={compact ? "col-span-2" : ""}>
            <span className={label}>Date</span>
            <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {!allDay && (
            <>
              <label>
                <span className={label}>From</span>
                <input
                  type="time"
                  className={input}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                <span className={label}>To</span>
                <input type="time" className={input} value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </>
          )}
          <div className={`flex flex-col justify-end gap-2 ${compact ? "col-span-2 flex-row" : ""}`}>
            <Toggle on={allDay} set={setAllDay} text="All day" />
            <Toggle on={weekly} set={setWeekly} text="Every week" />
          </div>
        </div>
      )}

      {kind === "task" && (
        <>
          <div>
            <span className={label}>Icon</span>
            <div className="flex flex-wrap gap-2">
              {ICONS.map((i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => setIcon(i)}
                  className={`press h-12 w-12 rounded-xl text-[24px] ${icon === i ? "bg-ink/10 ring-2 ring-ink" : "bg-paper-2"}`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div className={`grid gap-4 ${compact ? "grid-cols-1" : "grid-cols-[1fr_auto]"}`}>
            <div>
              <span className={label}>Repeat on</span>
              <div className="flex gap-1.5">
                {WEEKDAYS.map((d, i) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}
                    className={`press h-11 w-11 rounded-full text-[14px] font-semibold ${
                      days.includes(i) ? "bg-ink text-white" : "bg-paper-2 text-ink-2"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className={label}>Points</span>
              <div className="flex gap-1.5">
                {[0, 5, 10, 20].map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => setPoints(p)}
                    className={`press h-11 min-w-12 rounded-full px-3 text-[15px] font-semibold tabular ${
                      points === p ? "bg-accent text-white" : "bg-paper-2 text-ink-2"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {kind === "item" && (
        <div>
          <span className={label}>List</span>
          <div className="flex flex-wrap gap-2">
            {lists.map((l) => (
              <button
                type="button"
                key={l.id}
                onClick={() => setListId(l.id)}
                className={`press rounded-full px-4 py-2 text-[16px] font-medium ${
                  listId === l.id ? "bg-ink text-white" : "bg-paper-2 text-ink-2"
                }`}
              >
                {l.icon} {l.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="press rounded-full px-6 py-3 text-[17px] font-semibold text-ink-2"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={submit}
          className="press rounded-full bg-ink px-7 py-3 text-[17px] font-semibold text-white disabled:opacity-30"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function Toggle({ on, set, text }: { on: boolean; set: (v: boolean) => void; text: string }) {
  return (
    <button
      type="button"
      onClick={() => set(!on)}
      className="press flex items-center gap-2 text-[15px] font-medium text-ink-2"
    >
      <span className={`relative h-6 w-10 rounded-full transition-colors ${on ? "bg-ok" : "bg-line"}`}>
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
      {text}
    </button>
  );
}
