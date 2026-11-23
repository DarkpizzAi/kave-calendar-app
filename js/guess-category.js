/* Compass: a category guessed from the title (Isa, 23/11/2026). The new-event
   form preselects it while the person types the title, and stops for good the
   moment they pick or remove a category by hand. Pure: a title in, { type, icon }
   or null out. The household's languages are English, French, Spanish and
   Portuguese; text is folded (accents, case) and a word must match whole, so
   "bar" does not fire inside "barcelona". The first rule that matches wins, so
   the more specific ones come first. An icon is only named when the rule means
   one (a flight, a train); otherwise the category's own default is used. */
"use strict";

import { categoryOf } from "./icons.js";

const fold = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const rule = (type, words, icon) => ({ type, icon, rx: new RegExp("(?:^|[^a-z0-9])(?:" + words + ")(?![a-z0-9])") });

const RULES = [
  rule("at-ours", "at ours|chez nous|movie night|film night|game night|games night|board games?|noche de pelis|soiree jeux"),
  rule("business-trip", "business trip|voyage d affaires|viaje de trabajo|viagem de trabalho"),
  rule("work", "offsite|off-site|all hands|standup|stand-up|onsite|team meeting|1:1|sprint|reunion|reuniao"),
  rule("birthday", "birthday|bday|b-day|anniversaire|aniversario|cumpleanos|anos|geburtstag"),
  rule("celebration", "wedding|boda|mariage|casamento|baby shower|graduation|hen party|hen do|stag|new year|nochevieja|reveillon|goodbye party", "🎉"),
  rule("transport", "flight|vuelo|vol|voo|fly|plane", "✈️"),
  rule("transport", "train|tren|comboio|tgv", "🚄"),
  rule("transport", "bus|autobus|coach", "🚌"),
  rule("transport", "ferry|boat|barco|bateau", "🚢"),
  rule("transport", "car rental|rental car|rent a car|taxi|uber"),
  rule("accommodation", "hotel|airbnb|hostel|hostal|apartment|apartamento|check-in|check in|stay in|pousada"),
  rule("sport", "10k|5k|half marathon|marathon|run|running|course a pied", "running"),
  rule("sport", "gym|crossfit|yoga|pilates|padel|tennis lesson|swim|natacion|natation|climbing"),
  rule("activity", "roland garros|wimbledon|us open|australian open|tournament|tournoi|torneo", "🏆"),
  rule("activity", "museum|museo|musee|museu|theatre|teatro|theater|escape room|bowling|karaoke|exhibition|exposicion|expo|spa|massage|amusement park|workshop|pottery|ceramica"),
  rule("cinema", "cinema|cine|film|movie|pelicula|filme"),
  rule("live-music", "concert|concierto|concerto|gig|live music|festival|orchestra|orquesta|recital"),
  rule("clubbing", "club|clubbing|disco|discoteca|rave|boite|party|fiesta|festa"),
  rule("drinks", "drinks|drink|beers|beer|cervezas|cerveja|pints|cocktails?|afterwork|after work|apero|aperitif|aperitivo|copas|wine|vino|vinho|bar"),
  rule("eating", "brunch", "🥞"),
  rule("eating", "dinner|lunch|diner|dejeuner|cena|almuerzo|comida|jantar|almoco|restaurant|restaurante|resto|sushi|ramen|pizza|tapas|burger|pho|tacos|paella|coffee|cafe"),
  rule("hangout", "picnic|pique-nique|piquenique", "🧺"),
  rule("hangout", "park|parque|parc|hangout|hang out|catch up|catch-up|meet up|meetup"),
  rule("beach", "beach|playa|plage|praia"),
  rule("hike", "hike|hiking|trek|trekking|randonnee|senderismo|caminhada|trail"),
  rule("health", "x-ray|xray|radiografia|radiologie", "🩻"),
  rule("health", "dentist|dentista|dentiste", "🦷"),
  rule("health", "doctor|doctora|doctoralia|medico|medecin|physio|fisio|appointment|checkup|check-up|blood test|analisis|cita medica|rdv"),
  rule("visitor", "visitor|visitors|visiting us|visita de"),
  rule("home", "errand|errands|plumber|fontanero|landlord|casero|ikea|repair|reparacion|move out|move-in|moving day|rent"),
];

export function guessCategory(title) {
  const t = fold(title).replace(/['’]/g, " ").trim();
  if (t.length < 3) return null;
  const hit = RULES.find((r) => r.rx.test(t));
  if (!hit) return null;
  const cat = categoryOf(hit.type);
  if (!cat || cat.type !== hit.type) return null;
  /* a rule's icon only counts if the catalogue lists it, so a typo here never reaches the page */
  const icon = hit.icon && cat.icons.some((i) => i.icon === hit.icon) ? hit.icon : cat.icons[0].icon;
  return { type: hit.type, icon };
}

/* What the form's category list should become after the title changed: null for "leave it", else the new
   list (the guess, or empty when the title no longer says anything). A person's own pick or removal
   (manual) ends the suggestions for that form. */
export function suggestFor({ manual, title, current }) {
  if (manual) return null;
  const g = guessCategory(title);
  const next = g ? [{ type: g.type, icon: g.icon }] : [];
  return JSON.stringify(next) === JSON.stringify(current || []) ? null : next;
}
