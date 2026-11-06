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

### Local storage

The backend keeps runtime data on the local filesystem, inside `server/`:

| Directory                   | Contents                                  |
| --------------------------- | ----------------------------------------- |
| `server/data/`              | Application data as JSON files            |
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
