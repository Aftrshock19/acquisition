WITH seeded_collection AS (
  INSERT INTO public.text_collections (
    id,
    title,
    lang,
    author,
    description,
    collection_type
  )
  VALUES (
    'f2b0f0d3-6c1a-4b34-9c7a-0d7e9b3d7f10'::uuid,
    'Una semana en el barrio',
    'es',
    'Acquisition demo',
    'Una lectura breve y original sobre una mudanza tranquila, la vida de barrio y pequeños avances cotidianos.',
    'graded_reader'
  )
  ON CONFLICT (id) DO UPDATE
  SET title = EXCLUDED.title,
      lang = EXCLUDED.lang,
      author = EXCLUDED.author,
      description = EXCLUDED.description,
      collection_type = EXCLUDED.collection_type
  RETURNING id
),
seed_texts AS (
  SELECT *
  FROM (
    VALUES
      (
        '1c9b3477-0ee8-4d4c-8d9d-c24ef46ef101'::uuid,
        (SELECT id FROM seeded_collection),
        'Parte 1: La mudanza',
        'es',
        $$El lunes por la mañana, Ana llega al barrio con dos maletas, una planta pequeña y una libreta azul. No conoce a nadie, pero el portero le sonríe y le explica dónde está la panadería, la parada del autobús y la lavandería. Ana sube al tercer piso, abre las ventanas y deja entrar el aire fresco.

Por la tarde, baja a comprar pan y leche. En la fila escucha voces tranquilas, una radio vieja y el sonido de una cafetera. La panadera le pregunta si es nueva en la calle. Ana dice que sí y recibe una respuesta simple: "Aquí todo va despacio, pero la gente ayuda."$$,
        1,
        1,
        'A2'
      ),
      (
        '7d45a3ff-4798-4be9-9ad1-4c4f58f1e102'::uuid,
        (SELECT id FROM seeded_collection),
        'Parte 2: La plaza',
        'es',
        $$El martes, Ana decide caminar sin mapa. Dobla la esquina y encuentra una plaza con bancos verdes, árboles bajos y un kiosco de periódicos. Un señor mayor lee bajo el sol, dos niños juegan con una pelota y una mujer vende flores cerca de la fuente.

Ana se sienta diez minutos para observar. Anota en su libreta los nombres de los negocios y las palabras que oye. Después compra tres naranjas y un cuaderno barato. Antes de volver a casa, piensa que el barrio no es grande, pero tiene ritmo, voces y pequeños detalles que la hacen sentirse menos extraña.$$,
        2,
        2,
        'A2'
      ),
      (
        '91b8c796-3735-4d6b-95b2-0639a4f0e103'::uuid,
        (SELECT id FROM seeded_collection),
        'Parte 3: El sábado',
        'es',
        $$El sábado por la mañana, Ana ya sabe pedir café, saludar a los vecinos y encontrar la farmacia sin mirar el móvil. Lleva una bolsa de tela y pasa primero por el mercado. Compra tomates, arroz y una barra de pan. En la frutería, la dependienta recuerda su nombre y eso le da confianza.

Después, Ana vuelve a la plaza con un libro sencillo. Lee un rato, descansa y escucha una conversación entre dos amigas sobre una fiesta del barrio. No entiende cada palabra, pero comprende la idea general. Cuando regresa al piso, escribe una frase en su libreta: "Hoy no me sentí de visita. Hoy empecé a vivir aquí."$$,
        3,
        3,
        'A2'
      ),
      (
        '0efcaec2-2f40-4cb6-a56e-5f9dbf42e104'::uuid,
        NULL::uuid,
        'Un café antes del trabajo',
        'es',
        $$Pablo sale de casa a las siete y media, cuando la calle todavía está tranquila. Antes de entrar en la oficina, siempre pasa por un café pequeño junto a la estación. Pide un café con leche, deja la mochila en una silla y mira por la ventana durante cinco minutos.

No usa ese momento para trabajar. Prefiere escuchar las conversaciones cortas de la mañana, ver a la gente caminar deprisa y ordenar su plan del día en una libreta. Cuando termina, guarda el bolígrafo, sonríe al camarero y cruza la calle con la sensación de haber empezado bien.$$,
        NULL::integer,
        NULL::integer,
        'A1'
      )
  ) AS seed(
    id,
    collection_id,
    title,
    lang,
    content,
    order_index,
    section_number,
    difficulty_cefr
  )
)
INSERT INTO public.texts (
  id,
  collection_id,
  title,
  lang,
  content,
  order_index,
  section_number,
  word_count,
  estimated_minutes,
  difficulty_cefr
)
SELECT
  id,
  collection_id,
  title,
  lang,
  content,
  order_index,
  section_number,
  CASE
    WHEN btrim(content) = '' THEN 0
    ELSE array_length(regexp_split_to_array(btrim(content), E'\\s+'), 1)
  END AS word_count,
  GREATEST(
    1,
    CEIL(
      (
        CASE
          WHEN btrim(content) = '' THEN 0
          ELSE array_length(regexp_split_to_array(btrim(content), E'\\s+'), 1)
        END
      ) / 180.0
    )::integer
  ) AS estimated_minutes,
  difficulty_cefr
FROM seed_texts
ON CONFLICT (id) DO UPDATE
SET collection_id = EXCLUDED.collection_id,
    title = EXCLUDED.title,
    lang = EXCLUDED.lang,
    content = EXCLUDED.content,
    order_index = EXCLUDED.order_index,
    section_number = EXCLUDED.section_number,
    word_count = EXCLUDED.word_count,
    estimated_minutes = EXCLUDED.estimated_minutes,
    difficulty_cefr = EXCLUDED.difficulty_cefr;
