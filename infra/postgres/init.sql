-- Runs once on first Postgres init. POSTGRES_DB creates `authentik`;
-- this adds the Support database on the same instance.
CREATE DATABASE support;
CREATE DATABASE accounting;
CREATE DATABASE legal;
