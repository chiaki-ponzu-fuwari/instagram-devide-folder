const DEFAULT_MAX_AUTH_AGE_SECONDS = 5 * 60;
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 60;
const DELETED_ACTOR_UID = "deleted-user";
const DELETED_ACTOR_NAME = "削除済みユーザー";

const REQUEST_FIELDS = new Set(["requestId", "teamDecisions"]);
const DECISION_FIELDS = new Set(["teamId", "action", "transferToUid"]);
const DECISION_ACTIONS = new Set(["leave", "transfer", "dissolve"]);
const MAX_REQUEST_BYTES = 256 * 1024;
const APPROVED_MEMBERSHIP_STATUS = "active";
const ACTIVITY_SHARED_STRING_FIELDS = new Set([
  "id",
  "type",
  "action",
  "projectId",
  "projectName",
  "targetName",
]);
const ACTIVITY_TIMESTAMP_FIELDS = new Set(["createdAt", "updatedAt"]);

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

function isSafeDocumentId(value) {
  return (
    typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && value !== "."
    && value !== ".."
    && !/[\/\u0000-\u001f\u007f]/u.test(value)
  );
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
  if (!isSafeDocumentId(decision.teamId) || !DECISION_ACTIONS.has(decision.action)) {
    fail("invalid-team-decision", "Team decision has an invalid teamId or action.");
  }

  if (decision.action === "transfer") {
    if (!isSafeDocumentId(decision.transferToUid)) {
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

  let serializedInput;
  try {
    serializedInput = JSON.stringify(input);
  } catch {
    fail("invalid-request", "Deletion request must be JSON serializable.");
  }
  if (
    typeof serializedInput !== "string"
    || new TextEncoder().encode(serializedInput).byteLength > MAX_REQUEST_BYTES
  ) {
    fail("invalid-request", "Deletion request cannot exceed 256 KiB.");
  }

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
  if (!isSafeDocumentId(uid) || !Array.isArray(memberships) || !Array.isArray(teams)) {
    fail("invalid-plan-input", "Plan input must contain uid, memberships, and teams.");
  }

  const teamsById = new Map();
  for (const team of teams) {
    if (!isPlainObject(team) || !isSafeDocumentId(team.id)) {
      fail("invalid-plan-input", "Team snapshot has an unsafe ID.");
    }
    if (teamsById.has(team.id)) continue;
    teamsById.set(team.id, team);
  }

  const activeUidsByTeam = new Map();
  const ownMembershipsByTeam = new Map();
  for (const membership of memberships) {
    if (
      !isPlainObject(membership)
      || !isSafeDocumentId(membership.teamId)
      || !isSafeDocumentId(membership.uid)
    ) {
      fail("invalid-plan-input", "Membership snapshot has an unsafe ID.");
    }
    if (
      membership.status !== APPROVED_MEMBERSHIP_STATUS
      || !teamsById.has(membership.teamId)
    ) continue;

    if (!activeUidsByTeam.has(membership.teamId)) {
      activeUidsByTeam.set(membership.teamId, new Set());
    }
    activeUidsByTeam.get(membership.teamId).add(membership.uid);

    if (membership.uid === uid) {
      if (membership.role !== "admin" && membership.role !== "member") {
        fail("invalid-plan-input", "Active membership has an unknown role.", {
          teamId: membership.teamId,
        });
      }
      const previous = ownMembershipsByTeam.get(membership.teamId);
      if (!previous || membership.role === "admin") {
        ownMembershipsByTeam.set(membership.teamId, membership);
      }
    }
  }

  const planTeams = [];
  for (const [teamId, team] of teamsById) {
    const ownMembership = ownMembershipsByTeam.get(teamId);
    const isCreator = team.createdBy === uid;
    if (!ownMembership && !isCreator) continue;

    const role = isCreator || ownMembership.role === "admin" ? "admin" : "member";
    const eligibleSuccessorUids = role === "admin"
      ? [...(activeUidsByTeam.get(teamId) ?? [])]
        .filter((memberUid) => memberUid !== uid)
        .sort()
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

function isSupportedTimestamp(value) {
  if (typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (value === null || typeof value !== "object" || typeof value.toMillis !== "function") {
    return false;
  }
  try {
    return Number.isFinite(value.toMillis());
  } catch {
    return false;
  }
}

function anonymizeActivityText(activity) {
  if (typeof activity.text !== "string") return undefined;
  if (typeof activity.coreText === "string") {
    return `${DELETED_ACTOR_NAME}さんが${activity.coreText}`;
  }
  if (typeof activity.actorName !== "string" || activity.actorName.length === 0) {
    return undefined;
  }

  const actorPrefix = `${activity.actorName}さんが`;
  if (!activity.text.startsWith(actorPrefix)) return undefined;
  return `${DELETED_ACTOR_NAME}さんが${activity.text.slice(actorPrefix.length)}`;
}

export function anonymizeActivityRecord(activity, deletedUid) {
  if (!isPlainObject(activity) || !isNonEmptyString(deletedUid)) {
    fail("invalid-activity", "Activity and deletedUid are required.");
  }
  if (activity.actorUid !== deletedUid) return activity;

  const sharedFacts = {};
  for (const [key, value] of Object.entries(activity)) {
    if (ACTIVITY_SHARED_STRING_FIELDS.has(key) && typeof value === "string") {
      sharedFacts[key] = value;
    } else if (ACTIVITY_TIMESTAMP_FIELDS.has(key) && isSupportedTimestamp(value)) {
      sharedFacts[key] = value;
    }
  }
  if (typeof activity.coreText === "string") sharedFacts.coreText = activity.coreText;
  const anonymizedText = anonymizeActivityText(activity);
  if (anonymizedText !== undefined) sharedFacts.text = anonymizedText;

  return {
    ...sharedFacts,
    actorUid: DELETED_ACTOR_UID,
    actorName: DELETED_ACTOR_NAME,
  };
}
