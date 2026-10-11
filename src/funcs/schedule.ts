/**
 * Pure scheduling helpers (no RemNote SDK imports, so they can be unit-tested).
 *
 * Model: there is one "rollover moment" per day at the configured local time.
 * A rollover is due whenever the most recent rollover moment is later than the
 * last successful rollover. That means:
 *   - it fires within a minute of the configured time while RemNote is open;
 *   - if RemNote was closed at that time, it catches up the next time it opens;
 *   - on a fresh install (no previous run) it runs once right away;
 *   - it never runs twice for the same rollover moment.
 */

export type RolloverTime = { hours: number; minutes: number };

const TIME_RE = /^\s*([01]?[0-9]|2[0-3]):([0-5][0-9])(?::[0-5][0-9])?\s*$/;

export function parseRolloverTime(value: unknown): RolloverTime | null {
	if (typeof value !== 'string') return null;
	const match = TIME_RE.exec(value);
	if (!match) return null;
	return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/** The latest rollover moment that is <= now (today's if it has passed, otherwise yesterday's). */
export function mostRecentRolloverMoment(now: Date, time: RolloverTime): Date {
	const moment = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.hours, time.minutes, 0, 0);
	if (moment.getTime() > now.getTime()) {
		// setDate handles month/year boundaries and DST correctly in local time
		moment.setDate(moment.getDate() - 1);
	}
	return moment;
}

/** The next rollover moment strictly after now. */
export function nextRolloverMoment(now: Date, time: RolloverTime): Date {
	const next = mostRecentRolloverMoment(now, time);
	next.setDate(next.getDate() + 1);
	return next;
}

/** Coerce whatever came back from storage (number, ISO string, Date, undefined) into a valid Date. */
export function toValidDate(value: unknown): Date | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const date = value instanceof Date ? value : new Date(value as string | number);
	return Number.isNaN(date.getTime()) || date.getTime() <= 0 ? undefined : date;
}

export function isRolloverDue(now: Date, lastRun: Date | undefined, time: RolloverTime): boolean {
	if (!lastRun) return true; // never run before -> run now (this was the original plugin's deadlock)
	// A last-run time in the future means a clock change or a skewed device; don't let it block us forever.
	if (lastRun.getTime() > now.getTime() + 60 * 1000) return true;
	return lastRun.getTime() < mostRecentRolloverMoment(now, time).getTime();
}

export function localDateKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}
