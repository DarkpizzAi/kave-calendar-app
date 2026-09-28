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

/* Groups are display-only (settings grid, event-form picker) -- they don't
   touch `type`, so nothing stored on an event or in prefs changes. */
export const GROUPS = ["Nightlife & Social", "Entertainment & Leisure", "Outdoors", "Travel & Work", "Other"];

export const CATEGORIES = [
  /* 🎶 is the default; the old CD icon is retired */
  { type: "live-music", label: "Live music", group: "Nightlife & Social", icons: [{ icon: "🎶" }, { icon: "🎸", note: "rock" }, { icon: "🎻", note: "classical" }] },
  { type: "clubbing", label: "Clubbing", group: "Nightlife & Social", icons: [{ icon: "🪩" }, { icon: "dancing" }] },
  { type: "drinks", label: "Drinks", group: "Nightlife & Social", icons: [{ icon: "🍺" }, { icon: "🍷" }, { icon: "🥂" }, { icon: "🍹" }, { icon: "🍻", note: "pre-drinks" }] },
  { type: "eating", label: "Eating out", group: "Nightlife & Social", icons: [{ icon: "🍔" }, { icon: "🥩" }, { icon: "🍕" }, { icon: "🍝" }, { icon: "🍜" }, { icon: "🍙" }, { icon: "🍣" }, { icon: "🌮" }, { icon: "🥞", note: "brunch" }, { icon: "☕", note: "coffee" }] },
  { type: "birthday", label: "Birthday party", group: "Nightlife & Social", icons: [{ icon: "🎂" }] },
  { type: "cinema", label: "Cinema", group: "Entertainment & Leisure", icons: [{ icon: "🎬" }] },
  { type: "activity", label: "Paid activity", group: "Entertainment & Leisure", icons: [{ icon: "🎟" }, { icon: "🏛", note: "museum" }, { icon: "🖼", note: "exhibition" }, { icon: "🏺", note: "pottery" }, { icon: "🎨", note: "workshop" }, { icon: "🎤", note: "karaoke" }, { icon: "🎭", note: "theatre" }, { icon: "🩰", note: "ballet" }, { icon: "🎳", note: "bowling" }, { icon: "🎢", note: "amusement park" }, { icon: "🧗", note: "climbing" }] },
  { type: "games", label: "Games", group: "Entertainment & Leisure", icons: [{ icon: "🎮", note: "videogames" }, { icon: "🎲", note: "board games" }] },
  { type: "park", label: "Park or hang out", group: "Outdoors", icons: [{ icon: "🌳" }, { icon: "🧺" }, { icon: "☀️" }] },
  { type: "beach", label: "Beach", group: "Outdoors", icons: [{ icon: "🏖" }] },
  { type: "sport", label: "Sport or exercise", group: "Outdoors", icons: [{ icon: "weights" }, { icon: "running" }, { icon: "🏅", note: "a race" }, { icon: "🎾", note: "tennis" }, { icon: "🏓", note: "padel" }] },
  { type: "hike", label: "Hike", group: "Outdoors", icons: [{ icon: "🥾" }] },
  { type: "business-trip", label: "Business trip", group: "Travel & Work", icons: [{ icon: "💼" }] },
  { type: "work", label: "Work event", group: "Travel & Work", icons: [{ icon: "🏢" }] },
  { type: "visitor", label: "Visitor", group: "Travel & Work", icons: [{ icon: "🧳" }, { icon: "🏠", note: "staying with us" }] },
  { type: "transport", label: "Transport", group: "Travel & Work", icons: [{ icon: "✈️", note: "flight" }, { icon: "🛫", note: "outbound" }, { icon: "🛬", note: "return" }, { icon: "🚄", note: "train" }, { icon: "🚌", note: "bus" }, { icon: "🚗", note: "car" }, { icon: "🚢", note: "boat" }] },
  { type: "accommodation", label: "Accommodation", group: "Travel & Work", icons: [{ icon: "🏨" }, { icon: "🏡" }, { icon: "⛺" }] },
  { type: "none", label: "Other", group: "Other", icons: [{ icon: "📌" }] },
];

const BY_TYPE = new Map(CATEGORIES.map((c) => [c.type, c]));
export const categoryOf = (type) => BY_TYPE.get(type) || BY_TYPE.get("none");

/* The emoji to draw for one activity of one event, for one viewer. Only
   ever a catalogue icon: a stored icon the catalogue does not list (a
   retired one, or anything that is not an icon at all) falls back to the
   category's first, so synced data never decides what reaches the page. */
export function iconFor(activity, event, viewer) {
  const cat = BY_TYPE.get(activity && activity.type);
  if (!cat) return "📌";
  const listed = activity.icon && cat.icons.some((i) => i.icon === activity.icon);
  const key = listed ? activity.icon : cat.icons[0].icon;
  const person = PERSON_ICONS[key];
  if (person) return person[event.owner === "shared" ? viewer : event.owner] || person.isa;
  return key;
}
