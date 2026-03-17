import copyByLocale from './copy.yaml';

export const defaultLocale = 'en';

type CopyTree = Record<string, string | CopyTree>;

function getByPath(obj: CopyTree, path: string): string | undefined {
	const value = path.split('.').reduce<unknown>((acc, key) => {
		if (acc != null && typeof acc === 'object' && key in acc) {
			return (acc as CopyTree)[key];
		}
		return undefined;
	}, obj);
	return typeof value === 'string' ? value : undefined;
}

function interpolate(str: string, params?: Record<string, string | number>): string {
	if (!params) return str;
	return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
		return key in params ? String(params[key]) : `{{${key}}}`;
	});
}

/**
 * Look up copy by dot path (e.g. 'home.title') and optionally interpolate {{key}} with params.
 */
export function t(
	path: string,
	params?: Record<string, string | number>
): string {
	const localeCopy = copyByLocale[defaultLocale] as CopyTree | undefined;
	if (!localeCopy) return path;
	const raw = getByPath(localeCopy, path);
	if (raw == null) return path;
	return interpolate(raw, params);
}
