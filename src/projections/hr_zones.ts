import type { HrZonesOutT } from "../schemas/settings.js";
import { isObject, asArray, asBool, asNumber, asString } from "../lib/walk.js";

interface ProjectHrZonesInput {
  zones: unknown;
  settings: unknown;
}

const VALID_ZONE_IDS = ["ZONE_1", "ZONE_2", "ZONE_3", "ZONE_4", "ZONE_5"] as const;
type ZoneId = typeof VALID_ZONE_IDS[number];

export function projectHrZones(input: ProjectHrZonesInput): HrZonesOutT {
  const zones = isObject(input.zones) ? input.zones as Record<string, unknown> : {};
  const settings = isObject(input.settings) ? input.settings as Record<string, unknown> : {};

  // Max HR lives in settings.heart_rate_entry_row (an array of {id, value} rows,
  // id "MAX_HR"); fall back to the zones-screen entry field.
  let maxHr: number | null = null;
  for (const r of asArray(settings.heart_rate_entry_row)) {
    if (isObject(r) && asString(r.id) === "MAX_HR") maxHr = asNumber(r.value);
  }
  if (maxHr === null && isObject(zones.max_hr_entry_field)) {
    maxHr = asNumber((zones.max_hr_entry_field as Record<string, unknown>).value);
  }

  const zoneList = asArray(zones.zones)
    .map((z) => {
      if (!isObject(z)) return null;
      const id = asString(z.id);
      if (!id || !(VALID_ZONE_IDS as readonly string[]).includes(id)) return null;
      const min = asNumber(z.min) ?? 0;
      const max = asNumber(z.max) ?? 0;
      return { id: id as ZoneId, min, max };
    })
    .filter((z): z is { id: ZoneId; min: number; max: number } => z !== null);

  return {
    max_hr: maxHr,
    is_custom: asBool(zones.is_custom) ?? false,
    effective_timestamp: asString(zones.effective_timestamp),
    zones: zoneList,
  };
}
