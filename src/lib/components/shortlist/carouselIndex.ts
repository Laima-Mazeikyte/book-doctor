export function scrollSlotForLogicalIndex(logicalIndex: number, setSize: number): number {
	if (setSize <= 1) return 0;
	return logicalIndex + 1;
}

export function logicalIndexFromScrollSlot(slot: number, setSize: number): number {
	if (setSize <= 0) return 0;
	if (setSize === 1) return 0;
	if (slot === 0) return setSize - 1;
	if (slot === setSize + 1) return 0;
	return slot - 1;
}

export function teleportTargetSlot(slot: number, setSize: number): number | null {
	if (setSize <= 1) return null;
	if (slot === 0) return setSize;
	if (slot === setSize + 1) return 1;
	return null;
}
