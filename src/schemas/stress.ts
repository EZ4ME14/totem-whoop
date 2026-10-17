import { z } from "zod";
import { IsoDateTime } from "./primitives.js";

export const StressOut = z.object({
  date: z.iso.date(),
  current_level: z.number().nullable(),
  baseline_level: z.number().nullable(),
  peak_level: z.number().nullable(),
  min_level: z.number().nullable(),
  calibration_state: z.enum(["CALIBRATING", "CALIBRATED"]).nullable(),
  timeline: z.array(z.object({
    started_at: IsoDateTime,
    ended_at: IsoDateTime,
    level: z.number().nullable(),
  })),
});
export type StressOutT = z.infer<typeof StressOut>;
