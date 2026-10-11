import { BuiltInPowerupCodes, ReactRNPlugin, Rem } from '@remnote/plugin-sdk';
import { TodoRems } from '../types/TodoRem';
import { hasHappened, howLongAgo, isFinishedTodo, isUnfinishedTodo } from './calculations';
import { moveUnderDateHeadings } from './moveMode';

async function acceptTodoRem(
	dailyDocument: Rem,
	todoRems: TodoRems,
	rem: Rem,
	rememberedParent?: Rem
) {
	const timestamp: string = await dailyDocument.getPowerupProperty(
		BuiltInPowerupCodes.DailyDocument,
		'Timestamp'
	);
	const date = new Date(Number(timestamp) * 1000);

	if (hasHappened(date)) {
		const entry = { rem, rememberedParent, dailyDocument, timestamp: Number(timestamp) };
		if (todoRems[timestamp]) {
			todoRems[timestamp].push(entry);
		} else {
			todoRems[timestamp] = [entry];
		}
	}
}

async function acceptOmniRem(todoRems: TodoRems, rem: Rem, rememberedParent?: Rem) {
	if (todoRems['omni']) {
		todoRems['omni'].push({ rem: rem, rememberedParent: rememberedParent });
	} else {
		todoRems['omni'] = [{ rem: rem, rememberedParent: rememberedParent }];
	}
	return todoRems;
}

async function processRem(
	plugin: ReactRNPlugin,
	remId: any,
	todoRems: TodoRems,
	dailyDocument: Rem | null,
	rememberedParent: Rem | undefined = undefined,
	isOmniRem: boolean = false
) {
	const rem: Rem | undefined = await plugin.rem.findOne(remId);

	if (!isOmniRem && dailyDocument) {
		if (rem && (await isUnfinishedTodo(rem))) {
			if (await rememberedParent?.hasPowerup('doNotRollover')) {
				return;
			}
			if (await rem.hasPowerup('doNotRollover')) {
				return;
			}
			if (rememberedParent) {
				await acceptTodoRem(dailyDocument!, todoRems, rem, rememberedParent);
			} else {
				await acceptTodoRem(dailyDocument!, todoRems, rem);
			}
			return;
		}

		if (rem && (await isFinishedTodo(rem))) {
			return;
		}

		if (rem?.children) {
			for (const childId of rem.children) {
				await processRem(plugin, childId, todoRems, dailyDocument, rem);
			}
		}
	} else if (isOmniRem) {
		if (rem && (await isUnfinishedTodo(rem))) {
			if (await rememberedParent?.hasPowerup('doNotRollover')) {
				return;
			}
			if (await rem.hasPowerup('doNotRollover')) {
				return;
			}
			if (rememberedParent) {
				await acceptOmniRem(todoRems, rem, rememberedParent);
			} else {
				await acceptOmniRem(todoRems, rem);
			}
			return;
		}

		if (rem && (await isFinishedTodo(rem))) {
			return;
		}

		if (rem?.children) {
			for (const childId of rem.children) {
				await processRem(plugin, childId, todoRems, null, rem, true);
			}
		}
	}
}
export async function handleUnfinishedTodos(
	plugin: ReactRNPlugin,
	todayDailyDocument: Rem,
	opts: { quiet?: boolean } = {}
) {
	let parentRemsAlreadyRolledOver: Rem[] = [];
	let dateLimit: number = await plugin.settings.getSetting('dateLimit');
	const dailyDocumentPowerup = await plugin.powerup.getPowerupByCode(
		BuiltInPowerupCodes.DailyDocument
	);
	const dailyDocuments = await dailyDocumentPowerup?.taggedRem();
	const portalMode = await plugin.settings.getSetting('portal-mode');

	const todoRems: TodoRems = {};
	// handle if daily document is undefined and if todoRem is undefined
	if (!dailyDocumentPowerup) {
		return;
	}

	if (!dailyDocuments) {
		return;
	}

	for (const dailyDocument of dailyDocuments) {
		const timeStampValue = await dailyDocument.getPowerupProperty(
			BuiltInPowerupCodes.DailyDocument,
			'Timestamp'
		);
		const createdAt = new Date(Number(timeStampValue) * 1000);
		const daysAgo: number = howLongAgo(createdAt);
		if (daysAgo > dateLimit) {
			continue;
		}
		await processRem(plugin, dailyDocument._id, todoRems, dailyDocument);
	}

	const omniRem = await plugin.powerup.getPowerupByCode('omniRollover');
	const omniRems = await omniRem?.taggedRem();

	for (const omniRem of omniRems || []) {
		await processRem(plugin, omniRem._id, todoRems, null, undefined, true);
	}

	// The same todo can be reached twice (e.g. through a portal left by an earlier
	// portal-mode run). Keep one entry per rem, preferring the oldest daily document,
	// which is where the todo really lives.
	const seen = new Map<string, { key: string; ts: number }>();
	for (const key of Object.keys(todoRems)) {
		for (const item of todoRems[key]) {
			const ts = item.timestamp ?? Number.MAX_SAFE_INTEGER;
			const prev = seen.get(item.rem._id);
			if (!prev || ts < prev.ts) seen.set(item.rem._id, { key, ts });
		}
	}
	for (const key of Object.keys(todoRems)) {
		todoRems[key] = todoRems[key].filter((item, index, list) => {
			const owner = seen.get(item.rem._id);
			return owner?.key === key && list.findIndex((x) => x.rem._id === item.rem._id) === index;
		});
		if (!todoRems[key].length) delete todoRems[key];
	}

	const total = Object.values(todoRems).reduce((n, list) => n + list.length, 0);
	if (total === 0) {
		if (!opts.quiet) await plugin.app.toast('No unfinished todos to rollover.');
		return todoRems;
	}

	if (!portalMode) {
		const { omni, ...dated } = todoRems;
		if (omni?.length) {
			await plugin.app.toast('Omni Rollover only works with Portal Mode on; skipped those.');
		}
		const items = Object.values(dated).flat();
		if (!items.length) return todoRems;
		const { moved, failed } = await moveUnderDateHeadings(plugin, items, todayDailyDocument);
		let message = `Moved ${moved} unfinished todo${moved === 1 ? '' : 's'} into today's Daily Document.`;
		if (failed.length) {
			message += ` Couldn't move ${failed.length}: ${failed.map((t) => `"${t}"`).join(', ')}.`;
			console.error('[DailyTodoCarryover] Todos that could not be moved:', failed);
		}
		await plugin.app.toast(message);
		return todoRems;
	}

	await plugin.app.toast("Moving unfinished todos to today's Daily Document.");
	for (const dateString in todoRems) {
		// dateString can also be 'omni'
		if (
			todoRems[dateString][0].rememberedParent &&
			parentRemsAlreadyRolledOver.includes(todoRems[dateString][0].rememberedParent!)
		) {
			continue;
		}

		const newPortal = await plugin.rem.createPortal();
		await newPortal?.addPowerup('rolled');
		if (!newPortal) {
			continue;
		}
		await plugin.rem.moveRems([newPortal], todayDailyDocument, 0);
		for (const todoRem of todoRems[dateString]) {
			const rememberedParent = todoRem.rememberedParent;

			if (dateString === 'omni') {
				await todoRem?.rem.addToPortal(newPortal);
			}

			if (rememberedParent) {
				const isDailyDoc = await rememberedParent.hasPowerup(BuiltInPowerupCodes.DailyDocument);
				if (!isDailyDoc) {
					await todoRem?.rememberedParent?.addToPortal(newPortal);
				}
				await plugin.rem.moveRems(
					[todoRem.rem],
					rememberedParent,
					(rememberedParent.children ?? []).length
				);
				await todoRem?.rem.addToPortal(newPortal);
			}
		}
		if (todoRems[dateString][0].rememberedParent) {
			parentRemsAlreadyRolledOver.push(todoRems[dateString][0].rememberedParent!);
		}
	}

	return todoRems;
}
