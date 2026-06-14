-- Run this once against your RDS database (psql, DBeaver, etc.)
-- It speeds up the ILIKE '%...%' searches and DISTINCT ON queries used by /api/creators.
-- Safe to run multiple times (IF NOT EXISTS).

-- 1. Enable trigram search (needed for ILIKE '%term%' to use an index)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Trigram (GIN) indexes for fields used with ILIKE
CREATE INDEX IF NOT EXISTS idx_creators_username_trgm
  ON bronze.creators USING gin (username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_creators_fullname_trgm
  ON bronze.creators USING gin (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_creators_firstname_trgm
  ON bronze.creators USING gin (first_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_creators_lastname_trgm
  ON bronze.creators USING gin (last_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_creators_niche_primary_trgm
  ON bronze.creators USING gin (niche_primary gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_creators_niche_secondary_trgm
  ON bronze.creators USING gin (niche_secondary gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_creators_bio_trgm
  ON bronze.creators USING gin (bio_data gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_creators_country_trgm
  ON bronze.creators USING gin (address_country gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_creators_business_category_trgm
  ON bronze.creators USING gin (business_category gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_creators_hashtags_trgm
  ON bronze.creators USING gin (combined_hashtags gin_trgm_ops);

-- 3. The DISTINCT ON / ORDER BY relies heavily on these — make sure they exist
CREATE INDEX IF NOT EXISTS idx_creators_username_lower
  ON bronze.creators (LOWER(username));

CREATE INDEX IF NOT EXISTS idx_creators_follower_count
  ON bronze.creators (follower_count DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_creators_latest_post_date
  ON bronze.creators (latest_post_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_creators_address_city
  ON bronze.creators (address_city);

-- 4. Refresh planner statistics so Postgres uses the new indexes immediately
ANALYZE bronze.creators;
