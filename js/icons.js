/* Compass: the category catalogue (spec, round 1b decisions). A category is
   what an event is; its icon is one of that category's variants. A person
   variant ("running") is drawn for the viewer on a shared event and for the
   owner otherwise: never a neutral "shared" figure. */
"use strict";

const P = (isa, hugo) => ({ isa, hugo });
export const PERSON_ICONS = {
  running: P("🏃‍♀️", "🏃‍♂️"),
  weights: P("🏋️‍♀️", "🏋️‍♂️"),
  dancing: P("💃", "🕺"),
};

export const CATEGORIES = [
  /* F33: the CD icon (💿) is gone; the music notes (🎶) were already the
     first/default icon and stay it. */
  { type: "live-music", label: "Live music", icons: [{ icon: "🎶" }, { icon: "🎸", note: "rock" }, { icon: "🎻", note: "classical" }] },
  { type: "clubbing", label: "Clubbing", icons: [{ icon: "🪩" }, { icon: "dancing" }] },
  { type: "drinks", label: "Drinks", icons: [{ icon: "🍺" }, { icon: "🍷" }, { icon: "🥂" }, { icon: "🍹" }, { icon: "🍻", note: "pre-drinks" }] },
  { type: "eating", label: "Eating out", icons: [{ icon: "🍔" }, { icon: "🥩" }, { icon: "🍕" }, { icon: "🍝" }, { icon: "🍜" }, { icon: "🍙" }, { icon: "🍣" }, { icon: "🌮" }, { icon: "🥞", note: "brunch" }, { icon: "☕", note: "coffee" }] },
  { type: "birthday", label: "Birthday party", icons: [{ icon: "🎂" }] },
  { type: "cinema", label: "Cinema", icons: [{ icon: "🎬" }] },
  { type: "activity", label: "Activity", icons: [{ icon: "🎟" }, { icon: "🏛", note: "museum" }, { icon: "🖼", note: "exhibition" }, { icon: "🏺", note: "pottery" }, { icon: "🎨", note: "workshop" }, { icon: "🎤", note: "karaoke" }, { icon: "🎭", note: "theatre" }, { icon: "🩰", note: "ballet" }, { icon: "🎳", note: "bowling" }, { icon: "🎢", note: "amusement park" }, { icon: "🧗", note: "climbing" }] },
  { type: "games", label: "Games", icons: [{ icon: "🎮", note: "videogames" }, { icon: "🎲", note: "board games" }] },
  { type: "park", label: "Park or hang out", icons: [{ icon: "🌳" }, { icon: "🧺" }, { icon: "☀️" }] },
  { type: "beach", label: "Beach", icons: [{ icon: "🏖" }] },
  { type: "sport", label: "Sport or exercise", icons: [{ icon: "weights" }, { icon: "running" }, { icon: "🏅", note: "a race" }, { icon: "🎾", note: "tennis" }, { icon: "🏓", note: "padel" }] },
  { type: "hike", label: "Hike", icons: [{ icon: "🥾" }] },
  { type: "business-trip", label: "Business trip", icons: [{ icon: "💼" }] },
  { type: "work", label: "Work event", icons: [{ icon: "🏢" }] },
  { type: "visitor", label: "Visitor", icons: [{ icon: "🧳" }, { icon: "🏠", note: "staying with us" }] },
  { type: "transport", label: "Transport", icons: [{ icon: "🛫", note: "outbound" }, { icon: "🛬", note: "return" }, { icon: "🚄", note: "train" }, { icon: "🚌", note: "bus" }, { icon: "🚗", note: "car" }, { icon: "🚢", note: "boat" }] },
  { type: "accommodation", label: "Accommodation", icons: [{ icon: "🏨" }, { icon: "🏡" }, { icon: "⛺" }] },
  { type: "none", label: "Other", icons: [{ icon: "📌" }] },
];

const BY_TYPE = new Map(CATEGORIES.map((c) => [c.type, c]));
export const categoryOf = (type) => BY_TYPE.get(type) || BY_TYPE.get("none");

/* The emoji to draw for one activity of one event, for one viewer. */
export function iconFor(activity, event, viewer) {
  const cat = BY_TYPE.get(activity && activity.type);
  if (!cat) return "📌";
  const key = (activity.icon || cat.icons[0].icon);
  const person = PERSON_ICONS[key];
  if (person) return person[event.owner === "shared" ? viewer : event.owner] || person.isa;
  return key;
}
