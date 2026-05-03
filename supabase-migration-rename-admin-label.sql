-- Rename the 'admin' role's display label to 'Buyer Admin' so it's
-- visually distinct from the new 'trunk_admin' role.
--
-- The role ID stays 'admin' so we don't have to rewrite the dozens
-- of RLS policies and TypeScript checks that hard-code the string
-- 'admin'. Only the human-readable label changes.

UPDATE public.roles
SET    label = 'Buyer Admin',
       updated_at = now()
WHERE  id = 'admin';
