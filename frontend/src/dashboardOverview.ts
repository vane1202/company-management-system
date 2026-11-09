import type { FanSummary } from "./api";

export function reportingOverview(teams: FanSummary[]) {
  const expected = teams.reduce((sum, team) => sum + team.expectedCount, 0);
  const reported = teams.reduce((sum, team) => sum + team.reportedCount, 0);
  const missing = teams.reduce((sum, team) => sum + team.missingCount, 0);
  return { expected, reported, missing, percentage: expected > 0 ? Math.round(reported / expected * 100) : null };
}
