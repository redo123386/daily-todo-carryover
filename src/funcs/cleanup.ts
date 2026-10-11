import { ReactRNPlugin } from '@remnote/plugin-sdk';

/**
 * Move mode leaves behind the date bullets (tagged "rolled") in older Daily
 * Documents once their todos have moved on. Remove the empty ones.
 *
 * Safety rules (removing a rem also removes anything under it):
 *  - re-fetch each bullet right before removing it and skip it unless it is empty;
 *  - never touch anything inside today's Daily Document.
 */
export async function cleanupPastDocuments(plugin: ReactRNPlugin) {
	const portalMode = await plugin.settings.getSetting('portal-mode');
	// In portal mode, rolled portals stay in past daily docs so completed items can be reviewed.
	if (portalMode) return;

	const today = await plugin.date.getTodaysDoc();
	const todayId = today?._id;

	const isInsideToday = async (remId: string): Promise<boolean> => {
		if (!todayId) return false;
		let current = await plugin.rem.findOne(remId);
		for (let depth = 0; current && depth < 6; depth++) {
			const parentId = (current as any).parent as string | null | undefined;
			if (!parentId) return false;
			if (parentId === todayId) return true;
			current = await plugin.rem.findOne(parentId);
		}
		return false;
	};

	// A few passes, because removing an empty sub-bullet can leave its date bullet empty.
	for (let pass = 0; pass < 3; pass++) {
		const rolledPowerup = await plugin.powerup.getPowerupByCode('rolled');
		const rolledRems = (await rolledPowerup?.taggedRem()) ?? [];
		let removed = 0;
		for (const tagged of rolledRems) {
			const fresh = await plugin.rem.findOne(tagged._id);
			if (!fresh) continue;
			if ((fresh.children ?? []).length > 0) continue;
			if (await isInsideToday(fresh._id)) continue;
			await fresh.remove();
			removed++;
		}
		if (removed === 0) break;
	}
}
