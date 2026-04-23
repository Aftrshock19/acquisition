-- Generated: 2026-04-20T20:49:56.729551+00:00
-- Source CSV: words_rows (3).csv
-- Hand-curated mood-gap fixes (14 rows)
-- Source of fixes: recon H2/H3/H5/H6 manual review

BEGIN;

-- repita (repetir) -- H6 present subjunctive
--   old translation: I repeat; you repeat; he repeats; she repeats; it repeats; you repeat (formal) (present subjunctive)
--   old tags:        []
UPDATE words SET
    translation = 'I repeat; he repeats; she repeats (in wishes/doubts/commands)',
    tags = ARRAY['subjunctive','present','singular_ambiguous']::text[]
WHERE id = '0633e501-9982-4495-b78c-5ca0112a1fee';

-- llámelo (llamar) -- H6 formal usted imperative w/ enclitic
--   old translation: call him (formal imperative/subjunctive)
--   old tags:        []
UPDATE words SET
    translation = 'call him! (command, formal)',
    tags = ARRAY['subjunctive','present','third','singular','attached_pronoun','direct_object','lo']::text[]
WHERE id = '6a46893a-a6f4-48ba-a863-dadc94bc014d';

-- haga (hacer) -- H6 singular_ambiguous + formal imperative
--   old translation: do; make (subjunctive/formal imperative)
--   old tags:        []
UPDATE words SET
    translation = 'I do; he does; she does; make! (in wishes/doubts/commands; command, formal)',
    tags = ARRAY['subjunctive','present','singular_ambiguous']::text[]
WHERE id = 'ba7ab279-2bbf-4bbc-b07d-50f4c423a2d6';

-- vuelva (volver) -- H6 present subjunctive
--   old translation: return; come back (subjunctive)
--   old tags:        []
UPDATE words SET
    translation = 'I return; he returns; she returns (in wishes/doubts/commands)',
    tags = ARRAY['subjunctive','present','singular_ambiguous']::text[]
WHERE id = '0130673c-e824-49d9-9077-ca0bc9fe532c';

-- quiera (querer) -- H6 present subjunctive
--   old translation: wants; want (subjunctive)
--   old tags:        []
UPDATE words SET
    translation = 'I want; he wants; she wants (in wishes/doubts/commands)',
    tags = ARRAY['subjunctive','present','singular_ambiguous']::text[]
WHERE id = 'ea5025e3-bc63-4565-bc9f-c1461b3330ad';

-- vengas (venir) -- H6 present subjunctive
--   old translation: come (subjunctive)
--   old tags:        []
UPDATE words SET
    translation = 'you come (in wishes/doubts/commands)',
    tags = ARRAY['subjunctive','present','second','singular']::text[]
WHERE id = '7199bf9a-e7bc-443a-a34e-62f80bee0189';

-- hagámoslo (hacer) -- H2 hortative 1pl w/ enclitic; keep translation
--   old translation: let's do it
--   old tags:        []
UPDATE words SET
    tags = ARRAY['subjunctive','present','first','plural','attached_pronoun','direct_object','lo']::text[]
WHERE id = 'b6023e1e-12b6-4731-95bd-a3712136132e';

-- escúchalo (escuchar) -- H3 tú imperative w/ enclitic
--   old translation: listen to it (masculine)
--   old tags:        ['attached_pronoun', 'direct_object', 'lo']
UPDATE words SET
    translation = 'listen to it! (command)',
    tags = ARRAY['attached_pronoun','direct_object','lo','imperative','affirmative','tú','second','singular']::text[]
WHERE id = '0d9a9db3-d19c-4929-a836-55e4347fe9a0';

-- míralos (mirar) -- H3 tú imperative w/ enclitic
--   old translation: look at them (masculine)
--   old tags:        ['attached_pronoun', 'direct_object', 'los']
UPDATE words SET
    translation = 'look at them! (command)',
    tags = ARRAY['attached_pronoun','direct_object','los','imperative','affirmative','tú','second','singular']::text[]
WHERE id = 'c1502e7c-83c5-4e32-85ac-573008c51bf6';

-- dales (dar) -- H3 tú imperative w/ enclitic
--   old translation: give them
--   old tags:        ['attached_pronoun', 'indirect_object', 'les']
UPDATE words SET
    translation = 'give them! (command)',
    tags = ARRAY['attached_pronoun','indirect_object','les','imperative','affirmative','tú','second','singular']::text[]
WHERE id = '2b6b7e55-3c0d-4337-a5aa-005b886c48e2';

-- salte (salir) -- H3 tú imperative; old gloss had wrong formality
--   old translation: go out (formal command)
--   old tags:        ['attached_pronoun', 'direct_object', 'te']
UPDATE words SET
    translation = 'get out! (command)',
    tags = ARRAY['attached_pronoun','direct_object','te','imperative','affirmative','tú','second','singular']::text[]
WHERE id = '3e4383b2-43ec-4ec9-8b42-078e2d4d5181';

-- espérate (esperar) -- H3 fix literal-translation bug; tú imperative
--   old translation: wait for yourself
--   old tags:        ['attached_pronoun', 'direct_object', 'te']
UPDATE words SET
    translation = 'wait up! (command)',
    tags = ARRAY['attached_pronoun','direct_object','te','imperative','affirmative','tú','second','singular']::text[]
WHERE id = '23b81267-4934-4739-9490-7e7762a51ceb';

-- deciros (decir) -- H3 mislabelled: infinitive+enclitic, not imperative; fix missing 'to'
--   old translation: tell you all
--   old tags:        ['attached_pronoun', 'indirect_object', 'os']
UPDATE words SET
    translation = 'to tell you all'
WHERE id = 'c61f4cd7-dbed-4dcc-86c7-8c146ffd434c';

-- da (dar) -- H5 dual gloss to preserve indicative meaning
--   old translation: gives
--   old tags:        []
UPDATE words SET
    translation = 'gives; give! (command)',
    tags = ARRAY['imperative','affirmative','tú','second','singular']::text[]
WHERE id = '191ec27f-9090-4af1-8a0c-72234c8f00b4';

COMMIT;
