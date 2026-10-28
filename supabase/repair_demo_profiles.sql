-- MaplePro demo profile repair.
-- Run in the Supabase SQL Editor for the same project whose URL is configured in Vercel.
-- This repairs the demo firm and four demo profiles. It does not replace project or invoice data.

INSERT INTO public.firms (id, name)
VALUES ('firm-northline', 'Northline Construction Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, auth_user_id, firm_id, email, full_name, role, active)
VALUES
  ('usr-admin', NULL, 'firm-northline', 'admin@maplepro.demo', 'Alex Morgan', 'admin', true),
  ('usr-manager', NULL, 'firm-northline', 'manager@maplepro.demo', 'Olivia Chen', 'project_manager', true),
  ('usr-client', NULL, 'firm-northline', 'client@maplepro.demo', 'Jordan Blake', 'client', true),
  ('usr-subcontractor', NULL, 'firm-northline', 'subcontractor@maplepro.demo', 'Sam Patel', 'subcontractor', true)
ON CONFLICT (email) DO UPDATE SET
  firm_id = EXCLUDED.firm_id,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  active = true;

-- Verify that all four demo profiles are visible in this project.
SELECT id, email, firm_id, role, active
FROM public.profiles
WHERE email IN (
  'admin@maplepro.demo',
  'manager@maplepro.demo',
  'client@maplepro.demo',
  'subcontractor@maplepro.demo'
)
ORDER BY email;
