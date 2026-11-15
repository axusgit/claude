// ============================================================
//  Respuestas en español, según el CONTEXTO del mensaje que ella envía.
//
//  Cómo funciona: se recorre la lista de abajo de arriba hacia abajo.
//  Se usa el PRIMER intent cuyo patrón (match) coincida con su mensaje,
//  y se responde con una frase ELEGIDA AL AZAR de su lista "replies".
//  Si nada coincide, se usa FALLBACK.
//
//  Edita libremente: agrega patrones o frases. Los patrones no distinguen
//  mayúsculas ni acentos (se normaliza el texto antes de comparar).
// ============================================================

const INTENTS = [
  {
    name: "buenas_noches",
    match: [/buenas noches/, /\bbuenas noche\b/, /feliz noche/, /\bbuenas nxhes\b/],
    replies: [
      "Buenas noches 🌙",
      "Descansa 😴",
      "Buenas noches, descansa",
      "Dulces sueños",
      "Hasta mañana 😘",
    ],
  },
  {
    name: "buenos_dias",
    match: [/buenos dias/, /feliz dia/, /como amaneciste/, /buen dia/, /\bbuenos dis\b/],
    replies: [
      "Buenos días ☀️",
      "Buen día",
      "Buenos días 😊",
      "Buenos días, ¿dormiste bien?",
      "Igualmente 😊",
    ],
  },
  {
    name: "buenas_tardes",
    match: [/buenas tardes/, /feliz tarde/],
    replies: [
      "Buenas tardes",
      "Buenas tardes 😊",
      "¿Cómo va el día?",
      "Igualmente",
    ],
  },
  {
    name: "como_estas",
    match: [/como estas/, /como te va/, /que tal/, /como andas/, /todo bien/, /como has estado/],
    replies: [
      "Bien, ¿y tú?",
      "Todo bien, ¿y tú?",
      "Bien bien 😊 ¿tú?",
      "Aquí tranquilo, ¿y tú?",
    ],
  },
  {
    name: "que_haces",
    match: [/que haces/, /que estas haciendo/, /en que andas/, /que mas/],
    replies: [
      "Aquí trabajando",
      "Nada, aquí. ¿Y tú?",
      "Trabajando un poco",
      "Aquí, pensando en ti",
    ],
  },
  {
    name: "amor",
    match: [/te amo/, /te quiero/, /te extraño/, /te extrano/, /mi amor/, /\bamor\b/, /mi vida/, /mi cielo/],
    replies: [
      "Yo también ❤️",
      "Y yo a ti",
      "❤️",
      "Yo más 😘",
    ],
  },
  {
    name: "besos",
    match: [/\bbesos\b/, /\bbeso\b/, /\bmuac\b/, /\bmua\b/, /abrazo/, /abrazos/, /😘|😍|❤|🥰|💕|💋/],
    replies: [
      "😘",
      "Besos",
      "Igual 😘",
      "❤️",
      "Un abrazo",
    ],
  },
  {
    name: "risa",
    match: [/jaja/, /jeje/, /jiji/, /\blol\b/, /😂|🤣/],
    replies: [
      "Jajaja",
      "😂",
      "Jaja sí",
      "Jajaja ay",
    ],
  },
  {
    name: "gracias",
    match: [/gracias/, /\bgracia\b/],
    replies: [
      "De nada",
      "Con gusto",
      "😊",
      "Nada",
    ],
  },
  {
    name: "comida",
    match: [/buen provecho/, /provecho/, /que comiste/, /ya comiste/, /que cenaste/],
    replies: [
      "Buen provecho",
      "Provecho 😋",
      "¿Qué comiste?",
      "Que lo disfrutes",
    ],
  },
  {
    name: "despedida",
    match: [/adios/, /hasta luego/, /nos vemos/, /hasta mañana/, /hasta manana/, /cuidate/, /\bchao\b/, /\bchau\b/, /me voy/],
    replies: [
      "Cuídate",
      "Hablamos",
      "Dale, cuídate 😘",
      "Chao",
      "Ok, hablamos luego",
    ],
  },
  {
    name: "saludo",
    match: [/\bhola\b/, /\bhey\b/, /\bbuenas\b/, /\bholi\b/, /\bhello\b/, /\bholaa+\b/, /\bqiubo\b/, /\bquiubo\b/],
    replies: [
      "Hola",
      "Hola 😊",
      "Hey",
      "Hola, ¿cómo estás?",
      "Holaa",
    ],
  },
];

// Respuestas por defecto si el mensaje no coincide con nada de arriba.
const FALLBACK = [
  "😊",
  "❤️",
  "Ok 😊",
  "Aquí estoy",
  "😘",
];

// --- normaliza: minúsculas y sin acentos ---
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Devuelve una respuesta en español apropiada al mensaje recibido.
function replyFor(incomingText) {
  const text = normalize(incomingText);
  for (const intent of INTENTS) {
    if (intent.match.some((re) => re.test(text))) {
      return { reply: pick(intent.replies), intent: intent.name };
    }
  }
  return { reply: pick(FALLBACK), intent: "fallback" };
}

module.exports = { replyFor };
