/** A learning project: the context for turning authorized product documentation into learning content. */
export interface Project {
  id: string;
  name: string;
  product: string;
  /** Optional; empty string when not provided. */
  audience: string;
  /** Optional; empty string when not provided. */
  learningObjective: string;
  /** Optional; empty string when not provided. */
  context: string;
  /** Documents uploaded to this project, in upload order. */
  documentIds: string[];
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

/** Fields a client provides when creating a project. */
export type ProjectInput = Pick<Project, 'name' | 'product' | 'audience' | 'learningObjective' | 'context'>;

/** Maximum lengths (characters) after trimming. name and product are required. */
export const PROJECT_FIELD_LIMITS = {
  name: 120,
  product: 120,
  audience: 300,
  learningObjective: 1_000,
  context: 4_000,
} as const satisfies Record<keyof ProjectInput, number>;

export const REQUIRED_PROJECT_FIELDS = ['name', 'product'] as const;
