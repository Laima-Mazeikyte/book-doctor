-- Roll back Step 1C only while the endpoint still uses the old feed read.
-- After endpoint cutover, restore its previous implementation BEFORE running this.
-- RESTRICT preserves any unexpected dependent objects by refusing the drop.
begin;
set local lock_timeout = '2s';
drop function if exists public.get_rate_feed_bootstrap(integer) restrict;
notify pgrst, 'reload schema';
commit;
