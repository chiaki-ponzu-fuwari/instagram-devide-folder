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

test("request normalization validates document IDs at the length boundary", () => {
  const requestId = "a".repeat(32);
  const validId = `team_${"x".repeat(123)}`;
  assert.equal(validId.length, 128);
  assert.deepEqual(normalizeDeletionRequest({
    requestId,
    teamDecisions: [{ teamId: validId, action: "transfer", transferToUid: validId }],
  }).teamDecisions[0], {
    teamId: validId,
    action: "transfer",
    transferToUid: validId,
  });

  const invalidDecisions = [
    [{ teamId: "team/child", action: "leave" }],
    [{ teamId: "x".repeat(129), action: "leave" }],
    [{ teamId: "team", action: "transfer", transferToUid: "user/child" }],
    [{ teamId: "team", action: "transfer", transferToUid: "x".repeat(129) }],
  ];
  for (const teamDecisions of invalidDecisions) {
    assert.throws(
      () => normalizeDeletionRequest({ requestId, teamDecisions }),
      expectCode("invalid-team-decision"),
    );
  }
});

test("101 team decisions remain representable from plan through validation", () => {
  const teams = Array.from({ length: 101 }, (_, index) => ({ id: `team-${index}` }));
  const memberships = teams.map((team) => ({
    teamId: team.id,
    uid: "deleted",
    role: "member",
    status: "active",
  }));
  const plan = buildAccountDeletionPlan({ uid: "deleted", memberships, teams });
  const normalized = normalizeDeletionRequest({
    requestId: "a".repeat(32),
    teamDecisions: plan.teams.map(({ teamId }) => ({ teamId, action: "leave" })),
  });

  assert.equal(plan.teams.length, 101);
  assert.equal(validateTeamDecisions(plan, normalized.teamDecisions).length, 101);
});

test("request normalization rejects payloads over 256 KiB and unserializable input", () => {
  const oversizedDecisions = Array.from({ length: 2_000 }, (_, index) => ({
    teamId: `team-${index}-${"x".repeat(110)}`,
    action: "leave",
  }));
  assert.throws(
    () => normalizeDeletionRequest({ requestId: "a".repeat(32), teamDecisions: oversizedDecisions }),
    expectCode("invalid-request"),
  );

  const circular = { requestId: "a".repeat(32), teamDecisions: [] };
  circular.teamDecisions.push(circular);
  assert.throws(() => normalizeDeletionRequest(circular), expectCode("invalid-request"));
  assert.throws(() => normalizeDeletionRequest({
    requestId: "a".repeat(32),
    teamDecisions: [{ teamId: "team", action: "transfer", transferToUid: 1n }],
  }), expectCode("invalid-request"));
});

test("deletion plan includes only the user's active memberships with required actions", () => {
  const memberships = [
    { teamId: "team-transfer", uid: "deleted", role: "admin", status: "active" },
    { teamId: "team-transfer", uid: "successor-b", role: "member", status: "approved" },
    { teamId: "team-transfer", uid: "successor-a", role: "member", status: "active" },
    { teamId: "team-transfer", uid: "pending-user", role: "member", status: "pending" },
    { teamId: "team-solo", uid: "deleted", role: "admin", status: "active" },
    { teamId: "team-member", uid: "deleted", role: "member", status: "active" },
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
        requiredAction: "admin-choice",
        eligibleSuccessorUids: ["successor-a"],
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
        requiredAction: "admin-choice",
        eligibleSuccessorUids: ["member-a"],
      },
    ],
  });
  assert.deepEqual(buildAccountDeletionPlan(input), buildAccountDeletionPlan(structuredClone(input)));
});

test("deletion plan treats only active memberships as approved", () => {
  const input = {
    uid: "deleted",
    memberships: [
      { teamId: "shared", uid: "deleted", role: "admin", status: "active" },
      { teamId: "shared", uid: "active-successor", role: "member", status: "active" },
      { teamId: "shared", uid: "approved-successor", role: "member", status: "approved" },
      { teamId: "shared", uid: "pending-successor", role: "member", status: "pending" },
      { teamId: "not-active", uid: "deleted", role: "admin", status: "approved" },
    ],
    teams: [{ id: "shared" }, { id: "not-active" }],
  };

  assert.deepEqual(buildAccountDeletionPlan(input), {
    teams: [{
      teamId: "shared",
      teamName: "",
      role: "admin",
      requiredAction: "admin-choice",
      eligibleSuccessorUids: ["active-successor"],
    }],
  });
});

test("deletion plan treats a team creator as admin and rejects unknown active roles", () => {
  assert.deepEqual(buildAccountDeletionPlan({
    uid: "deleted",
    memberships: [
      { teamId: "creator-team", uid: "deleted", role: "member", status: "active" },
      { teamId: "creator-team", uid: "successor", role: "member", status: "active" },
    ],
    teams: [{ id: "creator-team", createdBy: "deleted" }],
  }), {
    teams: [{
      teamId: "creator-team",
      teamName: "",
      role: "admin",
      requiredAction: "admin-choice",
      eligibleSuccessorUids: ["successor"],
    }],
  });

  assert.throws(() => buildAccountDeletionPlan({
    uid: "deleted",
    memberships: [
      { teamId: "team", uid: "deleted", role: "owner", status: "active" },
    ],
    teams: [{ id: "team" }],
  }), expectCode("invalid-plan-input"));
});

test("deletion plan rejects unsafe team and membership IDs from database snapshots", () => {
  assert.throws(() => buildAccountDeletionPlan({
    uid: "deleted",
    memberships: [],
    teams: [{ id: "team/child", createdBy: "deleted" }],
  }), expectCode("invalid-plan-input"));
  assert.throws(() => buildAccountDeletionPlan({
    uid: "deleted",
    memberships: [{ teamId: "team", uid: "user/child", role: "member", status: "active" }],
    teams: [{ id: "team" }],
  }), expectCode("invalid-plan-input"));
});

test("team decision validation accepts a complete matching decision set", () => {
  const plan = {
    teams: [
      { teamId: "member", role: "member", requiredAction: "leave", eligibleSuccessorUids: [] },
      { teamId: "solo", role: "admin", requiredAction: "dissolve", eligibleSuccessorUids: [] },
      { teamId: "shared", role: "admin", requiredAction: "admin-choice", eligibleSuccessorUids: ["u2"] },
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

test("shared-team admins may explicitly dissolve instead of transferring", () => {
  const plan = {
    teams: [{
      teamId: "shared", role: "admin", requiredAction: "admin-choice",
      eligibleSuccessorUids: ["eligible"],
    }],
  };
  assert.deepEqual(validateTeamDecisions(plan, [
    { teamId: "shared", action: "dissolve" },
  ]), [{ teamId: "shared", action: "dissolve" }]);
  assert.deepEqual(validateTeamDecisions(plan, [
    { teamId: "shared", action: "transfer", transferToUid: "eligible" },
  ]), [{ teamId: "shared", action: "transfer", transferToUid: "eligible" }]);
});

test("team decision validation rejects unknown, duplicate, missing, and mismatched decisions", () => {
  const plan = {
    teams: [
      { teamId: "member", role: "member", requiredAction: "leave", eligibleSuccessorUids: [] },
      { teamId: "shared", role: "admin", requiredAction: "admin-choice", eligibleSuccessorUids: ["eligible"] },
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
    { teamId: "team", role: "admin", requiredAction: "admin-choice", eligibleSuccessorUids: [] },
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
  });
  assert.deepEqual(activity, before);
});

test("activity anonymization drops unstructured changes instead of retaining PII", () => {
  const activity = {
    actorUid: "deleted",
    actorName: "山田",
    action: "assignment_updated",
    projectName: "春案件",
    createdAt: "2026-09-05T12:00:00.000Z",
    changes: {
      assigneeUid: "deleted",
      assigneeUids: ["member-2", "deleted"],
      before: { Email: "old@example.com", value: "秘密" },
      after: { PROFILEURL: "https://example.com/private", value: "秘密2" },
      value: "deleted@example.com",
    },
  };

  const anonymized = anonymizeActivityRecord(activity, "deleted");
  assert.equal(Object.hasOwn(anonymized, "changes"), false);
  assert.doesNotMatch(JSON.stringify(anonymized), /old@example|PROFILEURL|deleted@example|秘密/);
  assert.equal(anonymized.action, "assignment_updated");
  assert.equal(anonymized.projectName, "春案件");
  assert.equal(anonymized.createdAt, "2026-09-05T12:00:00.000Z");
});

test("activity anonymization retains coreText only when it is a string", () => {
  const anonymized = anonymizeActivityRecord({
    actorUid: "deleted",
    actorName: "山田",
    action: "updated",
    coreText: { before: "秘密", Email: "old@example.com" },
    createdAt: "2026-09-05T12:00:00.000Z",
  }, "deleted");

  assert.equal(Object.hasOwn(anonymized, "coreText"), false);
});

test("activity anonymization rejects structured values in shared scalar fields", () => {
  const sharedStringFields = [
    "id", "type", "action", "projectId", "projectName", "targetName", "coreText", "text",
  ];
  for (const field of sharedStringFields) {
    for (const unsafeValue of [{ Email: "old@example.com" }, ["old@example.com"]]) {
      const anonymized = anonymizeActivityRecord({
        actorUid: "deleted",
        actorName: "山田",
        [field]: unsafeValue,
      }, "deleted");
      assert.equal(Object.hasOwn(anonymized, field), false, field);
    }
  }

  for (const field of ["createdAt", "updatedAt"]) {
    for (const unsafeValue of [{ Email: "old@example.com" }, ["old@example.com"], NaN]) {
      const anonymized = anonymizeActivityRecord({
        actorUid: "deleted",
        actorName: "山田",
        action: "updated",
        [field]: unsafeValue,
      }, "deleted");
      assert.equal(Object.hasOwn(anonymized, field), false, field);
    }
  }
});

test("activity anonymization preserves supported timestamp values", () => {
  const timestamp = { toMillis: () => 1_000 };
  const values = [timestamp, new Date("2026-09-05T12:00:00.000Z"), "2026-09-05", 1_000];
  for (const value of values) {
    const anonymized = anonymizeActivityRecord({
      actorUid: "deleted",
      actorName: "山田",
      action: "updated",
      createdAt: value,
      updatedAt: value,
    }, "deleted");
    assert.equal(anonymized.createdAt, value);
    assert.equal(anonymized.updatedAt, value);
  }
});

test("activity anonymization preserves shared names when they equal the actor name", () => {
  const activity = {
    actorUid: "deleted",
    actorName: "山田商店",
    action: "project_updated",
    projectName: "山田商店",
    targetName: "山田商店",
    text: "山田商店さんが「山田商店」を更新しました",
    coreText: "「山田商店」を更新しました",
    createdAt: "2026-09-05T12:00:00.000Z",
  };

  assert.deepEqual(anonymizeActivityRecord(activity, "deleted"), {
    actorUid: "deleted-user",
    actorName: "削除済みユーザー",
    action: "project_updated",
    projectName: "山田商店",
    targetName: "山田商店",
    text: "削除済みユーザーさんが「山田商店」を更新しました",
    coreText: "「山田商店」を更新しました",
    createdAt: "2026-09-05T12:00:00.000Z",
  });
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
