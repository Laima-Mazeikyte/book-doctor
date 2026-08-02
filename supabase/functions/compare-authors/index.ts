// Aggregate-only gateway to the private author-comparison backend.
import postgres from 'npm:postgres@3.4.7';

const databaseUrl = Deno.env.get('AUTHOR_COMPARISON_DB_URL');
if (!databaseUrl) {
	throw new Error('AUTHOR_COMPARISON_DB_URL is required');
}

const sql = postgres(databaseUrl, {
	max: 1,
	prepare: false,
	connect_timeout: 10,
	idle_timeout: 20
});

const configuredOrigins =
	Deno.env.get('ALLOWED_ORIGINS')?.trim() || Deno.env.get('ALLOWED_ORIGIN')?.trim() || '';
const allowedOrigins = [
	...new Set(
		configuredOrigins
			.split(',')
			.map((origin) => origin.trim())
			.filter(Boolean)
			.map((origin) => {
				const url = new URL(origin);
				if (
					(url.protocol !== 'http:' && url.protocol !== 'https:') ||
					url.pathname !== '/' ||
					url.search ||
					url.hash
				) {
					throw new Error('allowed origins must contain only http(s) origins');
				}
				return url.origin;
			})
	)
];
const defaultAllowedOrigin = allowedOrigins[0];
if (!defaultAllowedOrigin) {
	throw new Error('ALLOWED_ORIGINS or ALLOWED_ORIGIN is required');
}
const allowedOriginSet = new Set(allowedOrigins);
const pinnedDatasetVersion = Deno.env.get('AUTHOR_COMPARISON_DATASET_VERSION') ?? null;

function corsHeaders(origin: string | null): HeadersInit {
	const responseOrigin = origin && allowedOriginSet.has(origin) ? origin : defaultAllowedOrigin;
	return {
		'Access-Control-Allow-Origin': responseOrigin,
		'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Cache-Control': 'private, max-age=0, must-revalidate',
		'Content-Type': 'application/json; charset=utf-8',
		Vary: 'Origin'
	};
}

function response(body: unknown, status: number, origin: string | null): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: corsHeaders(origin)
	});
}

type JsonObject = Record<string, unknown>;

function requireObject(value: unknown, label: string): JsonObject {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`comparison response field ${label} is not an object`);
	}
	return value as JsonObject;
}

function allowFields(source: JsonObject, fields: readonly string[]): JsonObject {
	const output: JsonObject = {};
	for (const field of fields) {
		if (Object.prototype.hasOwnProperty.call(source, field)) {
			output[field] = source[field];
		}
	}
	return output;
}

const METRIC_FIELDS = [
	'mode',
	'display_state',
	'like_rate',
	'baseline_rate',
	'rate_difference',
	'rate_difference_standard_error',
	'rate_difference_ci_lower',
	'rate_difference_ci_upper',
	'log_odds_ratio',
	'standard_error',
	'ci_lower',
	'ci_upper',
	'p_value',
	'q_value',
	'posterior_mean',
	'posterior_sd',
	'evidence_score',
	'evidence_status',
	'eligible_for_production_test',
	'globally_multiple_testing_corrected'
] as const;
const VALIDATED_FIELDS = [
	'present',
	'source',
	'directionality_status',
	'a_to_b_selected',
	'b_to_a_selected',
	'a_to_b_q_value',
	'b_to_a_q_value',
	'a_to_b_q_claim',
	'b_to_a_q_claim',
	'asymmetry_q_value',
	'globally_multiple_testing_corrected'
] as const;

const INTERPRETATION_FIELDS = [
	'dynamic_p_values_are_globally_corrected',
	'absence_from_validated_relationships_means_no_validated_claim_not_no_relationship'
] as const;

function allowlistedComparisonResult(raw: unknown): JsonObject {
	const result = requireObject(raw, 'result');
	const authorA = requireObject(result.author_a, 'author_a');
	const authorB = requireObject(result.author_b, 'author_b');
	const aToB = requireObject(result.a_to_b, 'a_to_b');
	const bToA = requireObject(result.b_to_a, 'b_to_a');
	const validated = requireObject(result.validated_relationship, 'validated_relationship');
	const interpretation = requireObject(result.interpretation, 'interpretation');
	if (
		(aToB.mode !== 'release' && aToB.mode !== 'on_demand') ||
		(bToA.mode !== 'release' && bToA.mode !== 'on_demand') ||
		aToB.mode !== bToA.mode
	) {
		throw new Error('comparison response directions must carry the same valid mode');
	}
	const displayStates = new Set([
		'validated',
		'evidence_threshold_not_met',
		'on_demand_not_formally_validated',
		'not_enough_data'
	]);
	if (
		!displayStates.has(String(aToB.display_state)) ||
		!displayStates.has(String(bToA.display_state))
	) {
		throw new Error('comparison response contains an invalid display state');
	}

	return {
		...allowFields(result, ['schema_version', 'dataset_version', 'method_version']),
		author_a: allowFields(authorA, ['author_id', 'author_name']),
		author_b: allowFields(authorB, ['author_id', 'author_name']),
		a_to_b: allowFields(aToB, METRIC_FIELDS),
		b_to_a: allowFields(bToA, METRIC_FIELDS),
		validated_relationship: allowFields(validated, VALIDATED_FIELDS),
		interpretation: allowFields(interpretation, INTERPRETATION_FIELDS)
	};
}
Deno.serve(async (request: Request) => {
	const origin = request.headers.get('origin');

	if (origin && !allowedOriginSet.has(origin)) {
		return response({ error: 'origin_not_allowed' }, 403, origin);
	}
	if (request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: corsHeaders(origin) });
	}
	if (request.method !== 'POST') {
		return response({ error: 'method_not_allowed' }, 405, origin);
	}

	let payload: {
		author_a_id?: unknown;
		author_b_id?: unknown;
		dataset_version?: unknown;
	};
	try {
		payload = await request.json();
	} catch {
		return response({ error: 'invalid_json' }, 400, origin);
	}

	const authorA = payload.author_a_id;
	const authorB = payload.author_b_id;
	if (
		typeof authorA !== 'number' ||
		typeof authorB !== 'number' ||
		!Number.isSafeInteger(authorA) ||
		!Number.isSafeInteger(authorB) ||
		authorA < 0 ||
		authorB < 0 ||
		authorA > 2_147_483_647 ||
		authorB > 2_147_483_647
	) {
		return response({ error: 'invalid_author_ids' }, 400, origin);
	}
	if (authorA === authorB) {
		return response({ error: 'authors_must_differ' }, 400, origin);
	}

	let datasetVersion = pinnedDatasetVersion;
	if (!datasetVersion && payload.dataset_version != null) {
		if (
			typeof payload.dataset_version !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(payload.dataset_version)
		) {
			return response({ error: 'invalid_dataset_version' }, 400, origin);
		}
		datasetVersion = payload.dataset_version;
	}

	try {
		const rows = await sql`
      select private.compare_authors(
        ${authorA}::integer,
        ${authorB}::integer,
        ${datasetVersion}::text
      ) as result
    `;
		const row = rows[0] as { result?: unknown } | undefined;
		if (!row || !('result' in row)) {
			throw new Error('comparison query returned no result');
		}
		return response(allowlistedComparisonResult(row.result), 200, origin);
	} catch (error) {
		const code =
			typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
		if (code === 'P0002') {
			return response({ error: 'author_or_dataset_not_found' }, 404, origin);
		}
		if (code === '22004' || code === '22023') {
			return response({ error: 'invalid_comparison' }, 400, origin);
		}
		console.error('author comparison failed', { code });
		return response({ error: 'comparison_failed' }, 500, origin);
	}
});
