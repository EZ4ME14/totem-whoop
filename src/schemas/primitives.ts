import { z } from "zod";

// ISO-8601 datetime that ALSO accepts Whoop's no-colon offset form ("+0000" /
// "-0700", emitted by the journal / pg-range endpoints). zod's
// z.iso.datetime({ offset: true }) accepts only "Z" and "±HH:MM", so a raw
// Whoop timestamp in the no-colon form would fail output validation *before*
// jsonOut's localizeTimestamps gets a chance to normalize it. Use this for any
// field that carries a passthrough Whoop timestamp.
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
export const IsoDateTime = z.string().regex(ISO_DATETIME_RE, "invalid ISO-8601 datetime");

export const PgRange = z.object({
  start: IsoDateTime,
  end: IsoDateTime.nullable(),
});

export const HrZoneDurations = z.object({
  zone_0_ms: z.number().int().nullable(),
  zone_1_ms: z.number().int().nullable(),
  zone_2_ms: z.number().int().nullable(),
  zone_3_ms: z.number().int().nullable(),
  zone_4_ms: z.number().int().nullable(),
  zone_5_ms: z.number().int().nullable(),
});
export type HrZoneDurationsT = z.infer<typeof HrZoneDurations>;

export const RecoveryState = z.enum(["GREEN", "YELLOW", "RED"]);
export const SleepStage = z.enum(["AWAKE", "LIGHT", "REM", "SWS"]);
export const Medal = z.enum(["GOLD", "SILVER", "BRONZE"]);
export const Direction = z.enum(["positive", "negative", "neutral"]);
export const CalibrationState = z.enum(["CALIBRATING", "CALIBRATED"]);

// Re-export from write_safety so schemas/*.ts has one import path.
export { withPreview, WritePreviewSchema } from "../whoop/write_safety.js";
