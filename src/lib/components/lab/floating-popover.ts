export interface FloatingPopoverOptions {
	isVisible: () => boolean;
	getTrigger: () => Element | null;
	getPopover: () => Element | null;
	position?: () => void;
	onOutsidePointerDown: (event: PointerEvent) => void;
	onKeydown?: (event: KeyboardEvent) => void;
}

export interface FloatingPopoverController {
	schedulePosition: () => void;
	destroy: () => void;
}

/**
 * Own the global lifecycle for a visible floating popover. Call this from an effect that depends
 * on visibility so listeners and pending frames disappear as soon as the popover closes.
 */
export function createFloatingPopover(options: FloatingPopoverOptions): FloatingPopoverController {
	let positionFrame: number | null = null;
	let destroyed = false;

	function schedulePosition(): void {
		if (
			destroyed ||
			!options.position ||
			!options.isVisible() ||
			positionFrame !== null ||
			typeof window === 'undefined'
		)
			return;

		positionFrame = window.requestAnimationFrame(() => {
			positionFrame = null;
			if (destroyed || !options.isVisible()) return;
			options.position?.();
		});
	}

	function handleOutsidePointerDown(event: PointerEvent): void {
		const target = event.target;
		if (target instanceof Node) {
			const trigger = options.getTrigger();
			const popover = options.getPopover();
			if (trigger?.contains(target) || popover?.contains(target)) return;
		}
		options.onOutsidePointerDown(event);
	}

	if (typeof document !== 'undefined') {
		document.addEventListener('pointerdown', handleOutsidePointerDown);
		if (options.onKeydown) document.addEventListener('keydown', options.onKeydown);
	}
	if (typeof window !== 'undefined' && options.position) {
		window.addEventListener('resize', schedulePosition);
		window.addEventListener('scroll', schedulePosition, true);
	}

	schedulePosition();

	return {
		schedulePosition,
		destroy: () => {
			if (destroyed) return;
			destroyed = true;
			if (typeof document !== 'undefined') {
				document.removeEventListener('pointerdown', handleOutsidePointerDown);
				if (options.onKeydown) document.removeEventListener('keydown', options.onKeydown);
			}
			if (typeof window !== 'undefined') {
				window.removeEventListener('resize', schedulePosition);
				window.removeEventListener('scroll', schedulePosition, true);
				if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
			}
			positionFrame = null;
		}
	};
}
