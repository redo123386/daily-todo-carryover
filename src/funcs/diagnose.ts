import { BuiltInPowerupCodes, ReactRNPlugin, Rem } from '@remnote/plugin-sdk';
import { hasHappened, howLongAgo, isFinishedTodo, isUnfinishedTodo } from './calculations';
import { richTextToString } from './moveMode';

/**
 * Lists every unfinished todo in recent past Daily Documents and says whether
 * the rollover will pick it up, and if not, why. Mirrors the rules in
 * todoRemManagement.processRem.
 */

const SCAN_DAYS = 31;

type Finding = { day: string; daysAgo: number; text: string; status: string };

async function walk(
	plugin: ReactRNPlugin,
	remId: string,
	ctx: { day: string; daysAgo: number; beyondLimit: boolean; carryPlain: boolean; blockedBy?: string; parent?: Rem },
	out: Finding[],
	depth = 0
) {
	if (depth > 25) return;
	const rem = await plugin.rem.findOne(remId);
	if (!rem) return;

	let childBlockedBy = ctx.blockedBy;
	if (await isUnfinishedTodo(rem)) {
		let status: string;
		if (ctx.blockedBy) status = ctx.blockedBy;
		else if (ctx.beyondLimit) status = `SKIPPED: older than the Date Limit setting`;
		else if (await rem.hasPowerup('doNotRollover')) status = 'SKIPPED: tagged Do Not Rollover';
		else if (ctx.parent && (await ctx.parent.hasPowerup('doNotRollover')))
			status = 'SKIPPED: its parent is tagged Do Not Rollover';
		else status = 'will move';
		out.push({ day: ctx.day, daysAgo: ctx.daysAgo, text: richTextToString(rem.text) || '(empty)', status });
		childBlockedBy = childBlockedBy ?? 'moves together with its parent todo';
	} else if (await isFinishedTodo(rem)) {
		childBlockedBy = childBlockedBy ?? 'SKIPPED: it sits under a checked-off (finished) todo';
	} else if (
		(rem.children ?? []).length === 0 &&
		richTextToString(rem.text) &&
		!(await rem.hasPowerup('rolled'))
	) {
		let status: string;
		if (ctx.blockedBy) status = ctx.blockedBy;
		else if (!ctx.carryPlain) status = 'SKIPPED: plain bullet (Carry Over Plain Bullets is off)';
		else if (ctx.beyondLimit) status = 'SKIPPED: older than the Date Limit setting';
		else if (await rem.hasPowerup('doNotRollover')) status = 'SKIPPED: tagged Do Not Rollover';
		else status = 'will move (plain bullet, becomes a todo)';
		out.push({ day: ctx.day, daysAgo: ctx.daysAgo, text: richTextToString(rem.text), status });
	} else if (await rem.hasPowerup('doNotRollover')) {
		childBlockedBy = childBlockedBy ?? 'SKIPPED: its parent is tagged Do Not Rollover';
	}

	for (const childId of rem.children ?? []) {
		await walk(plugin, childId, { ...ctx, blockedBy: childBlockedBy, parent: rem }, out, depth + 1);
	}
}

export async function diagnose(plugin: ReactRNPlugin): Promise<string> {
	const dateLimit = Number(await plugin.settings.getSetting('dateLimit')) || 7;
	const carryPlain = (await plugin.settings.getSetting('carry-plain-bullets')) !== false;
	const dailyPowerup = await plugin.powerup.getPowerupByCode(BuiltInPowerupCodes.DailyDocument);
	const docs = (await dailyPowerup?.taggedRem()) ?? [];

	const findings: Finding[] = [];
	let scannedDocs = 0;
	for (const doc of docs) {
		const ts = Number(await doc.getPowerupProperty(BuiltInPowerupCodes.DailyDocument, 'Timestamp'));
		if (!Number.isFinite(ts)) continue;
		const date = new Date(ts * 1000);
		if (!hasHappened(new Date(date))) continue; // today or future
		const daysAgo = howLongAgo(new Date(date));
		if (daysAgo > SCAN_DAYS) continue;
		scannedDocs++;
		const day = richTextToString(doc.text) || date.toDateString();
		for (const childId of doc.children ?? []) {
			await walk(
				plugin,
				childId,
				{ day, daysAgo, beyondLimit: daysAgo > dateLimit, carryPlain, parent: doc },
				findings
			);
		}
	}

	findings.sort((a, b) => b.daysAgo - a.daysAgo);
	console.log('[DailyTodoCarryover] Diagnose results:', findings);

	if (!findings.length) {
		return `Diagnose: no unfinished todos found in the past ${SCAN_DAYS} days (${scannedDocs} past Daily Documents scanned). If you can see one, it may be a reference or portal to a todo that lives in another document.`;
	}
	const willMove = findings.filter((f) => f.status.startsWith('will move')).length;
	const lines = findings.map((f) => `• ${f.day}: "${f.text}" → ${f.status}`);
	return `Diagnose (${scannedDocs} past days scanned, Date Limit ${dateLimit}): ${findings.length} item(s), ${willMove} will move.\n${lines.join('\n')}`;
}
