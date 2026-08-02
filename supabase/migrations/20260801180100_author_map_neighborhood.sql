-- Fixed-map node and local-neighborhood exports for personalized placement.
-- Run after 20260801180000_author_comparisons.sql.

create table if not exists private.author_map_nodes (
    release_id text not null,
    author_id integer not null check (author_id >= 0),
    exact_author text not null,
    x double precision not null,
    y double precision not null,
    z double precision not null,
    local_radius double precision not null check (local_radius >= 0),
    community_id integer not null,
    primary key (release_id, author_id)
);

create table if not exists private.author_map_neighbors (
    release_id text not null,
    author_id integer not null,
    neighbor_author_id integer not null,
    neighbor_rank smallint not null check (neighbor_rank >= 1 and neighbor_rank <= 100),
    neighbor_distance double precision not null check (neighbor_distance >= 0),
    primary key (release_id, author_id, neighbor_author_id),
    unique (release_id, author_id, neighbor_rank),
    check (author_id <> neighbor_author_id),
    foreign key (release_id, author_id)
        references private.author_map_nodes (release_id, author_id)
        on delete cascade,
    foreign key (release_id, neighbor_author_id)
        references private.author_map_nodes (release_id, author_id)
        on delete cascade
);

alter table private.author_map_nodes enable row level security;
alter table private.author_map_neighbors enable row level security;

comment on table private.author_map_nodes is
    'Fixed published map coordinates and kth-neighbor local radius; no user-level data.';
comment on table private.author_map_neighbors is
    'Directed k-nearest-neighbor rows in published 3D coordinate space.';

revoke all on all tables in schema private from public, anon, authenticated;
