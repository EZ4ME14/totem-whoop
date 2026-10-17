import { z } from "zod";

// `whoop_communities` — your community memberships (teams / friend groups) +
// optionally your rank in each.
//
// Source: GET /community-service/v1/communities/memberships
// Query params: userId, teamType, includeOwnerDetails, includeUserRank,
//               leaderboardType, period, offset, limit
//
// IMPORTANT — schema status: this is a working hypothesis based on the
// documented response shape `{total_count, offset, records}` plus inferred
// record fields from sibling community endpoints (join receipt, leaderboard
// rows). The exact `records[]` field set hasn't been captured against a live
// account at the time of writing — every nullable field is tolerant of
// missing data, and a `WhoopProjectionError` from this tool is the signal
// that Whoop's actual shape differs from these assumptions.

export const CommunityMembership = z.object({
  member_type: z.string().nullable(),
  notification_setting: z.string().nullable(),
  unread_count: z.number().int().nullable(),
  online: z.boolean().nullable(),
  joined_at: z.string().nullable(),
  last_online: z.string().nullable(),
});

export const CommunityRank = z.object({
  rank: z.number().int().nullable(),
  score: z.number().nullable(),
  metric: z.string().nullable(),
  period: z.string().nullable(),
});

export const CommunityRecord = z.object({
  id: z.number().int(),
  name: z.string(),
  avatar_url: z.string().nullable(),
  banner_url: z.string().nullable(),
  about: z.string().nullable(),
  private: z.boolean().nullable(),
  member_count: z.number().int().nullable(),
  owner_id: z.number().int().nullable(),
  team_type: z.string().nullable(),
  membership: CommunityMembership,
  rank: CommunityRank.nullable(),
});

export const CommunitiesOut = z.object({
  total_count: z.number().int(),
  offset: z.number().int(),
  team_type_filter: z.enum(["ALL", "COMMUNITY", "TEAM", "BUSINESS"]),
  leaderboard_metric: z.enum(["strain", "sleep", "recovery"]),
  period: z.enum(["day", "week", "month"]),
  communities: z.array(CommunityRecord),
});
export type CommunitiesOutT = z.infer<typeof CommunitiesOut>;
