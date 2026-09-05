const DEFAULT_MAX_AUTH_AGE_SECONDS = 5 * 60;
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 60;
const DELETED_ACTOR_UID = "deleted-user";
const DELETED_ACTOR_NAME = "削除済みユーザー";

const REQUEST_FIELDS = new Set(["requestId", "teamDecisions"]);
const DECISION_FIELDS = new Set(["teamId", "action", "transferToUid"]);
const DECISION_ACTIONS = new Set(["leave", "transfer", "dissolve"]);
const APPROVED_STATUSES = new Set(["active", "approved"]);
const ACTIVITY_SHARED_FIELDS = new Set([
  "id",
  "type",
  "action",
  "text",
  "coreText",
  "projectId",
  "projectName",
  "targetName",
  "createdAt",
  "changes",
]);
const SENSITIVE_ACTIVITY_FIELD = /(?:email|e-mail|mailaddress|displayname|profile|avatar|photo|image|phone|telephone|contact|address|handle|username|private|personal|identity|secret|token|memo|note|bank|payout|recipient|account)/i;

export class AccountDeletionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AccountDeletionError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new AccountDeletionError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assertKnownFields(value, allowedFields) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      fail("unknown-field", `Unknown field: ${field}`, { field });
    }
  }
}

function normalizeTeamDecision(decision) {
  if (!isPlainObject(decision)) {
    fail("invalid-team-decision", "Each team decision must be a plain object.");
  }
  assertKnownFields(decision, DECISION_FIELDS);
  if (!isNonEmptyString(decision.teamId) || !DECISION_ACTIONS.has(decision.action)) {
    fail("invalid-team-decision", "Team decision has an invalid teamId or action.");
  }

  if (decision.action === "transfer") {
    if (!isNonEmptyString(decision.transferToUid)) {
      fail("invalid-team-decision", "A transfer decision requires transferToUid.");
    }
    return {
      teamId: decision.teamId,
      action: decision.action,
      transferToUid: decision.transferToUid,
    };
  }

  if (Object.hasOwn(decision, "transferToUid")) {
    fail("invalid-team-decision", "Only a transfer decision may include transferToUid.");
  }
  return { teamId: decision.teamId, action: decision.action };
}

export function assertRecentAuthentication(
  authTime,
  now,
  maxAgeSeconds = DEFAULT_MAX_AUTH_AGE_SECONDS,
) {
  if (
    !Number.isFinite(authTime)
    || authTime < 0
    || !Number.isFinite(now)
    || now < 0
    || !Number.isFinite(maxAgeSeconds)
    || maxAgeSeconds <= 0
  ) {
    fail("invalid-auth-time", "Authentication timestamps must be valid seconds.");
  }
  if (authTime - now > MAX_FUTURE_CLOCK_SKEW_SECONDS) {
    fail("invalid-auth-time", "Authentication time is too far in the future.");
  }
  if (now - authTime > maxAgeSeconds) {
    fail(
      "recent-authentication-required",
      "Recent authentication is required before deleting the account.",
    );
  }
  return authTime;
}

export function normalizeDeletionRequest(input) {
  if (!isPlainObject(input)) {
    fail("invalid-request", "Deletion request must be a plain object.");
  }
  assertKnownFields(input, REQUEST_FIELDS);

  if (
    typeof input.requestId !== "string"
    || !/^[A-Za-z0-9_-]{32,64}$/.test(input.requestId)
  ) {
    fail("invalid-request-id", "requestId must contain 32 to 64 safe characters.");
  }
  if (input.teamDecisions !== undefined && !Array.isArray(input.teamDecisions)) {
    fail("invalid-team-decision", "teamDecisions must be an array.");
  }

  return {
    requestId: input.requestId,
    teamDecisions: (input.teamDecisions ?? []).map(normalizeTeamDecision),
  };
}

export function buildAccountDeletionPlan({ uid, memberships, teams } = {}) {
  if (!isNonEmptyString(uid) || !Array.isArray(memberships) || !Array.isArray(teams)) {
    fail("invalid-plan-input", "Plan input must contain uid, memberships, and teams.");
  }

  const teamsById = new Map();
  for (const team of teams) {
    if (!isPlainObject(team) || !isNonEmptyString(team.id) || teamsById.has(team.id)) continue;
    teamsById.set(team.id, team);
  }

  const approvedMemberships = memberships.filter((membership) => (
    isPlainObject(membership)
    && isNonEmptyString(membership.teamId)
    && isNonEmptyString(membership.uid)
    && APPROVED_STATUSES.has(membership.status)
    && teamsById.has(membership.teamId)
  ));

  const ownMembershipsByTeam = new Map();
  for (const membership of approvedMemberships) {
    if (membership.uid !== uid) continue;
    const previous = ownMembershipsByTeam.get(membership.teamId);
    if (!previous || membership.role === "admin") {
      ownMembershipsByTeam.set(membership.teamId, membership);
    }
  }

  const planTeams = [];
  for (const [teamId, ownMembership] of ownMembershipsByTeam) {
    const team = teamsById.get(teamId);
    const role = ownMembership.role === "admin" ? "admin" : "member";
    const eligibleSuccessorUids = role === "admin"
      ? [...new Set(approvedMemberships
        .filter((membership) => membership.teamId === teamId && membership.uid !== uid)
        .map((membership) => membership.uid))].sort()
      : [];

    planTeams.push({
      teamId,
      teamName: typeof team.name === "string" ? team.name : "",
      role,
      requiredAction: role === "member"
        ? "leave"
        : eligibleSuccessorUids.length > 0 ? "transfer" : "dissolve",
      eligibleSuccessorUids,
    });
  }

  planTeams.sort((left, right) => left.teamId.localeCompare(right.teamId));
  return { teams: planTeams };
}

export function validateTeamDecisions(plan, decisions) {
  if (!isPlainObject(plan) || !Array.isArray(plan.teams)) {
    fail("invalid-team-decisions", "Deletion plan must contain teams.");
  }
  if (!Array.isArray(decisions)) {
    fail("invalid-team-decisions", "Team decisions must be an array.");
  }

  const planByTeamId = new Map();
  for (const team of plan.teams) {
    const eligibleSuccessorUids = Array.isArray(team?.eligibleSuccessorUids)
      ? team.eligibleSuccessorUids
      : [];
    const hasValidSuccessors = (
      Array.isArray(team?.eligibleSuccessorUids)
      && eligibleSuccessorUids.every(isNonEmptyString)
      && new Set(eligibleSuccessorUids).size === eligibleSuccessorUids.length
    );
    const actionMatchesRole = (
      (team?.role === "member"
        && team.requiredAction === "leave"
        && eligibleSuccessorUids.length === 0)
      || (team?.role === "admin"
        && team.requiredAction === "transfer"
        && eligibleSuccessorUids.length > 0)
      || (team?.role === "admin"
        && team.requiredAction === "dissolve"
        && eligibleSuccessorUids.length === 0)
    );
    if (
      !isPlainObject(team)
      || !isNonEmptyString(team.teamId)
      || !DECISION_ACTIONS.has(team.requiredAction)
      || !hasValidSuccessors
      || !actionMatchesRole
      || planByTeamId.has(team.teamId)
    ) {
      fail("invalid-team-decisions", "Deletion plan contains an invalid team.");
    }
    planByTeamId.set(team.teamId, team);
  }

  const normalized = [];
  const seenTeamIds = new Set();
  for (const rawDecision of decisions) {
    const decision = normalizeTeamDecision(rawDecision);
    if (seenTeamIds.has(decision.teamId)) {
      fail("duplicate-team-decision", "Each team can have only one decision.", {
        teamId: decision.teamId,
      });
    }
    seenTeamIds.add(decision.teamId);

    const plannedTeam = planByTeamId.get(decision.teamId);
    if (!plannedTeam) {
      fail("unknown-team", "Decision refers to a team outside the deletion plan.", {
        teamId: decision.teamId,
      });
    }
    if (decision.action !== plannedTeam.requiredAction) {
      fail("invalid-team-action", "Decision does not match the required team action.", {
        teamId: decision.teamId,
      });
    }
    if (
      decision.action === "transfer"
      && !plannedTeam.eligibleSuccessorUids.includes(decision.transferToUid)
    ) {
      fail("ineligible-successor", "Transfer target is not an eligible team member.", {
        teamId: decision.teamId,
      });
    }
    normalized.push(decision);
  }

  for (const teamId of planByTeamId.keys()) {
    if (!seenTeamIds.has(teamId)) {
      fail("missing-team-decision", "A required team decision is missing.", { teamId });
    }
  }

  return normalized.sort((left, right) => left.teamId.localeCompare(right.teamId));
}

function collectIdentityStrings(value, result) {
  if (typeof value === "string" && value.length > 0) {
    result.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const nestedValue of value) collectIdentityStrings(nestedValue, result);
    return;
  }
  if (isPlainObject(value)) {
    for (const nestedValue of Object.values(value)) collectIdentityStrings(nestedValue, result);
  }
}

function cloneAndScrubActivityValue(value, identityStrings) {
  if (typeof value === "string") {
    let anonymized = value;
    for (const identity of identityStrings) {
      anonymized = anonymized.split(identity).join(DELETED_ACTOR_NAME);
    }
    return anonymized;
  }
  if (Array.isArray(value)) {
    return value.map((nestedValue) => cloneAndScrubActivityValue(nestedValue, identityStrings));
  }
  if (!isPlainObject(value)) return value;

  const copy = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (
      key === "__proto__"
      || key === "prototype"
      || key === "constructor"
      || SENSITIVE_ACTIVITY_FIELD.test(key)
      || (key.startsWith("actor") && key !== "actorUid" && key !== "actorName")
    ) continue;
    copy[key] = cloneAndScrubActivityValue(nestedValue, identityStrings);
  }
  return copy;
}

export function anonymizeActivityRecord(activity, deletedUid) {
  if (!isPlainObject(activity) || !isNonEmptyString(deletedUid)) {
    fail("invalid-activity", "Activity and deletedUid are required.");
  }
  if (activity.actorUid !== deletedUid) return activity;

  const identityStrings = new Set();
  for (const [key, value] of Object.entries(activity)) {
    if (
      key === "actorName"
      || SENSITIVE_ACTIVITY_FIELD.test(key)
      || (key.startsWith("actor") && key !== "actorUid")
    ) {
      collectIdentityStrings(value, identityStrings);
    }
  }

  const sharedFacts = {};
  for (const [key, value] of Object.entries(activity)) {
    if (ACTIVITY_SHARED_FIELDS.has(key)) sharedFacts[key] = value;
  }

  return {
    ...cloneAndScrubActivityValue(sharedFacts, identityStrings),
    actorUid: DELETED_ACTOR_UID,
    actorName: DELETED_ACTOR_NAME,
  };
}
