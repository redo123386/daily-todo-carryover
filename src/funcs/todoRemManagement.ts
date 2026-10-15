import { BuiltInPowerupCodes, ReactRNPlugin, Rem } from '@remnote/plugin-sdk';
import { TodoRems } from '../types/TodoRem';
import { hasHappened, howLongAgo, isFinishedTodo, isUnfinishedTodo } from './calculations';
import { moveUnderDateHeadings, richTextToString } from './moveMode';

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
/**
 * Plain bullets (e.g. "Rebook Dermatology") are treated as todos: picked up,
 * turned into todos and carried over. Walks the whole day, mirroring the todo
 * rules: doesn't look inside todos (they're handled as todos), skips anything
 * tagged Do Not Rollover, and leaves empty lines alone. A plain bullet with
 * items under it acts as a heading; its items are carried under it.
 */
async function collectPlainBullets(
	plugin: ReactRNPlugin,
	parent: Rem,
	dailyDocument: Rem,
	todoRems: TodoRems,
	timestamp: string,
	depth = 0
) {
	if (depth > 20) return;
	if (depth === 0 && !hasHappened(new Date(Number(timestamp) * 1000))) return;
	for (const childId of parent.children ?? []) {
		const rem = await plugin.rem.findOne(childId);
		if (!rem) continue;
		if (await rem.isTodo()) continue;
		if (await rem.hasPowerup('doNotRollover')) continue;
		if ((rem.children ?? []).length > 0) {
			await collectPlainBullets(plugin, rem, dailyDocument, todoRems, timestamp, depth + 1);
			continue;
		}
		if (!richTextToString(rem.text)) continue;
		if (await rem.hasPowerup('rolled')) continue;
		if (await rem.hasPowerup(BuiltInPowerupCodes.DailyDocument)) continue;
		(todoRems[timestamp] ??= []).push({
			rem,
			rememberedParent: parent,
			dailyDocument,
			timestamp: Number(timestamp),
			convertToTodo: true,
		});
	}
}

export async function handleUnfinishedTodos(
	plugin: ReactRNPlugin,
	todayDailyDocument: Rem,
	opts: { quiet?: boolean; carryPlain?: boolean } = {}
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
		if (opts.carryPlain) {
			await collectPlainBullets(plugin, dailyDocument, dailyDocument, todoRems, String(timeStampValue));
		}
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

	// Turn picked-up plain bullets into unchecked todos before carrying them over.
	let converted = 0;
	for (const list of Object.values(todoRems)) {
		for (const item of list) {
			if (!item.convertToTodo) continue;
			try {
				const rem: any = item.rem;
				if (typeof rem.setIsTodo === 'function') await rem.setIsTodo(true);
				if (typeof rem.setTodoStatus === 'function') await rem.setTodoStatus('Unfinished');
				converted++;
			} catch (error) {
				console.warn('[DailyTodoCarryover] Could not turn a bullet into a todo.', error);
			}
		}
	}
	const convertedNote = converted
		? ` (${converted} bullet${converted === 1 ? '' : 's'} turned into todo${converted === 1 ? '' : 's'})`
		: '';

	if (!portalMode) {
		const { omni, ...dated } = todoRems;
		if (omni?.length) {
			await plugin.app.toast('Omni Rollover only works with Portal Mode on; skipped those.');
		}
		const items = Object.values(dated).flat();
		if (!items.length) return todoRems;
		const { moved, failed } = await moveUnderDateHeadings(plugin, items, todayDailyDocument);
		let message = `Moved ${moved} unfinished todo${moved === 1 ? '' : 's'} into today's Daily Document${convertedNote}.`;
		if (failed.length) {
			message += ` Couldn't move ${failed.length}: ${failed.map((t) => `"${t}"`).join(', ')}.`;
			console.error('[DailyTodoCarryover] Todos that could not be moved:', failed);
		}
		await plugin.app.toast(message);
		return todoRems;
	}

	await plugin.app.toast(`Moving unfinished todos to today's Daily Document${convertedNote}.`);
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
