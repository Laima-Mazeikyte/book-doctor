-- Apply once AFTER 004, with recommendation workers stopped; deploy updated workers.
-- Preserve original inputs; record skipped unsupported IDs atomically with outcomes.
-- Existing three-argument RPC calls continue to work via default arguments.
BEGIN;
LOCK TABLE public.recommendation_requests IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.recommendation_requests
    ADD COLUMN skipped_book_ids text[] NOT NULL DEFAULT '{}'::text[],
    ADD CONSTRAINT recommendation_requests_skipped_selection CHECK (
        cardinality(skipped_book_ids) = 0 OR (
            request_type IS NOT NULL AND book_ids IS NOT NULL
            AND skipped_book_ids <@ book_ids AND status IN ('completed', 'failed')
        )
    );

-- Remove old signatures so PostgREST sees a single unambiguous RPC per name.
DROP FUNCTION public.complete_recommendation_request(bigint, uuid, jsonb);
DROP FUNCTION public.fail_recommendation_request(bigint, uuid, text);

CREATE FUNCTION public.complete_recommendation_request(
    p_request_id bigint, p_token uuid, p_items jsonb,
    p_skipped_book_ids text[] DEFAULT '{}'::text[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.recommendation_requests%ROWTYPE; n integer;
BEGIN
    SELECT * INTO r FROM public.recommendation_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown request'; END IF;
    IF r.status = 'completed' AND r.processing_token = p_token THEN RETURN r.result_count; END IF;
    IF r.status IS DISTINCT FROM 'processing' OR p_token IS NULL
       OR r.processing_token IS DISTINCT FROM p_token THEN
        RAISE EXCEPTION 'Stale recommendation attempt';
    END IF;
    IF p_skipped_book_ids IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_skipped_book_ids) AS x(id) WHERE id IS NULL
    ) OR cardinality(p_skipped_book_ids) IS DISTINCT FROM (
        SELECT count(DISTINCT id)::integer FROM unnest(p_skipped_book_ids) AS x(id)
    ) OR (cardinality(p_skipped_book_ids) > 0 AND (
        r.request_type IS NULL OR NOT (p_skipped_book_ids <@ r.book_ids)
    )) THEN RAISE EXCEPTION 'Invalid skipped selection IDs'; END IF;
    IF r.request_type IS NOT NULL AND cardinality(p_skipped_book_ids) >= cardinality(r.book_ids) THEN
        RAISE EXCEPTION 'Selection has no usable books';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'Items must be an array';
    END IF;
    n := jsonb_array_length(p_items);
    IF n > 10 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(item, position)
        WHERE jsonb_typeof(item) <> 'object' OR nullif(item->>'book_id', '') IS NULL
           OR (item->>'rank')::integer IS DISTINCT FROM position::integer
    ) THEN RAISE EXCEPTION 'Invalid recommendation items'; END IF;

    IF r.request_type = 'rank_selection' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) x(item)
        WHERE NOT (item->>'book_id' = ANY(r.book_ids))
           OR item->>'book_id' = ANY(p_skipped_book_ids)
    ) THEN RAISE EXCEPTION 'Result outside submitted selection'; END IF;
    IF r.request_type = 'recommend_from_selection' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) x(item)
        WHERE item->>'book_id' = ANY(r.book_ids)
    ) THEN RAISE EXCEPTION 'Selection seed returned as recommendation'; END IF;

    DELETE FROM public.recommendation_items WHERE request_id = p_request_id::text;
    INSERT INTO public.recommendation_items (
        request_id, user_id, book_id, rank, score,
        liked_book_precedent_ids, author_relationship_evidence, dimension_matches
    )
    SELECT p_request_id::text, r.user_id, item->>'book_id', (item->>'rank')::integer,
        (item->>'score')::double precision,
        ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'liked_book_precedent_ids', '[]'::jsonb))),
        coalesce(item->'author_relationship_evidence', '[]'::jsonb),
        coalesce(item->'dimension_matches', '[]'::jsonb)
    FROM jsonb_array_elements(p_items) AS x(item);

    UPDATE public.recommendation_requests
    SET status = 'completed', result_count = n, error_code = NULL,
        skipped_book_ids = p_skipped_book_ids
    WHERE id = p_request_id;
    RETURN n;
END $$;

CREATE FUNCTION public.fail_recommendation_request(
    p_request_id bigint, p_token uuid, p_error_code text,
    p_skipped_book_ids text[] DEFAULT '{}'::text[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.recommendation_requests%ROWTYPE;
BEGIN
    IF p_error_code NOT IN ('invalid_filters', 'invalid_selection', 'no_usable_selection', 'recommendation_failed')
       OR p_error_code IS NULL THEN RAISE EXCEPTION 'Invalid error code'; END IF;
    SELECT * INTO r FROM public.recommendation_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND OR r.status IS DISTINCT FROM 'processing' OR p_token IS NULL
       OR r.processing_token IS DISTINCT FROM p_token THEN RETURN; END IF;
    IF p_skipped_book_ids IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_skipped_book_ids) AS x(id) WHERE id IS NULL
    ) OR cardinality(p_skipped_book_ids) IS DISTINCT FROM (
        SELECT count(DISTINCT id)::integer FROM unnest(p_skipped_book_ids) AS x(id)
    ) OR (cardinality(p_skipped_book_ids) > 0 AND (
        r.request_type IS NULL OR NOT (p_skipped_book_ids <@ r.book_ids)
    )) THEN RAISE EXCEPTION 'Invalid skipped selection IDs'; END IF;
    IF p_error_code = 'no_usable_selection' AND (
        r.request_type IS NULL OR cardinality(p_skipped_book_ids) <> cardinality(r.book_ids)
    ) THEN RAISE EXCEPTION 'No-usable-selection requires all submitted IDs'; END IF;
    UPDATE public.recommendation_requests
    SET status = 'failed', error_code = p_error_code, result_count = NULL,
        skipped_book_ids = p_skipped_book_ids
    WHERE id = p_request_id;
END $$;

REVOKE ALL ON FUNCTION public.complete_recommendation_request(bigint,uuid,jsonb,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_recommendation_request(bigint,uuid,text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_recommendation_request(bigint,uuid,jsonb,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_recommendation_request(bigint,uuid,text,text[]) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
