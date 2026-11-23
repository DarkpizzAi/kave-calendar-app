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
  { type: "drinks", label: "Drinks", group: "Nightlife & Social", icons: [{ icon: "🍺" }, { icon: "🥂" }, { icon: "🍹" }, { icon: "🍻", note: "pre-drinks" }, { icon: "🍷" }] },
  { type: "eating", label: "Eating out", group: "Nightlife & Social", icons: [{ icon: "🍴" }, { icon: "🍔" }, { icon: "🍝" }, { icon: "🥞", note: "brunch" }, { icon: "🍜" }, { icon: "🥩" }, { icon: "🍕" }, { icon: "🍙" }, { icon: "🍣" }, { icon: "🌮" }, { icon: "☕", note: "coffee" }, { icon: "🥘", note: "paella" }, { icon: "🥐", note: "croissant" }, { icon: "🍦", note: "ice cream" }] },
  { type: "birthday", label: "Birthday party", group: "Nightlife & Social", icons: [{ icon: "🎂" }] },
  /* At ours: its icons are used by no other category except its sister At a friend's (Isa, 23/11/2026).
     Games was folded in: the controller is here, board games too. */
  { type: "at-ours", label: "At ours", group: "Nightlife & Social", icons: [{ icon: "🛋️" }, { icon: "🍽️", note: "dinner" }, { icon: "🎲", note: "board games" }, { icon: "🎬", note: "movie night" }, { icon: "📺", note: "watch party" }, { icon: "🎮", note: "videogames" }] },
  /* the door is Isa's pick; the other icons are At ours' (23/11/2026) */
  { type: "at-theirs", label: "At a friend's", group: "Nightlife & Social", icons: [{ icon: "🚪" }, { icon: "🍽️", note: "dinner" }, { icon: "🎲", note: "board games" }, { icon: "🎬", note: "movie night" }, { icon: "📺", note: "watch party" }, { icon: "🎮", note: "videogames" }] },
  { type: "hangout", label: "Hangout", group: "Nightlife & Social", icons: [{ icon: "🧑‍🤝‍🧑" }, { icon: "🌳", note: "park" }, { icon: "☀️", note: "outside" }, { icon: "🧺", note: "picnic" }] },
  { type: "celebration", label: "Celebration", group: "Nightlife & Social", icons: [{ icon: "🎉" }, { icon: "💍", note: "wedding" }, { icon: "🍼", note: "baby shower" }, { icon: "🎓", note: "graduation" }, { icon: "👋", note: "goodbye" }, { icon: "🎆", note: "new year" }] },
  { type: "cinema", label: "Cinema", group: "Entertainment & Leisure", icons: [{ icon: "🍿" }] },
  { type: "activity", label: "Paid activity", group: "Entertainment & Leisure", icons: [{ icon: "🎟" }, { icon: "🏆", note: "tournament to watch" }, { icon: "🎭", note: "theatre" }, { icon: "🏛", note: "museum" }, { icon: "🏺", note: "pottery" }, { icon: "🎤", note: "karaoke" }, { icon: "🩰", note: "ballet" }, { icon: "🖼", note: "exhibition" }, { icon: "🎨", note: "workshop" }, { icon: "🎳", note: "bowling" }, { icon: "🎢", note: "amusement park" }, { icon: "🧗", note: "climbing" }, { icon: "🧖", note: "spa" }, { icon: "💆", note: "massage" }, { icon: "🧩", note: "escape room" }] },
  { type: "beach", label: "Beach", group: "Outdoors", icons: [{ icon: "🏖" }] },
  { type: "sport", label: "Sport or exercise", group: "Outdoors", icons: [{ icon: "weights" }, { icon: "running" }, { icon: "🎾", note: "tennis or padel" }] },
  { type: "hike", label: "Hike", group: "Outdoors", icons: [{ icon: "🥾" }] },
  { type: "business-trip", label: "Business trip", group: "Travel & Work", icons: [{ icon: "💼" }] },
  { type: "work", label: "Work event", group: "Travel & Work", icons: [{ icon: "💼" }] },
  { type: "visitor", label: "Visitor", group: "Travel & Work", icons: [{ icon: "🏠" }] },
  { type: "transport", label: "Transport", group: "Travel & Work", icons: [{ icon: "✈️", note: "flight" }, { icon: "🛫", note: "outbound" }, { icon: "🚄", note: "train" }, { icon: "🛬", note: "return" }, { icon: "🚌", note: "bus" }, { icon: "🚗", note: "car" }, { icon: "🚢", note: "boat" }] },
  { type: "accommodation", label: "Accommodation", group: "Travel & Work", icons: [{ icon: "🏨" }, { icon: "🏡" }, { icon: "⛺" }] },
  { type: "health", label: "Health appointment", group: "Other", icons: [{ icon: "🩺" }, { icon: "🦷", note: "dentist" }, { icon: "🩻", note: "x-ray" }] },
  { type: "home", label: "Home and errands", group: "Other", icons: [{ icon: "🧰" }, { icon: "🔧", note: "maintenance" }, { icon: "💶", note: "payment" }, { icon: "🛍️", note: "errand" }] },
  { type: "none", label: "Other", group: "Other", icons: [{ icon: "📌" }] },
];

/* An event has ONE category (spec 2026-11-23): `category` is { type, icon }. A list of `activities` is the
   old shape, still read (all of it) until the data has been migrated; the form only ever writes `category`. */
export const activitiesOf = (e) => (e && e.category && e.category.type ? [e.category] : (e && e.activities) || []);

const BY_TYPE = new Map(CATEGORIES.map((c) => [c.type, c]));
export const categoryOf = (type) => BY_TYPE.get(type) || BY_TYPE.get("none");
/* A category with exactly one possible icon has nothing to choose: the event
   form applies it straight away instead of asking. */
export const onlyIcon = (type) => { const c = BY_TYPE.get(type); return c && c.icons.length === 1 ? c.icons[0].icon : null; };

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
