-- Security linter remediation
-- Addresses: rls_disabled_in_public (8 ERRORs), rls_policy_always_true,
-- function_search_path_mutable, anon_security_definer_function_executable,
-- public_bucket_allows_listing.
--
-- Admin checks use profiles.id = auth.uid() AND profiles.role = 'admin',
-- matching src/lib/auth/api-auth.ts and the dashboard pages.
-- The service role bypasses RLS entirely, so every /api/* route is unaffected.

-- ---------------------------------------------------------------
-- 0. Remove the all-null rows an unauthenticated write test created
--    on 2026-08-25 (proof these tables accepted anonymous inserts).
-- ---------------------------------------------------------------
DELETE FROM public.training_batches    WHERE id = '336f47b5-5846-4ef9-9f10-fc4ea9a3838f';
DELETE FROM public.annotation_progress WHERE id = 'd68bab28-7ebe-4b9e-b99f-534255cc78e9';
DELETE FROM public.contact_submissions WHERE id = '5e83ae99-2345-4269-9c1f-3acdbfa34cb3';

-- ---------------------------------------------------------------
-- 1. training_batches / training_images  -> admin only
--    Used by /dashboard/admin/upload-training (browser, admin-gated).
-- ---------------------------------------------------------------
ALTER TABLE public.training_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_images  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage training_batches" ON public.training_batches
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "Admins manage training_images" ON public.training_images
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ---------------------------------------------------------------
-- 2. plant_annotations -> any signed-in user
--    /dashboard/annotate is open to all authenticated users and the table
--    has no owner column, so this preserves current app behaviour while
--    removing anonymous access.
-- ---------------------------------------------------------------
ALTER TABLE public.plant_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users manage plant_annotations" ON public.plant_annotations
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------
-- 3. annotation_progress -> owner scoped (table has user_id, unused in code)
-- ---------------------------------------------------------------
ALTER TABLE public.annotation_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own annotation_progress" ON public.annotation_progress
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------
-- 4. plant_type_presets / plant_health_analyses -> no client access
--    Neither table is referenced anywhere in src/, scripts/ or docker/.
--    RLS on with zero policies = deny all; service role still reaches them.
--    Add a read policy here if you later wire them into the UI.
-- ---------------------------------------------------------------
ALTER TABLE public.plant_type_presets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_health_analyses ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- 5. contact_submissions -> no client access
--    Not referenced in code; /api/contact writes to `contacts` instead.
-- ---------------------------------------------------------------
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- 6. contacts -> drop the always-true anon INSERT, restrict reads to admins
--    The public form posts to /api/contact, which uses the service role,
--    so the browser never needs direct INSERT on this table.
--    Drops every existing policy first so no unknown over-broad rule survives.
-- ---------------------------------------------------------------
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'contacts'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.contacts', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read contacts" ON public.contacts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "Admins update contacts" ON public.contacts
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ---------------------------------------------------------------
-- 7. Pin search_path on the four flagged functions.
--    public,pg_temp (not '') so unqualified references in the bodies keep working.
-- ---------------------------------------------------------------
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_updated_at()        SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user()          SET search_path = public, pg_temp;
ALTER FUNCTION public.trigger_set_timestamp()    SET search_path = public, pg_temp;

-- ---------------------------------------------------------------
-- 8. handle_new_user is an auth.users trigger, not an API endpoint.
--    Stop it being callable via /rest/v1/rpc/handle_new_user.
--    Trigger execution is unaffected (triggers ignore EXECUTE grants).
-- ---------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

-- ---------------------------------------------------------------
-- 9. Storage: stop clients enumerating the public buckets.
--    All listing in the app is server-side with the service role
--    (src/lib/supabase/storage.ts, /api/flight-detection/flights).
--    Public object URLs keep working without this policy.
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Public read access for tiles"        ON storage.objects;
DROP POLICY IF EXISTS "Public read access for orthomosaics" ON storage.objects;
