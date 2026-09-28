-- Runs once on first Postgres init. POSTGRES_DB creates `authentik`;
-- this adds the Support database on the same instance.
CREATE DATABASE support;
CREATE DATABASE accounting;
CREATE DATABASE aesign;
CREATE DATABASE subcontractor;
-- NOTE: init.sql only runs on a FRESH cluster. On the live box, create the new
-- database once by hand (it does not lock or touch the others):
--   docker compose exec postgres psql -U axus -c 'CREATE DATABASE subcontractor;'
