import { useState } from "react";

/** The dev/demo default PIN is shown only in dev and demo builds, never in production. */
const SHOW_DEV_HINT = import.meta.env.DEV || import.meta.env.VITE_DEMO === "1";

/** Adult PIN entry (FR-HH-08). The PIN is checked by the server (`POST /pin/verify`), never in the UI. */
export function PinPad({
  verify,
  onSuccess,
  onCancel,
}: { verify: (pin: string) => Promise<boolean>; onSuccess: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const press = (d: string) => {
    if (busy || pin.length >= 4) return;
    const next = pin + d;
    setError(false);
    setPin(next);
    if (next.length === 4) {
      setBusy(true);
      void verify(next).then((ok) => {
        setBusy(false);
        if (ok) onSuccess();
        else {
          setError(true);
          setPin("");
        }
      });
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="text-[44px] mb-1">🔒</div>
      <h2 className="font-display text-[28px] font-semibold tracking-tight">Grown-ups only</h2>
      <p className="text-ink-2 mt-1 mb-6 text-[16px]">
        Enter the family PIN to make changes
        {SHOW_DEV_HINT && <span className="text-muted"> (dev default: 1234)</span>}
      </p>
      <div className={`mb-7 flex gap-4 ${error ? "animate-[kb-pop_300ms]" : ""}`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-5 w-5 rounded-full transition-colors"
            style={{
              background: error ? "#b4413a" : i < pin.length ? "var(--color-ink)" : "var(--color-line)",
            }}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} onClick={() => press(d)}>
            {d}
          </Key>
        ))}
        <Key onClick={onCancel} muted>
          Cancel
        </Key>
        <Key onClick={() => press("0")}>0</Key>
        <Key onClick={() => setPin(pin.slice(0, -1))} muted>
          ⌫
        </Key>
      </div>
    </div>
  );
}

function Key({
  children,
  onClick,
  muted,
}: { children: React.ReactNode; onClick: () => void; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press h-[76px] w-[96px] rounded-2xl text-[28px] font-semibold tabular ${
        muted ? "text-[16px] text-ink-2 bg-transparent" : "bg-paper-2 hover:bg-line"
      }`}
    >
      {children}
    </button>
  );
}
