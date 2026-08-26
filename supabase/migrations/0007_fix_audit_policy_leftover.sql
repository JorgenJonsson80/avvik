-- ============================================================================
-- 0007_fix_audit_policy_leftover.sql — täpp kvarglömd policy på deviation_audit
-- ----------------------------------------------------------------------------
-- LIVE DATA. Kör i Supabase SQL Editor.
--
-- 0004_secure_org_delete.sql skulle dela upp "for all"-policyn på
-- deviation_audit i select/insert/update (öppet) + delete (admin-only), precis
-- som för deviations/rader/settings. Men dess drop-loop byggde policynamnet
-- som 'org ' || tabellnamn, dvs "org deviation_audit" — den faktiska policyn
-- (skapad i 0003_organizations.sql / 0003_catchup.sql) heter "org audit", inte
-- "org deviation_audit". `drop policy if exists` failade tyst, så den gamla
-- breda policyn (for all, ingen admin-koll, org-medlemmar kan DELETE) blev
-- kvar vid sidan av de nya admin-only-policyerna. RLS-policyer är permissiva
-- och OR:as ihop, så deviation_audit har i praktiken varit lika öppet för
-- radering som innan 0004 — hela poängen med den migrationen missade denna
-- enda tabell.
-- ============================================================================

drop policy if exists "org audit" on deviation_audit;
