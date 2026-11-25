import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "./data/store.ts";
import { DisplayShell } from "./display/DisplayShell.tsx";
import { MobileShell } from "./mobile/MobileShell.tsx";

export type Route = "studio" | "display" | "app";
export const routeFromHash = (): Route =>
  location.hash.startsWith("#/display") ? "display" : location.hash.startsWith("#/app") ? "app" : "studio";

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  useEffect(() => {
    const on = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  if (route === "display")
    return (
      <div className="h-full w-full">
        <DisplayShell />
      </div>
    );
  if (route === "app")
    return (
      <div className="mx-auto h-full max-w-[480px]">
        <MobileShell />
      </div>
    );
  return <Studio />;
}

/** Scales a fixed-size design canvas to fit its container. */
function Scaled({
  w,
  h,
  children,
  maxScale = 1,
}: { w: number; h: number; children: ReactNode; maxScale?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(maxScale, el.clientWidth / w)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, maxScale]);
  return (
    <div ref={ref} className="w-full" style={{ height: h * scale }}>
      <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

/** Side-by-side review: wall display + phone share one store, so every tap syncs live between them. */
function Studio() {
  const mode = useStore((s) => s.backend?.mode);
  const status = useStore((s) => s.status);
  return (
    <div className="min-h-full bg-[#e9e4d8] px-6 py-6 lg:px-10">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-5 flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-[22px] text-white">
              ✿
            </div>
            <div>
              <h1 className="font-display text-[30px] font-semibold leading-none tracking-tight">Kinboard</h1>
              <div className="mt-1 text-[14px] text-ink-2">Open-source family organiser · MVP interface</div>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="rounded-full bg-white/70 px-3 py-1.5 font-semibold text-ink-2">
              {mode === "demo"
                ? "Demo data · in-browser backend"
                : status === "offline"
                  ? "API offline · changes are queued"
                  : "Connected to API"}
            </span>
            <a href="#/display" className="rounded-full bg-ink px-4 py-1.5 font-semibold text-white">
              Open display ↗
            </a>
            <a href="#/app" className="rounded-full bg-white px-4 py-1.5 font-semibold text-ink">
              Open app ↗
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            <div className="rounded-[26px] bg-[#1b1f27] p-[14px] shadow-[0_30px_60px_-30px_rgba(0,0,0,.55)]">
              <div className="overflow-hidden rounded-[14px]">
                <Scaled w={1920} h={1080}>
                  <DisplayShell />
                </Scaled>
              </div>
            </div>
            <p className="mt-3 text-center text-[13px] text-ink-2">
              Home display · 15.6″ 1920×1080 kiosk · child-safe by default, adult PIN <b>1234</b>
            </p>
          </div>
          <div className="mx-auto w-full max-w-[340px] shrink-0">
            <div className="rounded-[46px] bg-[#1b1f27] p-[11px] shadow-[0_30px_60px_-30px_rgba(0,0,0,.55)]">
              <div className="overflow-hidden rounded-[36px]">
                <Scaled w={390} h={844}>
                  <MobileShell />
                </Scaled>
              </div>
            </div>
            <p className="mt-3 text-center text-[13px] text-ink-2">
              Companion app · signed in as Anna (adult)
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 text-[14px] text-ink-2 md:grid-cols-3">
          <Tip n="1">Tick a chore on the display: points and progress update in the app instantly.</Tip>
          <Tip n="2">Add groceries in the app (+): they appear on the display's list.</Tip>
          <Tip n="3">Request a reward on the display, then approve it in the app under More.</Tip>
        </div>
      </div>
    </div>
  );
}

function Tip({ n, children }: { n: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl bg-white/60 p-4">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white">
        {n}
      </span>
      <span>{children}</span>
    </div>
  );
}
