import { FLAVOR_KEYS, type FlavorGroups, type FlavorItem } from './flavorGroups';
export function flavorFixture(items: FlavorItem[] = []): FlavorGroups {
	return {
		version: 'flavors_v1',
		groups: FLAVOR_KEYS.map((key, index) => ({
			key,
			reason: 'filled',
			items:
				index === 0
					? items.slice(0, 7)
					: index === 1
						? items.slice(7).map((item, i) => ({ ...item, rank: i + 1 }))
						: []
		}))
	};
}
