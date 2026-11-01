-- Dataset-independent book connections schema/RPC, extracted from the reviewed backend v2 setup.
-- No vectors, active release or model-specific cutoff is bundled here.
-- The shared project already has these definitions; reconcile history before promotion.
-- Backend data packages stage/validate/activate releases separately.

-- Packed-int8 book connections. No pgvector or custom extension required.
-- Reads public.user_ratings(user_id uuid, book_id, book_rating).
BEGIN;
CREATE SCHEMA IF NOT EXISTS book_connections;
REVOKE ALL ON SCHEMA book_connections FROM PUBLIC, anon, authenticated;
DO $version$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'book_connections' AND table_name = 'embeddings'
                 AND column_name = 'book_id' AND udt_name <> 'uuid') THEN
        RAISE EXCEPTION 'Schema v2 requires a fresh installation; migrate the existing v1 dataset separately';
    END IF;
END
$version$;

-- Empty row-shape template; active data lives in one immutable data_<hex> table.
-- Schema v2 is for first deployment; it does not migrate an installed v1 schema.
CREATE TABLE IF NOT EXISTS book_connections.embeddings (
    book_id uuid NOT NULL,
    embedding bytea NOT NULL CHECK (octet_length(embedding) = 128),
    inverse_norm real NOT NULL CHECK (inverse_norm > 0 AND inverse_norm <= 1),
    author_key integer CHECK (author_key >= 0)
);
CREATE TABLE IF NOT EXISTS book_connections.release (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    release_id text NOT NULL,
    table_name name NOT NULL DEFAULT ('data_' || md5(random()::text || clock_timestamp()::text))::name CHECK (table_name::text ~ '^data_[0-9a-f]{32}$'),
    book_count integer NOT NULL CHECK (book_count > 0),
    records_md5 text NOT NULL CHECK (length(records_md5) = 32),
    minimum_similarity double precision NOT NULL
        CHECK (minimum_similarity > 0 AND minimum_similarity <= 1),
    manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
    activated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE book_connections.embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_connections.release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON book_connections.embeddings, book_connections.release FROM PUBLIC, anon, authenticated;

-- Canonical ULID -> the same 128 bits in a uuid. Invalid legacy history IDs
-- become NULL and cannot match an embedding. API IDs stay canonical ULID text.
CREATE OR REPLACE FUNCTION book_connections.storage_book_id(p_id text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = ''
AS $id$
DECLARE digits bytea; hi bigint; lo bigint;
BEGIN
    IF pg_catalog.octet_length(p_id) <> 26 OR p_id !~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$' THEN
        RETURN NULL;
    END IF;
    -- Translate the alphabet once in C, then unpack two words without a
    -- per-character PL/pgSQL loop. Low five bits contain the base32 digit.
    digits := pg_catalog.convert_to(pg_catalog.translate(p_id,
        '0123456789ABCDEFGHJKMNPQRSTVWXYZ', '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_'), 'UTF8');
    hi := ((pg_catalog.get_byte(digits, 0) & 31)::bigint << 61)
        | ((pg_catalog.get_byte(digits, 1) & 31)::bigint << 56)
        | ((pg_catalog.get_byte(digits, 2) & 31)::bigint << 51)
        | ((pg_catalog.get_byte(digits, 3) & 31)::bigint << 46)
        | ((pg_catalog.get_byte(digits, 4) & 31)::bigint << 41)
        | ((pg_catalog.get_byte(digits, 5) & 31)::bigint << 36)
        | ((pg_catalog.get_byte(digits, 6) & 31)::bigint << 31)
        | ((pg_catalog.get_byte(digits, 7) & 31)::bigint << 26)
        | ((pg_catalog.get_byte(digits, 8) & 31)::bigint << 21)
        | ((pg_catalog.get_byte(digits, 9) & 31)::bigint << 16)
        | ((pg_catalog.get_byte(digits, 10) & 31)::bigint << 11)
        | ((pg_catalog.get_byte(digits, 11) & 31)::bigint << 6)
        | ((pg_catalog.get_byte(digits, 12) & 31)::bigint << 1)
        | ((pg_catalog.get_byte(digits, 13) & 31)::bigint >> 4);
    lo := ((pg_catalog.get_byte(digits, 13) & 31)::bigint << 60)
        | ((pg_catalog.get_byte(digits, 14) & 31)::bigint << 55)
        | ((pg_catalog.get_byte(digits, 15) & 31)::bigint << 50)
        | ((pg_catalog.get_byte(digits, 16) & 31)::bigint << 45)
        | ((pg_catalog.get_byte(digits, 17) & 31)::bigint << 40)
        | ((pg_catalog.get_byte(digits, 18) & 31)::bigint << 35)
        | ((pg_catalog.get_byte(digits, 19) & 31)::bigint << 30)
        | ((pg_catalog.get_byte(digits, 20) & 31)::bigint << 25)
        | ((pg_catalog.get_byte(digits, 21) & 31)::bigint << 20)
        | ((pg_catalog.get_byte(digits, 22) & 31)::bigint << 15)
        | ((pg_catalog.get_byte(digits, 23) & 31)::bigint << 10)
        | ((pg_catalog.get_byte(digits, 24) & 31)::bigint << 5)
        | ((pg_catalog.get_byte(digits, 25) & 31)::bigint << 0);
    RETURN (pg_catalog.lpad(pg_catalog.to_hex(hi), 16, '0') || pg_catalog.lpad(pg_catalog.to_hex(lo), 16, '0'))::uuid;
END
$id$;
REVOKE ALL ON FUNCTION book_connections.storage_book_id(text) FROM PUBLIC, anon, authenticated;

-- Unrolled, fully qualified built-ins allow SQL inlining and avoid per-vector
-- generate_series / row aggregation. The helper has no privileged table access.
-- q_i = stored unsigned byte - 128; sum fits a signed int32.
CREATE OR REPLACE FUNCTION book_connections.int8_dot(p_a bytea, p_b bytea)
RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $dot$
    SELECT (pg_catalog.get_byte(p_a, 0) - 128) * (pg_catalog.get_byte(p_b, 0) - 128)
      + (pg_catalog.get_byte(p_a, 1) - 128) * (pg_catalog.get_byte(p_b, 1) - 128)
      + (pg_catalog.get_byte(p_a, 2) - 128) * (pg_catalog.get_byte(p_b, 2) - 128)
      + (pg_catalog.get_byte(p_a, 3) - 128) * (pg_catalog.get_byte(p_b, 3) - 128)
      + (pg_catalog.get_byte(p_a, 4) - 128) * (pg_catalog.get_byte(p_b, 4) - 128)
      + (pg_catalog.get_byte(p_a, 5) - 128) * (pg_catalog.get_byte(p_b, 5) - 128)
      + (pg_catalog.get_byte(p_a, 6) - 128) * (pg_catalog.get_byte(p_b, 6) - 128)
      + (pg_catalog.get_byte(p_a, 7) - 128) * (pg_catalog.get_byte(p_b, 7) - 128)
      + (pg_catalog.get_byte(p_a, 8) - 128) * (pg_catalog.get_byte(p_b, 8) - 128)
      + (pg_catalog.get_byte(p_a, 9) - 128) * (pg_catalog.get_byte(p_b, 9) - 128)
      + (pg_catalog.get_byte(p_a, 10) - 128) * (pg_catalog.get_byte(p_b, 10) - 128)
      + (pg_catalog.get_byte(p_a, 11) - 128) * (pg_catalog.get_byte(p_b, 11) - 128)
      + (pg_catalog.get_byte(p_a, 12) - 128) * (pg_catalog.get_byte(p_b, 12) - 128)
      + (pg_catalog.get_byte(p_a, 13) - 128) * (pg_catalog.get_byte(p_b, 13) - 128)
      + (pg_catalog.get_byte(p_a, 14) - 128) * (pg_catalog.get_byte(p_b, 14) - 128)
      + (pg_catalog.get_byte(p_a, 15) - 128) * (pg_catalog.get_byte(p_b, 15) - 128)
      + (pg_catalog.get_byte(p_a, 16) - 128) * (pg_catalog.get_byte(p_b, 16) - 128)
      + (pg_catalog.get_byte(p_a, 17) - 128) * (pg_catalog.get_byte(p_b, 17) - 128)
      + (pg_catalog.get_byte(p_a, 18) - 128) * (pg_catalog.get_byte(p_b, 18) - 128)
      + (pg_catalog.get_byte(p_a, 19) - 128) * (pg_catalog.get_byte(p_b, 19) - 128)
      + (pg_catalog.get_byte(p_a, 20) - 128) * (pg_catalog.get_byte(p_b, 20) - 128)
      + (pg_catalog.get_byte(p_a, 21) - 128) * (pg_catalog.get_byte(p_b, 21) - 128)
      + (pg_catalog.get_byte(p_a, 22) - 128) * (pg_catalog.get_byte(p_b, 22) - 128)
      + (pg_catalog.get_byte(p_a, 23) - 128) * (pg_catalog.get_byte(p_b, 23) - 128)
      + (pg_catalog.get_byte(p_a, 24) - 128) * (pg_catalog.get_byte(p_b, 24) - 128)
      + (pg_catalog.get_byte(p_a, 25) - 128) * (pg_catalog.get_byte(p_b, 25) - 128)
      + (pg_catalog.get_byte(p_a, 26) - 128) * (pg_catalog.get_byte(p_b, 26) - 128)
      + (pg_catalog.get_byte(p_a, 27) - 128) * (pg_catalog.get_byte(p_b, 27) - 128)
      + (pg_catalog.get_byte(p_a, 28) - 128) * (pg_catalog.get_byte(p_b, 28) - 128)
      + (pg_catalog.get_byte(p_a, 29) - 128) * (pg_catalog.get_byte(p_b, 29) - 128)
      + (pg_catalog.get_byte(p_a, 30) - 128) * (pg_catalog.get_byte(p_b, 30) - 128)
      + (pg_catalog.get_byte(p_a, 31) - 128) * (pg_catalog.get_byte(p_b, 31) - 128)
      + (pg_catalog.get_byte(p_a, 32) - 128) * (pg_catalog.get_byte(p_b, 32) - 128)
      + (pg_catalog.get_byte(p_a, 33) - 128) * (pg_catalog.get_byte(p_b, 33) - 128)
      + (pg_catalog.get_byte(p_a, 34) - 128) * (pg_catalog.get_byte(p_b, 34) - 128)
      + (pg_catalog.get_byte(p_a, 35) - 128) * (pg_catalog.get_byte(p_b, 35) - 128)
      + (pg_catalog.get_byte(p_a, 36) - 128) * (pg_catalog.get_byte(p_b, 36) - 128)
      + (pg_catalog.get_byte(p_a, 37) - 128) * (pg_catalog.get_byte(p_b, 37) - 128)
      + (pg_catalog.get_byte(p_a, 38) - 128) * (pg_catalog.get_byte(p_b, 38) - 128)
      + (pg_catalog.get_byte(p_a, 39) - 128) * (pg_catalog.get_byte(p_b, 39) - 128)
      + (pg_catalog.get_byte(p_a, 40) - 128) * (pg_catalog.get_byte(p_b, 40) - 128)
      + (pg_catalog.get_byte(p_a, 41) - 128) * (pg_catalog.get_byte(p_b, 41) - 128)
      + (pg_catalog.get_byte(p_a, 42) - 128) * (pg_catalog.get_byte(p_b, 42) - 128)
      + (pg_catalog.get_byte(p_a, 43) - 128) * (pg_catalog.get_byte(p_b, 43) - 128)
      + (pg_catalog.get_byte(p_a, 44) - 128) * (pg_catalog.get_byte(p_b, 44) - 128)
      + (pg_catalog.get_byte(p_a, 45) - 128) * (pg_catalog.get_byte(p_b, 45) - 128)
      + (pg_catalog.get_byte(p_a, 46) - 128) * (pg_catalog.get_byte(p_b, 46) - 128)
      + (pg_catalog.get_byte(p_a, 47) - 128) * (pg_catalog.get_byte(p_b, 47) - 128)
      + (pg_catalog.get_byte(p_a, 48) - 128) * (pg_catalog.get_byte(p_b, 48) - 128)
      + (pg_catalog.get_byte(p_a, 49) - 128) * (pg_catalog.get_byte(p_b, 49) - 128)
      + (pg_catalog.get_byte(p_a, 50) - 128) * (pg_catalog.get_byte(p_b, 50) - 128)
      + (pg_catalog.get_byte(p_a, 51) - 128) * (pg_catalog.get_byte(p_b, 51) - 128)
      + (pg_catalog.get_byte(p_a, 52) - 128) * (pg_catalog.get_byte(p_b, 52) - 128)
      + (pg_catalog.get_byte(p_a, 53) - 128) * (pg_catalog.get_byte(p_b, 53) - 128)
      + (pg_catalog.get_byte(p_a, 54) - 128) * (pg_catalog.get_byte(p_b, 54) - 128)
      + (pg_catalog.get_byte(p_a, 55) - 128) * (pg_catalog.get_byte(p_b, 55) - 128)
      + (pg_catalog.get_byte(p_a, 56) - 128) * (pg_catalog.get_byte(p_b, 56) - 128)
      + (pg_catalog.get_byte(p_a, 57) - 128) * (pg_catalog.get_byte(p_b, 57) - 128)
      + (pg_catalog.get_byte(p_a, 58) - 128) * (pg_catalog.get_byte(p_b, 58) - 128)
      + (pg_catalog.get_byte(p_a, 59) - 128) * (pg_catalog.get_byte(p_b, 59) - 128)
      + (pg_catalog.get_byte(p_a, 60) - 128) * (pg_catalog.get_byte(p_b, 60) - 128)
      + (pg_catalog.get_byte(p_a, 61) - 128) * (pg_catalog.get_byte(p_b, 61) - 128)
      + (pg_catalog.get_byte(p_a, 62) - 128) * (pg_catalog.get_byte(p_b, 62) - 128)
      + (pg_catalog.get_byte(p_a, 63) - 128) * (pg_catalog.get_byte(p_b, 63) - 128)
      + (pg_catalog.get_byte(p_a, 64) - 128) * (pg_catalog.get_byte(p_b, 64) - 128)
      + (pg_catalog.get_byte(p_a, 65) - 128) * (pg_catalog.get_byte(p_b, 65) - 128)
      + (pg_catalog.get_byte(p_a, 66) - 128) * (pg_catalog.get_byte(p_b, 66) - 128)
      + (pg_catalog.get_byte(p_a, 67) - 128) * (pg_catalog.get_byte(p_b, 67) - 128)
      + (pg_catalog.get_byte(p_a, 68) - 128) * (pg_catalog.get_byte(p_b, 68) - 128)
      + (pg_catalog.get_byte(p_a, 69) - 128) * (pg_catalog.get_byte(p_b, 69) - 128)
      + (pg_catalog.get_byte(p_a, 70) - 128) * (pg_catalog.get_byte(p_b, 70) - 128)
      + (pg_catalog.get_byte(p_a, 71) - 128) * (pg_catalog.get_byte(p_b, 71) - 128)
      + (pg_catalog.get_byte(p_a, 72) - 128) * (pg_catalog.get_byte(p_b, 72) - 128)
      + (pg_catalog.get_byte(p_a, 73) - 128) * (pg_catalog.get_byte(p_b, 73) - 128)
      + (pg_catalog.get_byte(p_a, 74) - 128) * (pg_catalog.get_byte(p_b, 74) - 128)
      + (pg_catalog.get_byte(p_a, 75) - 128) * (pg_catalog.get_byte(p_b, 75) - 128)
      + (pg_catalog.get_byte(p_a, 76) - 128) * (pg_catalog.get_byte(p_b, 76) - 128)
      + (pg_catalog.get_byte(p_a, 77) - 128) * (pg_catalog.get_byte(p_b, 77) - 128)
      + (pg_catalog.get_byte(p_a, 78) - 128) * (pg_catalog.get_byte(p_b, 78) - 128)
      + (pg_catalog.get_byte(p_a, 79) - 128) * (pg_catalog.get_byte(p_b, 79) - 128)
      + (pg_catalog.get_byte(p_a, 80) - 128) * (pg_catalog.get_byte(p_b, 80) - 128)
      + (pg_catalog.get_byte(p_a, 81) - 128) * (pg_catalog.get_byte(p_b, 81) - 128)
      + (pg_catalog.get_byte(p_a, 82) - 128) * (pg_catalog.get_byte(p_b, 82) - 128)
      + (pg_catalog.get_byte(p_a, 83) - 128) * (pg_catalog.get_byte(p_b, 83) - 128)
      + (pg_catalog.get_byte(p_a, 84) - 128) * (pg_catalog.get_byte(p_b, 84) - 128)
      + (pg_catalog.get_byte(p_a, 85) - 128) * (pg_catalog.get_byte(p_b, 85) - 128)
      + (pg_catalog.get_byte(p_a, 86) - 128) * (pg_catalog.get_byte(p_b, 86) - 128)
      + (pg_catalog.get_byte(p_a, 87) - 128) * (pg_catalog.get_byte(p_b, 87) - 128)
      + (pg_catalog.get_byte(p_a, 88) - 128) * (pg_catalog.get_byte(p_b, 88) - 128)
      + (pg_catalog.get_byte(p_a, 89) - 128) * (pg_catalog.get_byte(p_b, 89) - 128)
      + (pg_catalog.get_byte(p_a, 90) - 128) * (pg_catalog.get_byte(p_b, 90) - 128)
      + (pg_catalog.get_byte(p_a, 91) - 128) * (pg_catalog.get_byte(p_b, 91) - 128)
      + (pg_catalog.get_byte(p_a, 92) - 128) * (pg_catalog.get_byte(p_b, 92) - 128)
      + (pg_catalog.get_byte(p_a, 93) - 128) * (pg_catalog.get_byte(p_b, 93) - 128)
      + (pg_catalog.get_byte(p_a, 94) - 128) * (pg_catalog.get_byte(p_b, 94) - 128)
      + (pg_catalog.get_byte(p_a, 95) - 128) * (pg_catalog.get_byte(p_b, 95) - 128)
      + (pg_catalog.get_byte(p_a, 96) - 128) * (pg_catalog.get_byte(p_b, 96) - 128)
      + (pg_catalog.get_byte(p_a, 97) - 128) * (pg_catalog.get_byte(p_b, 97) - 128)
      + (pg_catalog.get_byte(p_a, 98) - 128) * (pg_catalog.get_byte(p_b, 98) - 128)
      + (pg_catalog.get_byte(p_a, 99) - 128) * (pg_catalog.get_byte(p_b, 99) - 128)
      + (pg_catalog.get_byte(p_a, 100) - 128) * (pg_catalog.get_byte(p_b, 100) - 128)
      + (pg_catalog.get_byte(p_a, 101) - 128) * (pg_catalog.get_byte(p_b, 101) - 128)
      + (pg_catalog.get_byte(p_a, 102) - 128) * (pg_catalog.get_byte(p_b, 102) - 128)
      + (pg_catalog.get_byte(p_a, 103) - 128) * (pg_catalog.get_byte(p_b, 103) - 128)
      + (pg_catalog.get_byte(p_a, 104) - 128) * (pg_catalog.get_byte(p_b, 104) - 128)
      + (pg_catalog.get_byte(p_a, 105) - 128) * (pg_catalog.get_byte(p_b, 105) - 128)
      + (pg_catalog.get_byte(p_a, 106) - 128) * (pg_catalog.get_byte(p_b, 106) - 128)
      + (pg_catalog.get_byte(p_a, 107) - 128) * (pg_catalog.get_byte(p_b, 107) - 128)
      + (pg_catalog.get_byte(p_a, 108) - 128) * (pg_catalog.get_byte(p_b, 108) - 128)
      + (pg_catalog.get_byte(p_a, 109) - 128) * (pg_catalog.get_byte(p_b, 109) - 128)
      + (pg_catalog.get_byte(p_a, 110) - 128) * (pg_catalog.get_byte(p_b, 110) - 128)
      + (pg_catalog.get_byte(p_a, 111) - 128) * (pg_catalog.get_byte(p_b, 111) - 128)
      + (pg_catalog.get_byte(p_a, 112) - 128) * (pg_catalog.get_byte(p_b, 112) - 128)
      + (pg_catalog.get_byte(p_a, 113) - 128) * (pg_catalog.get_byte(p_b, 113) - 128)
      + (pg_catalog.get_byte(p_a, 114) - 128) * (pg_catalog.get_byte(p_b, 114) - 128)
      + (pg_catalog.get_byte(p_a, 115) - 128) * (pg_catalog.get_byte(p_b, 115) - 128)
      + (pg_catalog.get_byte(p_a, 116) - 128) * (pg_catalog.get_byte(p_b, 116) - 128)
      + (pg_catalog.get_byte(p_a, 117) - 128) * (pg_catalog.get_byte(p_b, 117) - 128)
      + (pg_catalog.get_byte(p_a, 118) - 128) * (pg_catalog.get_byte(p_b, 118) - 128)
      + (pg_catalog.get_byte(p_a, 119) - 128) * (pg_catalog.get_byte(p_b, 119) - 128)
      + (pg_catalog.get_byte(p_a, 120) - 128) * (pg_catalog.get_byte(p_b, 120) - 128)
      + (pg_catalog.get_byte(p_a, 121) - 128) * (pg_catalog.get_byte(p_b, 121) - 128)
      + (pg_catalog.get_byte(p_a, 122) - 128) * (pg_catalog.get_byte(p_b, 122) - 128)
      + (pg_catalog.get_byte(p_a, 123) - 128) * (pg_catalog.get_byte(p_b, 123) - 128)
      + (pg_catalog.get_byte(p_a, 124) - 128) * (pg_catalog.get_byte(p_b, 124) - 128)
      + (pg_catalog.get_byte(p_a, 125) - 128) * (pg_catalog.get_byte(p_b, 125) - 128)
      + (pg_catalog.get_byte(p_a, 126) - 128) * (pg_catalog.get_byte(p_b, 126) - 128)
      + (pg_catalog.get_byte(p_a, 127) - 128) * (pg_catalog.get_byte(p_b, 127) - 128)
$dot$;
REVOKE ALL ON FUNCTION book_connections.int8_dot(bytea, bytea)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_book_connections(
    p_book_id text, p_limit integer DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $rpc$
DECLARE
    v_user_id uuid := auth.uid();
    v_release book_connections.release%ROWTYPE;
    v_target book_connections.embeddings%ROWTYPE;
    v_connections jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
    END IF;
    IF p_book_id IS NULL OR p_book_id = '' OR p_limit IS NULL OR p_limit < 1 OR p_limit > 3 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A book ID and limit between 1 and 3 are required';
    END IF;
    -- Readers share this row lock for their transaction. Activation takes a
    -- conflicting table lock only after loading/indexing the new private table.
    -- VOLATILE gives the following statements a fresh READ COMMITTED snapshot
    -- after waiting for activation; FOR SHARE rejects stale repeatable-read
    -- snapshots with a serialization error rather than using a retired table.
    SELECT * INTO v_release FROM book_connections.release WHERE singleton FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Book connections release is not loaded';
    END IF;
    EXECUTE pg_catalog.format('SELECT * FROM book_connections.%I WHERE book_id = $1', v_release.table_name)
        INTO v_target USING book_connections.storage_book_id(p_book_id);
    IF v_target.book_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('book_id', p_book_id,
            'release_id', v_release.release_id, 'status', 'target_unavailable',
            'connections', '[]'::jsonb);
    END IF;

    EXECUTE pg_catalog.format($query$
    WITH history AS MATERIALIZED (
        SELECT r.book_id::text AS book_id,
               max(r.book_rating::double precision) AS rating
        FROM public.user_ratings r
        WHERE r.user_id = $1
          AND r.book_rating::double precision BETWEEN 1 AND 5
          AND r.book_id::text <> $2
        GROUP BY r.book_id::text
    ), scored AS MATERIALIZED (
        SELECT h.book_id, h.rating, e.author_key,
            greatest(-1.0, least(1.0,
                book_connections.int8_dot(e.embedding, $3)::double precision
                * e.inverse_norm::double precision
                * $4::double precision
            )) AS similarity
        FROM history h
        JOIN book_connections.%I e ON e.book_id = book_connections.storage_book_id(h.book_id)
        WHERE e.author_key IS NOT NULL
    ), best_per_author AS (
        SELECT DISTINCT ON (author_key) book_id, rating, similarity
        FROM scored WHERE similarity >= $5
        ORDER BY author_key, similarity DESC, book_id COLLATE "C"
    ), selected AS (
        SELECT * FROM best_per_author
        ORDER BY similarity DESC, book_id COLLATE "C" LIMIT $6
    )
    SELECT coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('book_id', book_id,
                                     'similarity', similarity, 'rating', rating)
        ORDER BY similarity DESC, book_id COLLATE "C"
    ), '[]'::jsonb) FROM selected
    $query$, v_release.table_name) INTO v_connections
        USING v_user_id, p_book_id, v_target.embedding, v_target.inverse_norm,
              v_release.minimum_similarity, p_limit;

    RETURN pg_catalog.jsonb_build_object(
        'book_id', p_book_id, 'release_id', v_release.release_id,
        'minimum_similarity', v_release.minimum_similarity,
        'status', 'computed', 'connections', v_connections);
END
$rpc$;
REVOKE ALL ON FUNCTION public.get_book_connections(text, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_book_connections(text, integer) TO authenticated;
COMMENT ON FUNCTION public.get_book_connections(text, integer) IS
    'Exact packed-int8 cosine over the authenticated reader''s raw ratings. All stars included; no result cache. Shared release lock protects activation.';
COMMIT;
