import type { StressOutT } from "../schemas/stress.js";
import { isObject, asArray, asNumber, asString, labelToNumber } from "../lib/walk.js";
import { clockLabelToMinutes, wallClockIso } from "../lib/timezone.js";

// /health-service/v2/stress-bff returns (note: NOT the older `stress_state.timeline`
// shape — `stress_state` is a STRING like "RELAXED"/"CALIBRATING"):
//   stress_state              → headline state string ("RELAXED", "STRESSED", …)
//   calibration_text_display  → non-null while the metric is still calibrating
//   gauge: {
//     gauge_score_display  "0.6"   → current stress level (0–3 scale)
//     gauge_subtext_display "LOW"
//     gauge_min_display "0.0", gauge_max_display "3.0"
//   }
//   stress_graph.graph.plots[].plot.segments[].points[].data_scrubber_details:
//     primary_contextual_display "9:38 AM"  → local clock label
//     value_display "1.0"                   → stress level at that point
//     secondary_contextual_display "LOW"

// Cap on emitted timeline points. The raw graph holds ~700 intraday samples,
// which is useless noise in an LLM context; we evenly downsample to this many.
const MAX_TIMELINE_POINTS = 48;

interface RawPoint {
  clockMin: number;
  level: number | null;
}

function collectPoints(graph: unknown): RawPoint[] {
  const g = isObject(graph) ? graph : {};
  const out: RawPoint[] = [];
  for (const p of asArray(g.plots)) {
    if (!isObject(p)) continue;
    const plot = isObject(p.plot) ? (p.plot as Record<string, unknown>) : null;
    if (!plot) continue;
    for (const seg of asArray(plot.segments)) {
      if (!isObject(seg)) continue;
      for (const pt of asArray(seg.points)) {
        if (!isObject(pt)) continue;
        const dsd = isObject(pt.data_scrubber_details) ? (pt.data_scrubber_details as Record<string, unknown>) : {};
        const clockMin = clockLabelToMinutes(asString(dsd.primary_contextual_display));
        if (clockMin === null) continue;
        out.push({ clockMin, level: labelToNumber(asString(dsd.value_display)) });
      }
    }
  }
  return out;
}

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]!);
  // Always include the final point so the timeline ends at the latest reading.
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]!);
  return out;
}

export function projectStress(raw: unknown, date: string): StressOutT {
  const root = isObject(raw) ? raw : {};
  const gauge = isObject(root.gauge) ? (root.gauge as Record<string, unknown>) : {};

  // stress_graph wraps the plottable data under `.graph`.
  const stressGraph = isObject(root.stress_graph) ? (root.stress_graph as Record<string, unknown>) : {};
  const points = collectPoints(stressGraph.graph);
  const levels = points.map((p) => p.level).filter((v): v is number => v !== null);

  // Current level from the gauge (the headline number the app shows); fall back
  // to the last graphed sample.
  const currentLevel =
    labelToNumber(asString(gauge.gauge_score_display)) ??
    (levels.length > 0 ? levels[levels.length - 1]! : null);

  const calibrating =
    asString(root.calibration_text_display) !== null ||
    asString(root.stress_state) === "CALIBRATING";

  // Pair consecutive downsampled samples into [started_at, ended_at) intervals.
  const sampled = downsample(points, MAX_TIMELINE_POINTS);
  const timeline = sampled.map((p, i) => {
    const next = sampled[i + 1] ?? p;
    const toIso = (min: number): string => wallClockIso(date, Math.floor(min / 60), min % 60);
    return { started_at: toIso(p.clockMin), ended_at: toIso(next.clockMin), level: p.level };
  });

  return {
    date,
    current_level: currentLevel,
    baseline_level: null,
    peak_level: levels.length > 0 ? Math.max(...levels) : null,
    min_level: levels.length > 0 ? Math.min(...levels) : null,
    calibration_state: calibrating ? "CALIBRATING" : "CALIBRATED",
    timeline,
  };
}
