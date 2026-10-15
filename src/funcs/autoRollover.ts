import { ReactRNPlugin, Rem } from '@remnote/plugin-sdk';
import { handleUnfinishedTodos } from './todoRemManagement';
import { cleanupPastDocuments } from './cleanup';
import {
	isRolloverDue,
	localDateKey,
	mostRecentRolloverMoment,
	nextRolloverMoment,
	parseRolloverTime,
	toValidDate,
} from './schedule';

export const LAST_ROLLOVER_KEY = 'lastRolloverAt'; // epoch ms, synced across devices
export const DEFAULT_ROLLOVER_TIME = '00:00';
const INITIAL_SYNC_TIMEOUT_MS = 20 * 1000;

let running = false;
let missingDocToastDay: string | undefined;
let initialSyncDone = false;
let lastErrorToast: string | undefined;

/** What the scheduler has been doing; shown by the "Rollover Status" command. */
export const diagnostics: {
	schedulerStartedAt?: Date;
	lastCheckAt?: Date;
	lastCheckSource?: string;
	lastCheckResult?: string;
	lastError?: string;
	startupErrors: string[];
} = { startupErrors: [] };

export function errorText(error: unknown): string {
	if (error instanceof Error) return error.message || error.name;
	try {
		return typeof error === 'string' ? error : JSON.stringify(error);
	} catch {
		return String(error);
	}
}

async function debugLog(plugin: ReactRNPlugin, message: string, details?: unknown) {
	try {
		if (!(await plugin.settings.getSetting('debug-mode'))) return;
	} catch {
		return;
	}
	if (details !== undefined) console.log(`[DailyTodoCarryover] ${message}`, details);
	else console.log(`[DailyTodoCarryover] ${message}`);
}

/** Wait for RemNote's initial sync, but never forever (it has been seen to hang). */
async function ensureInitialSync(plugin: ReactRNPlugin) {
	if (initialSyncDone) return;
	await Promise.race([
		plugin.app.waitForInitialSync().catch((error) => {
			console.warn('[DailyTodoCarryover] waitForInitialSync failed; continuing.', error);
		}),
		new Promise((resolve) => setTimeout(resolve, INITIAL_SYNC_TIMEOUT_MS)),
	]);
	initialSyncDone = true;
}

export async function getLastRollover(plugin: ReactRNPlugin): Promise<Date | undefined> {
	return toValidDate(await plugin.storage.getSynced(LAST_ROLLOVER_KEY));
}

async function getTodaysDocument(plugin: ReactRNPlugin): Promise<Rem | undefined> {
	const existing = await plugin.date.getTodaysDoc();
	if (existing) return existing;

	const shouldCreate = (await plugin.settings.getSetting('create-daily-doc')) !== false;
	if (!shouldCreate) return undefined;

	try {
		return (await plugin.date.getDailyDoc(new Date())) ?? undefined;
	} catch (error) {
		console.error("[DailyTodoCarryover] Could not create today's daily document.", error);
		return undefined;
	}
}

/**
 * Performs the rollover and records it. Returns false if it couldn't run
 * (another run in progress, or no daily document for today), in which case
 * nothing is recorded and the scheduler will try again on the next tick.
 */
export async function runRollover(
	plugin: ReactRNPlugin,
	opts: { source: string; quiet?: boolean }
): Promise<boolean> {
	if (running) {
		await debugLog(plugin, `Skipped (${opts.source}): a rollover is already running.`);
		return false;
	}
	running = true;
	try {
		const todaysDoc = await getTodaysDocument(plugin);
		if (!todaysDoc) {
			const today = localDateKey(new Date());
			if (!opts.quiet || missingDocToastDay !== today) {
				missingDocToastDay = today;
				await plugin.app.toast(
					"Rollover is waiting: open today's Daily Document and it will run automatically."
				);
			}
			diagnostics.lastCheckResult = "waiting for today's Daily Document";
			return false;
		}

		await cleanupPastDocuments(plugin);
		const carryPlain = (await plugin.settings.getSetting('carry-plain-bullets')) !== false;
		await handleUnfinishedTodos(plugin, todaysDoc, { quiet: opts.quiet, carryPlain });
		await cleanupPastDocuments(plugin); // remove date bullets emptied by this move
		await plugin.storage.setSynced(LAST_ROLLOVER_KEY, Date.now());
		diagnostics.lastCheckResult = 'rolled over';
		diagnostics.lastError = undefined;
		await debugLog(plugin, `Rollover finished (${opts.source}).`);
		return true;
	} finally {
		running = false;
	}
}

/** Called on startup, every minute, and when the window regains focus. Cheap when nothing is due. */
export async function checkScheduledRollover(plugin: ReactRNPlugin, source: string) {
	if (running) return;
	diagnostics.lastCheckAt = new Date();
	diagnostics.lastCheckSource = source;
	try {
		await ensureInitialSync(plugin);

		if (await plugin.settings.getSetting('disable-auto-rollover')) {
			diagnostics.lastCheckResult = 'auto rollover disabled';
			return;
		}

		const rawTime = await plugin.settings.getSetting('rollover-time');
		const time = parseRolloverTime(rawTime ?? DEFAULT_ROLLOVER_TIME);
		if (!time) {
			diagnostics.lastCheckResult = `invalid rollover time "${rawTime}"`;
			return;
		}

		const now = new Date();
		const lastRun = await getLastRollover(plugin);
		const due = isRolloverDue(now, lastRun, time);
		await debugLog(plugin, `Check (${source})`, {
			now: now.toString(),
			lastRun: lastRun?.toString(),
			rolloverMoment: mostRecentRolloverMoment(now, time).toString(),
			due,
		});
		if (!due) {
			diagnostics.lastCheckResult = 'not due';
			return;
		}

		await runRollover(plugin, { source: `auto:${source}`, quiet: true });
	} catch (error) {
		const message = errorText(error);
		diagnostics.lastCheckResult = 'error';
		diagnostics.lastError = message;
		console.error(`[DailyTodoCarryover] Automatic rollover failed (${source}).`, error);
		// Tell the user once per distinct error instead of failing silently every minute.
		if (lastErrorToast !== message) {
			lastErrorToast = message;
			await plugin.app
				.toast(`Daily Todo Carryover: automatic rollover failed: ${message}`)
				.catch(() => {});
		}
	}
}

const time = (d?: Date) => (d ? d.toLocaleTimeString() : 'never');

export async function describeStatus(plugin: ReactRNPlugin): Promise<string> {
	const lastRun = await getLastRollover(plugin);
	const parts: string[] = [];
	parts.push(`Last rollover: ${lastRun ? lastRun.toLocaleString() : 'never'}.`);

	if (await plugin.settings.getSetting('disable-auto-rollover')) {
		parts.push('Auto rollover is OFF.');
	} else {
		const rawTime = await plugin.settings.getSetting('rollover-time');
		const t = parseRolloverTime(rawTime ?? DEFAULT_ROLLOVER_TIME);
		if (!t) parts.push(`Invalid rollover time "${rawTime}".`);
		else {
			const now = new Date();
			parts.push(
				`Next: ${isRolloverDue(now, lastRun, t) ? 'due now' : nextRolloverMoment(now, t).toLocaleString()}.`
			);
		}
	}

	if (!diagnostics.schedulerStartedAt) {
		parts.push('Scheduler: NOT STARTED.');
	} else {
		parts.push(
			`Scheduler: running since ${time(diagnostics.schedulerStartedAt)}, last check ${time(
				diagnostics.lastCheckAt
			)} (${diagnostics.lastCheckResult ?? 'in progress'}).`
		);
	}
	if (diagnostics.lastError) parts.push(`Last error: ${diagnostics.lastError}`);
	if (diagnostics.startupErrors.length) parts.push(`Startup errors: ${diagnostics.startupErrors.join(' | ')}`);
	return parts.join(' ');
}
