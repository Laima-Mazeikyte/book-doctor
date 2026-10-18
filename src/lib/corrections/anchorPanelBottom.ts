/** Keep an expanding correction panel's bottom in place within its existing scroll area. */
export function anchorPanelBottom(panel: HTMLElement) {
	let scroller = panel.parentElement;
	while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
		scroller = scroller.parentElement;
	}
	const scrollArea = scroller ?? (document.scrollingElement as HTMLElement);
	const scrollEvents = scroller ?? window;
	const previousAnchor = scrollArea.style.overflowAnchor;
	const previousBehavior = scrollArea.style.scrollBehavior;
	scrollArea.style.overflowAnchor = 'none';
	scrollArea.style.scrollBehavior = 'auto';
	let height = panel.getBoundingClientRect().height;
	let bottom = panel.getBoundingClientRect().bottom;

	function viewportBottom() {
		const viewport = window.visualViewport;
		const screenBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
		return scroller
			? Math.min(
					screenBottom,
					scroller.getBoundingClientRect().top + scroller.clientTop + scroller.clientHeight
				)
			: screenBottom;
	}

	function align() {
		const rect = panel.getBoundingClientRect();
		const movement = rect.bottom - bottom;
		if (Math.abs(movement) > 0.5) scrollArea.scrollTop += movement;
		height = rect.height;
		bottom = panel.getBoundingClientRect().bottom;
	}

	function onScroll() {
		const rect = panel.getBoundingClientRect();
		// A resize can clamp scrollTop before its observer runs. Account for that in align().
		if (Math.abs(rect.height - height) < 0.5) bottom = rect.bottom;
	}

	function onViewportResize() {
		bottom = Math.min(bottom, viewportBottom() - 8);
		align();
	}

	// Opening the editor brings its actions into view; subsequent changes retain that position.
	bottom = Math.min(bottom, viewportBottom() - 8);
	const observer = new ResizeObserver(align);
	observer.observe(panel);
	scrollEvents.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('resize', onViewportResize);
	window.visualViewport?.addEventListener('resize', onViewportResize);

	return {
		destroy() {
			observer.disconnect();
			scrollEvents.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onViewportResize);
			window.visualViewport?.removeEventListener('resize', onViewportResize);
			scrollArea.style.overflowAnchor = previousAnchor;
			scrollArea.style.scrollBehavior = previousBehavior;
		}
	};
}
