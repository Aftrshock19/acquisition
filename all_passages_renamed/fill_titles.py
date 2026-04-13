#!/usr/bin/env python3
"""Fill in title (Spanish) and topic (English) fields for all passage JSON files
by analyzing the passage text content."""

import json
import glob
import re
import os

# --- Theme detection rules ---
# Each rule: (keywords_in_passage, topic_en, title_templates_es)
# keywords are checked against lowercased passage text
# title_templates use {detail} placeholder filled from passage context

THEME_RULES = [
    # FOOD & COOKING
    (["receta", "cocinar", "cocinando", "ingredientes", "plato", "guiso", "potaje"],
     "cooking", ["Cocinando en casa", "La receta", "En la cocina"]),
    (["restaurante", "camarero", "menú", "mesa", "reserva"],
     "eating at a restaurant", ["En el restaurante", "Comida fuera", "La cena en el restaurante"]),
    (["supermercado", "compra", "comprar", "nevera", "bolsa", "carro"],
     "grocery shopping", ["La compra", "En el supermercado", "Comprando comida"]),
    (["mercado", "puesto", "vender", "fruta", "verdura"],
     "visit to the market", ["En el mercado", "El mercado", "Día de mercado"]),
    (["desayuno", "desayunar", "tostada", "café", "cereales"],
     "breakfast routine", ["El desayuno", "La hora del desayuno"]),
    (["cena", "cenar", "preparé la cena", "cené"],
     "dinner", ["La cena", "La hora de cenar"]),
    (["comida", "almuerzo", "almorzar", "comer juntos"],
     "mealtime", ["La comida", "La hora de comer"]),
    (["panadería", "pan ", "pastel", "tarta", "galleta"],
     "bakery visit", ["En la panadería", "El pan del día"]),

    # DAILY ROUTINES & HOME
    (["mañana", "levanto", "despierto", "alarma", "despertador", "ducho", "rutina"],
     "morning routine", ["La mañana", "Por la mañana", "Una mañana cualquiera"]),
    (["noche", "dormir", "acuesto", "sueño", "cama", "almohada"],
     "evening routine", ["Por la noche", "La noche", "Antes de dormir"]),
    (["limpiar", "limpieza", "ordenar", "habitación", "barrer", "fregar"],
     "cleaning the house", ["Limpieza en casa", "Ordenando la casa", "La limpieza"]),
    (["mudanza", "mudar", "mudarse", "cajas", "furgoneta", "piso nuevo"],
     "moving house", ["La mudanza", "Un nuevo hogar", "Día de mudanza"]),
    (["jardín", "plantas", "regar", "flores", "sembrar", "huerto"],
     "gardening", ["El jardín", "Cuidando el jardín", "Las plantas"]),

    # WORK & SCHOOL
    (["trabajo", "oficina", "jefe", "empresa", "reunión", "compañero", "empleo"],
     "work life", ["En el trabajo", "Un día en la oficina", "El trabajo"]),
    (["entrevista", "curriculum", "puesto", "contratar"],
     "job interview", ["La entrevista", "Buscando trabajo"]),
    (["escuela", "colegio", "clase", "deberes", "alumno", "examen", "nota"],
     "school life", ["En la escuela", "Un día de clase", "El colegio"]),
    (["universidad", "carrera", "facultad", "estudiar", "estudiante", "campus"],
     "university life", ["En la universidad", "La vida universitaria"]),
    (["profesor", "profesora", "enseñar", "explicar", "lección"],
     "a memorable teacher", ["El profesor", "Una lección especial"]),
    (["libro", "leer", "lectura", "novela", "biblioteca", "páginas"],
     "reading", ["El libro", "La lectura", "Un buen libro"]),

    # HEALTH & WELLNESS
    (["médico", "hospital", "enfermo", "dolor", "salud", "consulta", "doctor"],
     "health and doctors", ["En el médico", "La consulta", "La visita al médico"]),
    (["deporte", "ejercicio", "gimnasio", "correr", "nadar", "entrenar", "entrenamiento"],
     "exercise and fitness", ["El ejercicio", "En el gimnasio", "Hacer deporte"]),
    (["fútbol", "partido", "equipo", "gol", "campo", "balón"],
     "football", ["El partido", "Día de fútbol", "El fútbol"]),
    (["bicicleta", "pedalear", "ciclismo", "pedal"],
     "cycling", ["En bicicleta", "El paseo en bicicleta"]),
    (["caminar", "paseo", "andar", "senderismo", "ruta", "montaña"],
     "going for a walk", ["El paseo", "Caminando", "Un paseo"]),

    # FAMILY & RELATIONSHIPS
    (["familia", "padre", "madre", "hermano", "hermana", "papá", "mamá", "padres", "abuelo", "abuela"],
     "family life", ["En familia", "La familia", "Un día en familia"]),
    (["hijo", "hija", "niño", "niña", "bebé", "pequeño"],
     "family and children", ["Los niños", "En familia", "La familia"]),
    (["amigo", "amiga", "amistad", "amigos", "quedamos", "quedar"],
     "friendship", ["Entre amigos", "Los amigos", "Un día con amigos"]),
    (["novio", "novia", "pareja", "relación", "amor", "romántico"],
     "relationships", ["El amor", "La pareja", "Una relación"]),
    (["vecino", "vecina", "vecinos", "comunidad", "barrio", "bloque"],
     "neighbours and community", ["Los vecinos", "El barrio", "La comunidad"]),

    # TRAVEL & TRANSPORT
    (["viaje", "viajar", "maleta", "aeropuerto", "avión", "vuelo", "turista"],
     "travel", ["El viaje", "De viaje", "Un viaje"]),
    (["tren", "estación", "andén", "billete", "vagón"],
     "train journey", ["En el tren", "El tren", "El viaje en tren"]),
    (["autobús", "parada", "bus", "transporte"],
     "bus journey", ["En el autobús", "El autobús"]),
    (["coche", "conducir", "carretera", "tráfico", "aparcar"],
     "driving", ["En coche", "El coche", "En la carretera"]),
    (["playa", "mar", "arena", "ola", "nadar", "costa", "sol"],
     "a day at the beach", ["La playa", "Un día en la playa", "El mar"]),
    (["vacaciones", "verano", "descanso", "escapada"],
     "holidays", ["Las vacaciones", "Días de descanso"]),
    (["hotel", "habitación", "recepción", "reserva", "turismo"],
     "staying at a hotel", ["En el hotel", "El hotel"]),
    (["ciudad", "calle", "edificio", "centro", "plaza"],
     "exploring the city", ["La ciudad", "Por la ciudad", "Un paseo por la ciudad"]),
    (["pueblo", "campo", "naturaleza", "rural", "tranquilo"],
     "the countryside", ["El pueblo", "En el campo"]),

    # WEATHER & SEASONS
    (["lluvia", "llover", "lloviendo", "paraguas", "tormenta", "trueno"],
     "rainy day", ["La lluvia", "Un día de lluvia", "Día lluvioso"]),
    (["invierno", "frío", "nieve", "abrigo", "bufanda", "calefacción"],
     "winter", ["En invierno", "El frío del invierno"]),
    (["primavera", "flores", "florecer", "brotes"],
     "spring", ["La primavera", "Llega la primavera"]),
    (["verano", "calor", "sol ", "helado", "piscina"],
     "summer", ["En verano", "El calor del verano"]),
    (["otoño", "hojas", "caen las hojas"],
     "autumn", ["El otoño", "Llega el otoño"]),

    # SHOPPING & ERRANDS
    (["tienda", "comprar", "precio", "dinero", "oferta", "barato"],
     "shopping", ["De compras", "En la tienda", "Las compras"]),
    (["ropa", "camiseta", "pantalón", "zapato", "vestido", "camisa"],
     "clothes shopping", ["La ropa nueva", "De compras", "Comprando ropa"]),
    (["regalo", "cumpleaños", "fiesta", "celebrar", "celebración", "sorpresa"],
     "celebration", ["La fiesta", "El cumpleaños", "Una celebración"]),
    (["navidad", "nochebuena", "nochevieja", "año nuevo"],
     "holiday celebration", ["Las fiestas", "Navidad", "La celebración"]),

    # TECHNOLOGY & MEDIA
    (["teléfono", "móvil", "mensaje", "llamar", "llamada", "pantalla"],
     "phones and communication", ["El teléfono", "La llamada"]),
    (["ordenador", "internet", "correo", "email", "página web"],
     "technology", ["La tecnología", "El ordenador"]),
    (["película", "cine", "actor", "actriz", "serie"],
     "cinema and films", ["El cine", "La película", "Una película"]),
    (["música", "canción", "tocar", "instrumento", "guitarra", "piano", "concierto"],
     "music", ["La música", "El concierto", "Una canción"]),
    (["foto", "fotografía", "cámara", "imagen"],
     "photography", ["Las fotos", "La fotografía"]),

    # EMOTIONS & REFLECTIONS
    (["recuerdo", "recordar", "pasado", "nostalgia", "memoria", "infancia", "niñez"],
     "memories and nostalgia", ["Los recuerdos", "Recuerdos", "Mirando atrás"]),
    (["soledad", "solo ", "estar solo", "silencio", "tranquilidad"],
     "solitude and reflection", ["La soledad", "El silencio", "Un momento a solas"]),
    (["cambio", "cambiar", "decisión", "decidir", "nueva vida", "empezar"],
     "life changes", ["Un cambio", "Empezar de nuevo", "El cambio"]),
    (["miedo", "preocupación", "nervios", "ansioso", "ansiedad", "preocupar"],
     "fears and worries", ["El miedo", "Las preocupaciones"]),
    (["felicidad", "feliz", "contento", "alegría", "sonreír", "sonrisa"],
     "happiness", ["La alegría", "Un buen momento"]),
    (["triste", "tristeza", "llorar", "pérdida", "perder", "echar de menos"],
     "sadness and loss", ["La pérdida", "Echar de menos"]),

    # NATURE & ANIMALS
    (["perro", "gato", "mascota", "animal", "veterinario"],
     "pets and animals", ["La mascota", "El perro", "Los animales"]),
    (["parque", "banco", "árbol", "árboles", "hierba", "lago"],
     "time in the park", ["El parque", "En el parque", "Un rato en el parque"]),
    (["río", "agua", "pescar", "barca"],
     "by the river", ["El río", "Junto al río"]),

    # LANGUAGE & CULTURE
    (["idioma", "lengua", "hablar", "español", "inglés", "palabra", "aprender"],
     "learning a language", ["Aprender un idioma", "Las palabras"]),
    (["cultura", "tradición", "costumbre", "sociedad"],
     "culture and traditions", ["Las tradiciones", "La cultura"]),
    (["pintura", "arte", "museo", "cuadro", "exposición", "galería"],
     "art and museums", ["El museo", "El arte", "La exposición"]),

    # MISCELLANEOUS
    (["carta", "escribir", "correo", "sobre", "buzón"],
     "letters and correspondence", ["La carta", "Una carta"]),
    (["sábado", "domingo", "fin de semana"],
     "weekend plans", ["El fin de semana", "Un sábado tranquilo"]),
    (["lunes", "martes", "miércoles", "jueves", "viernes", "semana"],
     "a day in the week", ["Un día cualquiera", "Entre semana"]),
]

# Higher-level abstract themes for C1/C2 passages
ABSTRACT_RULES = [
    (["identidad", "quién soy", "definir", "definirse"],
     "identity and self-definition", ["La identidad", "Quién soy"]),
    (["tiempo ", "reloj", "pasado", "futuro", "presente", "prisa", "lento"],
     "the nature of time", ["El tiempo", "El paso del tiempo"]),
    (["lenguaje", "palabras", "decir", "expresar", "comunicar", "silencio"],
     "language and communication", ["Las palabras", "El lenguaje", "Lo que no se dice"]),
    (["muerte", "morir", "murió", "pérdida", "duelo", "ausencia"],
     "loss and grief", ["La ausencia", "La pérdida", "Lo que queda"]),
    (["libertad", "libre", "elegir", "elección"],
     "freedom and choice", ["La libertad", "Elegir"]),
    (["justicia", "injusticia", "derecho", "ley", "juicio"],
     "justice and fairness", ["La justicia", "Lo justo"]),
    (["educación", "enseñar", "aprender", "conocimiento", "saber"],
     "education and knowledge", ["El aprendizaje", "Aprender"]),
    (["rutina", "costumbre", "hábito", "repetir", "siempre igual"],
     "routines and habits", ["La rutina", "Las costumbres"]),
    (["confianza", "confiar", "fiar"],
     "trust", ["La confianza", "Confiar"]),
    (["generosidad", "generoso", "dar", "compartir", "ayudar"],
     "generosity and giving", ["La generosidad", "Dar y recibir"]),
    (["éxito", "fracaso", "ganar", "perder", "lograr"],
     "success and failure", ["El éxito", "Ganar y perder"]),
    (["verdad", "mentira", "honesto", "sincero", "engañar"],
     "truth and honesty", ["La verdad", "Ser sincero"]),
    (["paciencia", "esperar", "espera", "calma"],
     "patience and waiting", ["La paciencia", "Saber esperar"]),
    (["creatividad", "crear", "imaginar", "imaginación", "inventar"],
     "creativity and imagination", ["La creatividad", "Crear"]),
    (["naturaleza", "bosque", "montaña", "cielo", "tierra", "paisaje"],
     "nature and the environment", ["La naturaleza", "El paisaje"]),
    (["tecnología", "digital", "red", "algoritmo", "inteligencia artificial"],
     "technology and society", ["La tecnología", "El mundo digital"]),
    (["responsabilidad", "deber", "obligación", "compromiso"],
     "responsibility and duty", ["La responsabilidad", "El deber"]),
    (["nostalgia", "pasado", "recuerdo", "antes", "infancia"],
     "nostalgia", ["La nostalgia", "Lo que fue"]),
    (["viaje interior", "reflexión", "pensar", "filosof"],
     "personal reflection", ["Reflexiones", "Pensar en voz alta"]),
]


def detect_theme(passage_text):
    """Detect the theme from passage text, return (topic_en, title_es)."""
    text_lower = passage_text.lower()

    best_score = 0
    best_topic = None
    best_titles = None

    # Check abstract rules first (for higher-level passages)
    for keywords, topic, titles in ABSTRACT_RULES:
        score = sum(1 for kw in keywords if kw in text_lower)
        if score > best_score:
            best_score = score
            best_topic = topic
            best_titles = titles

    # Check concrete theme rules
    for keywords, topic, titles in THEME_RULES:
        score = sum(1 for kw in keywords if kw in text_lower)
        if score > best_score:
            best_score = score
            best_topic = topic
            best_titles = titles

    if best_topic and best_score >= 1:
        return best_topic, best_titles[0]

    return None, None


def extract_title_from_text(passage_text):
    """Extract a title from the first sentence if no theme matched."""
    # Get the first sentence
    first_sent = re.split(r'[.!?]', passage_text)[0].strip()

    # If it's short enough, use it directly
    if len(first_sent) <= 50:
        return first_sent

    # Try to find a key noun phrase at the start
    # Look for "Es/Hoy es/Hay" patterns
    m = re.match(r'^((?:Hoy |Ayer |Esta |Este |El |La |Los |Las |Mi |Un |Una ).{5,30}?)[,.]', first_sent)
    if m:
        return m.group(1).strip()

    # Truncate first sentence to ~40 chars at a word boundary
    if len(first_sent) > 40:
        truncated = first_sent[:40].rsplit(' ', 1)[0]
        return truncated

    return first_sent


def generate_topic_from_text(passage_text):
    """Generate a generic English topic when no theme matched."""
    text_lower = passage_text.lower()

    # Try to detect broad categories
    if any(w in text_lower for w in ["hoy ", "ayer ", "esta mañana", "esta tarde"]):
        return "a personal experience"
    if any(w in text_lower for w in ["siempre", "cada día", "todos los días", "costumbre"]):
        return "daily life"
    if any(w in text_lower for w in ["creo que", "pienso que", "me parece", "opino"]):
        return "personal opinion"
    if any(w in text_lower for w in ["cuando era", "de pequeño", "de niño"]):
        return "childhood memories"

    return "daily life"


def process_file(filepath):
    """Read a JSON file, fill in title and topic, and write back."""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    passage = data.get("passage_text", "")
    if not passage:
        return False, "empty passage"

    # Skip if already filled
    if data.get("title") and data.get("topic"):
        return True, "already filled"

    # Detect theme
    topic, title = detect_theme(passage)

    if not topic:
        topic = generate_topic_from_text(passage)
    if not title:
        title = extract_title_from_text(passage)

    data["title"] = title
    data["topic"] = topic

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')

    return True, f"title={title!r}, topic={topic!r}"


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    files = sorted(glob.glob(os.path.join(base_dir, '*.json')))

    total = 0
    filled = 0
    errors = []

    for fp in files:
        total += 1
        ok, msg = process_file(fp)
        if ok:
            filled += 1
        else:
            errors.append(f"{os.path.basename(fp)}: {msg}")

    print(f"\n=== Title/Topic Fill Summary ===")
    print(f"Files processed: {total}")
    print(f"Files updated:   {filled}")
    print(f"Errors:          {len(errors)}")
    if errors:
        for e in errors:
            print(f"  - {e}")

    # Show sample results
    print(f"\n=== Sample Results ===")
    import random
    sample = random.sample(files, min(10, len(files)))
    for fp in sorted(sample):
        with open(fp) as f:
            d = json.load(f)
        print(f"  {os.path.basename(fp)}: title={d['title']!r}, topic={d['topic']!r}")


if __name__ == '__main__':
    main()
