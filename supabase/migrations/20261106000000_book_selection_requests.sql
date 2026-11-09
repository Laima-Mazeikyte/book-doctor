-- Apply after 001_filtered_recommendations.sql, with recommendation workers stopped.
-- Additive: existing requests/results and general/discovery behavior are preserved.
-- No new tables or model artifacts. Frontend stores selection inputs on requests.
BEGIN;
LOCK TABLE public.recommendation_requests IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.recommendation_requests
    ADD COLUMN request_type text,
    ADD COLUMN book_ids text[],
    ADD CONSTRAINT recommendation_requests_selection_contract CHECK (
        (request_type IS NULL AND book_ids IS NULL)
        OR (request_type IS NOT NULL AND request_type IN ('rank_selection', 'recommend_from_selection')
            AND book_ids IS NOT NULL AND array_ndims(book_ids) = 1
            AND cardinality(book_ids) BETWEEN 4 AND 200 AND filters IS NULL)
    );

-- Prevent editing the meaning of an in-flight or completed request. Edit
-- selection creates a new request; stored submission order is kept unchanged.
CREATE FUNCTION public.validate_recommendation_selection() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.request_type IS NOT NULL OR NEW.request_type IS NOT NULL) AND (
           NEW.request_type IS DISTINCT FROM OLD.request_type
           OR NEW.book_ids IS DISTINCT FROM OLD.book_ids
           OR NEW.filters IS DISTINCT FROM OLD.filters
           OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
            RAISE EXCEPTION 'Request inputs are immutable; create a new request';
        END IF;
    END IF;
    IF NEW.request_type IS NOT NULL AND (
        EXISTS (SELECT 1 FROM unnest(NEW.book_ids) AS b(id)
                WHERE id IS NULL OR id !~ '^[0-9A-HJKMNP-TV-Z]{26}$')
        OR (SELECT count(DISTINCT id) FROM unnest(NEW.book_ids) AS b(id))
            IS DISTINCT FROM cardinality(NEW.book_ids)::bigint
    ) THEN RAISE EXCEPTION 'Selection requires unique canonical catalog book IDs'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER recommendation_selection_inputs
BEFORE INSERT OR UPDATE ON public.recommendation_requests
FOR EACH ROW EXECUTE FUNCTION public.validate_recommendation_selection();
REVOKE ALL ON FUNCTION public.validate_recommendation_selection() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_recommendation_request(
    p_request_id bigint, p_user_id uuid, p_token uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.recommendation_requests%ROWTYPE;
BEGIN
    IF p_token IS NULL THEN RAISE EXCEPTION 'Attempt token required'; END IF;
    SELECT * INTO r FROM public.recommendation_requests
    WHERE id = p_request_id AND user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'missing'); END IF;
    IF r.status = 'completed' THEN
        RETURN jsonb_build_object('state', 'completed', 'result_count', r.result_count);
    END IF;
    IF r.status = 'failed' THEN
        RETURN jsonb_build_object('state', 'failed', 'error_code', r.error_code);
    END IF;
    IF r.status = 'processing' AND r.processing_started_at > now() - interval '15 minutes' THEN
        RETURN jsonb_build_object('state', 'processing');
    END IF;
    UPDATE public.recommendation_requests
    SET status = 'processing', processing_token = p_token, processing_started_at = now(),
        result_count = NULL, error_code = NULL
    WHERE id = p_request_id;
    RETURN jsonb_build_object('state', 'claimed', 'filters', r.filters, 'request_type', r.request_type, 'book_ids', r.book_ids);
END $$;

CREATE OR REPLACE FUNCTION public.complete_recommendation_request(
    p_request_id bigint, p_token uuid, p_items jsonb
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
    SET status = 'completed', result_count = n, error_code = NULL
    WHERE id = p_request_id;
    RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.fail_recommendation_request(
    p_request_id bigint, p_token uuid, p_error_code text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_error_code NOT IN ('invalid_filters', 'invalid_selection', 'recommendation_failed') OR p_error_code IS NULL THEN
        RAISE EXCEPTION 'Invalid error code';
    END IF;
    UPDATE public.recommendation_requests
    SET status = 'failed', error_code = p_error_code, result_count = NULL
    WHERE id = p_request_id AND status = 'processing' AND processing_token = p_token;
END $$;

REVOKE ALL ON FUNCTION public.claim_recommendation_request(bigint,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_recommendation_request(bigint,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_recommendation_request(bigint,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recommendation_request(bigint,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_recommendation_request(bigint,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_recommendation_request(bigint,uuid,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
