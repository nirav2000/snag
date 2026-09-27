# Snag Recorder

Snag is a mobile-first property snagging and shared completion workflow for homeowners, builders and trades.

## Release

Current release: **2026.09.27.1715**

The release keeps the existing Snag data and Version Lab compatibility surface while adding multi-customer accounts, stronger tenant isolation, privacy controls and the commercial/payment foundation.

## Current product

- Multiple projects/properties per account.
- Snag capture with description, room, priority, assignment and acceptance outcome.
- Photos, video, voice and files.
- Status flow: Open → In progress → Needs review → Resolved.
- Threaded project conversation and evidence.
- Rooms, project cover images, annotations, private notes and unread state.
- Search and archive.
- Project invitations for client/builder/contractor roles.
- Revocable access links.
- Local-first recovery plus Firebase real-time sync.
- R2 media storage.
- Export and permanent project/account deletion flows.
- First-visit sales/pricing page plus Privacy and Terms pages.

## Shared platform modules

Cross-app features live in `nirav2000/Apps` rather than being copied into Snag:

- `apps-auth.js` — shared identity bridge.
- `apps-account.js` v2 — protect/create account, sign in/out, email verification, reset password, change password and change email.
- `apps-privacy.js` — shared optional analytics/monitoring preferences.
- `apps-billing.js` — provider-neutral authenticated billing client.
- `apps-platform.js` — convenience loader.
- `app-monitor.js` and `firebase-usage-monitor.js` — reusable monitoring with optional privacy gates.

Snag keeps only its domain-specific adapters: project tenancy, Firestore paths/rules, R2 object authorization and Stripe entitlement endpoints.

## Cloud architecture

### Firebase

Primary project: `snag-509418`

- Firebase Authentication: anonymous bootstrap plus protected email/password accounts.
- Firestore project data under `snag_projects/{projectId}`.
- User recovery/project references under `snag_users/{uid}`.
- Stable commercial account records under `snag_accounts/{accountId}`.
- Legacy `kk-syllabus` support remains read-only for migration/rollback.

### Cloudflare R2

Production media lives in the `snag-media` R2 bucket through the `snag-media-api` Worker.

New release media is marked `private-v2`. Reads authenticate the Firebase user, verify project membership and, for snag media, verify access to that specific snag. Project owners can purge the complete project media prefix during deletion.

Historical pre-release R2 objects retain their existing bearer-URL behaviour so archived Version Lab interfaces continue to work.

### Billing

The Worker contains Stripe Checkout, return verification, signed webhook handling and R2-backed entitlement reconciliation.

Plans in this release:

- **Home Project — £34.99 one-off per property**
- **Snag Pro — £12/month**, account-wide for multiple projects

Commercial gates deliberately remain disabled when Stripe is not configured. Existing projects are marked `legacy` and remain usable. When Stripe is connected, a free project allows up to five snags, sharing requires a Home Project licence, and additional projects require Pro.

## Tenant security

`accessModelVersion: 2` adds per-snag `participantUids`, `createdByUid` and `assigneeId`.

For contractors:
- broad snag collection reads are denied;
- the app queries with `participantUids array-contains <uid>`;
- Firestore independently enforces the same restriction;
- revoking an invitation invalidates membership even if a stale member reference remains.

`security-tests.mjs` runs against the Firestore emulator and tests unrelated owners, assigned/unassigned contractor access, restricted queries and revoked invitations.

## Firebase deployment authority

Firestore rules deploy through the existing keyless GitHub OIDC workflow in `nirav2000/cloud-setup`.

`cloud-setup/projects.yaml` pins the exact Snag rules commit. The Snag repo intentionally does not keep a second secret-based Firebase deployment path.

## Version Lab and release process

- `main` = current tested release/development line.
- `stable` = production reference.
- `versions/<build>` = immutable/recoverable build lineage.
- Version Lab “Latest” follows `main`.
- Archived interfaces continue to load the central `firebase-config.js` compatibility surface.
- `release-check.mjs` validates release invariants.
- `validate.yml` checks JavaScript syntax and release wiring.
- `security-tests.yml` tests Firestore tenant isolation.
- `promote-stable.yml` validates before promoting a commit to `stable`.

## Privacy

Firebase usage telemetry and personalised App Monitor telemetry are enabled by default in Snag. The shared privacy module supports app-defined defaults. A passkey-authenticated developer setting controls whether ordinary Snag users are shown the telemetry opt-out switch; essential authentication, storage and security requests continue independently.

See `privacy.html` and `terms.html` for the published release notices.

## Payment activation

The payment code is safe to deploy before credentials exist. The Worker reports its readiness through `/health` using:

- `stripeConfigured`
- `stripeWebhookConfigured`

Live checkout remains unavailable until the Stripe secret and webhook secret are securely configured.


### Developer telemetry control

The global setting is stored by the shared App Monitor service. The developer panel appears in Snag only when the browser has a valid App Monitor admin session. It controls whether ordinary users see the telemetry opt-out switch. The default is `false`, so telemetry is enabled and the user switch is hidden.

The App Monitor Worker source remains single-source in `nirav2000/Apps`. Because Cloudflare deployment credentials currently live in the Snag repository, `.github/workflows/deploy-shared-app-monitor.yml` checks the shared source hourly and deploys it only when the Worker build differs.
