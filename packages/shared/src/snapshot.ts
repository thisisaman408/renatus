import { z } from "zod";

/**
 * A snapshot is a frozen clone of the target repo at a specific commit, on a
 * local working directory. All downstream artifacts (files, imports, symbols,
 * patches) reference this snapshot by id.
 */
export const SnapshotSchema = z.object({
  id: z.string().uuid(),
  repoUrl: z.string(),
  ref: z.string().describe("Branch, tag, or symbolic ref requested by the job"),
  commitSha: z.string().describe("Resolved commit SHA at clone time"),
  localPath: z.string().describe("Absolute path to the snapshot working tree"),
  createdAt: z.date(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/**
 * Supported source-language tags. `other` is a catch-all so the indexer can
 * record every file without blowing up on lockfiles, binaries, etc.
 */
export const FileLanguageSchema = z.enum([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "other",
]);
export type FileLanguage = z.infer<typeof FileLanguageSchema>;

/**
 * A single file record produced by the indexer. `sha` is sha256(contents) and
 * is what the orchestrator uses for cache keys and idempotency.
 */
export const FileRecordSchema = z.object({
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  path: z.string().describe("Repo-relative path"),
  language: FileLanguageSchema,
  sha: z.string().describe("sha256 of file contents"),
  sizeBytes: z.number().int().nonnegative(),
});
export type FileRecord = z.infer<typeof FileRecordSchema>;

/**
 * A directed edge in the import graph. `importedSymbols` empty = side-effect
 * import (e.g. `import './polyfills'`). `isTypeOnly` covers
 * `import type {...}` so the Surgeon can prune cross-cutting type-only edges.
 */
export const ImportEdgeSchema = z.object({
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  fromFileId: z.string().uuid(),
  toFileId: z.string().uuid(),
  importedSymbols: z
    .array(z.string())
    .describe("Empty array means side-effect import"),
  isTypeOnly: z.boolean(),
});
export type ImportEdge = z.infer<typeof ImportEdgeSchema>;

/**
 * Kinds of top-level symbols the indexer surfaces.
 * `default` covers `export default` regardless of underlying form.
 */
export const SymbolKindSchema = z.enum([
  "function",
  "class",
  "interface",
  "type",
  "variable",
  "enum",
  "default",
]);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;

/**
 * A top-level symbol within a file. Used by the Surgeon to scope edits and by
 * the Cartographer to bind rules to specific call sites.
 */
export const SymbolRecordSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
  name: z.string(),
  kind: SymbolKindSchema,
  isExported: z.boolean(),
  line: z.number().int().positive(),
});
export type SymbolRecord = z.infer<typeof SymbolRecordSchema>;

// Made with Bob
