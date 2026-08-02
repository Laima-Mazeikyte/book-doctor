-- Make comparison provenance, display state, and degenerate metrics explicit.
-- This is a follow-up to 20260801180000_author_comparisons.sql.

drop function if exists private.author_direction_metrics(
    integer, integer, integer, integer, integer, integer, integer, integer,
    integer, double precision, integer, double precision, integer, integer,
    integer, integer
);

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
    p_min_target_dislike_users integer,
    p_comparison_mode text,
    p_release_selected boolean
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
    v_has_outcome_variation boolean;
    v_status text;
    v_display_state text;
begin
    if p_comparison_mode not in ('release', 'on_demand') then
        raise exception using
            errcode = '22023',
            message = 'comparison mode must be release or on_demand';
    end if;

    -- A smoothed log-odds estimate is not meaningful when both groups are constant:
    -- there is no observed outcome variation for the correction to regularise.
    v_has_outcome_variation :=
        (p_a > 0 and p_b > 0) or (p_c > 0 and p_d > 0);

    if v_has_outcome_variation then
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
    end if;

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

    if p_tau_squared > 0 and v_theta is not null and v_se is not null then
        v_posterior_mean := v_theta * p_tau_squared / (p_tau_squared + v_se * v_se);
        v_posterior_sd := sqrt(
            p_tau_squared * v_se * v_se / (p_tau_squared + v_se * v_se)
        );
        v_evidence_score := greatest(
            0.0,
            abs(v_posterior_mean) - v_z95 * v_posterior_sd
        );
    elsif v_theta is not null then
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
    v_display_state := case
        when not v_eligible then 'not_enough_data'
        when p_comparison_mode = 'release' and p_release_selected
            then 'validated'
        when p_comparison_mode = 'release'
            then 'evidence_threshold_not_met'
        else 'on_demand_not_formally_validated'
    end;

    return jsonb_build_object(
        'mode', p_comparison_mode,
        'display_state', v_display_state,
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
        'ci_lower', case when v_se is null then null else v_theta - v_z95 * v_se end,
        'ci_upper', case when v_se is null then null else v_theta + v_z95 * v_se end,
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
    v_comparison_mode text;
    v_a_to_b_selected boolean := false;
    v_b_to_a_selected boolean := false;
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
        v_comparison_mode := 'release';
        v_a_to_b_selected := case when v_orientation_matches
            then v_validated.a_to_b_selected else v_validated.b_to_a_selected end;
        v_b_to_a_selected := case when v_orientation_matches
            then v_validated.b_to_a_selected else v_validated.a_to_b_selected end;
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
            'a_to_b_selected', v_a_to_b_selected,
            'b_to_a_selected', v_b_to_a_selected,
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
        v_comparison_mode := 'on_demand';
        v_validated_json := jsonb_build_object(
            'present', false,
            'source', v_dataset.source_handoff_version,
            'directionality_status', 'not_validated',
            'globally_multiple_testing_corrected', false
        );
    end if;

    return jsonb_build_object(
        'schema_version', 2,
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
            v_dataset.min_target_dislike_users,
            v_comparison_mode,
            v_a_to_b_selected
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
            v_dataset.min_target_dislike_users,
            v_comparison_mode,
            v_b_to_a_selected
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

revoke all on function private.author_direction_metrics(
    integer, integer, integer, integer, integer, integer, integer, integer,
    integer, double precision, integer, double precision, integer, integer,
    integer, integer, text, boolean
) from public, anon, authenticated;

grant execute on function private.compare_authors(integer, integer, text)
    to author_comparison_executor;
