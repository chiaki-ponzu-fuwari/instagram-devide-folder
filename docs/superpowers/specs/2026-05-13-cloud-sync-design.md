# Cloud Sync Design

## Goal

Make the app safe across multiple devices.

Requirements:

- Signing in on a new device should show the same data as the old device.
- Reinstalling or changing phones should not lose data.
- Personal data should sync to the owner account.
- Team data should sync to the team and remain visible only to allowed members.
- The existing visibility rules still apply.

## Current State

The app already has:

- Firebase Authentication with Google and Apple sign-in.
- Firestore-backed team data.
- Local-first storage for folders, accounts, projects, templates, and app state.

Right now, only part of the team system is cloud-backed. Most user content still lives in local storage, so another device does not see it.

## Chosen Approach

Move the app to a cloud-primary model:

- Firestore becomes the source of truth.
- Local storage becomes a cache and offline fallback.
- Every saved record is written to cloud storage with the current user or team ownership.
- The client still keeps a local mirror for startup speed and offline use.

This keeps devices consistent while preserving the current fast UI.

## Data Ownership Model

Use two ownership scopes:

- `personal`
  - Owned by one Firebase user.
  - Visible only to that user.
- `team`
  - Owned by one team.
  - Visible only to approved members of that team, subject to field-level permissions.

Each syncable record should carry:

- `id`
- `scope`
- `ownerUid` for personal records
- `teamId` for team records
- `updatedAt`
- `updatedBy`

## Data To Sync

Sync these app data types:

- folders
- accounts
- projects
- templates
- per-user settings that affect the app experience
- team records that are already part of the shared team model

Do not keep the synced data in one giant blob. Each record should remain a separate document so merges and permissions stay manageable.

## Local Migration

On first successful login:

1. Load the current local dataset.
2. Check whether cloud data already exists for the user.
3. If cloud data is empty, upload the local dataset to Firestore.
4. If cloud data already exists, merge per record using stable IDs and timestamps.
5. Save the merged result back to local cache.

Migration must be idempotent. Reopening the app should not duplicate records.

## Conflict Policy

Use per-record last-write-wins:

- Compare `updatedAt` first.
- If timestamps are equal or unavailable, keep the server copy.
- Writes should always include `updatedBy`.

This is simple enough for the first release and avoids large overwrites.

## Sync Flow

Startup:

1. Initialize Firebase.
2. Wait for auth to settle.
3. If signed in, load cloud state for that user and visible teams.
4. Merge cloud state with local cache.
5. Render from the merged state.

Edits:

1. User changes a record.
2. Save locally immediately for responsiveness.
3. Queue the Firestore write.
4. Refresh the cloud listener when the write resolves.

Offline:

- Local edits remain visible.
- Cloud writes retry when connectivity returns.
- The app should not discard unsynced local changes without warning.

## Team Sync

Team data stays separate from personal data.

- Team records sync only for approved members.
- Pending join requests must not expose internal team data.
- Team field visibility rules remain controlled by the team settings already in place.

Personal data must never leak into team records. Team data must never be stored as personal data.

## Settings And Permissions

Keep the existing visibility controls:

- display name: public to team members
- email: configurable visibility
- payout details: configurable visibility
- notes / other fields: configurable visibility

For personal analysis, keep the current setting that controls whether personal analysis includes only personal data or personal data plus the user's share of team data.

## Error Handling

The app should clearly handle:

- auth not ready yet
- first-login migration in progress
- cloud unavailable
- permission denied
- merge conflict resolved by server copy
- team access revoked while the screen is open

If cloud access fails, the app should fall back to the last local cache and show a clear message rather than wiping data.

## Security Requirements

Firestore rules must enforce:

- personal records readable only by their owner
- team records readable only by approved members
- team admin actions restricted to admins
- pending join requests hidden from non-admins
- data writes limited to the matching scope and owner

The client must never be trusted to hide unauthorized data by itself.

## Testing

Cover the first release with:

- model tests for scope, ownership, and merge behavior
- Firestore rules tests for personal-owner reads and team-member reads
- migration tests for first-login upload from local cache
- UI checks that the same user sees the same data after reload
- device verification on two logins for the same account

## Out Of Scope

The first release does not include:

- real-time collaborative cursors
- per-character text conflict resolution
- multi-user editing inside one text field
- external billing or plan enforcement
- completely automatic migration without any guardrails

