import { initializeApp } from "firebase-admin/app";

initializeApp();

export {
  applyTeamDecision,
  beginAccountDeletionJob,
  deletePersonalCloudData,
  loadAccountDeletionSnapshot,
  markDeletionJobComplete,
  markDeletionJobReadyForAuthDelete,
  removeUserIdentityFromTeam,
  verifyNoProtectedReferences,
} from "./account-deletion-store.mjs";
