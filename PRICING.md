# Snag pricing and upgrade model

Status: **decision document / not final public pricing**

## Product principle

Snag should not ask a new user to pay before it has become useful. A user should be able to capture enough real issues to understand the workflow and build a record they would not want to abandon.

The upgrade prompt should therefore be tied to a meaningful value event rather than the first interaction.

## Current implementation

At build 2026.09.28.0743, the commercial gate in `release.js` still reflects the earlier experimental rules:

- free users can create up to **5 snags**
- sharing a project requires a paid Home Project licence
- additional live projects require Pro
- the UI currently references **£34.99 one-off** for Home Project and **£12/month** for Pro

These values are implementation history, not a confirmed final pricing decision.

## Recommended model to test

### Free
Purpose: let the user become invested in the workflow.

Possible allowance:
- one project
- enough snags to create a meaningful record (test 10, 15 or 20 rather than 5)
- photos, notes, rooms, search, statuses and personal history
- no forced payment merely for trying the core workflow

### Collaboration unlock
Potential paid trigger:
- inviting another person
- assigning work externally
- shared comments / contractor access
- handover / sign-off with other participants

This is a strong value moment because the app starts replacing WhatsApp, email, spreadsheets and repeated chasing.

### Multi-project / Pro
Potential paid trigger:
- second or subsequent active project
- team administration
- portfolio reporting
- exports / advanced reports
- cross-project dashboards and controls

## What to test before finalising price

1. How many snags are normally created before a user returns voluntarily.
2. Whether users first feel the need to pay at the snag-count limit or at the first share/invite.
3. Conversion difference between a hard snag limit and a collaboration gate.
4. Whether a one-off per-project price is more natural for homeowners than a subscription.
5. Whether recurring professional users prefer per-user, per-project or account-wide pricing.
6. Whether invited contractors should always be free. Current product direction says yes.

## Public site

The public `pricing.html` currently explains the three product stages but intentionally does not publish final prices. Add prices only when the free allowance and upgrade event have been agreed and the app gate matches the page.
