import path from 'node:path';
import { serverRoot } from './paths.js';

const dataDir = path.join(serverRoot, 'data');
const storageDir = path.join(serverRoot, 'storage');

export interface StorageConfig {
  /** Application JSON data. */
  dataDir: string;
  /** Root for stored files. Persisted file paths are relative to this directory. */
  storageDir: string;
  /** Original uploaded documents, stored unmodified. */
  originalsDir: string;
  /** JSON collection of document metadata. */
  documentsFile: string;
  /** JSON collection of learning projects. */
  projectsFile: string;
  /** Version history of logical documents (see version.repository.ts). */
  documentVersionsFile: string;
  /** Extraction history per document (see extraction.repository.ts). */
  extractionsDir: string;
  /** One immutable JSON file per claim analysis: <analysisId>.json. */
  analysesDir: string;
  /** One immutable JSON file per learning proposal: <proposalId>.json. */
  proposalsDir: string;
  /** Append-only human review log per proposal: <proposalId>/<reviewId>.json. */
  reviewsDir: string;
  /** One immutable JSON file per impact analysis: <impactAnalysisId>.json. */
  impactAnalysesDir: string;
  /** One immutable JSON file per learning update: <updateId>.json. */
  learningUpdatesDir: string;
  /** E5.5: one immutable JSON file per audience training: <trainingId>.json. */
  trainingsDir: string;
  /** E5.5: append-only human review log per training: <trainingId>/<reviewId>.json. */
  trainingReviewsDir: string;
  /** E5.5: append-only human decisions on findings, per analysis: <analysisId>/<decisionId>.json. */
  findingDecisionsDir: string;
}

export const storage: StorageConfig = {
  dataDir,
  storageDir,
  originalsDir: path.join(storageDir, 'originals'),
  documentsFile: path.join(dataDir, 'documents.json'),
  projectsFile: path.join(dataDir, 'projects.json'),
  documentVersionsFile: path.join(dataDir, 'document-versions.json'),
  extractionsDir: path.join(dataDir, 'extractions'),
  analysesDir: path.join(dataDir, 'analyses'),
  proposalsDir: path.join(dataDir, 'proposals'),
  reviewsDir: path.join(dataDir, 'reviews'),
  impactAnalysesDir: path.join(dataDir, 'impact-analyses'),
  learningUpdatesDir: path.join(dataDir, 'learning-updates'),
  trainingsDir: path.join(dataDir, 'trainings'),
  trainingReviewsDir: path.join(dataDir, 'training-reviews'),
  findingDecisionsDir: path.join(dataDir, 'finding-decisions'),
};
