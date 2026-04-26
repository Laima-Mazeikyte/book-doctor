import { getContext, setContext } from 'svelte';

const OPEN_BUG_REPORT = Symbol('openBugReport');

export function setOpenBugReportContext(open: () => void): void {
	setContext(OPEN_BUG_REPORT, open);
}

export function getOpenBugReportContext(): (() => void) | undefined {
	return getContext(OPEN_BUG_REPORT);
}
