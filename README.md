# Snag Recorder

A mobile-first issue recorder and shared progress communicator. It is aimed at home snagging but intentionally supports software/app issues and business/process problems too.

## v1 features
- Projects/workspaces for different properties or contexts.
- Record an issue with title, description, location, assignee, priority and acceptance check.
- Capture/upload photos, video, audio and PDFs.
- Status workflow: Open → In progress → Needs review → Resolved.
- Threaded updates between client/builder/team members, including voice memos and attachments.
- Resolved issues stay searchable as an archive/history.
- Simple local similarity suggestions surface potentially related past resolved issues.
- Local-first mode works immediately in one browser.
- Optional Firebase mode uses Firestore for issue/update records and Firebase Storage for media.
- Shareable project URLs (`?project=<id>`) provide the basis for builder/client invitations.
- PWA manifest for add-to-home-screen use.

## Firebase setup
1. Create a Firebase project and a Web App.
2. Enable **Authentication** and an authentication provider. Anonymous auth is the simplest first test; production should use email-link, Google or another suitable provider.
3. Enable **Cloud Firestore** and **Storage**.
4. Paste the normal Firebase web config into Settings in the app, or set `window.SNAG_FIREBASE_CONFIG` in `firebase-config.js`.
5. Deploy `firestore.rules` and `storage.rules`, adapting them to your exact invitation/role model before production.

The Firebase web config is not a private service-account credential. Access control belongs in Firebase Authentication plus Firestore/Storage security rules.

## Data model direction
`projects/{projectId}` contains project metadata. Project members belong under `projects/{projectId}/members/{uid}`. Snags live under `projects/{projectId}/snags/{snagId}` and conversation items under each snag's `updates` subcollection. Media blobs live in Storage and their download URL/metadata is stored on the snag/update.

## Next-stage roadmap
- Builder account creates and owns multiple projects/addresses.
- Invite links create a real membership record and role (builder/client/contractor/viewer).
- Authentication, revocable invitations and notification preferences.
- Push/email notifications when an issue is assigned, replied to or moved to review.
- Image annotation, before/after pairing, due dates and contractor trade filters.
- Semantic similarity with embeddings for “we solved this before” suggestions.
- Exportable completion/handover report and unresolved snag list.
- Offline queue / retry for field use with patchy connectivity.
