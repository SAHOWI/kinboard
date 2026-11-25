import { type Member, type Task, dateKey } from "@kinboard/shared";
import { useState } from "react";
import { Burst, tint } from "../components/ui.tsx";
import { useDisplay } from "./context.tsx";

/** One-tap task check-off with a celebration (FR-TSK-03). Child-safe: no PIN required. */
export function TaskChip({
  task,
  member,
  day,
  done,
  size = "md",
}: { task: Task; member: Member; day: Date; done: boolean; size?: "md" | "lg" }) {
  const { run } = useDisplay();
  const [burst, setBurst] = useState(0);
  const lg = size === "lg";

  const toggle = () => {
    const args = { taskId: task.id, memberId: member.id, date: dateKey(day) };
    if (done) void run({ type: "task.uncomplete", ...args }, member.id);
    else {
      setBurst(Date.now());
      void run({ type: "task.complete", ...args }, member.id);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={`press relative flex w-full items-center gap-3 rounded-2xl border text-left ${lg ? "min-h-[72px] px-4 py-3" : "min-h-[60px] px-3 py-2"}`}
      style={{
        borderColor: done ? "transparent" : "var(--color-line)",
        background: done ? tint(member.color, 0.16) : "white",
      }}
    >
      <span className={`${lg ? "text-[32px]" : "text-[26px]"} leading-none ${done ? "opacity-50" : ""}`}>
        {task.icon}
      </span>
      <span
        className={`flex-1 font-semibold ${lg ? "text-[20px]" : "text-[17px]"} ${done ? "text-ink-2 line-through decoration-2" : ""}`}
      >
        {task.title}
      </span>
      {task.points > 0 && (
        <span className={`tabular text-[13px] font-bold ${done ? "text-ink-2" : "text-accent"}`}>
          +{task.points}
        </span>
      )}
      <span
        className={`relative flex shrink-0 items-center justify-center rounded-full ${lg ? "h-11 w-11" : "h-9 w-9"} ${done ? "pop" : ""}`}
        style={{
          background: done ? member.color : "transparent",
          boxShadow: done ? "none" : `inset 0 0 0 2.5px ${tint(member.color, 0.55)}`,
        }}
      >
        {done && <span className="text-[20px] font-bold text-white">✓</span>}
        <Burst seed={burst} />
      </span>
    </button>
  );
}
