import { type Snapshot, addDays, dateKey, newId, startOfWeek } from "@kinboard/shared";
import { useState } from "react";
import { Modal, fmtDay } from "../components/ui.tsx";
import { useDisplay } from "./context.tsx";

const IDEAS: [string, string][] = [
  ["Pancakes", "🥞"],
  ["Tacos", "🌮"],
  ["Soup & bread", "🍲"],
  ["Risotto", "🍚"],
  ["Burgers", "🍔"],
  ["Salad bowl", "🥗"],
  ["Sushi night", "🍣"],
  ["Leftovers", "🥡"],
];

/** Weekly dinner plan (FR-MEAL-01). Recipes + ingredient → shopping list follow in v1.0. */
export function MealsView({ snapshot, now }: { snapshot: Snapshot; now: Date }) {
  const { run, withPin } = useDisplay();
  const [edit, setEdit] = useState<string | null>(null);
  const mon = startOfWeek(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-4">
        {days.map((d) => {
          const k = dateKey(d);
          const meal = snapshot.meals.find((m) => m.date === k && m.slot === "dinner");
          const today = k === dateKey(now);
          return (
            <button
              type="button"
              key={k}
              onClick={() => withPin(() => setEdit(k))}
              className={`card press flex flex-col items-center p-5 text-center ${today ? "ring-[3px] ring-accent" : ""} ${d < addDays(now, -1) ? "opacity-55" : ""}`}
            >
              <div
                className={`text-[16px] font-bold uppercase tracking-wider ${today ? "text-accent" : "text-muted"}`}
              >
                {today ? "Today" : fmtDay(d, { weekday: "short" })}
              </div>
              <div className="font-display text-[34px] font-semibold">{d.getDate()}</div>
              <div className="flex flex-1 flex-col items-center justify-center gap-4">
                <span className="text-[88px] leading-none">{meal?.icon ?? "➕"}</span>
                <span className="font-display text-[24px] font-semibold leading-tight">
                  {meal?.title ?? "Plan dinner"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? `Dinner · ${fmtDay(new Date(`${edit}T12:00`))}` : ""}
        width={720}
      >
        <div className="grid grid-cols-4 gap-3">
          {IDEAS.map(([title, icon]) => (
            <button
              type="button"
              key={title}
              onClick={() => {
                if (edit)
                  void run({
                    type: "meal.set",
                    meal: { id: newId("meal"), date: edit, slot: "dinner", title, icon },
                  });
                setEdit(null);
              }}
              className="press flex flex-col items-center gap-2 rounded-2xl bg-paper p-4 text-[17px] font-semibold"
            >
              <span className="text-[44px] leading-none">{icon}</span>
              {title}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
