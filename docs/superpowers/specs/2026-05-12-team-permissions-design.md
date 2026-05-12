# Team Permissions And Invite Flow Design

## Goal

Add team sharing to the DM management app without making the data model brittle or expensive to run.

The team system must:

- Keep the app local-first for personal data.
- Let users join a team by invite code or invite link.
- Require admin approval before a user can access team data.
- Show the approved member list to everyone inside the team.
- Let admins control invitations, approvals, edit permissions, and reward visibility.
- Keep Firestore rules strict enough that unapproved users cannot read team data.

## Current App Context

The app already has:

- Firebase Authentication with Google and Apple sign-in.
- A settings screen with login controls.
- A local-first data model for accounts, folders, templates, and related UI state.

The team feature should not replace the local personal mode. It is an additional shared mode that uses Firestore.

## Chosen Approach

Use one team document tree per team and keep membership explicit.

Core ideas:

- Each team has its own `teams/{teamId}` root document.
- Approved members are stored in `teams/{teamId}/members/{uid}`.
- Invite records and join requests are separate subcollections.
- The approved member list is readable by all approved members.
- Pending join requests are readable only by admins and the requesting user.

This keeps the authorization model simple and avoids storing the team as one large JSON blob that could be overwritten by another user.

## Roles

Two roles are enough for the first release:

- `admin`
- `member`

Admin capabilities:

- Create invite codes and invite links.
- Approve or reject join requests.
- Grant or revoke editing permissions.
- Configure reward visibility scope.
- Remove members.

Member capabilities:

- Read approved team data.
- Edit only the records and fields allowed by their permission set.
- See the approved member list.

## Membership States

Use explicit states for the join flow:

- `pending`: user has requested to join, but is not allowed to read team data.
- `active`: user is approved and can access the team.
- `rejected`: optional audit state for rejected requests.
- `removed`: optional audit state for removed members.

Only `active` members count as team members for read/write access.

## Data Model

Suggested Firestore shape:

```text
teams/{teamId}
  name
  createdBy
  createdAt
  updatedAt
  rewardVisibility
  memberCount

teams/{teamId}/members/{uid}
  uid
  role
  status
  displayName
  joinedAt
  joinedBy
  editScope
  rewardScope

teams/{teamId}/invites/{inviteId}
  codeHash
  createdBy
  createdAt
  expiresAt
  maxUses
  useCount
  enabled

teams/{teamId}/joinRequests/{requestId}
  uid
  inviteId
  status
  requestedAt
  decidedAt
  decidedBy

teams/{teamId}/folders/{folderId}
teams/{teamId}/accounts/{accountId}
teams/{teamId}/templates/{templateId}
teams/{teamId}/activity/{activityId}
```

Approved members are the source of truth for access control. The team root document may keep lightweight summary fields, but the rules should not depend on a giant embedded member list.

## Invite And Approval Flow

The join flow should be:

1. A user enters an invite code or opens an invite link.
2. The app creates a join request.
3. The app shows a pending state.
4. An admin reviews the request.
5. If approved, a `members/{uid}` document is created or updated to `status = active`.
6. Only after approval does the user gain read/write access to the team.

Invite links should not grant access by themselves. They should resolve to an invite record or code and still require approval.

## Visibility Rules

Visible to all approved members:

- Team name
- Approved member list
- Each member's role
- Basic active/inactive status
- Shared team data records

Visible only to admins:

- Pending join requests
- Invite records
- Role changes
- Permission changes
- Reward visibility settings

Not visible to unapproved users:

- Team data
- Member list
- Pending requests
- Invite details beyond what is needed to submit a request

## Reward Visibility

Reward-related data needs an admin-controlled scope. Support these levels:

- `admin_only`
- `all_members`
- `selected_members`

For `selected_members`, store an allowlist in the permission model or a dedicated team setting. The first implementation should keep this explicit and easy to inspect rather than dynamic or inferred.

## Security Rules Requirements

Firestore rules must enforce:

- Only signed-in users can create join requests.
- Only active members can read team records.
- Only admins can read pending requests and invite records.
- Only admins can approve or reject requests.
- Only admins can change other members' roles or permission scopes.
- Non-members cannot read team member documents or shared records.
- Approved members can only write within the team they belong to.

Rules should avoid broad `allow read: if true` patterns and should not rely on the client hiding unauthorized data.

## Cost Controls

Keep Firestore usage low by design:

- Store one shared record per document.
- Avoid realtime listeners on all teams at once.
- Watch only the active team screen.
- Do not expose large member or request collections unless needed.
- Avoid expensive aggregate queries in the first version.
- Debounce writes from text editing.

This should stay within the free quota for early usage as long as team activity remains modest.

## Error Handling

The app should clearly handle:

- Invalid invite code or invite link.
- Expired invite.
- Request already pending.
- Request rejected.
- User removed from team while the team screen is open.
- Permission denied from Firestore rules.

When access is removed, the UI should fail closed and return the user to a safe non-team screen.

## Testing

Cover the first implementation with:

- Pure model tests for membership and permission normalization.
- Firestore rules tests for active member reads, pending request denial, and admin-only approval.
- UI checks for member list visibility and approval state labels.
- Simulator verification that approved members can open a team and pending members cannot.

## Out Of Scope

The first release does not include:

- Fine-grained per-field collaboration.
- Real-time text cursor sync.
- Complex nested team hierarchies.
- Automatic migration of all personal data into team data.
- Billing or paid plan enforcement.

