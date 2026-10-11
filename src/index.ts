import { declareIndexPlugin, ReactRNPlugin } from '@remnote/plugin-sdk';
import { cleanupPastDocuments } from './funcs/cleanup';
import { diagnose } from './funcs/diagnose';
import {
	checkScheduledRollover,
	DEFAULT_ROLLOVER_TIME,
	describeStatus,
	diagnostics,
	errorText,
	getLastRollover,
	LAST_ROLLOVER_KEY,
	runRollover,
} from './funcs/autoRollover';

const CHECK_EVERY_MS = 60 * 1000;

let intervalId: ReturnType<typeof setInterval> | undefined;
let removeWakeListeners: (() => void) | undefined;

/** Run one startup step; if it fails, record it and keep going so the rest still loads. */
async function safe(label: string, fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (error) {
		const message = `${label}: ${errorText(error)}`;
		diagnostics.startupErrors.push(message);
		console.error(`[DailyTodoCarryover] Startup step failed - ${message}`, error);
	}
}

function startScheduler(plugin: ReactRNPlugin) {
	stopScheduler();

	const tick = (source: string) => {
		checkScheduledRollover(plugin, source).catch((error) =>
			console.error(`[DailyTodoCarryover] Scheduled check failed (${source}).`, error)
		);
	};

	intervalId = setInterval(() => tick('interval'), CHECK_EVERY_MS);
	diagnostics.schedulerStartedAt = new Date();

	// Browsers throttle or pause timers while a window is hidden or the computer sleeps.
	// Re-check the moment RemNote becomes visible/focused again so a missed rollover catches up immediately.
	try {
		if (typeof window !== 'undefined' && typeof document !== 'undefined') {
			const onVisible = () => {
				if (document.visibilityState === 'visible') tick('visible');
			};
			const onFocus = () => tick('focus');
			const onOnline = () => tick('online');
			document.addEventListener('visibilitychange', onVisible);
			window.addEventListener('focus', onFocus);
			window.addEventListener('online', onOnline);
			removeWakeListeners = () => {
				document.removeEventListener('visibilitychange', onVisible);
				window.removeEventListener('focus', onFocus);
				window.removeEventListener('online', onOnline);
			};
		}
	} catch (error) {
		console.warn('[DailyTodoCarryover] Could not add wake listeners; the 1-minute timer still runs.', error);
	}

	// First check shortly after startup (gives RemNote a moment to finish loading).
	setTimeout(() => tick('startup'), 3000);
}

function stopScheduler() {
	if (intervalId !== undefined) clearInterval(intervalId);
	intervalId = undefined;
	removeWakeListeners?.();
	removeWakeListeners = undefined;
}

async function onActivate(plugin: ReactRNPlugin) {
	diagnostics.startupErrors = [];

	// ---------- settings ----------
	await safe('rollover-time setting', () =>
		plugin.settings.registerStringSetting({
			id: 'rollover-time',
			title: 'Daily Rollover Time',
			description:
				"Local time (24-hour hh:mm) when unfinished todos from previous days move into today's Daily Document. Runs once per day; if RemNote is closed at that time, it runs as soon as you next open RemNote.",
			defaultValue: DEFAULT_ROLLOVER_TIME,
			validators: [
				{
					type: 'regex',
					arg: '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$',
				},
			],
		})
	);

	await safe('disable-auto-rollover setting', () =>
		plugin.settings.registerBooleanSetting({
			id: 'disable-auto-rollover',
			title: 'Disable Auto Rollover',
			description: 'If enabled, todos only roll over when you run the command manually.',
			defaultValue: false,
		})
	);

	await safe('create-daily-doc setting', () =>
		plugin.settings.registerBooleanSetting({
			id: 'create-daily-doc',
			title: "Create Today's Daily Document If Missing",
			description:
				"If today's Daily Document doesn't exist yet when the rollover is due, create it so todos can be moved. If off, the rollover waits until you open today's document.",
			defaultValue: true,
		})
	);

	await safe('portal-mode setting', () =>
		plugin.settings.registerBooleanSetting({
			id: 'portal-mode',
			title: 'Portal Mode',
			description:
				"Off (default): unfinished todos are moved into today's Daily Document under a bullet with their original date, and removed from the old day. On: they stay in the old day and a portal to them is added to today.",
			defaultValue: false,
		})
	);

	await safe('dateLimit setting', () =>
		plugin.settings.registerNumberSetting({
			id: 'dateLimit',
			title: 'Date Limit',
			description: 'The number of days to look back for unfinished todos',
			defaultValue: 7,
		})
	);

	await safe('debug-mode setting', () =>
		plugin.settings.registerBooleanSetting({
			id: 'debug-mode',
			title: 'Debug Mode',
			description:
				'Logs every scheduler check to the developer console and adds a command to reset the last rollover time.',
			defaultValue: false,
		})
	);

	// ---------- powerups (needed by the rollover itself, so before the scheduler) ----------
	await safe('RO powerup', () =>
		plugin.app.registerPowerup({
			name: 'RO',
			code: 'rolled',
			description: 'Indicates that this rem has been rolled over.',
			options: { slots: [] },
		})
	);

	await safe('Do Not Rollover powerup', () =>
		plugin.app.registerPowerup({
			name: 'Do Not Rollover',
			code: 'doNotRollover',
			description: 'Tag this to a rem to prevent it from being rolled over.',
			options: { slots: [] },
		})
	);

	await safe('OmniRollover powerup', () =>
		plugin.app.registerPowerup({
			name: 'OmniRollover',
			code: 'omniRollover',
			description: 'Allows you to rollover a rem from anywhere.',
			options: { slots: [] },
		})
	);

	// ---------- scheduler ----------
	// Started before the commands, and without blocking on sync, so nothing below can stop it.
	startScheduler(plugin);

	// ---------- commands ----------
	const manualRolloverCommand = {
		id: 'rollover-todos',
		name: 'Rollover Unfinished Todos',
		description: "Roll over unfinished todos into today's Daily Document right now.",
		quickCode: 'rollover',
		icon: '📅',
		keywords: 'rollover, todos, unfinished',
		keyboardShortcut: 'ctrl+shift+alt+o',
		action: async () => {
			try {
				await runRollover(plugin, { source: 'manual' });
			} catch (error) {
				console.error('[DailyTodoCarryover] Manual rollover failed.', error);
				await plugin.app.toast(`Rollover failed: ${errorText(error)}`);
			}
		},
	};
	await safe('Rollover Unfinished Todos command', async () => {
		try {
			await plugin.app.registerCommand(manualRolloverCommand);
		} catch (error) {
			// Most likely the keyboard shortcut is taken (e.g. by the old plugin). Register without it.
			console.warn('[DailyTodoCarryover] Registering without keyboard shortcut.', error);
			const { keyboardShortcut: _unused, ...withoutShortcut } = manualRolloverCommand;
			await plugin.app.registerCommand(withoutShortcut);
		}
	});

	await safe('Rollover Status command', () =>
		plugin.app.registerCommand({
			id: 'rollover-status',
			name: 'Rollover Status',
			description: 'Show when todos last rolled over, when the next automatic rollover is, and any errors.',
			quickCode: 'rollover status',
			icon: '🕒',
			keywords: 'rollover, status, schedule, next, last',
			action: async () => {
				const status = await describeStatus(plugin);
				console.log(`[DailyTodoCarryover] ${status}`);
				await plugin.app.toast(status);
			},
		})
	);

	await safe('Diagnose command', () =>
		plugin.app.registerCommand({
			id: 'rollover-diagnose',
			name: 'Rollover: Diagnose',
			description:
				'List every unfinished todo in recent past Daily Documents and whether it will roll over (and why not).',
			quickCode: 'rollover diagnose',
			icon: '🔍',
			keywords: 'rollover, diagnose, debug, why, missing, todos',
			action: async () => {
				try {
					await plugin.app.toast('Scanning past Daily Documents...');
					await plugin.app.toast(await diagnose(plugin));
				} catch (error) {
					console.error('[DailyTodoCarryover] Diagnose failed.', error);
					await plugin.app.toast(`Diagnose failed: ${errorText(error)}`);
				}
			},
		})
	);

	await safe('Cleanup command', () =>
		plugin.app.registerCommand({
			id: 'cleanup-rolled-over-rems',
			name: 'Cleanup Rolled Over Rems',
			quickCode: 'cleanup',
			icon: '🧹',
			keywords: 'cleanup, rolled, over, rems',
			action: async () => {
				await cleanupPastDocuments(plugin);
			},
		})
	);

	await safe('Do Not Rollover command', () =>
		plugin.app.registerCommand({
			id: 'do-not-rollover',
			name: 'Do Not Rollover Rem',
			quickCode: 'dnr',
			keywords: 'do, not, rollover, rem',
			action: async () => {
				const rem = await plugin.focus.getFocusedRem();
				await rem?.addPowerup('doNotRollover');
			},
		})
	);

	await safe('Omni Rollover command', () =>
		plugin.app.registerCommand({
			id: 'omni-rollover',
			description:
				'Functionally allows you to have a Rem always rollover in the Daily Document as a Reminder. Only works when there are unfinished todos.',
			name: 'Omni Rollover',
			quickCode: 'or',
			keywords: 'omni, rollover',
			action: async () => {
				const rem = await plugin.focus.getFocusedRem();
				await rem?.addPowerup('omniRollover');
			},
		})
	);

	await safe('Remove Omni Rollover command', () =>
		plugin.app.registerCommand({
			id: 'remove-omni-rollover',
			description: 'Removes the Omni Rollover powerup from the Rem.',
			name: 'Remove Omni Rollover',
			quickCode: 'ror',
			keywords: 'remove, omni, rollover',
			action: async () => {
				const rem = await plugin.focus.getFocusedRem();
				await rem?.removePowerup('omniRollover');
			},
		})
	);

	await safe('Debug command tracker', async () => {
		plugin.track(async (reactivePlugin) => {
			if (!(await reactivePlugin.settings.getSetting('debug-mode'))) return;
			await plugin.app.registerCommand({
				id: 'debug-reset-last-rollover',
				name: 'Debug: Reset Last Rollover Time',
				description:
					'Forget the last rollover so the scheduler runs again on its next check (within a minute).',
				quickCode: 'debug rollover reset',
				icon: '🐛',
				action: async () => {
					const before = await getLastRollover(plugin);
					console.log('[DailyTodoCarryover] Clearing last rollover time. Was:', before?.toString());
					await plugin.storage.setSynced(LAST_ROLLOVER_KEY, null);
					await plugin.app.toast('Last rollover time cleared. Auto rollover will run within a minute.');
				},
			});
		});
	});

	if (diagnostics.startupErrors.length) {
		await plugin.app
			.toast(
				`Daily Todo Carryover started with ${diagnostics.startupErrors.length} problem(s). Run "Rollover Status" for details.`
			)
			.catch(() => {});
	}
}

async function onDeactivate(_: ReactRNPlugin) {
	stopScheduler();
}

declareIndexPlugin(onActivate, onDeactivate);
