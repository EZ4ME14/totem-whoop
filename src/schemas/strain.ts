import { z } from "zod";
import { HrZoneDurations } from "./primitives.js";

export const StrainOut = z.object({
  date: z.iso.date(),
  score: z.number().nullable(),
  // Whoop's daily strain target: the recovery-calibrated value Whoop wants you
  // to hit today. `value` is the suggested target; `optimal_lower` and
  // `optimal_upper` bound the green zone. All on the 0–21 strain scale.
  // Raw API stores these as 0–1 decimals (percentage of max strain 21); the
  // projection multiplies by 21 so the output is a strain value, not a fraction.
  target: z.object({
    value: z.number().nullable(),
    optimal_lower: z.number().nullable(),
    optimal_upper: z.number().nullable(),
  }),
  calories: z.number().int().nullable(),
  avg_hr_bpm: z.number().nullable(),
  max_hr_bpm: z.number().nullable(),
  zone_durations: HrZoneDurations,
  workouts_count: z.number().int(),
  steps: z.number().int().nullable(),
  strength_activity_time_ms: z.number().int().nullable(),
});
export type StrainOutT = z.infer<typeof StrainOut>;
