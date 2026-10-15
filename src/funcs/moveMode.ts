import { BuiltInPowerupCodes, ReactRNPlugin, Rem } from '@remnote/plugin-sdk';
import { TodoRem } from '../types/TodoRem';

/**
 * "Move" mode: unfinished todos are moved out of their old Daily Document into
 * today's, grouped under a bullet named after the day they came from:
 *
 *   • October 9th, 2026
 *       ☐ Potatoes
 *       ☐ Tooth
 *       • Work                 (only if the todo sat under a heading in the old doc)
 *           ☐ Commbank rebuttal
 *
 * A todo that keeps rolling over keeps its ORIGINAL date bullet (it doesn't nest
 * "October 10th > October 9th > ..."). Emptied bullets are removed by cleanup.
 */

type Group = {
	label: string;
	labelRichText: any[];
	sortKey: number;
	direct: Rem[];
	sub: Map<string, { richText: any[]; rems: Rem[] }>;
};

export function richTextToString(rt: unknown): string {
	if (!Array.isArray(rt)) return typeof rt === 'string' ? rt : '';
	return rt
		.map((part: any) => {
			if (typeof part === 'string') return part;
			if (part && typeof part.text === 'string') return part.text;
			return '';
		})
		.join('')
		.trim();
}

/** "October 9th, 2026" -> timestamp, falling back to the source doc's date. */
export function sortKeyForLabel(label: string, fallbackMs: number): number {
	const cleaned = label.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
	const parsed = Date.parse(cleaned);
	return Number.isNaN(parsed) ? fallbackMs : parsed;
}

async function parentOf(plugin: ReactRNPlugin, rem: Rem | undefined): Promise<Rem | undefined> {
	const parentId = (rem as any)?.parent;
	if (!parentId) return undefined;
	return (await plugin.rem.findOne(parentId)) ?? undefined;
}

async function isRolledWrapper(rem: Rem | undefined) {
	return !!rem && (await rem.hasPowerup('rolled'));
}

async function isDailyDoc(rem: Rem | undefined) {
	return !!rem && (await rem.hasPowerup(BuiltInPowerupCodes.DailyDocument));
}

/** Works out which date bullet (and optional sub-bullet) a todo belongs under. */
async function placementFor(plugin: ReactRNPlugin, item: TodoRem) {
	const parent = await parentOf(plugin, item.rem);
	const fallbackDoc = item.dailyDocument;

	// Directly in a Daily Document: group under that day's name.
	if (!parent || (await isDailyDoc(parent))) {
		const doc = parent ?? fallbackDoc;
		return { labelRt: doc?.text ?? [], subRt: undefined as any[] | undefined, sourceHeadingId: undefined as string | undefined };
	}

	// Inside one of our own bullets from a previous rollover: keep the original date.
	if (await isRolledWrapper(parent)) {
		const grandparent = await parentOf(plugin, parent);
		if (await isRolledWrapper(grandparent)) {
			return { labelRt: grandparent!.text ?? [], subRt: parent.text ?? [], sourceHeadingId: undefined };
		}
		return { labelRt: parent.text ?? [], subRt: undefined, sourceHeadingId: undefined };
	}

	// Under a normal heading (e.g. "Work") in a Daily Document: date bullet + heading sub-bullet.
	return { labelRt: fallbackDoc?.text ?? [], subRt: parent.text ?? [], sourceHeadingId: parent._id };
}

/** Find a bullet we created earlier under `parent` with the same text, or create one. */
async function findOrCreateWrapper(
	plugin: ReactRNPlugin,
	parent: Rem,
	label: string,
	richText: any[],
	position: number | 'end'
): Promise<{ wrapper: Rem; created: boolean } | undefined> {
	for (const childId of parent.children ?? []) {
		const child = await plugin.rem.findOne(childId);
		if (child && (await isRolledWrapper(child)) && richTextToString(child.text) === label) {
			return { wrapper: child, created: false };
		}
	}
	const wrapper = await plugin.rem.createRem();
	if (!wrapper) return undefined;
	await wrapper.setText(richText.length ? richText : [label || 'Rolled over']);
	await wrapper.addPowerup('rolled');
	const index = position === 'end' ? (parent.children ?? []).length : position;
	await plugin.rem.moveRems([wrapper], parent, index);
	return { wrapper, created: true };
}

async function currentParentId(plugin: ReactRNPlugin, remId: string): Promise<string | null | undefined> {
	const fresh = await plugin.rem.findOne(remId);
	return fresh ? ((fresh as any).parent ?? null) : undefined;
}

/** True if `remId` is now a direct child of `targetId` (checked from both sides). */
async function isUnder(plugin: ReactRNPlugin, remId: string, targetId: string): Promise<boolean> {
	if ((await currentParentId(plugin, remId)) === targetId) return true;
	const target = await plugin.rem.findOne(targetId);
	return !!target && (target.children ?? []).includes(remId);
}

/**
 * Move `rem` under `targetId` and CHECK that it really happened. RemNote's
 * moveRems can silently do nothing, so fall back to rem.setParent, then verify.
 */
async function moveAndVerify(plugin: ReactRNPlugin, rem: Rem, targetId: string): Promise<boolean> {
	const target = await plugin.rem.findOne(targetId);
	if (!target) return false;
	const position = (target.children ?? []).length;

	try {
		await plugin.rem.moveRems([rem], target, position);
	} catch (error) {
		console.warn('[DailyTodoCarryover] moveRems failed; trying setParent.', error);
	}
	if (await isUnder(plugin, rem._id, targetId)) return true;

	try {
		const fresh = (await plugin.rem.findOne(rem._id)) ?? rem;
		if (typeof (fresh as any).setParent === 'function') {
			await (fresh as any).setParent(targetId, position);
		}
	} catch (error) {
		console.warn('[DailyTodoCarryover] setParent failed.', error);
	}
	return isUnder(plugin, rem._id, targetId);
}

async function appendTo(
	plugin: ReactRNPlugin,
	parentId: string,
	rems: Rem[],
	result: MoveResult
) {
	for (const rem of rems) {
		if (await moveAndVerify(plugin, rem, parentId)) result.moved++;
		else result.failed.push(richTextToString(rem.text) || rem._id);
	}
}

export type MoveResult = { moved: number; failed: string[] };

export async function moveUnderDateHeadings(
	plugin: ReactRNPlugin,
	items: TodoRem[],
	todayDailyDocument: Rem
): Promise<MoveResult> {
	const groups = new Map<string, Group>();

	const sourceHeadings = new Set<string>();
	for (const item of items) {
		const { labelRt, subRt, sourceHeadingId } = await placementFor(plugin, item);
		if (sourceHeadingId) sourceHeadings.add(sourceHeadingId);
		const label = richTextToString(labelRt) || 'Rolled over';
		let group = groups.get(label);
		if (!group) {
			group = {
				label,
				labelRichText: labelRt,
				sortKey: sortKeyForLabel(label, (item.timestamp ?? 0) * 1000),
				direct: [],
				sub: new Map(),
			};
			groups.set(label, group);
		}
		if (subRt) {
			const subLabel = richTextToString(subRt) || 'Untitled';
			const sub = group.sub.get(subLabel) ?? { richText: subRt, rems: [] };
			sub.rems.push(item.rem);
			group.sub.set(subLabel, sub);
		} else {
			group.direct.push(item.rem);
		}
	}

	// Oldest date first, at the top of today's document.
	const ordered = [...groups.values()].sort((a, b) => a.sortKey - b.sortKey);
	const result: MoveResult = { moved: 0, failed: [] };
	let insertAt = 0;
	for (const group of ordered) {
		const allRems = [...group.direct, ...[...group.sub.values()].flatMap((s) => s.rems)];
		const today = (await plugin.rem.findOne(todayDailyDocument._id)) ?? todayDailyDocument;
		const created = await findOrCreateWrapper(plugin, today, group.label, group.labelRichText, insertAt);
		if (!created) {
			result.failed.push(...allRems.map((r) => richTextToString(r.text) || r._id));
			continue;
		}
		const { wrapper } = created;
		// Make sure the date bullet itself landed in today's document.
		if (!(await isUnder(plugin, wrapper._id, todayDailyDocument._id))) {
			await moveAndVerify(plugin, wrapper, todayDailyDocument._id);
		}
		insertAt++;

		await appendTo(plugin, wrapper._id, group.direct, result);

		for (const [subLabel, sub] of group.sub) {
			const freshWrapper = (await plugin.rem.findOne(wrapper._id)) ?? wrapper;
			const subCreated = await findOrCreateWrapper(plugin, freshWrapper, subLabel, sub.richText, 'end');
			if (!subCreated) {
				result.failed.push(...sub.rems.map((r) => richTextToString(r.text) || r._id));
				continue;
			}
			await appendTo(plugin, subCreated.wrapper._id, sub.rems, result);
		}
	}
	// The heading was recreated under today's date bullet; remove the now-empty original
	// so it isn't mistaken for a bullet to carry over next time.
	for (const headingId of sourceHeadings) {
		const heading = await plugin.rem.findOne(headingId);
		if (!heading || (heading.children ?? []).length > 0) continue;
		if (await heading.isTodo()) continue;
		if (await isDailyDoc(heading)) continue;
		if (await isRolledWrapper(heading)) continue;
		await heading.remove();
	}
	return result;
}
