import * as rruleNs from "rrule";
import type { CalendarEvent, Snapshot, Task } from "./types.ts";

// rrule ships CJS (Node) + ESM (bundlers); resolve RRule in both module systems.
type RRuleCtor = typeof rruleNs.RRule;
const RRule: RRuleCtor =
  (rruleNs as { RRule?: RRuleCtor }).RRule ??
  (rruleNs as unknown as { default: { RRule: RRuleCtor } }).default.RRule;

export const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date key YYYY-MM-DD. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseLocal(iso: string): Date {
  // "YYYY-MM-DD" must be treated as local midnight, not UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(iso);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function startOfWeek(d: Date, weekStartsOn: 0 | 1 = 1): Date {
  const s = startOfDay(d);
  const diff = (s.getDay() - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}

export interface Occurrence {
  key: string; // eventId@start
  event: CalendarEvent;
  start: Date;
  end: Date;
}

/* rrule works in UTC; we feed it "floating" wall-clock times (README-recommended pattern) so DST is respected. */
const toFloating = (d: Date) =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
const fromFloating = (d: Date) =>
  new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());

/** Expand events (incl. RFC 5545 recurrence) into concrete occurrences overlapping [from, to). */
export function occurrences(events: CalendarEvent[], from: Date, to: Date): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of events) {
    const start = parseLocal(ev.start);
    const end = parseLocal(ev.end);
    const dur = end.getTime() - start.getTime();
    if (!ev.rrule) {
      if (start < to && end > from) out.push({ key: `${ev.id}@${ev.start}`, event: ev, start, end });
      continue;
    }
    const rule = new RRule({ ...RRule.parseString(ev.rrule), dtstart: toFloating(start) });
    const hits = rule.between(toFloating(new Date(from.getTime() - dur)), toFloating(to), true);
    for (const h of hits) {
      const s = fromFloating(h);
      const e = new Date(s.getTime() + dur);
      if (s < to && e > from) out.push({ key: `${ev.id}@${s.toISOString()}`, event: ev, start: s, end: e });
    }
  }
  return out.sort(
    (a, b) => a.start.getTime() - b.start.getTime() || Number(b.event.allDay) - Number(a.event.allDay),
  );
}

export function tasksForDay(tasks: Task[], day: Date): Task[] {
  const key = dateKey(day);
  return tasks.filter((t) => (t.days.length ? t.days.includes(day.getDay()) : t.date === key));
}

export function isDone(state: Snapshot, taskId: string, memberId: string, day: Date): boolean {
  const key = dateKey(day);
  return state.completions.some((c) => c.taskId === taskId && c.memberId === memberId && c.date === key);
}

export function memberProgress(state: Snapshot, memberId: string, day: Date) {
  const mine = tasksForDay(state.tasks, day).filter((t) => t.memberIds.includes(memberId));
  const done = mine.filter((t) => isDone(state, t.id, memberId, day)).length;
  return { done, total: mine.length, ratio: mine.length ? done / mine.length : 0 };
}

/** The routine whose window contains `now`, if any. */
export function activeRoutineId(state: Snapshot, now: Date): string | undefined {
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return state.routines.find((r) => r.from <= hm && hm < r.to)?.id;
}
