import { type Snapshot, newId } from "@kinboard/shared";
import { useState } from "react";
import { useDisplay } from "./context.tsx";

const SUGGESTIONS: Record<string, string[]> = {
  shopping: ["Apples", "Butter", "Yoghurt", "Toilet paper", "Rice", "Carrots", "Chocolate"],
  packing: ["Chargers", "Toothbrushes", "Passports", "Rain jackets"],
  todo: ["Call plumber", "Renew insurance"],
  generic: [],
};

export function ListsView({ snapshot }: { snapshot: Snapshot }) {
  const { run, withPin } = useDisplay();
  const [listId, setListId] = useState(snapshot.lists[0]?.id);
  const [text, setText] = useState("");
  const list = snapshot.lists.find((l) => l.id === listId) ?? snapshot.lists[0];
  const items = snapshot.items.filter((i) => i.listId === list?.id).sort((a, b) => a.sort - b.sort);
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const existing = new Set(items.map((i) => i.text.toLowerCase()));

  const add = (t: string) => {
    const v = t.trim();
    if (!v || !list) return;
    void run({
      type: "item.add",
      item: { id: newId("i"), listId: list.id, text: v, checked: false, sort: Date.now() },
    });
    setText("");
  };

  return (
    <div className="grid h-full grid-cols-[340px_1fr] gap-6">
      <div className="card flex flex-col gap-2 p-4">
        {snapshot.lists.map((l) => {
          const n = snapshot.items.filter((i) => i.listId === l.id && !i.checked).length;
          return (
            <button
              type="button"
              key={l.id}
              onClick={() => setListId(l.id)}
              className={`press flex items-center gap-3 rounded-2xl px-4 py-4 text-left ${l.id === list?.id ? "bg-ink text-white" : "hover:bg-paper"}`}
            >
              <span className="text-[30px] leading-none">{l.icon}</span>
              <span className="flex-1 text-[20px] font-semibold">{l.name}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[14px] font-bold tabular ${l.id === list?.id ? "bg-white/20" : "bg-paper-2 text-ink-2"}`}
              >
                {n}
              </span>
            </button>
          );
        })}
        <div className="mt-auto rounded-2xl bg-paper p-4 text-[14px] leading-snug text-ink-2">
          🔒 Private lists such as gift ideas only appear in the app of the people they're shared with.
        </div>
      </div>

      {list && (
        <div className="card flex min-h-0 flex-col p-7">
          <div className="mb-5 flex items-center gap-3">
            <span className="text-[40px] leading-none">{list.icon}</span>
            <h2 className="font-display text-[36px] font-semibold tracking-tight">{list.name}</h2>
            <div className="flex-1" />
            {done.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  withPin(() => {
                    for (const i of done) void run({ type: "item.remove", itemId: i.id });
                  })
                }
                className="press rounded-full bg-paper-2 px-4 py-2 text-[15px] font-semibold text-ink-2"
              >
                Clear {done.length} done
              </button>
            )}
          </div>

          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              add(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Add to ${list.name}…`}
              className="flex-1 rounded-2xl border border-line bg-paper px-5 py-4 text-[22px] outline-none focus:border-ink-2 focus:bg-white"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="press rounded-2xl bg-ink px-8 text-[20px] font-semibold text-white disabled:opacity-30"
            >
              Add
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS[list.kind]
              .filter((s) => !existing.has(s.toLowerCase()))
              .map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => add(s)}
                  className="press rounded-full border border-line bg-white px-4 py-2 text-[16px] font-medium text-ink-2"
                >
                  + {s}
                </button>
              ))}
          </div>

          <div className="no-scrollbar mt-5 grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-x-6 gap-y-1 overflow-auto">
            {open.map((i) => (
              <button
                type="button"
                key={i.id}
                onClick={() => run({ type: "item.check", itemId: i.id, checked: !i.checked })}
                className="press rise flex items-center gap-4 rounded-2xl px-3 py-3.5 text-left hover:bg-paper"
              >
                <span className="h-9 w-9 shrink-0 rounded-xl border-[3px] border-line bg-white" />
                <span className="text-[22px] font-medium">{i.text}</span>
              </button>
            ))}
            {done.length > 0 && (
              <div className="col-span-2 mt-4 mb-1 text-[14px] font-bold uppercase tracking-wider text-muted">
                Done
              </div>
            )}
            {done.map((i) => (
              <button
                type="button"
                key={i.id}
                onClick={() => run({ type: "item.check", itemId: i.id, checked: !i.checked })}
                className="press flex items-center gap-4 rounded-2xl px-3 py-3 text-left"
              >
                <span className="pop flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ok text-[18px] font-bold text-white">
                  ✓
                </span>
                <span className="text-[20px] text-muted line-through">{i.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
