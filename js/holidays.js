/* Compass: bank holidays for Barcelona (Catalan official plus the city's two
   local days). Public data, so it ships with the app and works offline.

   Checked 2026-09-24 against:
     2026, 2027: treball.gencat.cat calendari-festes-2026 / -2027 (DOGC) and
                 ajuntament.barcelona.cat/calendarifestius
     2028:       NOT YET PUBLISHED. Provisional: fixed dates plus Easter, with
                 Barcelona's local days assumed (Segona Pasqua, La Merce).
                 Re-check when the Generalitat publishes it (usually spring
                 the year before) and flip STATUS to "official".
   Only the days the official lists name are here; a holiday that falls on a
   weekend in a given year is simply absent from that year. */
"use strict";

export const STATUS = { 2026: "official", 2027: "official", 2028: "provisional" };

export const HOLIDAYS = {
  "2026-01-01": "Cap d'Any", "2026-01-06": "Reis", "2026-04-03": "Divendres Sant", "2026-04-06": "Dilluns de Pasqua",
  "2026-05-01": "Festa del Treball", "2026-05-25": "Segona Pasqua", "2026-06-24": "Sant Joan", "2026-08-15": "L'Assumpció",
  "2026-09-11": "Diada", "2026-09-24": "La Mercè", "2026-10-12": "Festa Nacional d'Espanya", "2026-12-08": "La Immaculada",
  "2026-12-25": "Nadal", "2026-12-26": "Sant Esteve",

  "2027-01-01": "Cap d'Any", "2027-01-06": "Reis", "2027-03-26": "Divendres Sant", "2027-03-29": "Dilluns de Pasqua",
  "2027-05-01": "Festa del Treball", "2027-05-17": "Segona Pasqua", "2027-06-24": "Sant Joan", "2027-09-11": "Diada",
  "2027-09-24": "La Mercè", "2027-10-12": "Festa Nacional d'Espanya", "2027-11-01": "Tots Sants",
  "2027-12-06": "Dia de la Constitució", "2027-12-08": "La Immaculada", "2027-12-25": "Nadal",

  "2028-01-01": "Cap d'Any", "2028-01-06": "Reis", "2028-04-14": "Divendres Sant", "2028-04-17": "Dilluns de Pasqua",
  "2028-05-01": "Festa del Treball", "2028-06-05": "Segona Pasqua", "2028-06-24": "Sant Joan", "2028-08-15": "L'Assumpció",
  "2028-09-11": "Diada", "2028-09-24": "La Mercè", "2028-10-12": "Festa Nacional d'Espanya", "2028-11-01": "Tots Sants",
  "2028-12-06": "Dia de la Constitució", "2028-12-08": "La Immaculada", "2028-12-25": "Nadal", "2028-12-26": "Sant Esteve",
};

export const holidayOn = (day) => HOLIDAYS[day] || null;
export const isProvisional = (day) => STATUS[day.slice(0, 4)] !== "official";
