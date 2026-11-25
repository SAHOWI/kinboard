import type { Member } from "@kinboard/shared";
import { type ReactNode, useEffect, useState } from "react";
import { useStore } from "../data/store.ts";

export const fmtTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const fmtDay = (
  d: Date,
  opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" },
) => d.toLocaleDateString("en-GB", opts);

/** Light tint of a member colour for backgrounds. */
export const tint = (hex: string, alpha = 0.14) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Avatar({
  member,
  size = 40,
  dim = false,
  className = "",
}: { member: Member; size?: number; dim?: boolean; className?: string }) {
  return (
    <span
      title={member.name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: tint(member.color, dim ? 0.08 : 0.2),
        boxShadow: `inset 0 0 0 ${Math.max(2, size / 18)}px ${dim ? tint(member.color, 0.25) : member.color}`,
        fontSize: size * 0.5,
        filter: dim ? "grayscale(0.7)" : undefined,
        opacity: dim ? 0.55 : 1,
      }}
    >
      {member.emoji}
    </span>
  );
}

export function AvatarStack({ members, size = 26 }: { members: Member[]; size?: number }) {
  return (
    <span className="inline-flex">
      {members.map((m, i) => (
        <span key={m.id} style={{ marginLeft: i ? -size / 3 : 0 }} className="rounded-full bg-white">
          <Avatar member={m} size={size} />
        </span>
      ))}
    </span>
  );
}

export function ProgressRing({
  ratio,
  color,
  size = 64,
  stroke = 7,
  children,
}: { ratio: number; color: string; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0" aria-hidden="true">
        <title>progress</title>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tint(color, 0.18)}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          style={{ transition: "stroke-dashoffset 500ms cubic-bezier(.2,.7,.3,1)" }}
        />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}

const BURST_COLORS = ["#E8596F", "#4F8EF7", "#3DBE8B", "#F5A524", "#9B6BF2", "#14B8C4"];
export function Burst({ seed }: { seed: number }) {
  if (!seed) return null;
  return (
    <span key={seed} aria-hidden>
      {Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2 + seed;
        const dist = 46 + ((i * 37 + seed) % 30);
        return (
          <span
            key={i}
            className="burst-piece"
            style={
              {
                background: BURST_COLORS[i % BURST_COLORS.length],
                "--dx": `${Math.cos(angle) * dist}px`,
                "--dy": `${Math.sin(angle) * dist}px`,
                "--rot": `${(i * 47) % 360}deg`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

/** Modal positioned inside its shell (absolute), so display and phone can coexist in the studio view. */
export function Modal({
  open,
  onClose,
  children,
  width = 560,
  title,
}: { open: boolean; onClose: () => void; children: ReactNode; width?: number | string; title?: string }) {
  if (!open) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: positioned inside its shell (studio view), native <dialog> uses the top layer
    <div className="absolute inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal>
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-[#1d2330]/35 backdrop-blur-[2px] cursor-default"
        onClick={onClose}
      />
      <div className="card rise relative max-h-full overflow-auto p-7" style={{ width, maxWidth: "100%" }}>
        {title && <h2 className="font-display text-[28px] font-semibold mb-5 tracking-tight">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rise rounded-full px-5 py-2.5 text-[15px] font-medium shadow-lg ${
            t.tone === "error"
              ? "bg-[#b4413a] text-white"
              : t.tone === "success"
                ? "bg-ok text-white"
                : "bg-ink text-white"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function SourceBadge({ source }: { source: string }) {
  if (source === "local") return null;
  const label = { google: "Google", caldav: "iCloud", ics: "ICS", msgraph: "Outlook" }[source] ?? source;
  return (
    <span className="rounded-md bg-paper-2 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
      {label}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-full bg-paper-2 p-1">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`press rounded-full font-semibold ${size === "sm" ? "px-3 py-1 text-[13px]" : "px-5 py-2 text-[16px]"} ${
            value === o.value ? "bg-white text-ink shadow-sm" : "text-ink-2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
