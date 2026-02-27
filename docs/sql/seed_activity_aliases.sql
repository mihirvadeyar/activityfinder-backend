CREATE OR REPLACE FUNCTION seed_activity_aliases(
  p_activity_name TEXT,
  p_aliases TEXT[],
  p_source TEXT DEFAULT 'manual',
  p_confidence NUMERIC(4,3) DEFAULT 1.000,
  p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  activity_id BIGINT,
  alias_text TEXT,
  action TEXT
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_activity_id BIGINT;
BEGIN
  SELECT id
  INTO v_activity_id
  FROM activity
  WHERE LOWER(TRIM(name)) = LOWER(TRIM(p_activity_name))
  LIMIT 1;

  IF v_activity_id IS NULL THEN
    RAISE EXCEPTION 'Activity not found: %', p_activity_name;
  END IF;

  RETURN QUERY
  WITH input_aliases AS (
    SELECT DISTINCT TRIM(a) AS alias_text
    FROM UNNEST(p_aliases) AS a
    WHERE a IS NOT NULL AND TRIM(a) <> ''
  ),
  upserted AS (
    INSERT INTO activity_alias (
      activity_id,
      alias_text,
      alias_normalized,
      source,
      confidence,
      is_active
    )
    SELECT
      v_activity_id,
      ia.alias_text,
      LOWER(TRIM(ia.alias_text)) AS alias_normalized,
      p_source,
      p_confidence,
      p_is_active
    FROM input_aliases ia
    ON CONFLICT (alias_normalized, activity_id)
    DO UPDATE SET
      alias_text = EXCLUDED.alias_text,
      source = EXCLUDED.source,
      confidence = EXCLUDED.confidence,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING
      activity_alias.activity_id,
      activity_alias.alias_text,
      (xmax = 0) AS inserted_flag
  )
  SELECT
    u.activity_id,
    u.alias_text,
    CASE WHEN u.inserted_flag THEN 'inserted' ELSE 'updated' END AS action
  FROM upserted u;
END;
$$;

-- Example usage:
-- SELECT *
-- FROM seed_activity_aliases(
--   'Racquet Sports',
--   ARRAY['Badminton', 'Pickleball', 'Tennis', 'Squash', 'Racquet Sport']
-- );
