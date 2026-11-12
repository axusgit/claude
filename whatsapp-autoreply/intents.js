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
      "Buenas noches 🌙✨",
      "Buenas noches, que descanses 💤🌟",
      "Igualmente, buenas noches 😴💫",
      "Dulces sueños 🌙💛",
      "Que descanses lindo, buenas noches 😘🌛",
      "Buenas noches, sueña bonito 🌠🥱",
      "Hasta mañana, descansa 💤❤️",
    ],
  },
  {
    name: "buenos_dias",
    match: [/buenos dias/, /feliz dia/, /como amaneciste/, /buen dia/, /\bbuenos dis\b/],
    replies: [
      "Buenos días ☀️😊",
      "Buenos días, que tengas un lindo día 🌞💛",
      "Igualmente, buenos días 🌻",
      "Buen día para ti también ☕💫",
      "¡Buenos días! Que sea un gran día 🌅✨",
      "Buenos días preciosa 😘☀️",
      "Amanecí pensando en ti 🥰🌤️",
    ],
  },
  {
    name: "buenas_tardes",
    match: [/buenas tardes/, /feliz tarde/],
    replies: [
      "Buenas tardes 🌅😊",
      "Buenas tardes, ¿cómo va tu día? ☀️",
      "Igualmente, buenas tardes 💛",
      "¡Buenas tardes! Espero que estés bien 🌼",
      "Buenas tardes, pensando en ti 🥰🌇",
    ],
  },
  {
    name: "como_estas",
    match: [/como estas/, /como te va/, /que tal/, /como andas/, /todo bien/, /como has estado/],
    replies: [
      "Muy bien, gracias 😊 ¿y tú?",
      "Todo bien por aquí 💛 ¿y tú cómo estás?",
      "Aquí todo tranquilo 😌 ¿tú qué tal?",
      "Mejor ahora que me escribes 🥰",
      "Bien, bien 😊 contándote a ti 💫",
    ],
  },
  {
    name: "que_haces",
    match: [/que haces/, /que estas haciendo/, /en que andas/, /que mas/],
    replies: [
      "Aquí pensando en ti 😊💭",
      "Nada interesante, ¿y tú qué haces? 🙂",
      "Ocupadito, pero siempre con tiempo para ti 💛",
      "Justo pensaba en ti 🥰",
      "Por aquí, extrañándote un poquito 😘",
    ],
  },
  {
    name: "amor",
    match: [/te amo/, /te quiero/, /te extraño/, /te extrano/, /mi amor/, /\bamor\b/, /mi vida/, /mi cielo/],
    replies: [
      "Yo también te amo ❤️",
      "Y yo a ti 💕😘",
      "Yo te extraño más 🥰💖",
      "Siempre pensando en ti 💛✨",
      "Eres lo mejor de mi día ❤️🌹",
      "Te quiero muchísimo 😍💞",
      "Mi corazón es tuyo 💘",
    ],
  },
  {
    name: "besos",
    match: [/\bbesos\b/, /\bbeso\b/, /\bmuac\b/, /\bmua\b/, /abrazo/, /abrazos/, /😘|😍|❤|🥰|💕|💋/],
    replies: [
      "Besos para ti 😘💋",
      "Un abrazo bien fuerte 🤗❤️",
      "Muac muac 😚💞",
      "Besitos 😘🥰",
      "Te mando un abrazote 🤗💛",
    ],
  },
  {
    name: "risa",
    match: [/jaja/, /jeje/, /jiji/, /\blol\b/, /😂|🤣/],
    replies: [
      "Jajaja 😂",
      "Me haces reír 🤣💛",
      "Jajaja qué buena 😄",
      "Me sacaste una sonrisa 😊",
    ],
  },
  {
    name: "gracias",
    match: [/gracias/, /\bgracia\b/],
    replies: ["De nada 😊", "Con gusto 💛", "Siempre para ti 🙂", "No hay de qué 🤗", "Cuando quieras 😘"],
  },
  {
    name: "comida",
    match: [/buen provecho/, /provecho/, /que comiste/, /ya comiste/, /que cenaste/],
    replies: [
      "¡Buen provecho! 😋🍽️",
      "Que disfrutes tu comida 😊🥘",
      "Provechito 😋💛",
      "¡A comer rico! 🍴✨",
    ],
  },
  {
    name: "despedida",
    match: [/adios/, /hasta luego/, /nos vemos/, /hasta mañana/, /hasta manana/, /cuidate/, /\bchao\b/, /\bchau\b/, /me voy/],
    replies: [
      "Hasta luego 👋😊",
      "Nos vemos, cuídate mucho 💛",
      "Cuídate, hablamos pronto 😘",
      "Un abrazo, hasta pronto 🤗💫",
      "Que te vaya súper 🌟👋",
    ],
  },
  {
    name: "saludo",
    match: [/\bhola\b/, /\bhey\b/, /\bbuenas\b/, /\bholi\b/, /\bhello\b/, /\bholaa+\b/, /\bqiubo\b/, /\bquiubo\b/],
    replies: [
      "¡Hola! 😊",
      "Hola, ¿cómo estás? 💛",
      "¡Hey! Qué gusto saber de ti 💫",
      "¡Holaa! 🥰",
      "¡Hola hola! 😘",
      "Qué alegría leerte 😊✨",
    ],
  },
];

// Respuestas por defecto si el mensaje no coincide con nada de arriba.
const FALLBACK = [
  "😊💛",
  "Aquí estoy, pensando en ti 💭💛",
  "Qué lindo recibir tu mensaje 💫",
  "Me alegra saber de ti 🥰",
  "Siempre es bueno leerte 😊✨",
  "Un abrazo para ti 🤗",
  "Me hiciste sonreír 😊💞",
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
