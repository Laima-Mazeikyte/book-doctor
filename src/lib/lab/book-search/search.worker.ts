import { matchingIndices, prepareSearchIndex, type SearchPopulation } from './ranking';
import type { SearchRequest, SearchResponse } from './search-client';

const populations = new Map<string, SearchPopulation>();
const orders = new Map<string, Int32Array>();

self.onmessage = ({ data }: MessageEvent<SearchRequest>) => {
	if (data.type === 'prepare') {
		populations.set(data.mode, data.population);
		orders.delete(data.mode);
		prepareSearchIndex(data.population);
		return;
	}
	if (data.order) orders.set(data.mode, data.order);
	const population = populations.get(data.mode);
	const order = orders.get(data.mode);
	let response: SearchResponse;
	if (!population || !order) {
		// Report instead of throwing: an uncaught error would take the whole worker down.
		response = { id: data.id, notReady: true };
	} else {
		const matches = matchingIndices(population, { order }, data.query);
		response = { id: data.id, indices: matches.slice(0, data.limit), total: matches.length };
	}
	self.postMessage(response);
};
