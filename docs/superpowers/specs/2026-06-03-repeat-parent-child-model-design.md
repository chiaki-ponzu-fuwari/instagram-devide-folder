# Repeat Parent/Child Model Design

## Overview

This feature defines the repeat-project model used by both personal and team project management.
The model separates a project family into:

- one **parent project** that stores the base information for the account
- one or more **child projects** that store each execution or delivery record

The parent is the master record for the series.
The child records are the user-facing project instances that appear in the normal project lists.

This definition applies to same-username repeat projects and keeps personal pages and team pages conceptually consistent.

## Goals

- Treat repeat projects as a single family with one parent and many children.
- Create the parent and the first child together when a project is first marked as repeat.
- Keep the parent as the base information container for the account.
- Let each child inherit the parent’s information and then be edited independently.
- Make same-username saves link to the same repeat family instead of creating multiple parents.
- Keep deleted repeat parents from deleting child history.
- Keep personal pages untouched as a scope boundary for future implementation work.

## Non-Goals

- Do not redesign the normal non-repeat project workflow.
- Do not change the personal/t team data separation model.
- Do not introduce a separate repeat-only database.
- Do not change the reporting model in this spec.

## Definitions

### Parent project

The parent project is the family-level record for a username/account.
It stores the stable base information:

- account name
- project name
- reward base amount
- expense base amount
- tags
- memo
- URL
- folder linkage

The parent is not the same as a normal standalone execution record.

### Child project

The child project is one execution/delivery instance under a parent family.
It stores the per-run values:

- shooting date
- draft submission date
- post date
- delivery date
- completion state
- per-child reward override
- per-child expense override

The child inherits the parent’s base fields when created, then may be edited independently.

## Core Rules

1. A repeat family has exactly one parent for a given normalized username key.
2. A repeat family may have one or more children.
3. When a project is first saved as repeat, the app creates:
   - the repeat parent
   - the first child
4. When the same username is registered again, the save flow should link the new record into the same repeat family.
5. Children are the records that appear in normal project lists.
6. The parent is managed in the repeat-project list and family detail UI.
7. Editing a child does not automatically mutate the parent.
8. Deleting or removing a parent must not delete child history; children remain as standalone projects if the parent is removed.
9. If a username already exists only as a standalone record and the user confirms repeat linkage, that existing record may be promoted to the parent of the family and the new save becomes the first child.

## Username Matching

The repeat family is keyed by a normalized username.

Normalization rules:

- trim leading and trailing whitespace
- remove an optional leading `@` for comparison
- compare case-insensitively
- display usernames with `@` prepended

Examples:

- `abc` and `@abc` are the same family key
- `ABC` and `abc` are the same family key

## Save Flow

### First repeat save

When a user marks a newly created project as repeat:

1. Create the parent record from the base fields.
2. Create the first child record from the parent’s initial values.
3. Link the child to the parent family.
4. Show the family in the repeat-project list.

The user should see this as:

- one parent
- one child

### Same-username additional save

When a new project uses a username that already belongs to a repeat family:

1. Show a confirmation dialog.
2. If the user chooses yes, attach the new record as another child in the same family.
3. If the user chooses no, save it as a standalone non-repeat project.

The key behavior is that the repeat family remains one parent with additional children.

If the username exists only as a standalone record and no repeat parent has been established yet:

1. Show the same confirmation dialog.
2. If the user chooses yes, promote the existing record to the repeat parent.
3. Save the new record as the first child of that parent.
4. If the user chooses no, leave the records independent.

## Data Shape

The implementation may reuse the existing project record structure, but it must preserve the following repeat fields:

- `contractType: 'repeat'`
- `repeatParentId`
- `repeatClosedAt`
- family username key

Child records must carry a parent reference.
Parent records must carry the family identity and base values.

## UI Expectations

### Repeat project list

- Show repeat parents as the family entry.
- Show child counts in a way that reflects the family structure.
- Keep the family list separate from the normal project list.

### Parent detail

- Show base information.
- Show the child list.
- Show actions such as adding a child, closing the contract, and reopening if needed.
- Do not expose parent-only records as normal standalone execution records.

### Child detail

- Show the inherited base information.
- Show per-child execution fields.
- Allow editing of child-only values without changing the parent automatically.

## Parent Removal Behavior

If a repeat parent is removed:

- child records must remain
- child records must lose the repeat linkage
- child records become ordinary standalone projects
- child reward and expense history must remain intact

This behavior prevents data loss when test records or family heads are removed.

## Validation

- First repeat save creates one parent and one child.
- Repeated saves with the same username stay under the same parent family.
- `@abc` and `abc` resolve to the same family.
- Editing a child does not modify the parent automatically.
- Removing a parent does not delete child history.
