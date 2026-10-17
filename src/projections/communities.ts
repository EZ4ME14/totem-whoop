import type { CommunitiesOutT } from "../schemas/communities.js";
import { isObject, asArray, asNumber, asString, asBool } from "../lib/walk.js";

// Conservative projection over /community-service/v1/communities/memberships.
// The endpoint returns `{total_count, offset, records}` (verified — same
// endpoint is already called by whoop_leaderboard for community auto-discovery).
// Per-record fields are inferred from sibling endpoints + community CRUD shapes.
// Every field is nullable in the schema so partial responses still parse;
// when Whoop's actual record shape differs, the projection just returns more
// nulls rather than throwing.

interface ProjectInput {
  raw: unknown;
  team_type: "ALL" | "COMMUNITY" | "TEAM" | "BUSINESS";
  leaderboard_metric: "strain" | "sleep" | "recovery";
  period: "day" | "week" | "month";
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = asString(obj[k]);
    if (v !== null) return v;
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = asNumber(obj[k]);
    if (v !== null) return v;
  }
  return null;
}

function pickBool(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = asBool(obj[k]);
    if (v !== null) return v;
  }
  return null;
}

function projectRank(
  source: Record<string, unknown>,
  metric: string,
  period: string,
): CommunitiesOutT["communities"][number]["rank"] {
  // The user's rank usually lives in either `user_rank`, `rank`, or
  // `leaderboard_rank` depending on Whoop's flavor; try the common ones.
  const candidate =
    (isObject(source.user_rank) ? source.user_rank : null) ??
    (isObject(source.rank) ? source.rank : null) ??
    (isObject(source.leaderboard_rank) ? source.leaderboard_rank : null);
  if (!candidate) return null;
  const c = candidate as Record<string, unknown>;
  return {
    rank: pickNumber(c, ["rank", "position", "place"]) !== null
      ? Math.trunc(pickNumber(c, ["rank", "position", "place"])!)
      : null,
    score: pickNumber(c, ["score", "value", "day_strain", "performance", "average"]),
    metric,
    period,
  };
}

function projectMembership(
  source: Record<string, unknown>,
): CommunitiesOutT["communities"][number]["membership"] {
  // The membership sub-object may be inline on the record or nested under
  // `membership` / `user_membership`. Same defensive read.
  const candidate =
    (isObject(source.membership) ? source.membership : null) ??
    (isObject(source.user_membership) ? source.user_membership : null) ??
    source;
  const c = candidate as Record<string, unknown>;
  const unread = pickNumber(c, ["unread_count"]);
  return {
    member_type: pickString(c, ["member_type", "role"]),
    notification_setting: pickString(c, ["notification_setting", "notifications"]),
    unread_count: unread !== null ? Math.trunc(unread) : null,
    online: pickBool(c, ["online", "is_online"]),
    joined_at: pickString(c, ["joined_at", "created_at"]),
    last_online: pickString(c, ["last_online", "last_seen"]),
  };
}

export function projectCommunities(input: ProjectInput): CommunitiesOutT {
  const root = isObject(input.raw) ? input.raw : {};
  const totalCountRaw = pickNumber(root, ["total_count", "totalCount"]);
  const offsetRaw = pickNumber(root, ["offset"]);

  const records = asArray(root.records);

  const communities = records.flatMap((r): CommunitiesOutT["communities"] => {
    if (!isObject(r)) return [];
    const rec = r as Record<string, unknown>;
    // Community core fields may be inline or nested under `community` /
    // `team` depending on the response variant.
    const coreCandidate =
      (isObject(rec.community) ? rec.community : null) ??
      (isObject(rec.team) ? rec.team : null) ??
      rec;
    const core = coreCandidate as Record<string, unknown>;

    const id = pickNumber(core, ["id", "community_id", "team_id"]);
    const name = pickString(core, ["name", "title"]);
    if (id === null || name === null) return []; // skip malformed records

    const memberCount = pickNumber(core, ["member_count", "members", "total_members"]);
    const ownerId = pickNumber(core, ["owner_id", "ownerId"]);

    return [{
      id: Math.trunc(id),
      name,
      avatar_url: pickString(core, ["avatar_url", "avatar", "avatarUrl"]),
      banner_url: pickString(core, ["banner_url", "banner", "bannerUrl"]),
      about: pickString(core, ["about", "description"]),
      private: pickBool(core, ["private", "is_private"]),
      member_count: memberCount !== null ? Math.trunc(memberCount) : null,
      owner_id: ownerId !== null ? Math.trunc(ownerId) : null,
      team_type: pickString(core, ["team_type", "type"]),
      membership: projectMembership(rec),
      rank: projectRank(rec, input.leaderboard_metric, input.period),
    }];
  });

  return {
    total_count: totalCountRaw !== null ? Math.trunc(totalCountRaw) : communities.length,
    offset: offsetRaw !== null ? Math.trunc(offsetRaw) : 0,
    team_type_filter: input.team_type,
    leaderboard_metric: input.leaderboard_metric,
    period: input.period,
    communities,
  };
}
