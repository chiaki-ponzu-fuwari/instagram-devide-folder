import assert from "node:assert/strict";
import test from "node:test";

import {
  anonymizeActivityRecord,
  assertRecentAuthentication,
  buildAccountDeletionPlan,
  normalizeDeletionRequest,
  validateTeamDecisions,
} from "../functions/account-deletion-core.mjs";

function expectCode(code) {
  return (error) => error?.code === code;
}

test("recent authentication accepts the five-minute boundary", () => {
  assert.equal(assertRecentAuthentication(700, 1_000), 700);
});

test("recent authentication rejects an auth time older than five minutes", () => {
  assert.throws(
    () => assertRecentAuthentication(699, 1_000),
    expectCode("recent-authentication-required"),
  );
});

test("recent authentication allows at most 60 seconds of clock skew", () => {
  assert.equal(assertRecentAuthentication(1_060, 1_000), 1_060);
  assert.throws(
    () => assertRecentAuthentication(1_061, 1_000),
    expectCode("invalid-auth-time"),
  );
});

test("recent authentication rejects invalid timestamps and maximum ages", () => {
  for (const authTime of [null, "700", NaN, Infinity, -1]) {
    assert.throws(
      () => assertRecentAuthentication(authTime, 1_000),
      expectCode("invalid-auth-time"),
    );
  }
  assert.throws(
    () => assertRecentAuthentication(700, NaN),
    expectCode("invalid-auth-time"),
  );
  assert.throws(
    () => assertRecentAuthentication(700, 1_000, 0),
    expectCode("invalid-auth-time"),
  );
});

test("request normalization accepts a safe request and does not mutate it", () => {
  const input = {
    requestId: "delete_request_0123456789abcdef0123456789",
    teamDecisions: [
      { teamId: "team-b", action: "transfer", transferToUid: "user-2" },
      { teamId: "team-a", action: "leave" },
    ],
  };
  const before = structuredClone(input);

  assert.deepEqual(normalizeDeletionRequest(input), input);
  assert.deepEqual(input, before);
});

test("request normalization accepts UUID-style request IDs and defaults decisions", () => {
  assert.deepEqual(
    normalizeDeletionRequest({ requestId: "123e4567-e89b-12d3-a456-426614174000" }),
    {
      requestId: "123e4567-e89b-12d3-a456-426614174000",
      teamDecisions: [],
    },
  );
});

test("request normalization rejects non-plain input, unsafe IDs, and unknown fields", () => {
  for (const input of [null, [], new Date(), "request"]) {
    assert.throws(() => normalizeDeletionRequest(input), expectCode("invalid-request"));
  }
  for (const requestId of ["short", "x".repeat(65), "x".repeat(31), `x${"a".repeat(31)}!`]) {
    assert.throws(
      () => normalizeDeletionRequest({ requestId }),
      expectCode("invalid-request-id"),
    );
  }
  assert.throws(
    () => normalizeDeletionRequest({
      requestId: "a".repeat(32),
      uid: "attacker-selected-uid",
    }),
    expectCode("unknown-field"),
  );
});

test("request normalization rejects malformed or over-permissive team decisions", () => {
  const requestId = "a".repeat(32);
  const invalidDecisions = [
    "team-a",
    { teamId: "team-a", action: "delete" },
    { teamId: "team-a", action: "leave", transferToUid: "user-2" },
    { teamId: "team-a", action: "transfer" },
    { teamId: "team-a", action: "dissolve", force: true },
    { teamId: "", action: "leave" },
  ];

  for (const decision of invalidDecisions) {
    assert.throws(
      () => normalizeDeletionRequest({ requestId, teamDecisions: [decision] }),
      (error) => ["invalid-team-decision", "unknown-field"].includes(error?.code),
    );
  }
});

test("deletion plan includes only the user's approved memberships with required actions", () => {
  const memberships = [
    { teamId: "team-transfer", uid: "deleted", role: "admin", status: "active" },
    { teamId: "team-transfer", uid: "successor-b", role: "member", status: "approved" },
    { teamId: "team-transfer", uid: "successor-a", role: "member", status: "active" },
    { teamId: "team-transfer", uid: "pending-user", role: "member", status: "pending" },
    { teamId: "team-solo", uid: "deleted", role: "admin", status: "active" },
    { teamId: "team-member", uid: "deleted", role: "member", status: "approved" },
    { teamId: "team-pending", uid: "deleted", role: "admin", status: "pending" },
    { teamId: "other-team", uid: "outsider", role: "member", status: "active" },
    { teamId: "team-transfer", uid: "successor-a", role: "member", status: "active" },
  ];
  const teams = [
    { id: "team-solo", name: "一人チーム" },
    { id: "team-transfer", name: "引き継ぐチーム" },
    { id: "team-member", name: "参加チーム" },
    { id: "other-team", name: "無関係" },
  ];
  const input = { uid: "deleted", memberships, teams };
  const before = structuredClone(input);

  assert.deepEqual(buildAccountDeletionPlan(input), {
    teams: [
      {
        teamId: "team-member",
        teamName: "参加チーム",
        role: "member",
        requiredAction: "leave",
        eligibleSuccessorUids: [],
      },
      {
        teamId: "team-solo",
        teamName: "一人チーム",
        role: "admin",
        requiredAction: "dissolve",
        eligibleSuccessorUids: [],
      },
      {
        teamId: "team-transfer",
        teamName: "引き継ぐチーム",
        role: "admin",
        requiredAction: "transfer",
        eligibleSuccessorUids: ["successor-a", "successor-b"],
      },
    ],
  });
  assert.deepEqual(input, before);
});

test("deletion plan is deterministic and prevents membership data crossing team boundaries", () => {
  const input = {
    uid: "deleted",
    memberships: [
      { teamId: "team-b", uid: "member-a", role: "member", status: "active" },
      { teamId: "team-a", uid: "deleted", role: "admin", status: "active" },
      { teamId: "team-b", uid: "deleted", role: "admin", status: "active" },
    ],
    teams: [{ id: "team-b" }, { id: "team-a" }],
  };

  assert.deepEqual(buildAccountDeletionPlan(input), {
    teams: [
      {
        teamId: "team-a",
        teamName: "",
        role: "admin",
        requiredAction: "dissolve",
        eligibleSuccessorUids: [],
      },
      {
        teamId: "team-b",
        teamName: "",
        role: "admin",
        requiredAction: "transfer",
        eligibleSuccessorUids: ["member-a"],
      },
    ],
  });
  assert.deepEqual(buildAccountDeletionPlan(input), buildAccountDeletionPlan(structuredClone(input)));
});

test("team decision validation accepts a complete matching decision set", () => {
  const plan = {
    teams: [
      { teamId: "member", role: "member", requiredAction: "leave", eligibleSuccessorUids: [] },
      { teamId: "solo", role: "admin", requiredAction: "dissolve", eligibleSuccessorUids: [] },
      { teamId: "shared", role: "admin", requiredAction: "transfer", eligibleSuccessorUids: ["u2"] },
    ],
  };
  const decisions = [
    { teamId: "shared", action: "transfer", transferToUid: "u2" },
    { teamId: "member", action: "leave" },
    { teamId: "solo", action: "dissolve" },
  ];
  const before = structuredClone(decisions);

  assert.deepEqual(validateTeamDecisions(plan, decisions), [
    { teamId: "member", action: "leave" },
    { teamId: "shared", action: "transfer", transferToUid: "u2" },
    { teamId: "solo", action: "dissolve" },
  ]);
  assert.deepEqual(decisions, before);
});

test("team decision validation rejects unknown, duplicate, missing, and mismatched decisions", () => {
  const plan = {
    teams: [
      { teamId: "member", role: "member", requiredAction: "leave", eligibleSuccessorUids: [] },
      { teamId: "shared", role: "admin", requiredAction: "transfer", eligibleSuccessorUids: ["eligible"] },
      { teamId: "solo", role: "admin", requiredAction: "dissolve", eligibleSuccessorUids: [] },
    ],
  };
  const valid = [
    { teamId: "member", action: "leave" },
    { teamId: "shared", action: "transfer", transferToUid: "eligible" },
    { teamId: "solo", action: "dissolve" },
  ];
  const cases = [
    [valid.slice(1), "missing-team-decision"],
    [[...valid, valid[0]], "duplicate-team-decision"],
    [[...valid, { teamId: "unknown", action: "leave" }], "unknown-team"],
    [[{ teamId: "member", action: "dissolve" }, ...valid.slice(1)], "invalid-team-action"],
    [[valid[0], { teamId: "shared", action: "transfer", transferToUid: "outsider" }, valid[2]], "ineligible-successor"],
    [[valid[0], { teamId: "shared", action: "dissolve" }, valid[2]], "invalid-team-action"],
    [[valid[0], valid[1], { teamId: "solo", action: "transfer", transferToUid: "eligible" }], "invalid-team-action"],
  ];

  for (const [decisions, code] of cases) {
    assert.throws(() => validateTeamDecisions(plan, decisions), expectCode(code));
  }
});

test("team decision validation rejects plans that bypass role constraints", () => {
  const invalidPlans = [
    { teamId: "team", role: "member", requiredAction: "leave" },
    { teamId: "team", role: "admin", requiredAction: "leave", eligibleSuccessorUids: [] },
    { teamId: "team", role: "member", requiredAction: "dissolve", eligibleSuccessorUids: [] },
    { teamId: "team", role: "admin", requiredAction: "transfer", eligibleSuccessorUids: [] },
    { teamId: "team", role: "admin", requiredAction: "dissolve", eligibleSuccessorUids: ["u2"] },
  ];

  for (const team of invalidPlans) {
    assert.throws(
      () => validateTeamDecisions(
        { teams: [team] },
        [{
          teamId: "team",
          action: team.requiredAction,
          ...(team.requiredAction === "transfer" ? { transferToUid: "u2" } : {}),
        }],
      ),
      expectCode("invalid-team-decisions"),
    );
  }
});

test("activity anonymization removes the deleted actor identity and preserves shared facts", () => {
  const activity = {
    id: "activity-1",
    actorUid: "deleted",
    actorName: "山田花子",
    actorEmail: "hanako@example.com",
    actorProfile: { photoUrl: "https://example.com/me.jpg", bio: "秘密" },
    actorPrivateMemo: "secret",
    unreviewedPayload: "unknown fields must not survive anonymization",
    action: "project_updated",
    projectName: "春キャンペーン",
    text: "山田花子さんが「春キャンペーン」を更新しました",
    createdAt: "2026-09-05T12:00:00.000Z",
    changes: { status: "完了" },
  };
  const before = structuredClone(activity);

  assert.deepEqual(anonymizeActivityRecord(activity, "deleted"), {
    id: "activity-1",
    actorUid: "deleted-user",
    actorName: "削除済みユーザー",
    action: "project_updated",
    projectName: "春キャンペーン",
    text: "削除済みユーザーさんが「春キャンペーン」を更新しました",
    createdAt: "2026-09-05T12:00:00.000Z",
    changes: { status: "完了" },
  });
  assert.deepEqual(activity, before);
});

test("activity anonymization does not change another actor's record", () => {
  const activity = {
    actorUid: "another-user",
    actorName: "佐藤",
    actorEmail: "sato@example.com",
    action: "created",
  };
  const before = structuredClone(activity);

  assert.deepEqual(anonymizeActivityRecord(activity, "deleted"), activity);
  assert.deepEqual(activity, before);
});

test("public functions reject malformed inputs with stable error codes", () => {
  assert.throws(
    () => buildAccountDeletionPlan({ uid: "", memberships: [], teams: [] }),
    expectCode("invalid-plan-input"),
  );
  assert.throws(
    () => validateTeamDecisions({ teams: [] }, null),
    expectCode("invalid-team-decisions"),
  );
  assert.throws(
    () => anonymizeActivityRecord(null, "deleted"),
    expectCode("invalid-activity"),
  );
});
