import type { CycleOutT } from "../schemas/womens_health.js";
import { isObject, asArray, asBool, asNumber, asString, findByType } from "../lib/walk.js";

// /womens-health-service/v1/menstrual-cycle-insights?date=YYYY-MM-DD returns a
// tiles[] BFF (NOT flat fields). The data lives in:
//   HEADER_TILE          content.title_display "Cycle Day 11",
//                        content.subtitle_display "Luteal Phase", content.style "LUTEAL"
//   CALENDAR_TILE        content.calendar.days_of_month[]:
//                        { date "2026-05-21", phase, day_state "PERIOD", first_day_of_phase }
//   TYPICAL_CYCLE_TILE   content.stats[]: { title_display "CYCLE LENGTH", value_display "-"|"28" }
//   CYCLE_PHASE_COACHING content.destination.parameters.phase "LUTEAL"
//
// Hormonal mode / contraception / pregnancy are account-settings that this BFF
// does NOT carry, so they stay null here.
//
// The previous projection looked for tile types CYCLE_PHASE_TILE / HORMONAL_MODE_TILE
// that don't exist in the response, so every field returned null even on a fully
// populated 200 (women's-health enabled, mid-cycle).

function tileByType(tiles: unknown[], type: string): Record<string, unknown> | null {
  for (const t of tiles) {
    if (isObject(t) && asString(t.type) === type) return t;
  }
  return null;
}

function contentOf(tile: Record<string, unknown> | null): Record<string, unknown> {
  return tile && isObject(tile.content) ? (tile.content as Record<string, unknown>) : {};
}

export function projectCycle(raw: unknown, date: string): CycleOutT {
  const root = isObject(raw) ? raw : {};
  const tiles = asArray(root.tiles);

  const header = contentOf(tileByType(tiles, "HEADER_TILE"));
  // "Cycle Day 11" → 11
  const dayMatch = (asString(header.title_display) ?? "").match(/(\d+)/);
  const cycleDay = dayMatch ? Number(dayMatch[1]) : null;
  // Human-readable phase ("Luteal Phase"); fall back to the style enum ("LUTEAL").
  const phase = asString(header.subtitle_display) ?? asString(header.style);

  // "CYCLE LENGTH" stat — value_display is "-" until there's enough history, so
  // asNumber yields null in that case (correct).
  const typical = contentOf(tileByType(tiles, "TYPICAL_CYCLE_TILE"));
  let cycleLength: number | null = null;
  for (const s of asArray(typical.stats)) {
    if (isObject(s) && /CYCLE LENGTH/i.test(asString(s.title_display) ?? "")) {
      cycleLength = asNumber(s.value_display);
    }
  }

  // Forward-looking predictions from the calendar: the earliest first-day-of-phase
  // marker on/after `date` for menstruation (next period) and ovulation. Null when
  // the predicted day falls outside the month the BFF returned.
  const calendar = contentOf(tileByType(tiles, "CALENDAR_TILE"));
  const calObj = isObject(calendar.calendar) ? (calendar.calendar as Record<string, unknown>) : {};
  const days = asArray(calObj.days_of_month);
  const nextPhaseStart = (phaseName: string): string | null => {
    let best: string | null = null;
    for (const d of days) {
      if (!isObject(d) || d.first_day_of_phase !== true) continue;
      if (asString(d.phase) !== phaseName) continue;
      const dDate = asString(d.date);
      if (!dDate || dDate < date) continue; // ISO dates compare lexicographically
      if (best === null || dDate < best) best = dDate;
    }
    return best;
  };

  // Hormonal mode / contraception / pregnancy aren't in this BFF; keep the
  // defensive lookup in case a variant carries them, otherwise null.
  const modeTile = findByType(root, "HORMONAL_MODE_TILE");

  return {
    date,
    phase,
    cycle_day: cycleDay,
    cycle_length: cycleLength,
    next_period_predicted_date: nextPhaseStart("MENSTRUAL"),
    ovulation_predicted_date: nextPhaseStart("OVULATORY"),
    hormonal_mode: modeTile ? asString(modeTile.mode) : null,
    contraception_type: modeTile ? asString(modeTile.contraception_type) : null,
    is_pregnant: modeTile ? asBool(modeTile.is_pregnant) : null,
  };
}
