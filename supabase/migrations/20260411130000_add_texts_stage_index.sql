-- Index for the reading passage index page query:
--   SELECT ... FROM texts WHERE stage IS NOT NULL ORDER BY stage_index, order_index
CREATE INDEX IF NOT EXISTS texts_stage_order_idx
  ON public.texts (stage_index, order_index)
  WHERE stage IS NOT NULL;
