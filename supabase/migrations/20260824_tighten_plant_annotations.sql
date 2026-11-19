-- Follow-up to 20260824_security_lint_remediation.sql
--
-- The first pass gave plant_annotations a blanket authenticated USING(true)
-- policy to preserve app behaviour. That was more permissive than needed:
-- both pages that touch the table -- /dashboard/annotate and
-- /dashboard/admin/annotate -- are already in adminOnlyPaths in
-- src/middleware.ts, so only admins can ever reach them.
--
-- Scoping the policy to admins matches training_batches / training_images
-- and clears lint 0024 (rls_policy_always_true).

DROP POLICY IF EXISTS "Signed-in users manage plant_annotations" ON public.plant_annotations;

CREATE POLICY "Admins manage plant_annotations" ON public.plant_annotations
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
