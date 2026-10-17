import type { CalendarOutT } from "../schemas/calendar.js";
import { isObject, asArray, asString } from "../lib/walk.js";

// /home-service/v1/calendar/overview (and /recovery) return the month grid:
//   { calendar_title_display: "MAY", days_of_month: [
//       { date_value_display: "1", has_data: true, cycle_id, day_state: "MEDIUM_RECOVERY" }, ... ] }
// The grid only exposes the recovery STATE per day (LOW/MEDIUM/HIGH_RECOVERY),
// not numeric recovery/sleep/strain scores — those aren't in this payload, so
// they stay null. (Numeric per-day scores would require 30 deep-dive calls.)

interface ProjectCalendarInput {
  overview: unknown;
  recovery: unknown;
  date: string;
}

const STATE: Record<string, "GREEN" | "YELLOW" | "RED"> = {
  HIGH_RECOVERY: "GREEN",
  MEDIUM_RECOVERY: "YELLOW",
  LOW_RECOVERY: "RED",
};

export function projectCalendar(input: ProjectCalendarInput): CalendarOutT {
  const month = input.date.slice(0, 7); // "2026-05"
  // overview + recovery carry the same day_state grid; prefer recovery, fall back to overview.
  const recovery = isObject(input.recovery) ? input.recovery : {};
  const overview = isObject(input.overview) ? input.overview : {};
  const grid = asArray(recovery.days_of_month).length ? asArray(recovery.days_of_month) : asArray(overview.days_of_month);

  const days: CalendarOutT["days"] = [];
  for (const d of grid) {
    if (!isObject(d)) continue;
    if (d.has_data === false) continue;
    const dayNum = asString(d.date_value_display);
    if (!dayNum) continue;
    const state = asString(d.day_state);
    days.push({
      date: `${month}-${dayNum.padStart(2, "0")}`,
      recovery_score: null,
      recovery_state: state ? (STATE[state] ?? null) : null,
      sleep_score: null,
      day_strain: null,
    });
  }
  return { month, days };
}
