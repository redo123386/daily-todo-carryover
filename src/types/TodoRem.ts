import { Rem } from '@remnote/plugin-sdk';

export interface TodoRem {
	rem: Rem;
	rememberedParent: Rem | undefined;
	/** The daily document the todo was found in (undefined for Omni Rollover rems). */
	dailyDocument?: Rem;
	/** That daily document's timestamp in seconds. */
	timestamp?: number;
}
export interface TodoRems {
	[date: string]: TodoRem[];
}
