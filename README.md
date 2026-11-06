# AI-First Learning Builder

An AI-First Learning Builder that turns authorized product documentation into structured learning proposals. It uses AI generation, source traceability and factual validation, and every proposal needs human approval.

> Status: initial monorepo setup. Product features are not implemented yet.

## Technology stack

| Layer       | Technology                              |
| ----------- | --------------------------------------- |
| Frontend    | React, TypeScript, Vite                 |
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

### AI claim analysis

`POST /api/documents/:id/analyses` sends the document's current extraction to OpenAI and stores the extracted factual claims with verified evidence. `GET /api/analyses/:analysisId` returns a stored analysis.

- Every claim cites one or more `sourceId`s with an exact quotation. The backend resolves each source, verifies the quotation occurs exactly once in the fragment text and computes `startOffset`/`endOffset` itself (UTF-16 code units, start inclusive, end exclusive). Claims with unverifiable evidence are kept under `rejectedClaims` for audit and never treated as verified.
- Classifications: `confirmed` (directly stated, verified evidence), `pending_validation` (requires human validation) and `not_documented` (used only by documentation gaps: the documentation does not establish something; this never means the capability does not exist). The backend only ever downgrades a claim, never promotes it: claims involved in a contradiction, or stating automation, skipped review or guarantees, become `pending_validation`; claims stating figures or such capabilities that their quotations do not contain are rejected (`unsupported_detail`, `overreach`).
- `contradictions` quote every side of a conflict (at least two verified, distinct passages) and always have status `pending_review`; they are never resolved automatically.
- `documentationGaps` describe relevant missing information (limitations, integrations, preconditions, user responsibilities, error handling, expected outcomes) with status `not_documented` and optional verified related references.
- Rejected claims, contradictions and gaps are kept with their reasons for audit.
- Each analysis is stored immutably in `server/data/analyses/<analysisId>.json` and is tied to the exact `extractionId` analyzed. Failed provider calls are recorded with `status: "failed"`. Analyses created since E3.2 have `schemaVersion: 2`; earlier analyses (no `schemaVersion`) are returned as stored.

### Learning proposals

`POST /api/analyses/:analysisId/proposals` turns a completed analysis (`schemaVersion: 2`) into a draft learning experience; `GET /api/proposals/:proposalId` returns it. The document is not analyzed again.

- Input to the model: the analysis' confirmed and pending claims (with their verified quotations, re-verified against the extraction first), contradictions and documentation gaps.
- A proposal has a learning objective, audience, prerequisites and estimated duration (each `supported` by confirmed claims or explicitly `pending_validation`), and ordered modules with lessons, activities and assessments.
- Factual content (`fact`) may only reference confirmed claims. Pending claims can only appear as flagged `pending_validation` content. Items that are unsupported, rely on pending claims or state automation, guarantees or skipped review not present in the cited claims are removed and listed in `rejectedItems`; unknown claim/contradiction/gap references, malformed output or a proposal left without supported facts make the attempt fail.
- Every contradiction, documentation gap and pending claim of the analysis is carried over into `warnings` (all `requiresHumanReview: true`); related content is marked `requiresReview`.
- Source references and per-module evidence are derived by the backend from the analysis, never taken from the model.
- Generated proposals always have status `draft`; there is no approval or publication. Failed attempts are recorded with status `failed` and no content. Each proposal is an immutable file in `server/data/proposals/<proposalId>.json`.

### Local storage

The backend keeps runtime data on the local filesystem, inside `server/`:

| Directory                   | Contents                                  |
| --------------------------- | ----------------------------------------- |
| `server/data/`              | Application data as JSON files (documents, extraction history, analyses, proposals) |
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
