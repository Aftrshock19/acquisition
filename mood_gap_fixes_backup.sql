CREATE TABLE IF NOT EXISTS public.words_mood_gap_backup_20260420 AS
SELECT id, translation, tags, now() AS backed_up_at
FROM public.words
WHERE id IN (
  '0130673c-e824-49d9-9077-ca0bc9fe532c'::uuid,  '0633e501-9982-4495-b78c-5ca0112a1fee'::uuid,  '0d9a9db3-d19c-4929-a836-55e4347fe9a0'::uuid,  '191ec27f-9090-4af1-8a0c-72234c8f00b4'::uuid,  '23b81267-4934-4739-9490-7e7762a51ceb'::uuid,  '2b6b7e55-3c0d-4337-a5aa-005b886c48e2'::uuid,  '3e4383b2-43ec-4ec9-8b42-078e2d4d5181'::uuid,  '6a46893a-a6f4-48ba-a863-dadc94bc014d'::uuid,  '7199bf9a-e7bc-443a-a34e-62f80bee0189'::uuid,  'b6023e1e-12b6-4731-95bd-a3712136132e'::uuid,  'ba7ab279-2bbf-4bbc-b07d-50f4c423a2d6'::uuid,  'c1502e7c-83c5-4e32-85ac-573008c51bf6'::uuid,  'c61f4cd7-dbed-4dcc-86c7-8c146ffd434c'::uuid,  'ea5025e3-bc63-4565-bc9f-c1461b3330ad'::uuid
);
SELECT count(*) AS backed_up FROM public.words_mood_gap_backup_20260420;
