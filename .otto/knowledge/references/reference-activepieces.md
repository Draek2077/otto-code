---
id: "reference-activepieces"
kind: "reference"
title: "Activepieces"
status: "confirmed"
tags: ["external-reference","legacy-references-migration"]
reference_disposition: "adopted"
source_url: "https://github.com/activepieces/activepieces"
created_at: "2026-08-08T06:18:06.908Z"
updated_at: "2026-09-12T20:23:40.449Z"
---
# Activepieces

<!-- compiled_truth -->

**Read, not linked** | The **pause/resume model, near-verbatim**: a `PAUSED` status plus a discriminated `PauseMetadata` persisted on the run row, and a boot-time worker that rehydrates paused runs. Roughly sixty readable lines closing Otto's gate + restart-resume gap.

## Timeline

- time: "2026-08-08T06:18:06.908Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:18:06.908Z"
  kind: "evidence"
  summary: "Migrated from `docs/references.md` (table row 302). Legacy status: MIT (packages/ee/ carved out)."
- time: "2026-08-08T06:19:56.304Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
- time: "2026-09-12T19:01:08.744Z"
  kind: "evidence"
  summary: "Connector reuse evaluation, 2026-09-12: inspected upstream commit 89aeeae8c1eb98428210ec7d214f933b96aa1987 and published npm bundles. Community gmail, google-calendar, google-drive, microsoft-outlook, microsoft-outlook-calendar and microsoft-onedrive directories are outside root LICENSE enterprise exclusions and use MIT Expat (third-party dependency licenses still apply). Their action objects include names, descriptions, input properties, run functions and often AI/read-write/idempotency metadata. This makes selected operations a candidate for an Otto adapter without deploying the workflow engine. Gmail source handles MIME composition, reply thread headers and forwarding parsed attachments; OneDrive source handles chunked upload with 320KiB-multiple chunks. Coverage gaps: Outlook has search/send/draft/reply/forward but no dedicated get-message/list-messages actions; Outlook Calendar has create/delete/list-events but no dedicated list-calendars/get-event actions. Inspected Gmail reply-all splits recipients on commas, so quoted display names require a fix before reuse; broad edge-case correctness is not established. Local import-only probe of pinned bundles loaded Gmail 0.15.0, Google Calendar 0.10.3, Outlook 0.5.3, Outlook Calendar 0.2.8, OneDrive 0.4.7 and enumerated action metadata. Google Drive 0.9.1 failed import with missing @zip.js/zip.js, despite published dependencies being empty; source declares that dependency. No account operations were invoked, packages were not added to Otto dependencies, and no adapter was implemented during this evaluation. Recommendation is selected, pinned operation reuse with Otto-owned authorization, schemas and result bounds; it is not yet an adopted runtime dependency. Alternatives: NangoHQ/integration-templates contains relevant schemas and operations but root LICENSE is Elastic License 2.0, including hosted/managed-service restrictions. VibeTensor/vibemcp uses PolyForm Noncommercial 1.0.0 and lists Google Drive/OneDrive and hosted OAuth as unfinished roadmap. googleworkspace/cli builds Google API commands from Discovery documents but covers Google only and explicitly states it is not an officially supported Google product."
  source: "https://github.com/activepieces/activepieces/tree/89aeeae8c1eb98428210ec7d214f933b96aa1987/packages/pieces/community"
  affects: ["connectors"]
- time: "2026-09-12T20:23:40.449Z"
  kind: "note"
  summary: "Selected Gmail MIME/reply/forward helpers from MIT community code at commit 89aeeae8c1eb98428210ec7d214f933b96aa1987 are now adapted in packages/server/src/server/connectors/vendor/activepieces-mail.ts, retaining the full license and recording changes. Nodemailer and Mailparser are pinned dependencies; the workflow engine and complete pieces packages are not runtime dependencies. The prior import-only evaluation remains history. MIME-focused tests pass, and a real unsent draft composed through this adapter was created/read/deleted successfully using the development host's own Google account grant. Actual send/reply/forward delivery and Microsoft reuse remain unverified. Original pause/resume reference remains research; adoption here is limited to mail helpers."
  affects: ["reference-activepieces"]
