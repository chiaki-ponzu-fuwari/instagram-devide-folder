# Team Member Assigned Projects Design

## Overview

This feature connects team members to the projects they are assigned to, and lets a member open a project list filtered to only the projects they participate in.

The feature stays inside the existing team workspace. It does not change personal pages or personal data structures.

## Goals

- Show a member's assigned projects from their member detail page.
- Make the assigned-project list open from `担当案件一覧`.
- Filter the team project list so only projects that include the selected member are shown.
- Reuse the existing team project reward allocation data as the assignment source.
- Keep personal pages untouched.

## Non-Goals

- Do not add a separate assignment table or duplicate assignment storage.
- Do not change the personal workflow.
- Do not change the team reward analysis rules in this feature.

## UX Flow

### Member detail

- Open a member from the team member list.
- Show a `担当案件一覧` button near the lower part of the member detail page.
- Tapping the button opens a filtered project list for that member.

### Assigned projects list

- The list title should clearly identify the member, e.g. `Aさんの案件`.
- The list only shows team projects where the member is assigned.
- Each item can still open the normal project detail page.
- Back navigation returns to the member detail page, not the team settings or personal pages.

### Project detail

- In the team project detail page, the checked members are the assigned members.
- The same checked rows also hold the per-member reward amount.
- Saving the project persists both assignment and reward allocation together.

## Data Model

### Assignment source

Use the existing team project reward allocation array as the assignment source.

- A checked member in the project detail page means that member is assigned.
- A member without a positive allocation amount is not treated as assigned.
- No extra assignment-only field is introduced in this feature.

### Filtering rule

When opening a member's assigned project list:

- include team-scoped projects only
- include projects where the selected member appears in `rewardAllocations`
- use the same project visibility and team workspace boundaries as the team project screen

## Access Control

- Team members can open their own assigned project list.
- Team admins can also open any member's assigned project list.
- Editing project assignments and reward amounts stays admin-only.
- Personal pages and personal project data remain unchanged.

## Expected Behavior

- If a member is assigned to 2 projects, the assigned-project list shows 2 items.
- If a project is assigned to multiple members, it appears in each member's assigned-project list.
- The list should not create new project records.
- The list should only be a view/filter over the existing team projects.

## Verification

- Open a member detail page and confirm `担当案件一覧` appears.
- Open the assigned-project list and confirm only that member's assigned projects are shown.
- Open one of the filtered projects and confirm the normal project detail page still works.
- Confirm the back action returns to the member detail page.
- Confirm personal pages are unchanged.
