-- ============================================================
-- Trade organizations for trunk show stores
--
-- BEB tracks which industry trade organizations a store belongs to
-- (RJO today, others later). Used to filter the Trunk Show Stores
-- list and to surface group affiliations on a per-store basis.
--
-- Two tables:
--   trade_organizations              — master list of orgs
--   store_trade_organization_members — many-to-many between
--                                      trunk_show_stores and
--                                      trade_organizations
--
-- RLS mirrors the trunk_show_stores model (admin / superadmin /
-- trunk_admin / partner write; same roles read).
--
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trade_organizations (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT         NOT NULL UNIQUE,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Seed RJO. NULL-safe on re-run; we only ever care that the row
-- exists with this exact display name.
INSERT INTO public.trade_organizations (name, sort_order)
  VALUES ('RJO', 0)
  ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.trade_organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_organizations_read ON public.trade_organizations;
CREATE POLICY trade_organizations_read ON public.trade_organizations
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trade_organizations_write ON public.trade_organizations;
CREATE POLICY trade_organizations_write ON public.trade_organizations
  FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

-- ── Membership join table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_trade_organization_members (
  store_id    UUID NOT NULL REFERENCES public.trunk_show_stores(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES public.trade_organizations(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, org_id)
);

CREATE INDEX IF NOT EXISTS store_trade_org_members_store_idx
  ON public.store_trade_organization_members (store_id);
CREATE INDEX IF NOT EXISTS store_trade_org_members_org_idx
  ON public.store_trade_organization_members (org_id);

ALTER TABLE public.store_trade_organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_trade_org_members_read ON public.store_trade_organization_members;
CREATE POLICY store_trade_org_members_read ON public.store_trade_organization_members
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS store_trade_org_members_write ON public.store_trade_organization_members;
CREATE POLICY store_trade_org_members_write ON public.store_trade_organization_members
  FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

DO $$ BEGIN
  RAISE NOTICE 'Created trade_organizations + store_trade_organization_members. Seeded RJO. Re-run is safe.';
END $$;
