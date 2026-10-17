import type { TrendOutT } from "../schemas/trend.js";
import { isObject, asArray, asNumber, asString, labelToNumber, timeLabelToMs } from "../lib/walk.js";

// Whoop's /progression-service/v3/trends/{metric} returns named segments:
//   week_time_segment / month_time_segment / six_month_time_segment / year_time_segment
// Each has shape:
//   {
//     date_picker: { current_date_range_display, next_date_time, previous_date_time },
//     metrics: [{ trend_key, metric_name_display, metric_value_display,
//                 metric_units_display, trend_direction, trend_text_display,
//                 current_metric_value, previous_metric_value, metric_change }],
//     graph: { plots: [{ plot: { segments: [{ points: [{ graph_label.label, data_scrubber_details:{ primary_contextual_display, value_display } }] }] } }] },
//     is_hidden
//   }
//
// CRITICAL: metrics is an ARRAY (one entry per overlaid metric). Not an object.
// The data_scrubber_details.value is null on every point — the actual number is
// in value_display (string) and graph_label.label (string).

const NAMED_KEYS = [
  "week_time_segment",
  "month_time_segment",
  "six_month_time_segment",
  "year_time_segment",
] as const;
type WindowLabel = "week" | "month" | "six_month" | "year";

function labelFromKey(k: string): WindowLabel {
  if (k.startsWith("week")) return "week";
  if (k.startsWith("month")) return "month";
  if (k.startsWith("six_month")) return "six_month";
  return "year";
}

interface PointOut {
  date: string;
  value: number | null;
  value_display: string | null;
}

// A display string like "41", "1,644", "97%", or a duration "11:14"/"0:05".
// labelToNumber handles plain/percent/comma numbers; durations fall through to
// timeLabelToMs (→ milliseconds), matching the metric's avg/min/max units which
// Whoop also reports in ms for time-based metrics. Last resort: the raw value.
function parseDisplay(display: string | null, rawValue: unknown): number | null {
  return labelToNumber(display) ?? timeLabelToMs(display) ?? asNumber(rawValue);
}

function extractPoints(graph: unknown): PointOut[] {
  const g = isObject(graph) ? graph : {};
  const out: PointOut[] = [];
  for (const p of asArray(g.plots)) {
    if (!isObject(p)) continue;
    const plot = isObject(p.plot) ? (p.plot as Record<string, unknown>) : null;
    if (!plot) continue;
    // Line plots: segments[].points[]
    for (const seg of asArray(plot.segments)) {
      if (!isObject(seg)) continue;
      for (const pt of asArray(seg.points)) {
        if (!isObject(pt)) continue;
        const graphLabel = isObject(pt.graph_label) ? (pt.graph_label as Record<string, unknown>) : null;
        const label = graphLabel ? asString(graphLabel.label) : null;
        const dsd = isObject(pt.data_scrubber_details) ? (pt.data_scrubber_details as Record<string, unknown>) : {};
        const valueDisplay = asString(dsd.value_display) ?? label;
        out.push({
          date: asString(dsd.primary_contextual_display) ?? "",
          value: parseDisplay(valueDisplay, dsd.value),
          value_display: valueDisplay,
        });
      }
    }
    // Bar plots: bar_groups[].bars[] — the per-bar data_scrubber_details carries
    // both the date (primary_contextual_display) and the value (value_display).
    // This is where time/duration metrics (time in bed, sleep debt, stress
    // durations, HR-zone time, strength activity time) live; the older code read
    // the group-level top_label and lost both. We emit one point per group, using
    // the first bar that carries a value_display.
    for (const grp of asArray(plot.bar_groups)) {
      if (!isObject(grp)) continue;
      const bars = asArray(grp.bars);
      const topLabel = isObject(grp.top_label) ? asString((grp.top_label as Record<string, unknown>).label) : null;
      const candidates = bars.length > 0 ? bars : [grp];
      let chosen: { date: string; value_display: string | null; raw: unknown } | null = null;
      for (const bar of candidates) {
        if (!isObject(bar)) continue;
        const dsd = isObject(bar.data_scrubber_details) ? (bar.data_scrubber_details as Record<string, unknown>) : {};
        const vd = asString(dsd.value_display) ?? topLabel;
        const cand = { date: asString(dsd.primary_contextual_display) ?? "", value_display: vd, raw: dsd.value };
        if (chosen === null) chosen = cand;
        if (vd !== null) { chosen = cand; break; }
      }
      if (chosen === null) continue;
      out.push({
        date: chosen.date,
        value: parseDisplay(chosen.value_display, chosen.raw),
        value_display: chosen.value_display,
      });
    }
  }
  return out;
}

export function projectTrend(raw: unknown, metric: TrendOutT["metric"], endDate: string): TrendOutT {
  const root = isObject(raw) ? raw : {};
  const segments: TrendOutT["segments"] = [];

  function pushSegment(label: WindowLabel, s: Record<string, unknown>) {
    if (s.is_hidden === true) return;
    const dp = isObject(s.date_picker) ? (s.date_picker as Record<string, unknown>) : {};
    // Metrics is an array; take the first (primary) row.
    const metricsArr = asArray(s.metrics);
    const m0 = isObject(metricsArr[0]) ? (metricsArr[0] as Record<string, unknown>) : null;
    const avg = m0 ? asNumber(m0.current_metric_value) : null;
    const deltaPct = m0 ? asNumber(m0.metric_change) : null;
    const unit = m0 ? asString(m0.metric_units_display) : null;
    const points = extractPoints(s.graph);
    const numericPoints = points.map((p) => p.value).filter((v): v is number => v !== null);
    segments.push({
      label,
      start_date: asString(dp.current_date_range_display) ?? "",
      end_date: asString(dp.next_date_time) ?? "",
      avg,
      min: numericPoints.length > 0 ? Math.min(...numericPoints) : null,
      max: numericPoints.length > 0 ? Math.max(...numericPoints) : null,
      delta_pct: deltaPct,
      unit,
      points,
    });
  }

  if (Array.isArray(root.time_segments)) {
    for (const [i, s] of (root.time_segments as Record<string, unknown>[]).entries()) {
      const labels = ["week", "month", "six_month", "year"] as const;
      const label = labels[i] ?? "year";
      pushSegment(label, s);
    }
  }
  for (const k of NAMED_KEYS) {
    const seg = root[k];
    if (isObject(seg)) pushSegment(labelFromKey(k), seg as Record<string, unknown>);
  }

  return {
    metric,
    end_date: endDate,
    segments,
    cardio_fitness_level: asString(root.cardio_fitness_level),
  };
}
