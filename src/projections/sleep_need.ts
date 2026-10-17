import type { SleepNeedOutT } from "../schemas/sleep_need.js";
import { isObject, asNumber, asString, asBool } from "../lib/walk.js";

// /coaching-service/v2/sleepneed shape:
//   need_breakdown: { total, baseline, naps, strain, debt }   <- all MILLISECONDS
//   recommended_time_in_bed_formatted: { "70": {...}, "85": {...}, "100": {...},
//       weekly_plan: {...}, optimize_sleep: {...} }
//     each tier: { recommended_time_in_bed (ms), recommended_time_in_bed_time_string ("8:45"),
//       optimal_endpoints_formatted: { start, end }, ... }
//   alarm_schedule_state ("OFF"), next_schedule_day_label, eligible_for_smart_alarms
// The "85" tier is Whoop's standard (85% sleep-performance) recommendation.

const msToMin = (ms: number | null): number | null => (ms === null ? null : Math.round(ms / 60000));

export function projectSleepNeed(raw: unknown): SleepNeedOutT {
  const root = isObject(raw) ? raw : {};
  const need = isObject(root.need_breakdown) ? (root.need_breakdown as Record<string, unknown>) : {};
  const recFmt = isObject(root.recommended_time_in_bed_formatted)
    ? (root.recommended_time_in_bed_formatted as Record<string, unknown>)
    : {};
  const tier = isObject(recFmt["85"]) ? (recFmt["85"] as Record<string, unknown>) : {};

  return {
    recommended_time_in_bed: asString(tier.recommended_time_in_bed_time_string),
    recommended_time_in_bed_minutes: msToMin(asNumber(tier.recommended_time_in_bed)),
    need_breakdown: {
      baseline_minutes: msToMin(asNumber(need.baseline)),
      debt_minutes: msToMin(asNumber(need.debt)),
      strain_minutes: msToMin(asNumber(need.strain)),
      nap_credit_minutes: msToMin(asNumber(need.naps)),
    },
    next_schedule_day: asString(root.next_schedule_day_label),
    smart_alarm_eligible: asBool(root.eligible_for_smart_alarms) ?? false,
    schedule_state: asString(root.alarm_schedule_state),
  };
}
