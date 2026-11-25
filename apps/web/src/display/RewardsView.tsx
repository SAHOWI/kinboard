import { type Snapshot, balanceOf, newId } from "@kinboard/shared";
import { Avatar, tint } from "../components/ui.tsx";
import { useStore } from "../data/store.ts";
import { SectionTitle } from "./HomeView.tsx";
import { useDisplay } from "./context.tsx";

export function RewardsView({ snapshot }: { snapshot: Snapshot }) {
  const { run, withPin } = useDisplay();
  const kids = snapshot.members.filter((m) => m.role === "child");
  const byId = new Map(snapshot.members.map((m) => [m.id, m]));
  const rewardById = new Map(snapshot.rewards.map((r) => [r.id, r]));
  const pending = snapshot.redemptions.filter((r) => r.status === "requested");
  const history = snapshot.redemptions
    .filter((r) => r.status !== "requested")
    .slice(-4)
    .reverse();
  const available = (id: string) =>
    balanceOf(snapshot, id) -
    pending.filter((p) => p.memberId === id).reduce((s, p) => s + (rewardById.get(p.rewardId)?.cost ?? 0), 0);

  return (
    <div className="grid h-full grid-cols-[1.6fr_1fr] gap-6">
      <div className="flex min-h-0 flex-col gap-6">
        <div className="grid grid-cols-2 gap-6">
          {kids.map((k) => (
            <div
              key={k.id}
              className="card flex items-center gap-5 p-6"
              style={{ background: `linear-gradient(135deg, ${tint(k.color, 0.16)}, white 70%)` }}
            >
              <Avatar member={k} size={78} />
              <div>
                <div className="font-display text-[30px] font-semibold leading-none">{k.name}</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className="font-display text-[52px] font-semibold leading-none tabular"
                    style={{ color: k.color }}
                  >
                    {balanceOf(snapshot, k.id)}
                  </span>
                  <span className="text-[16px] font-semibold text-ink-2">points</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="card min-h-0 flex-1 overflow-auto p-6">
          <SectionTitle icon="🎁" title="Rewards" sub="Tap your avatar to ask for one" />
          <div className="grid grid-cols-2 gap-4">
            {snapshot.rewards.map((r) => (
              <div key={r.id} className="flex items-center gap-4 rounded-3xl bg-paper p-4">
                <span className="text-[48px] leading-none">{r.icon}</span>
                <div className="flex-1">
                  <div className="text-[20px] font-bold leading-tight">{r.title}</div>
                  <div className="text-[16px] font-semibold text-accent tabular">{r.cost} pts</div>
                </div>
                <div className="flex gap-2">
                  {kids.map((k) => {
                    const ok = available(k.id) >= r.cost;
                    return (
                      <button
                        type="button"
                        key={k.id}
                        disabled={!ok}
                        title={ok ? `${k.name}: request` : `${k.name}: not enough points yet`}
                        onClick={() =>
                          run(
                            {
                              type: "reward.request",
                              redemptionId: newId("rd"),
                              rewardId: r.id,
                              memberId: k.id,
                            },
                            k.id,
                          ).then(
                            (done) =>
                              done &&
                              useStore.getState().toast(`${k.name} asked for "${r.title}" 🙋`, "success"),
                          )
                        }
                        className="press disabled:cursor-not-allowed"
                      >
                        <Avatar member={k} size={48} dim={!ok} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card flex min-h-0 flex-col p-6">
        <SectionTitle icon="🙋" title="Waiting for a grown-up" />
        <div className="flex flex-col gap-3">
          {pending.length === 0 && (
            <div className="py-6 text-center text-[17px] text-muted">No open requests</div>
          )}
          {pending.map((p) => {
            const m = byId.get(p.memberId)!;
            const r = rewardById.get(p.rewardId)!;
            return (
              <div
                key={p.id}
                className="rise flex items-center gap-3 rounded-2xl p-3"
                style={{ background: tint(m.color, 0.1) }}
              >
                <Avatar member={m} size={44} />
                <div className="flex-1">
                  <div className="text-[17px] font-bold">
                    {r.icon} {r.title}
                  </div>
                  <div className="text-[14px] text-ink-2">
                    {m.name} · {r.cost} pts
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    withPin(() => void run({ type: "reward.decide", redemptionId: p.id, approve: false }))
                  }
                  className="press h-11 w-11 rounded-full bg-white text-[18px]"
                >
                  ✕
                </button>
                <button
                  type="button"
                  onClick={() =>
                    withPin(() => void run({ type: "reward.decide", redemptionId: p.id, approve: true }))
                  }
                  className="press h-11 rounded-full bg-ok px-4 text-[16px] font-semibold text-white"
                >
                  Approve
                </button>
              </div>
            );
          })}
        </div>
        {history.length > 0 && (
          <>
            <div className="mt-6 mb-2 text-[14px] font-bold uppercase tracking-wider text-muted">
              Recently
            </div>
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-2 py-1.5 text-[16px] text-ink-2">
                {h.status === "approved" ? "✅" : "✕"} {byId.get(h.memberId)?.name}:{" "}
                {rewardById.get(h.rewardId)?.title}
              </div>
            ))}
          </>
        )}
        <div className="mt-6 rounded-2xl bg-paper p-4 text-[14px] leading-snug text-ink-2">
          Parents also get a push notification for each request and can approve it from the app.
        </div>
      </div>
    </div>
  );
}
