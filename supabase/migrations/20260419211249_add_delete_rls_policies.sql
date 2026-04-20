CREATE POLICY "Users can delete own listening progress"
  ON public.listening_progress
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reading progress"
  ON public.reading_progress
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
