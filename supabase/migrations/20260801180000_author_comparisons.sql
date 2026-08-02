-- Canonical private on-demand author comparison backend.
-- Run this migration before loading a generated comparison_backend version.

create schema if not exists extensions;
create extension if not exists intarray with schema extensions;
create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.author_comparison_datasets (
    dataset_version text primary key,
    method_version text not null,
    source_author_graph_version text not null,
    source_handoff_version text not null,
    author_count integer not null check (author_count > 0),
    reader_count integer not null check (reader_count >= 0),
    tau_squared double precision not null check (tau_squared >= 0),
    min_test_books integer not null check (min_test_books >= 1),
    min_pair_information double precision not null check (min_pair_information >= 0),
    min_source_like_users integer not null check (min_source_like_users >= 0),
    min_target_clear_users integer not null check (min_target_clear_users >= 0),
    min_target_like_users integer not null check (min_target_like_users >= 0),
    min_target_dislike_users integer not null check (min_target_dislike_users >= 0),
    complete_corpus boolean not null,
    is_active boolean not null default false,
    loaded_at timestamptz not null default now(),
    check (not is_active or complete_corpus)
);

create unique index if not exists author_comparison_one_active_dataset
    on private.author_comparison_datasets (is_active)
    where is_active;

create table if not exists private.author_reaction_sets (
    dataset_version text not null references private.author_comparison_datasets(dataset_version)
        on delete cascade,
    author_id integer not null check (author_id >= 0),
    author_name text not null,
    book_count integer not null check (book_count >= 0),
    like_count integer not null check (like_count >= 0),
    dislike_count integer not null check (dislike_count >= 0),
    like_reader_ids integer[] not null,
    dislike_reader_ids integer[] not null,
    primary key (dataset_version, author_id),
    check (like_count = cardinality(like_reader_ids)),
    check (dislike_count = cardinality(dislike_reader_ids)),
    check (array_position(like_reader_ids, null) is null),
    check (array_position(dislike_reader_ids, null) is null)
);

comment on table private.author_reaction_sets is
    'Server-private clean-opinion sets. Reader integers are dataset-local and must never be returned by an API.';

create table if not exists private.validated_author_comparisons (
    dataset_version text not null references private.author_comparison_datasets(dataset_version)
        on delete cascade,
    author_a_id integer not null,
    author_b_id integer not null,
    a_to_b_selected boolean not null,
    b_to_a_selected boolean not null,
    a_to_b_q_value double precision,
    b_to_a_q_value double precision,
    a_to_b_q_claim double precision,
    b_to_a_q_claim double precision,
    asymmetry_q_value double precision,
    directionality_status text not null check (
        directionality_status in (
            'unresolved',
            'reciprocal',
            'reliably_one_sided_a_to_b',
            'reliably_one_sided_b_to_a',
            'opposing'
        )
    ),
    primary key (dataset_version, author_a_id, author_b_id),
    check (author_a_id < author_b_id)
);

create table if not exists private.author_comparison_cache (
    dataset_version text not null references private.author_comparison_datasets(dataset_version)
        on delete cascade,
    author_low_id integer not null,
    author_high_id integer not null,
    like_like_count integer not null check (like_like_count >= 0),
    low_like_high_dislike_count integer not null
        check (low_like_high_dislike_count >= 0),
    low_dislike_high_like_count integer not null
        check (low_dislike_high_like_count >= 0),
    computed_at timestamptz not null default now(),
    primary key (dataset_version, author_low_id, author_high_id),
    check (author_low_id < author_high_id)
);

alter table private.author_comparison_datasets enable row level security;
alter table private.author_reaction_sets enable row level security;
alter table private.validated_author_comparisons enable row level security;
alter table private.author_comparison_cache enable row level security;

revoke all on all tables in schema private from public, anon, authenticated;

create or replace function private.normal_upper_tail_abs(p_z double precision)
returns double precision
language sql
immutable
strict
set search_path = ''
as $function$
    with value as (
        select abs(p_z) as x
    ), terms as (
        select
            x,
            1.0 / (1.0 + 0.2316419 * x) as t,
            exp(-0.5 * x * x) / sqrt(2.0 * pi()) as density
        from value
    )
    select case
        when x >= 38.0 then 0.0
        else density * t * (
            0.319381530
            + t * (
                -0.356563782
                + t * (
                    1.781477937
                    + t * (-1.821255978 + t * 1.330274429)
                )
            )
        )
    end
    from terms
$function$;

comment on function private.normal_upper_tail_abs(double precision) is
    'Normal upper-tail approximation for |z|; maximum absolute error is approximately 7.5e-8.';

create or replace function private.author_direction_metrics(
    p_a integer,
    p_b integer,
    p_c integer,
    p_d integer,
    p_source_book_count integer,
    p_source_like_count integer,
    p_target_book_count integer,
    p_target_like_count integer,
    p_target_dislike_count integer,
    p_tau_squared double precision,
    p_min_test_books integer,
    p_min_pair_information double precision,
    p_min_source_like_users integer,
    p_min_target_clear_users integer,
    p_min_target_like_users integer,
    p_min_target_dislike_users integer
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
    v_z95 constant double precision := 1.959963984540054;
    v_exposed integer := p_a + p_b;
    v_comparison integer := p_c + p_d;
    v_target_clear integer := p_target_like_count + p_target_dislike_count;
    v_total integer := p_a + p_b + p_c + p_d;
    v_theta double precision;
    v_se double precision;
    v_p double precision;
    v_rate_difference double precision;
    v_rd_se double precision;
    v_like_rate double precision;
    v_baseline_rate double precision;
    v_pair_information double precision := 0.0;
    v_ea double precision;
    v_eb double precision;
    v_ec double precision;
    v_ed double precision;
    v_posterior_mean double precision;
    v_posterior_sd double precision;
    v_evidence_score double precision;
    v_author_gate boolean;
    v_eligible boolean;
    v_status text;
begin
    v_theta := ln(
        ((p_a + 0.5) * (p_d + 0.5))
        / ((p_b + 0.5) * (p_c + 0.5))
    );
    v_se := sqrt(
        1.0 / (p_a + 0.5)
        + 1.0 / (p_b + 0.5)
        + 1.0 / (p_c + 0.5)
        + 1.0 / (p_d + 0.5)
    );
    v_p := least(1.0, 2.0 * private.normal_upper_tail_abs(v_theta / v_se));

    if v_exposed > 0 and v_comparison > 0 then
        v_like_rate := p_a::double precision / v_exposed;
        v_baseline_rate := p_c::double precision / v_comparison;
        v_rate_difference := v_like_rate - v_baseline_rate;
        v_rd_se := sqrt(
            v_like_rate * (1.0 - v_like_rate) / v_exposed
            + v_baseline_rate * (1.0 - v_baseline_rate) / v_comparison
        );
    end if;

    if v_total > 0 and v_exposed > 0 and v_comparison > 0
       and p_target_like_count > 0 and p_target_dislike_count > 0 then
        v_ea := v_exposed::double precision * p_target_like_count / v_total;
        v_eb := v_exposed::double precision * p_target_dislike_count / v_total;
        v_ec := v_comparison::double precision * p_target_like_count / v_total;
        v_ed := v_comparison::double precision * p_target_dislike_count / v_total;
        v_pair_information := 1.0 / (
            1.0 / v_ea + 1.0 / v_eb + 1.0 / v_ec + 1.0 / v_ed
        );
    end if;

    if p_tau_squared > 0 then
        v_posterior_mean := v_theta * p_tau_squared / (p_tau_squared + v_se * v_se);
        v_posterior_sd := sqrt(
            p_tau_squared * v_se * v_se / (p_tau_squared + v_se * v_se)
        );
        v_evidence_score := greatest(
            0.0,
            abs(v_posterior_mean) - v_z95 * v_posterior_sd
        );
    else
        v_posterior_mean := 0.0;
        v_posterior_sd := 0.0;
        v_evidence_score := 0.0;
    end if;

    v_author_gate := (
        p_source_book_count >= p_min_test_books
        and p_source_like_count >= p_min_source_like_users
        and p_target_book_count >= p_min_test_books
        and v_target_clear >= p_min_target_clear_users
        and p_target_like_count >= p_min_target_like_users
        and p_target_dislike_count >= p_min_target_dislike_users
    );
    v_eligible := (
        v_exposed > 0
        and v_comparison > 0
        and v_author_gate
        and v_pair_information >= p_min_pair_information
    );
    v_status := case
        when v_exposed = 0 or v_comparison = 0 then 'no_comparable_readers'
        when not v_author_gate then 'below_author_thresholds'
        when v_pair_information < p_min_pair_information then 'below_pair_information'
        else 'eligible_unadjusted'
    end;

    return jsonb_build_object(
        'like_rate', v_like_rate,
        'baseline_rate', v_baseline_rate,
        'rate_difference', v_rate_difference,
        'rate_difference_standard_error', v_rd_se,
        'rate_difference_ci_lower',
            case when v_rd_se is null then null else v_rate_difference - v_z95 * v_rd_se end,
        'rate_difference_ci_upper',
            case when v_rd_se is null then null else v_rate_difference + v_z95 * v_rd_se end,
        'log_odds_ratio', v_theta,
        'standard_error', v_se,
        'ci_lower', v_theta - v_z95 * v_se,
        'ci_upper', v_theta + v_z95 * v_se,
        'p_value', v_p,
        'q_value', null,
        'posterior_mean', v_posterior_mean,
        'posterior_sd', v_posterior_sd,
        'evidence_score', v_evidence_score,
        'evidence_status', v_status,
        'eligible_for_production_test', v_eligible,
        'globally_multiple_testing_corrected', false
    );
end
$function$;

create or replace function private.compare_authors(
    p_author_a_id integer,
    p_author_b_id integer,
    p_dataset_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_dataset private.author_comparison_datasets%rowtype;
    v_author_a private.author_reaction_sets%rowtype;
    v_author_b private.author_reaction_sets%rowtype;
    v_low private.author_reaction_sets%rowtype;
    v_high private.author_reaction_sets%rowtype;
    v_cache private.author_comparison_cache%rowtype;
    v_validated private.validated_author_comparisons%rowtype;
    v_low_id integer := least(p_author_a_id, p_author_b_id);
    v_high_id integer := greatest(p_author_a_id, p_author_b_id);
    v_ll integer;
    v_ld integer;
    v_dl integer;
    v_cache_hit boolean;
    v_orientation_matches boolean := p_author_a_id < p_author_b_id;
    v_directionality_status text;
    v_validated_json jsonb;
begin
    if p_author_a_id is null or p_author_b_id is null then
        raise exception using errcode = '22004', message = 'both author IDs are required';
    end if;
    if p_author_a_id = p_author_b_id then
        raise exception using errcode = '22023', message = 'choose two different authors';
    end if;

    if p_dataset_version is null then
        select *
        into v_dataset
        from private.author_comparison_datasets
        where is_active;
    else
        select *
        into v_dataset
        from private.author_comparison_datasets
        where dataset_version = p_dataset_version;
    end if;
    if not found then
        raise exception using errcode = 'P0002', message = 'comparison dataset not found';
    end if;

    select * into v_author_a
    from private.author_reaction_sets
    where dataset_version = v_dataset.dataset_version and author_id = p_author_a_id;
    if not found then
        raise exception using errcode = 'P0002', message = 'first author not found';
    end if;
    select * into v_author_b
    from private.author_reaction_sets
    where dataset_version = v_dataset.dataset_version and author_id = p_author_b_id;
    if not found then
        raise exception using errcode = 'P0002', message = 'second author not found';
    end if;

    if v_orientation_matches then
        v_low := v_author_a;
        v_high := v_author_b;
    else
        v_low := v_author_b;
        v_high := v_author_a;
    end if;

    select * into v_cache
    from private.author_comparison_cache
    where dataset_version = v_dataset.dataset_version
      and author_low_id = v_low_id
      and author_high_id = v_high_id;
    v_cache_hit := found;

    if not v_cache_hit then
        v_cache.dataset_version := v_dataset.dataset_version;
        v_cache.author_low_id := v_low_id;
        v_cache.author_high_id := v_high_id;
        v_cache.like_like_count := extensions.icount(
            v_low.like_reader_ids OPERATOR(extensions.&) v_high.like_reader_ids
        );
        v_cache.low_like_high_dislike_count := extensions.icount(
            v_low.like_reader_ids OPERATOR(extensions.&) v_high.dislike_reader_ids
        );
        v_cache.low_dislike_high_like_count := extensions.icount(
            v_low.dislike_reader_ids OPERATOR(extensions.&) v_high.like_reader_ids
        );
        insert into private.author_comparison_cache (
            dataset_version, author_low_id, author_high_id, like_like_count,
            low_like_high_dislike_count, low_dislike_high_like_count
        ) values (
            v_cache.dataset_version, v_cache.author_low_id, v_cache.author_high_id,
            v_cache.like_like_count, v_cache.low_like_high_dislike_count,
            v_cache.low_dislike_high_like_count
        )
        on conflict (dataset_version, author_low_id, author_high_id) do nothing;
    end if;

    v_ll := v_cache.like_like_count;
    if v_orientation_matches then
        v_ld := v_cache.low_like_high_dislike_count;
        v_dl := v_cache.low_dislike_high_like_count;
    else
        v_ld := v_cache.low_dislike_high_like_count;
        v_dl := v_cache.low_like_high_dislike_count;
    end if;

    select * into v_validated
    from private.validated_author_comparisons
    where dataset_version = v_dataset.dataset_version
      and author_a_id = v_low_id
      and author_b_id = v_high_id;

    if found then
        v_directionality_status := case
            when v_orientation_matches then v_validated.directionality_status
            when v_validated.directionality_status = 'reliably_one_sided_a_to_b'
                then 'reliably_one_sided_b_to_a'
            when v_validated.directionality_status = 'reliably_one_sided_b_to_a'
                then 'reliably_one_sided_a_to_b'
            else v_validated.directionality_status
        end;
        v_validated_json := jsonb_build_object(
            'present', true,
            'source', v_dataset.source_handoff_version,
            'directionality_status', v_directionality_status,
            'a_to_b_selected', case when v_orientation_matches
                then v_validated.a_to_b_selected else v_validated.b_to_a_selected end,
            'b_to_a_selected', case when v_orientation_matches
                then v_validated.b_to_a_selected else v_validated.a_to_b_selected end,
            'a_to_b_q_value', case when v_orientation_matches
                then v_validated.a_to_b_q_value else v_validated.b_to_a_q_value end,
            'b_to_a_q_value', case when v_orientation_matches
                then v_validated.b_to_a_q_value else v_validated.a_to_b_q_value end,
            'a_to_b_q_claim', case when v_orientation_matches
                then v_validated.a_to_b_q_claim else v_validated.b_to_a_q_claim end,
            'b_to_a_q_claim', case when v_orientation_matches
                then v_validated.b_to_a_q_claim else v_validated.a_to_b_q_claim end,
            'asymmetry_q_value', v_validated.asymmetry_q_value,
            'globally_multiple_testing_corrected', true
        );
    else
        v_validated_json := jsonb_build_object(
            'present', false,
            'source', v_dataset.source_handoff_version,
            'directionality_status', 'not_validated',
            'globally_multiple_testing_corrected', false
        );
    end if;

    return jsonb_build_object(
        'schema_version', 1,
        'dataset_version', v_dataset.dataset_version,
        'method_version', v_dataset.method_version,
        'author_a', jsonb_build_object(
            'author_id', v_author_a.author_id,
            'author_name', v_author_a.author_name
        ),
        'author_b', jsonb_build_object(
            'author_id', v_author_b.author_id,
            'author_name', v_author_b.author_name
        ),
        'a_to_b', private.author_direction_metrics(
            v_ll,
            v_ld,
            v_author_b.like_count - v_ll,
            v_author_b.dislike_count - v_ld,
            v_author_a.book_count,
            v_author_a.like_count,
            v_author_b.book_count,
            v_author_b.like_count,
            v_author_b.dislike_count,
            v_dataset.tau_squared,
            v_dataset.min_test_books,
            v_dataset.min_pair_information,
            v_dataset.min_source_like_users,
            v_dataset.min_target_clear_users,
            v_dataset.min_target_like_users,
            v_dataset.min_target_dislike_users
        ),
        'b_to_a', private.author_direction_metrics(
            v_ll,
            v_dl,
            v_author_a.like_count - v_ll,
            v_author_a.dislike_count - v_dl,
            v_author_b.book_count,
            v_author_b.like_count,
            v_author_a.book_count,
            v_author_a.like_count,
            v_author_a.dislike_count,
            v_dataset.tau_squared,
            v_dataset.min_test_books,
            v_dataset.min_pair_information,
            v_dataset.min_source_like_users,
            v_dataset.min_target_clear_users,
            v_dataset.min_target_like_users,
            v_dataset.min_target_dislike_users
        ),
        'validated_relationship', v_validated_json,
        'interpretation', jsonb_build_object(
            'dynamic_p_values_are_globally_corrected', false,
            'absence_from_validated_relationships_means_no_validated_claim_not_no_relationship',
            true
        )
    );
end
$function$;

revoke all on function private.normal_upper_tail_abs(double precision)
    from public, anon, authenticated;
revoke all on function private.author_direction_metrics(
    integer, integer, integer, integer, integer, integer, integer, integer,
    integer, double precision, integer, double precision, integer, integer,
    integer, integer
) from public, anon, authenticated;
revoke all on function private.compare_authors(integer, integer, text)
    from public, anon, authenticated;

do $block$
begin
    if not exists (select 1 from pg_roles where rolname = 'author_comparison_executor') then
        create role author_comparison_executor nologin noinherit;
    end if;
end
$block$;

grant usage on schema private to author_comparison_executor;
grant execute on function private.compare_authors(integer, integer, text)
    to author_comparison_executor;

comment on role author_comparison_executor is
    'Grant this role to the dedicated Edge Function database login; it can execute comparisons but cannot read reaction arrays.';
