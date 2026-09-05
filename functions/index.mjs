import { initializeApp } from "firebase-admin/app";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall } from "firebase-functions/v2/https";

import {
  createAccountDeletionJobUpdatedHandler,
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

export const finalizeAccountDeletion = onDocumentUpdated({
  document: "accountDeletionJobs/{jobId}",
  region: "asia-northeast1",
  retry: true,
  timeoutSeconds: 540,
  memory: "512MiB",
  maxInstances: 5,
}, createAccountDeletionJobUpdatedHandler());

export {
  abortPendingAccountDeletionJob,
  applyTeamDecision,
  beginAccountDeletionJob,
  deletePersonalCloudData,
  loadActiveAccountDeletionJob,
  loadAccountDeletionJob,
  loadAccountDeletionSnapshot,
  markDeletionJobComplete,
  markDeletionJobReadyForAuthDelete,
  preflightAccountDeletionDecisions,
  requestAuthDeletion,
  reverifyDeletionBeforeAuthDelete,
  removeUserIdentityFromTeam,
  verifyNoProtectedReferences,
} from "./account-deletion-store.mjs";
