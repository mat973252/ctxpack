import { z } from "zod";

export const SCHEMA_VERSION = 1;
export const PACK_VERSION = "0.1";

export const ProgressStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "blocked",
  "completed",
]);
export type ProgressStatus = z.infer<typeof ProgressStatusSchema>;

export const ManifestSchema = z
  .object({
    version: z.string().min(1),
    project: z.string().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    schemaVersion: z.literal(SCHEMA_VERSION),
  })
  .strict();
export type Manifest = z.infer<typeof ManifestSchema>;

export const VerificationSchema = z
  .object({
    name: z.string().min(1),
    result: z.enum(["pass", "fail", "unknown"]),
    detail: z.string().optional(),
  })
  .strict();
export type Verification = z.infer<typeof VerificationSchema>;

export const GitStateSchema = z
  .object({
    branch: z.string().optional(),
    head: z.string().optional(),
    changedFiles: z.array(z.string()).optional(),
  })
  .strict();
export type GitState = z.infer<typeof GitStateSchema>;

export const StateSchema = z
  .object({
    goal: z.string(),
    status: ProgressStatusSchema,
    completed: z.array(z.string()),
    currentTasks: z.array(z.string()),
    blockers: z.array(z.string()),
    nextActions: z.array(z.string()),
    relevantFiles: z.array(z.string()),
    verification: z.array(VerificationSchema),
    git: GitStateSchema,
  })
  .strict();
export type State = z.infer<typeof StateSchema>;

export const ArtifactSchema = z
  .object({
    path: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();
export type Artifact = z.infer<typeof ArtifactSchema>;

export const ArtifactsSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    artifacts: z.array(ArtifactSchema),
  })
  .strict();
export type Artifacts = z.infer<typeof ArtifactsSchema>;

export interface ContextPack {
  manifest: Manifest;
  state: State;
  artifacts: Artifacts;
}

export function createDefaultManifest(project: string, now: string): Manifest {
  return {
    version: PACK_VERSION,
    project,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  };
}

export function createDefaultState(): State {
  return {
    goal: "",
    status: "not_started",
    completed: [],
    currentTasks: [],
    blockers: [],
    nextActions: [],
    relevantFiles: [],
    verification: [],
    git: {},
  };
}

export function createDefaultArtifacts(): Artifacts {
  return { schemaVersion: SCHEMA_VERSION, artifacts: [] };
}
