import type { BehaviorImpactOutT, BehaviorImpactListOutT } from "../schemas/journal.js";
import { isObject, asArray, asNumber, asString, findAll } from "../lib/walk.js";
import { BEHAVIORS_BY_ID } from "../data/behaviors.js";

// /behavior-impact-service/v1/impact returns a tiles[] BFF:
//   tiles[].type "IMPACT_TILE" (enough data) | "INSUFFICIENT_IMPACT_TILE"
//   tiles[].content.impact_cards[]:
//     impact_uuid                 → the id whoop_behavior_impact(details) needs
//     impact_card_title_display   "Daylight Eating"
//     impact_style                "POSITIVE" | "NEGATIVE" | "INSUFFICIENT"
//     impact_percentage_display   "+7%" (null when insufficient)
//
// This is the ONLY place the impact UUIDs are exposed, so the list mode is what
// makes the detail mode reachable at all.
export function projectBehaviorImpactList(raw: unknown): BehaviorImpactListOutT {
  const root = isObject(raw) ? raw : {};
  const behaviors: BehaviorImpactListOutT["behaviors"] = [];
  for (const tile of asArray(root.tiles)) {
    if (!isObject(tile)) continue;
    const sufficient = asString(tile.type) === "IMPACT_TILE";
    const content = isObject(tile.content) ? (tile.content as Record<string, unknown>) : {};
    for (const card of asArray(content.impact_cards)) {
      if (!isObject(card)) continue;
      const uuid = asString(card.impact_uuid);
      const name = asString(card.impact_card_title_display);
      if (!uuid || !name) continue;
      const style = (asString(card.impact_style) ?? "").toUpperCase();
      const direction =
        style === "POSITIVE" ? "positive" :
        style === "NEGATIVE" ? "negative" :
        style === "INSUFFICIENT" ? "insufficient" : "neutral";
      behaviors.push({
        impact_uuid: uuid,
        behavior_name: name,
        direction,
        impact_display: asString(card.impact_percentage_display),
        has_sufficient_data: sufficient,
      });
    }
  }
  return { behaviors };
}

// /behavior-impact-service/v2/impact/details/{id} returns a BFF, not flat metrics:
//   header.details_title_display      → behavior name ("Daylight Eating")
//   header.details_subtitle_display   → insight text (may be "")
//   header.details_impact_style       → overall style ("POSITIVE"/"INSUFFICIENT"/…)
//   sections[].items[].content.impact_card (and footer tiles) each:
//     title_display            "RECOVERY IMPACT"
//     impact_style             "POSITIVE" | "NEGATIVE" | "NEUTRAL"
//     impact_percentage_value  "+7"
//     impact_percentage_symbol "%"
//     sub_bar_percent          "+3%"  (whoop member average — not the user delta)
//
// The older projection read `sections[].type === METRIC_CARD`, which never
// matched, so every response came back with empty metrics.

function directionFromStyle(style: string | null): "positive" | "negative" | "neutral" {
  const s = (style ?? "").toUpperCase();
  if (s === "POSITIVE") return "positive";
  if (s === "NEGATIVE") return "negative";
  return "neutral";
}

export function projectBehaviorImpact(raw: unknown, behaviorId: number | string): BehaviorImpactOutT {
  const root = isObject(raw) ? raw : {};
  const header = isObject(root.header) ? (root.header as Record<string, unknown>) : {};

  // Every impact card anywhere in the tree carries `impact_percentage_value`;
  // collect them all (one per affected metric) and dedupe by metric name.
  const cards = findAll(root, (n) => typeof n.impact_percentage_value === "string" && typeof n.title_display === "string");
  const seen = new Set<string>();
  const metrics: BehaviorImpactOutT["metrics"] = [];
  for (const card of cards) {
    const metricName = asString(card.title_display) ?? "";
    if (seen.has(metricName)) continue;
    seen.add(metricName);
    metrics.push({
      metric: metricName,
      delta_avg: asNumber((asString(card.impact_percentage_value) ?? "").replace("+", "")),
      delta_unit: asString(card.impact_percentage_symbol),
      sample_size: null, // not exposed by this BFF
      direction: directionFromStyle(asString(card.impact_style)),
    });
  }

  const numericId = typeof behaviorId === "number" ? behaviorId : Number(behaviorId);
  const meta = !isNaN(numericId) ? BEHAVIORS_BY_ID.get(numericId) : undefined;
  const headerName = asString(header.details_title_display);
  const subtitle = asString(header.details_subtitle_display);

  return {
    behavior_id: behaviorId,
    behavior_name: headerName ?? meta?.title ?? null,
    metrics,
    insight: subtitle && subtitle.length > 0 ? subtitle : asString(header.details_tag_label_display),
  };
}
