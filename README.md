# AI-First Learning Builder

An AI-First Learning Builder that turns authorized product documentation into structured learning proposals. It uses AI generation, source traceability and factual validation, and every proposal needs human approval.

> Status: initial monorepo setup. Product features are not implemented yet.

## Technology stack

| Layer       | Technology                              |
| ----------- | --------------------------------------- |
| Frontend    | React, TypeScript, Vite, Tailwind CSS 4 |
| Backend     | Node.js, Express, TypeScript            |
| AI          | OpenAI API (backend only)               |
| Persistence | Local JSON files, local document storage |

## Repository structure

```text
ai-first-learning-builder/
├── client/   # React + TypeScript + Vite frontend
├── server/   # Node.js + Express + TypeScript API
├── .gitignore
└── README.md
```

## Prerequisites

- Node.js 20.19+ or 22.12+ (required by Vite)
- npm

## Initial setup

Install dependencies for each app:

```bash
cd client
npm install

cd ../server
npm install
```

## Running locally

The frontend and backend run independently, each in its own terminal.

### Backend (Express API)

```bash
cd server
npm run dev       # development with auto-reload (tsx)
```

The API runs on `http://localhost:3001` by default. Set the `PORT` environment variable to change it.

Health check:

```bash
curl http://localhost:3001/api/health
# {"status":"ok","message":"API is running"}
```

Production build:

```bash
npm run build     # compiles TypeScript to server/dist
npm start         # runs the compiled build
```

### Configuration (environment variables)

The backend reads `server/.env` at startup if it exists (git-ignored). Start from the template:

```bash
cd server
cp .env.example .env    # then set OPENAI_API_KEY
```

| Variable            | Required        | Default         | Purpose                                                     |
| ------------------- | --------------- | --------------- | ----------------------------------------------------------- |
| `PORT`              | no              | `3001`          | API port                                                    |
| `OPENAI_API_KEY`    | for AI analysis | —               | OpenAI API key. Server-side only; never sent to the client. |
| `OPENAI_MODEL`      | no              | `gpt-5.4-mini`  | Model for claim extraction (must support structured outputs)|
| `OPENAI_TIMEOUT_MS` | no              | `120000`        | Timeout per AI request                                      |
| `OPENAI_BASE_URL`   | no              | official API    | Alternative endpoint (proxy, local test server)             |

Variables set in the shell override `.env`. Without `OPENAI_API_KEY` the rest of the API works normally and AI analysis requests respond `503`.

### Projects and documents

- `POST /api/projects` creates a project (`name` and `product` required; `audience`, `learningObjective`, `context` optional). `GET /api/projects` lists them (newest first); `GET /api/projects/:id` returns one. Projects are stored in `server/data/projects.json`.
- `POST /api/projects/:id/documents` uploads a PDF/DOCX (multipart field `file`, same rules as `POST /api/documents`: max 15 MB) and links it to the project; unknown projects are rejected before the file is read. `GET /api/projects/:id/documents` lists the project's documents in upload order.
- Uploading never starts processing. The project-document link is stored in `project.documentIds`; document metadata is unchanged.

### AI claim analysis

`POST /api/documents/:id/analyses` sends the document's current extraction to OpenAI and stores the extracted factual claims with verified evidence. `GET /api/analyses/:analysisId` returns a stored analysis, and `GET /api/documents/:id/analyses` lists a document's persisted analyses (summaries, newest first, failed attempts included).

- Every claim cites one or more `sourceId`s with an exact quotation. The backend resolves each source, verifies the quotation occurs exactly once in the fragment text and computes `startOffset`/`endOffset` itself (UTF-16 code units, start inclusive, end exclusive). Claims with unverifiable evidence are kept under `rejectedClaims` for audit and never treated as verified.
- Classifications: `confirmed` (directly stated, verified evidence), `pending_validation` (requires human validation) and `not_documented` (used only by documentation gaps: the documentation does not establish something; this never means the capability does not exist). The backend only ever downgrades a claim, never promotes it: claims involved in a contradiction, or stating automation, skipped review or guarantees, become `pending_validation`; claims stating figures or such capabilities that their quotations do not contain are rejected (`unsupported_detail`, `overreach`).
- `contradictions` quote every side of a conflict (at least two verified, distinct passages) and always have status `pending_review`; they are never resolved automatically.
- `documentationGaps` describe relevant missing information (limitations, integrations, preconditions, user responsibilities, error handling, expected outcomes) with status `not_documented` and optional verified related references.
- Rejected claims, contradictions and gaps are kept with their reasons for audit.
- Each analysis is stored immutably in `server/data/analyses/<analysisId>.json` and is tied to the exact `extractionId` analyzed. Failed provider calls are recorded with `status: "failed"`. Analyses created since E3.2 have `schemaVersion: 2`; earlier analyses (no `schemaVersion`) are returned as stored.

### Learning proposals

`POST /api/analyses/:analysisId/proposals` turns a completed analysis (`schemaVersion: 2`) into a draft learning experience; `GET /api/proposals/:proposalId` returns it, and `GET /api/analyses/:analysisId/proposals` lists an analysis' persisted proposals (summaries, newest first, failed attempts included). The document is not analyzed again.

- Input to the model: the analysis' confirmed and pending claims (with their verified quotations, re-verified against the extraction first), contradictions and documentation gaps.
- A proposal has a learning objective, audience, prerequisites and estimated duration (each `supported` by confirmed claims or explicitly `pending_validation`), and ordered modules with lessons, activities and assessments.
- Factual content (`fact`) may only reference confirmed claims. Pending claims can only appear as flagged `pending_validation` content. Items that are unsupported, rely on pending claims or state automation, guarantees or skipped review not present in the cited claims are removed and listed in `rejectedItems`; unknown claim/contradiction/gap references, malformed output or a proposal left without supported facts make the attempt fail.
- Every contradiction, documentation gap and pending claim of the analysis is carried over into `warnings` (all `requiresHumanReview: true`); related content is marked `requiresReview`.
- Source references and per-module evidence are derived by the backend from the analysis, never taken from the model.
- Generated proposals always have status `draft`; there is no approval or publication. Failed attempts are recorded with status `failed` and no content. Each proposal is an immutable file in `server/data/proposals/<proposalId>.json`.

### Human review

Proposals are approved or rejected only through an explicit human decision. Decisions are stored in an append-only review log, separate from the proposal (which is never modified): `server/data/reviews/<proposalId>/<reviewId>.json`.

- `POST /api/proposals/:proposalId/reviews` records a decision: `{ decision: "approved" | "rejected", reason?, comment?, acknowledgedWarnings?, basedOnReviewId }`.
  - A rejection requires a `reason`.
  - Approving a proposal with warnings or pending-validation content requires `acknowledgedWarnings: true`.
  - Failed generation attempts (critical validation errors) cannot be approved or rejected (`409`).
  - `basedOnReviewId` must be the latest decision the reviewer saw (`null` if none); otherwise `409`, so a stale view can never overwrite someone else's decision. Repeating the current decision is also `409`.
- `GET /api/proposals/:proposalId/reviews` returns `{ reviewStatus, reviews }` (newest first). `reviewStatus` is `pending_review`, `approved`, `rejected` or `not_reviewable`.
- `GET /api/analyses/:analysisId/proposals` summaries include `reviewStatus` (`"unavailable"` if a review log cannot be read; an approval state is never guessed).
- There is no publication and no automatic approval.

### Document versions and comparison

A project document (a *logical document*) can receive new versions. Each version is a separate physical document (its own `DocumentRecord`, stored file and extraction history), so earlier versions, their files and their extractions are never modified. The logical document id is the id of version 1, i.e. the id listed in the project's `documentIds`; later versions are not added to that list, so `GET /api/projects/:id/documents` is unchanged.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/projects/:id/documents/:documentId/versions` | `{ documentId, projectId, currentVersion, versions }`, oldest first. Each version: `version`, `documentId`, `originalFilename`, `uploadedAt`, `status` (live from the document record), `isCurrent`, `document`. A document without stored history is returned as its own version 1. |
| `POST /api/projects/:id/documents/:documentId/versions` | Uploads a new version (multipart field `file`, same PDF/DOCX rules as other uploads) and returns it with the next version number (`201`). Processing is not started: run the existing `POST /api/documents/:versionDocumentId/process`. No AI analysis is started. |
| `GET /api/projects/:id/documents/:documentId/versions/:version` | One version. |
| `GET /api/projects/:id/documents/:documentId/comparison?from=1&to=2` | Deterministic comparison of two versions (see below). |

- Only documents of the given project can be versioned or compared (`404` otherwise; the id of a later version is rejected with `400`). The project and document are checked before the upload is read.
- The latest uploaded version is the current one, even if its processing failed.
- Histories are stored in `server/data/document-versions.json` only once a second version exists; entries are appended, never changed. Version numbers are assigned in a serialized operation, so concurrent uploads get consecutive numbers. A corrupted file makes the endpoints fail (`500`) and is left unchanged.

**Comparison** (no AI). Compares the current extraction of each version, unit by unit: PDF pages or DOCX paragraphs (original paragraph positions). Units without text (e.g. image-only PDF pages) are skipped and counted in `emptyUnitCount`.

1. Units are matched as unchanged by their whitespace-normalized text with a longest-common-subsequence alignment, which keeps document order.
2. Between two matched units, removed and added units are paired as `modified` when their word overlap (Dice coefficient over words, case-insensitive) is at least 0.5, using an order-preserving alignment. The rest are `removed` or `added`.
3. `modified` changes include a word-level `diff` (omitted for very long units).

Each change has a deterministic `changeId`, `type` (`added`, `removed`, `modified`, `unchanged`), and `from` / `to` sides with `version`, `documentId`, `extractionId`, `locator`, `sourceId` and `text`; every `sourceId` resolves through `GET /api/sources/:sourceId` to exactly that text. The response also has `summary` counts and per-version metadata.

Each comparison also has a deterministic `comparisonId` (algorithm + both extraction ids).

The comparison responds `409` with the reason, and returns no changes, when a version is not processed, its processing failed, it only has a legacy extraction, or the two versions have different formats (PDF vs DOCX). Limits: comparison is at page/paragraph granularity, so moved content is reported as removed + added; a split or merged paragraph appears as modified, removed or added depending on word overlap; whitespace-only differences count as unchanged.

### Impact analysis

An impact analysis asks the AI (shared OpenAI client, strict structured output, prompt `impact@1`) how the changes between two processed versions affect an existing learning proposal of the **previous** version. It is a recommendation for human review: proposals are never modified and no learning content is generated.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/projects/:id/documents/:documentId/versions/:version/proposals` | Proposals compatible with a version: drafts generated from exactly that version's current extraction, newest first, each with its `reviewStatus`. |
| `POST /api/projects/:id/documents/:documentId/impact-analyses` | Body `{ from, to, proposalId }` (`from` < `to`). Runs the analysis and stores it (`201`). |
| `GET /api/projects/:id/documents/:documentId/impact-analyses` | Summaries of the document's impact analyses, newest first; optional `from`, `to`, `proposalId` filters. |
| `GET /api/impact-analyses/:impactAnalysisId` | One stored analysis. |

- **Inputs.** The E5.1 comparison of `from` → `to` (only `added`, `removed` and `modified` units are sent, with their text and source ids), and the proposal's modules, lessons, activities and assessments (real ids, text, claim ids), the claims' statuses and source ids, and its unresolved contradictions / pending validations. For each change the backend also computes `linkedElementIds`: elements whose claims cite the previous text.
- **Compatibility.** The proposal must belong to the `from` version's document and current extraction (`409` otherwise, e.g. a proposal of another document or version). Failed proposals are not accepted. The proposal's review status (pending, approved, rejected) is shown, stored as a snapshot and turned into a warning; it never selects the proposal automatically. Identical versions (`409`) and unprocessed or incomparable versions (E5.1 `409`s) are not analyzed.
- **Result per change.** `impact` (`high`, `medium`, `low`, `no_impact`, or `null` when no valid assessment exists), `certainty` (`supported` / `uncertain`), `justification`, `reviewRecommendation`, `affectedElements`, `evidence` and `requiresHumanReview` with `reviewReasons` (`uncertain`, `not_assessed`, `unresolved_issue`, `no_element_identified`, `linked_elements_not_listed`, `element_requires_review`). The record also has `affectedElements` (each with its highest impact), `summary` counts, `warnings` (backend warnings with a `code`, AI warnings with `code: null`), `rejectedResults`, the version/extraction/document ids, `comparisonId`, `proposalId`, `model`, `promptVersion` and timestamps.
- **Validation (backend).** Results for unknown or duplicate `changeId`s, unknown element ids, `no_impact` with affected elements, missing texts, or references that are not passages of the change or of the affected elements' claims are rejected and kept in `rejectedResults`; the change is then reported as not assessed (`impact: null`) instead of guessing. Every reference is resolved through `GET /api/sources/:sourceId` and must belong to one of the two compared versions; each result always cites the change's own passages. The model never supplies quotes or claim statuses, so it cannot turn pending information into confirmed facts or resolve contradictions; results involving such claims are flagged for review.
- **Failures.** Malformed output, output without any valid result, and provider errors are stored as `failed` records (no results) and answered with `502`/`504`. Without `OPENAI_API_KEY` the endpoint responds `503` and stores nothing.
- **Storage.** One immutable file per analysis in `server/data/impact-analyses/<impactAnalysisId>.json`; a new analysis always creates a new record.
- Proposal versions produced by learning updates (below) can be analyzed only once a human approved them.

### Learning updates and proposal versions

A learning update asks the AI (shared OpenAI client, strict structured output, prompt `update@1`) to propose changes to the learning content affected by a completed impact analysis. The result is a **new candidate version** of the proposal, stored as a separate immutable proposal record; it only becomes the current version when a person approves it. No existing proposal, review or analysis is ever modified.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/projects/:id/documents/:documentId/learning-updates` | Body `{ impactAnalysisId }`. Generates and stores an update (`201`). |
| `GET /api/projects/:id/documents/:documentId/learning-updates` | Summaries, newest first; optional `impactAnalysisId` and `proposalId` (source or root proposal) filters. |
| `GET /api/learning-updates/:updateId` | One update, with its `reviewStatus`, `reviews` and `isCurrent`. |
| `POST /api/projects/:id/documents/:documentId/learning-updates/:updateId/reviews` | Approve or reject (same body and rules as E4.5 reviews: `basedOnReviewId`, reason required to reject, `acknowledgedWarnings` to approve with warnings or pending content). |
| `GET /api/proposals/:proposalId/versions` | The lineage of a proposal (any of its versions): `currentProposalId`, `currentVersion` and every version with its review status. |

- **Preconditions (all checked in the backend).** The impact analysis belongs to the project/document and is `completed`; its proposal exists, has content and belongs to the analysis' previous version (document and extraction); the E5.1 comparison of the two versions still has the same `comparisonId` and extraction ids; the impact results match the comparison's changes; and the proposal is the **current** version of its lineage (`409` otherwise).
- **What can change.** Only *actionable* impact results — validated `high`, `medium` or `low` assessments with `certainty: supported` — can lead to operations. `no_impact`, `uncertain` and not-assessed results never change content; they are listed in `notUpdatedChanges`, and elements of uncertain results are kept and flagged for review. Without actionable results the endpoint answers `409` ("no learning content to update") and stores nothing.
- **AI input.** The full proposal (ids, content, claim ids), its claims (status, and whether their evidence still exists in the new version), unresolved contradictions/pending validations, the actionable changes (impact, justification, affected elements, previous and new text with source ids) and the excluded changes.
- **Operations.** `modify` / `remove` an existing affected element, or `add` a lesson, activity or assessment to an existing module (or a new module with its first lesson). Each stored operation has `operation`, `elementType`, `elementId` (existing or newly assigned, e.g. `asm_v2_1`), `moduleId`, `previous` and `proposed` content, `justification`, `changeIds`, `impactLevel` and verified `references` of the cited changes. The model can also keep elements unchanged and flag them for review (`keptForReview`).
- **Validation.** Operations are rejected (kept in `rejectedOperations`) when they cite unknown or non-actionable changes, unknown elements, elements not affected by the cited changes, references that are not passages of those changes, or have an invalid payload; facts must be backed by a passage of the new version or a confirmed claim whose evidence still exists, cannot use pending or contradicted claims, and cannot state figures or capabilities (automation, guarantees, no review) absent from their sources. If no operation survives, the attempt is stored as `failed` (`502`) with no candidate.
- **The new version.** Built from a copy of the source proposal: untouched elements keep their ids and content (`unchangedElementIds`); existing evidence is re-anchored to the new version through the comparison (claims whose quoted text disappeared become stale; elements citing them are flagged for review and supported attributes without evidence become `pending_validation`); new content cites passages of the new version. The candidate records `lineage` (`rootProposalId`, `parentProposalId`, `proposalVersion`, `updateId`, `impactAnalysisId`) and is excluded from the per-analysis proposal lists of E4.4/E4.5.
- **Review.** Decisions use the E4.5 review log of the candidate proposal (append-only, `basedOnReviewId` concurrency), only through the update endpoint (the generic proposal review endpoint answers `409` for candidates). Approval additionally requires that the update's source proposal is still current and that every reference still verifies; it makes the candidate the current version. Rejecting keeps the previous version current; revoking an approval is blocked once a newer approved version builds on it. Failed updates cannot be reviewed.
- **Next cycle.** An approved version belongs to the new document version: it is offered as a compatible proposal of that version for E5.2, and its updates produce version 3, 4, …
- **Storage.** One immutable file per update in `server/data/learning-updates/<updateId>.json`; candidates in `server/data/proposals/`; decisions in `server/data/reviews/<candidateProposalId>/`.

### Local storage

The backend keeps runtime data on the local filesystem, inside `server/`:

| Directory                   | Contents                                  |
| --------------------------- | ----------------------------------------- |
| `server/data/`              | Application data as JSON files (projects, documents, document versions, extraction history, analyses, proposals, reviews) |
| `server/storage/originals/` | Original uploaded documents, unmodified   |

These directories are created automatically when the server starts, and existing files are never deleted or overwritten. If they cannot be created, the server exits with an error instead of starting. Paths are resolved relative to the `server/` folder, so they do not depend on the directory you start the server from.

Both directories are ignored by Git. Local runtime data is never committed.

### Frontend (Vite)

```bash
cd client
npm run dev       # starts the Vite dev server
```

The app runs on `http://localhost:5173` by default.

Production build:

```bash
npm run build     # type-checks and builds to client/dist
npm run preview   # serves the production build locally
```
