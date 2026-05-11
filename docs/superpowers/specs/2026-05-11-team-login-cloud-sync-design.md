# Team Login And Cloud Sync Design

## Goal

Build the first team feature for the DM management app without making the app expensive to run.

The design uses:

- Local-first personal data for speed, offline use, and low cost.
- Firebase Authentication for login.
- Firestore cloud backup for personal data.
- Firestore realtime sync only for team data while the team screen is open.

This keeps the app usable without login, protects user data better after login, and gives teams near-immediate updates only where they need them.

## Current App Context

The app is a Capacitor iOS app served from `www/`.

Important existing files:

- `www/index.html`: main UI, local state, folders, accounts, projects, revenue, schedule, templates, backup, team UI placeholders.
- `www/i18n.js`: Japanese and English UI strings.
- `www/js/firebase-auth.mjs`: Firebase Auth helper for Google sign-in.
- `capacitor.config.json`: iOS Capacitor configuration.
- `firebase.json`: Firebase project configuration.

Current storage is mainly local. This must remain supported so users can keep using the app offline and without login.

## Chosen Approach

Use "personal sync + team realtime sync".

Personal data:

- Saved locally first.
- Synced to the cloud only when the user is logged in.
- Used as cloud backup and restore.
- Not watched in realtime.

Team data:

- Stored in Firestore as separate records.
- Watched in realtime only while the team screen is open.
- Listener is stopped when leaving the team screen.

This avoids the high-cost pattern of watching all app data all the time.

## Firebase Services

Use these Firebase services:

- Firebase Authentication for user login.
- Cloud Firestore for personal backup and team shared data.

Initial login provider:

- Google login, using the existing Firebase Auth helper.

Future provider:

- Apple login can be added later for App Store friendliness, but it is not required for the first implementation pass unless the app offers third-party login in a way that triggers Apple's sign-in rule.

Do not put secret keys in frontend code. Firebase web config values are not treated as server secrets, but Firestore Security Rules must protect all user data.

## Firestore Data Model

Personal data:

```text
users/{uid}
  profile
  privateBackup
  syncMeta
```

Team data:

```text
teams/{teamId}
  members/{uid}
  folders/{folderId}
  accounts/{accountId}
  templates/{templateId}
  activity/{activityId}
  joinRequests/{requestId}
  invites/{inviteId}
```

Team data must not be saved as one large JSON blob. Store records one by one so one user's save does not overwrite unrelated changes from another user.

Shared record fields:

```text
id
createdAt
createdBy
updatedAt
updatedBy
deletedAt
deletedBy
```

`deletedAt` means soft delete. The first version should hide soft-deleted records from normal screens. Permanent cleanup can come later.

## Sync Behavior

Personal mode:

- App reads local data first.
- If logged in, the app can offer backup and restore from `users/{uid}`.
- Saves should be batched or debounced. Do not write to Firestore on every keystroke.

Team mode:

- Opening a team starts Firestore listeners for that team.
- Closing team mode stops those listeners.
- Only the selected team's records are watched.
- Records are written one by one.
- UI updates when Firestore sends changes.

Conflict rule:

- If two people edit the same field, the later save wins.
- Every save updates `updatedAt` and `updatedBy`.
- Important changes should create an `activity` entry so users can see what changed.

This is intentionally simple for the first release.

## User Flow

1. User can continue using personal mode without login.
2. User opens team area.
3. If not logged in, the app asks the user to sign in.
4. Logged-in user can create a team.
5. Team creator becomes admin.
6. Admin creates an invite code.
7. Another logged-in user enters the invite code and sends a join request.
8. Admin approves the request.
9. Approved member can access the team data.
10. Team data updates in realtime while the team screen is open.

Initial invitation design:

- Use invite codes, not public editable links.
- Invite codes should not grant access by themselves.
- A join request must still be approved by an admin.

## Roles And Permissions

Initial roles:

- `admin`
- `member`

Admins can:

- Read team data.
- Add, edit, and soft-delete team records.
- Create invite codes.
- Approve or deny join requests.
- Remove members.
- Rename the team.
- Soft-delete or close the team.

Members can:

- Read team data.
- Add, edit, and soft-delete normal team records.
- Change their own display name.

Members cannot:

- Create invite codes.
- Approve join requests.
- Remove members.
- Delete the team.
- Change admin-only settings.

Deferred roles:

- View-only members.
- Assignee-only editing.
- Reward visibility controls.
- Field-level permissions.

## Security Rules Requirements

Firestore rules must enforce:

- A user can read and write only their own `users/{uid}` data.
- Only approved team members can read team records.
- Join-request users cannot read team data before approval.
- Only admins can approve join requests.
- Only admins can create invite codes.
- Only admins can remove members or delete the team.
- Normal members can edit shared records only inside teams where they are approved members.

Rules should avoid unnecessary `get()` calls where possible because rule reads can add Firestore read cost.

## Cost Controls

The app must avoid unnecessary reads and writes.

Rules:

- Do not realtime-watch personal data.
- Do not realtime-watch all teams.
- Watch only the open team.
- Stop listeners when leaving team mode.
- Debounce writes from text inputs.
- Use one document per shared record, not one giant team document.
- Avoid Firestore `offset`; use cursors or limits if pagination is needed.
- Keep initial queries small and scoped to the selected team.
- Avoid expensive analytics or aggregate queries in the first version.

This design targets low usage inside Firestore's free tier for early users, while keeping a path to scale.

## Offline And Error Handling

Personal mode:

- Must keep working offline with local data.
- Login and cloud sync failures should not block personal use.

Team mode:

- If offline, show that team data may be out of date.
- Do not pretend a team save succeeded until Firestore confirms it.
- If save fails, show a short Japanese error and keep the user's input where possible.
- If a listener disconnects, show a subtle reconnecting state.

Deletion:

- Use soft delete first.
- Hide deleted records in normal lists.
- Keep enough metadata to restore or audit later.

## UI Requirements

Keep the first version simple:

- Team entry from existing team button or settings.
- Login prompt only when team features are used.
- Clear mode switch between personal and team mode.
- Team list screen.
- Team create screen.
- Invite code screen.
- Join request approval screen for admins.
- Team member list.
- Team shared folders/accounts/projects list.

Copy should be short and beginner-friendly in Japanese.

## Initial Implementation Scope

In scope:

- Firebase Auth initialization for login state.
- Firestore client setup.
- Personal backup document design.
- Team create/read/update basics.
- Invite code plus admin approval.
- Team realtime listeners while team screen is open.
- Security rules for personal and team data.
- Basic error messages.

Out of scope for first pass:

- Apple login.
- Paid plans or subscription limits.
- Full audit log UI.
- Fine-grained permissions.
- Realtime collaboration inside the same text field.
- Automatic migration of all personal data into a team.
- Server-side cleanup of old soft-deleted records.

## Verification Plan

Manual checks:

- App still works without login.
- Login succeeds.
- Logged-out user cannot open team data.
- User can create a team.
- Admin can create invite code.
- Another user can request to join.
- Admin can approve the request.
- Approved member sees team data.
- Non-member cannot read team data.
- Team updates appear on another device/browser while team screen is open.
- Leaving team screen stops realtime listeners.
- Offline personal mode still works.
- Failed team save shows a useful message.

Security checks:

- User cannot read another user's personal backup.
- Non-member cannot read `teams/{teamId}` records.
- Pending join request cannot read team records.
- Member cannot approve join requests.
- Member cannot remove admin.

Cost checks:

- Opening personal mode does not start team listeners.
- Only selected team data is queried.
- Text input does not write on every keystroke.
- Team listeners are unsubscribed after leaving team mode.
