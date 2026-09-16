-- Sales Desk (plnt.net/sales)
-- ============================================================================
-- Storage for the internal sales CRM: nursery/grower organizations with their
-- contacts and call history, reusable email templates, and team settings.
--
-- Each table is a small document store — one row per record with a JSONB
-- body — because the desk was built against a document API and its records
-- are read and written whole (an organization carries its contacts and its
-- activity log). Nothing here joins to the customer-facing tables.
--
-- Access: admins only, enforced by RLS through is_plnt_admin(). The browser
-- talks to these tables directly with the user's session (no service-role
-- route in between), so the policies are the whole gate. The email allowlist
-- in src/lib/auth/allowlist.ts decides who can sign in at all.

CREATE TABLE IF NOT EXISTS public.sales_orgs (
  id         TEXT PRIMARY KEY,
  doc        JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales_templates (
  id         TEXT PRIMARY KEY,
  doc        JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales_settings (
  id         TEXT PRIMARY KEY,
  doc        JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Is the caller a PLNT admin?" — reads profiles as the function owner so the
-- check works regardless of the profiles RLS policies the caller is under.
CREATE OR REPLACE FUNCTION public.is_plnt_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_plnt_admin() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.is_plnt_admin() TO authenticated;

ALTER TABLE public.sales_orgs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_settings  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_orgs: admins" ON public.sales_orgs;
CREATE POLICY "sales_orgs: admins" ON public.sales_orgs
  FOR ALL TO authenticated
  USING (public.is_plnt_admin())
  WITH CHECK (public.is_plnt_admin());

DROP POLICY IF EXISTS "sales_templates: admins" ON public.sales_templates;
CREATE POLICY "sales_templates: admins" ON public.sales_templates
  FOR ALL TO authenticated
  USING (public.is_plnt_admin())
  WITH CHECK (public.is_plnt_admin());

DROP POLICY IF EXISTS "sales_settings: admins" ON public.sales_settings;
CREATE POLICY "sales_settings: admins" ON public.sales_settings
  FOR ALL TO authenticated
  USING (public.is_plnt_admin())
  WITH CHECK (public.is_plnt_admin());

-- Live updates between reps: the desk subscribes to postgres_changes on these
-- tables so a call logged on one screen appears on the other within seconds.
-- (Realtime honours the RLS policies above.) If the table is already in the
-- publication this is a no-op error, hence the DO block.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_orgs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_templates;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_settings;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
