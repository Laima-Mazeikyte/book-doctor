type AnonymousSessionStarter = () => Promise<boolean>;

const defaultStarter: AnonymousSessionStarter = async () => false;

let starter: AnonymousSessionStarter = defaultStarter;
let inFlight: Promise<boolean> | null = null;

export function registerAnonymousSessionStarter(
	nextStarter: AnonymousSessionStarter | null
): void {
	starter = nextStarter ?? defaultStarter;
}

export function ensureAnonymousSessionStarted(): Promise<boolean> {
	if (inFlight) return inFlight;

	inFlight = starter()
		.catch((error) => {
			console.error('[auth] Lazy anonymous sign-in failed:', error);
			return false;
		})
		.finally(() => {
			inFlight = null;
		});

	return inFlight;
}
