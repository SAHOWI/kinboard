import { useState } from "react";

/** Adult PIN entry (FR-HH-08). MVP: PIN is checked client-side ("1234"); M2: POST /pin/verify → short-lived token. */
export const DEMO_PIN = "1234";

export function PinPad({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const press = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setError(false);
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => {
        if (next === DEMO_PIN) onSuccess();
        else {
          setError(true);
          setPin("");
        }
      }, 150);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="text-[44px] mb-1">🔒</div>
      <h2 className="font-display text-[28px] font-semibold tracking-tight">Grown-ups only</h2>
      <p className="text-ink-2 mt-1 mb-6 text-[16px]">
        Enter the family PIN to make changes <span className="text-muted">(demo: 1234)</span>
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
