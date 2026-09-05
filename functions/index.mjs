import { initializeApp } from "firebase-admin/app";
import { onCall } from "firebase-functions/v2/https";

import {
  createDeleteAccountHandler,
  createGetAccountDeletionPlanHandler,
} from "./account-deletion-functions.mjs";

initializeApp();

const accountDeletionOptions = {
  region: "asia-northeast1",
  timeoutSeconds: 540,
  memory: "512MiB",
  maxInstances: 5,
  enforceAppCheck: false,
};

export const getAccountDeletionPlan = onCall(
  accountDeletionOptions,
  createGetAccountDeletionPlanHandler(),
);

export const deleteAccount = onCall(
  accountDeletionOptions,
  createDeleteAccountHandler(),
);

export {
  applyTeamDecision,
  beginAccountDeletionJob,
  deletePersonalCloudData,
  loadAccountDeletionSnapshot,
  markDeletionJobComplete,
  markDeletionJobReadyForAuthDelete,
  reverifyDeletionBeforeAuthDelete,
  removeUserIdentityFromTeam,
  verifyNoProtectedReferences,
} from "./account-deletion-store.mjs";
