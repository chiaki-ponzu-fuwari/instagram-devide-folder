# Team Assigned Projects Design

## Overview

This feature adds assignment tracking to team projects and lets members open a filtered list of the projects they are assigned to.

The feature stays inside the team workspace. It does not change personal pages or personal data structures.

## Goals

- Add member checkboxes to the team project detail page.
- Allow reward amount input only for checked members.
- Keep unchecked reward values available so they can be restored later.
- Add `担当案件一覧` to member detail pages.
- Open a member-specific project list that shows only projects assigned to that member.
- Keep personal pages untouched.

## Non-Goals

- Do not add a separate assignment-only table if the existing reward allocation data can be reused.
- Do not change the personal project workflow.
- Do not change the team reward analysis rules in this feature.
- Do not add a new standalone team project database.

## UX Flow

### Team project detail

- Open a project from the team project management page.
- Show the team members as rows with checkboxes.
- A checked member is an assigned member for that project.
- Only checked members can edit the reward amount input on that row.
- If a member is unchecked, keep the stored amount but disable or hide the input.
- Saving the project persists the checkbox state and the amount together.

### Member detail

- Open a member from the team member list.
- Show a `担当案件一覧` button near the lower part of the member detail page.
- Tapping the button opens a member-specific project list.

### Member-specific project list

- Show only team projects assigned to that member.
- The title should identify the member, e.g. `Aさんの案件`.
- Each item should still open the normal team project detail page.
- Back navigation returns to the member detail page.

## Data Model

### Assignment source

Reuse the existing team project reward allocation array as the assignment source.

- A checked member row means the member is assigned to that project.
- The row keeps its reward amount.
- If a row is unchecked, keep its amount in storage and treat it as inactive.
- No separate assignment-only storage is introduced.

### Stored shape

The existing reward allocation array is extended with an explicit assignment flag:

```json
{
  "uid": "memberUid",
  "displayName": "Member Name",
  "amountYen": 10000,
  "assigned": true
}
```

Rules:

- `assigned: true` means the member counts as a project assignee.
- `assigned: false` means the amount stays stored, but the member is not currently assigned.
- If a row has no amount and is not assigned, it remains available for later reuse.

## Filtering Rule

The member-specific list shows a project when:

- the project belongs to the current team workspace
- the project has at least one reward allocation row for the selected member with `assigned: true`

If a project has multiple assigned members, it appears in each assigned member's filtered list.

## Access Control

- Team members can open their own assigned project list.
- Team admins can open any member's assigned project list.
- Editing assignments and reward amounts stays admin-only.
- Personal pages and personal project data remain unchanged.

## Expected Behavior

- Checked members are visible as assignees in the project detail page.
- Unchecked members remain stored, but their amount input is not editable until rechecked.
- `担当案件一覧` acts as a filter over existing team projects, not as a separate record set.
- The member-specific list does not create, duplicate, or modify project records.

## Verification

- Open a team project detail page and confirm member checkboxes appear.
- Confirm only checked members can edit reward amounts.
- Save and reopen the project to ensure checked state and amounts persist.
- Open a member detail page and confirm `担当案件一覧` appears.
- Open the filtered list and confirm only that member's assigned projects are shown.
- Confirm back navigation returns to member detail.
- Confirm personal pages are unchanged.
