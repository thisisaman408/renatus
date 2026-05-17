import { createHash } from "node:crypto";
import { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  Project,
  type ExportDeclaration,
  type ImportDeclaration,
  type SourceFile,
} from "ts-morph";
import type {
  AuditEventRepository,
  FileRepository,
  FileInput,
  ImportRepository,
  ImportEdgeInput,
  SymbolRepository,
  SymbolInput,
} from "@renatus/db";
import type { FileLanguage, SymbolKind } from "@renatus/shared";
import { emitAuditEvent } from "../audit-events/emit.js";

/**
 * Directory segments that the indexer must never descend into.
 *
 * Mirrors the GitHub adapter's exclude list so an indexed snapshot stays
 * consistent with what was cloned, plus build outputs that may have been
 * created post-clone (e.g. by a `pnpm install` side-effect).
 */
const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".renatus-workspace",
  "coverage",
]);

/**
 * Hard cap on file size that the indexer will read into memory. Anything
 * larger is skipped silently — we don't want to OOM on minified bundles or
 * checked-in binaries.
 */
const MAX_FILE_BYTES = 1024 * 1024; // 1 MB

/**
 * Extension → language tag mapping. Anything not in here becomes `other`.
 */
const LANGUAGE_BY_EXT: ReadonlyMap<string, FileLanguage> = new Map([
  [".ts", "typescript"],
  [".tsx", "tsx"],
  [".js", "javascript"],
  [".jsx", "jsx"],
  [".json", "json"],
]);

/**
 * Extensions whose contents we feed to ts-morph for AST parsing.
 */
const PARSEABLE_RE = /\.(ts|tsx|js|jsx)$/;

/**
 * Resolution suffixes tried, in order, when resolving a relative import
 * specifier to a file already known to the indexer. The empty string covers
 * the case where the spec already names a file with an explicit extension.
 */
const RESOLUTION_SUFFIXES: readonly string[] = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

export interface IndexInput {
  /** UUID of the persisted `repo_snapshots` row. */
  snapshotId: string;
  /** Absolute path to the cloned working tree. */
  localPath: string;
  /**
   * Optional job UUID — when present, the indexer emits audit events at the
   * start and end of the indexing run. When absent, audit emission is
   * skipped entirely (the indexer can be used in test contexts without
   * synthetic job ids).
   */
  jobId?: string;
}

export interface IndexResult {
  snapshotId: string;
  fileCount: number;
  importCount: number;
  symbolCount: number;
}

/**
 * Internal record kept per discovered file during a single index run.
 */
interface DiscoveredFile {
  /** Absolute path on disk. */
  absPath: string;
  /** Forward-slash repo-relative path (the row's `path` column). */
  relPath: string;
  /** sha256(contents). */
  sha: string;
  /** Byte size. */
  sizeBytes: number;
  /** Language tag. */
  language: FileLanguage;
}

/**
 * Indexer — walks a snapshot's working tree, parses TS/JS modules with
 * ts-morph, and persists files, import edges, and top-level symbols.
 *
 * Design notes:
 *   1. We do a single pass to discover + hash every file (one bulk insert),
 *      then a second pass to AST-parse only the TS/JS subset. This lets us
 *      build a complete path→id map *before* resolving any imports, so
 *      edges always point at real file rows.
 *   2. The ts-morph project is configured to skip the user's tsconfig — we
 *      want stable zero-config parsing, not type-checking.
 *   3. Per-file parse failures are logged and swallowed; the file row still
 *      exists, but no imports/symbols are produced for it. The indexer never
 *      throws on a single bad source.
 */
export class Indexer {
  constructor(
    private readonly fileRepo: FileRepository,
    private readonly importRepo: ImportRepository,
    private readonly symbolRepo: SymbolRepository,
    private readonly auditRepo: AuditEventRepository | null = null,
  ) {}

  async index(input: IndexInput): Promise<IndexResult> {
    const { snapshotId, localPath, jobId } = input;

    if (jobId !== undefined) {
      await emitAuditEvent(this.auditRepo, {
        jobId,
        agentKind: "indexer",
        eventType: "index_started",
        payload: { snapshotId, localPath },
      });
    }

    // 1. Walk the working tree and produce a DiscoveredFile per entry.
    const discovered = await this.walk(localPath);

    // 2. Persist all file rows in one shot and build a path→id map.
    const fileInputs: FileInput[] = discovered.map((f) => ({
      path: f.relPath,
      language: f.language,
      sha: f.sha,
      sizeBytes: f.sizeBytes,
    }));
    const fileRows = await this.fileRepo.bulkInsert(snapshotId, fileInputs);

    const idByRelPath = new Map<string, string>();
    for (const row of fileRows) {
      idByRelPath.set(row.path, row.id);
    }

    // Subset of discovered files we will actually feed to ts-morph.
    const parseable = discovered.filter((f) => PARSEABLE_RE.test(f.absPath));

    // 3. Configure a tsconfig-free ts-morph project.
    const project = new Project({
      useInMemoryFileSystem: false,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        // rationale: ts-morph CompilerOptions uses ts enums; numeric values match TypeScript 5.x
        allowJs: true,
        jsx: 4 /* React JSX */,
        target: 99 /* ESNext */,
        module: 99 /* ESNext */,
        moduleResolution: 100 /* Bundler */,
        isolatedModules: true,
        noEmit: true,
      },
    });

    for (const f of parseable) {
      project.addSourceFileAtPath(f.absPath);
    }

    // 4. For each parseable file, extract imports + symbols.
    const importEdges: ImportEdgeInput[] = [];
    const symbolInputs: SymbolInput[] = [];

    for (const f of parseable) {
      const fromFileId = idByRelPath.get(f.relPath);
      if (fromFileId === undefined) continue; // Defensive — should not happen.

      let sourceFile: SourceFile;
      try {
        sourceFile = project.getSourceFileOrThrow(f.absPath);
      } catch (error) {
        console.error(
          `[Indexer] Failed to load ${f.relPath}: ${(error as Error).message}`,
        );
        continue;
      }

      try {
        importEdges.push(
          ...this.extractEdges(sourceFile, fromFileId, idByRelPath, localPath),
        );
      } catch (error) {
        console.error(
          `[Indexer] Failed to parse imports for ${f.relPath}: ${(error as Error).message}`,
        );
      }

      try {
        symbolInputs.push(...this.extractSymbols(sourceFile, fromFileId));
      } catch (error) {
        console.error(
          `[Indexer] Failed to parse symbols for ${f.relPath}: ${(error as Error).message}`,
        );
      }
    }

    // 5. Bulk-persist edges + symbols.
    await this.importRepo.bulkInsert(snapshotId, importEdges);
    await this.symbolRepo.bulkInsert(symbolInputs);

    const result: IndexResult = {
      snapshotId,
      fileCount: fileRows.length,
      importCount: importEdges.length,
      symbolCount: symbolInputs.length,
    };

    if (jobId !== undefined) {
      await emitAuditEvent(this.auditRepo, {
        jobId,
        agentKind: "indexer",
        eventType: "index_completed",
        payload: {
          fileCount: result.fileCount,
          importCount: result.importCount,
          symbolCount: result.symbolCount,
        },
        entityId: snapshotId,
        entityType: "snapshot",
      });
    }

    return result;
  }

  /**
   * Walk `root` recursively, returning one DiscoveredFile per non-excluded,
   * sub-1MB file. Hashes are computed as we go so we can persist in one shot.
   */
  private async walk(root: string): Promise<DiscoveredFile[]> {
    const entries = (await readdir(root, {
      recursive: true,
      withFileTypes: true,
    })) as Dirent[];

    const results: DiscoveredFile[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const parent = entry.parentPath ?? root;
      const absPath = path.join(parent, entry.name);
      const relPathOs = path.relative(root, absPath);

      if (relIsExcluded(relPathOs)) continue;

      const relPath = relPathOs.split(path.sep).join("/");

      let size: number;
      try {
        const st = await stat(absPath);
        size = st.size;
      } catch (error) {
        console.error(
          `[Indexer] Failed to stat ${relPath}: ${(error as Error).message}`,
        );
        continue;
      }

      if (size > MAX_FILE_BYTES) continue;

      let buf: Buffer;
      try {
        buf = await readFile(absPath);
      } catch (error) {
        console.error(
          `[Indexer] Failed to read ${relPath}: ${(error as Error).message}`,
        );
        continue;
      }

      const sha = createHash("sha256").update(buf).digest("hex");
      const language = languageOf(absPath);

      results.push({
        absPath,
        relPath,
        sha,
        sizeBytes: size,
        language,
      });
    }

    return results;
  }

  /**
   * Collect import + re-export edges for a single source file.
   *
   * Both `import ... from '...'` and `export ... from '...'` form edges:
   * the latter is essentially a re-export and the Surgeon must follow them
   * the same way to find consumers.
   */
  private extractEdges(
    sourceFile: SourceFile,
    fromFileId: string,
    idByRelPath: Map<string, string>,
    localPath: string,
  ): ImportEdgeInput[] {
    const edges: ImportEdgeInput[] = [];
    const sourceDir = sourceFile.getDirectoryPath();

    for (const decl of sourceFile.getImportDeclarations()) {
      const edge = this.edgeFromImportDecl(
        decl,
        sourceDir,
        fromFileId,
        idByRelPath,
        localPath,
      );
      if (edge !== null) edges.push(edge);
    }

    for (const decl of sourceFile.getExportDeclarations()) {
      const edge = this.edgeFromExportDecl(
        decl,
        sourceDir,
        fromFileId,
        idByRelPath,
        localPath,
      );
      if (edge !== null) edges.push(edge);
    }

    return edges;
  }

  private edgeFromImportDecl(
    decl: ImportDeclaration,
    sourceDir: string,
    fromFileId: string,
    idByRelPath: Map<string, string>,
    localPath: string,
  ): ImportEdgeInput | null {
    const spec = decl.getModuleSpecifierValue();
    if (!spec || !isRelativeSpec(spec)) return null;

    const toFileId = resolveSpecifier(spec, sourceDir, localPath, idByRelPath);
    if (toFileId === null) return null;

    const named = decl.getNamedImports().map((n) => n.getName());
    const def = decl.getDefaultImport()?.getText();
    const ns = decl.getNamespaceImport()?.getText();

    const importedSymbols: string[] = [];
    if (def !== undefined) importedSymbols.push(def);
    if (ns !== undefined) importedSymbols.push(ns);
    importedSymbols.push(...named);

    const isTypeOnly = decl.isTypeOnly?.() ?? false;

    return {
      fromFileId,
      toFileId,
      importedSymbols,
      isTypeOnly,
    };
  }

  private edgeFromExportDecl(
    decl: ExportDeclaration,
    sourceDir: string,
    fromFileId: string,
    idByRelPath: Map<string, string>,
    localPath: string,
  ): ImportEdgeInput | null {
    const spec = decl.getModuleSpecifierValue();
    // export { x } (no `from`) does not produce an edge.
    if (!spec || !isRelativeSpec(spec)) return null;

    const toFileId = resolveSpecifier(spec, sourceDir, localPath, idByRelPath);
    if (toFileId === null) return null;

    const namedExports = decl.getNamedExports().map((n) => n.getName());

    return {
      fromFileId,
      toFileId,
      importedSymbols: namedExports,
      isTypeOnly: decl.isTypeOnly?.() ?? false,
    };
  }

  /**
   * Surface top-level symbols. Variables are filtered to those declared in
   * a `VariableStatement` whose parent is the source file — i.e. true
   * top-level `const`/`let`/`var`, not destructured locals inside a function.
   */
  private extractSymbols(
    sourceFile: SourceFile,
    fileId: string,
  ): SymbolInput[] {
    const out: SymbolInput[] = [];

    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (name === undefined) continue;
      out.push({
        fileId,
        name,
        kind: "function" satisfies SymbolKind,
        isExported: fn.isExported(),
        line: fn.getStartLineNumber(),
      });
    }

    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (name === undefined) continue;
      out.push({
        fileId,
        name,
        kind: "class" satisfies SymbolKind,
        isExported: cls.isExported(),
        line: cls.getStartLineNumber(),
      });
    }

    for (const iface of sourceFile.getInterfaces()) {
      out.push({
        fileId,
        name: iface.getName(),
        kind: "interface" satisfies SymbolKind,
        isExported: iface.isExported(),
        line: iface.getStartLineNumber(),
      });
    }

    for (const alias of sourceFile.getTypeAliases()) {
      out.push({
        fileId,
        name: alias.getName(),
        kind: "type" satisfies SymbolKind,
        isExported: alias.isExported(),
        line: alias.getStartLineNumber(),
      });
    }

    for (const en of sourceFile.getEnums()) {
      out.push({
        fileId,
        name: en.getName(),
        kind: "enum" satisfies SymbolKind,
        isExported: en.isExported(),
        line: en.getStartLineNumber(),
      });
    }

    for (const decl of sourceFile.getVariableDeclarations()) {
      // Only true top-level statements: VariableDeclaration → VariableDeclarationList
      // → VariableStatement → SourceFile.
      const stmt = decl.getVariableStatement();
      if (stmt === undefined) continue;
      if (stmt.getParent() !== sourceFile) continue;

      out.push({
        fileId,
        name: decl.getName(),
        kind: "variable" satisfies SymbolKind,
        isExported: stmt.isExported(),
        line: decl.getStartLineNumber(),
      });
    }

    for (const ea of sourceFile.getExportAssignments()) {
      // `export = X` (CJS-style) and `export default X` both surface here.
      // We tag both as `default` so downstream consumers see a uniform shape.
      out.push({
        fileId,
        name: "default",
        kind: "default" satisfies SymbolKind,
        isExported: true,
        line: ea.getStartLineNumber(),
      });
    }

    return out;
  }
}

/**
 * Resolve a relative import specifier against `sourceDir` to one of the
 * already-discovered file IDs, trying ts/tsx/js/jsx + index variants in
 * order. Returns null if no match is found.
 */
function resolveSpecifier(
  spec: string,
  sourceDir: string,
  localPath: string,
  idByRelPath: Map<string, string>,
): string | null {
  const base = path.resolve(sourceDir, spec);

  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = base + suffix;
    const rel = path.relative(localPath, candidate).split(path.sep).join("/");
    // Skip resolution attempts that escape the snapshot root.
    if (rel.startsWith("../") || rel === "" || path.isAbsolute(rel)) continue;
    const id = idByRelPath.get(rel);
    if (id !== undefined) return id;
  }

  return null;
}

/**
 * Relative-import predicate. Matches `./x`, `../x`, `/abs/x`. Bare specs
 * like `react` or `@scope/pkg` return false — we don't track external edges
 * in Wave 2.
 */
function isRelativeSpec(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/");
}

/**
 * Map a file path to its FileLanguage tag based on extension.
 */
function languageOf(absPath: string): FileLanguage {
  const ext = path.extname(absPath).toLowerCase();
  return LANGUAGE_BY_EXT.get(ext) ?? "other";
}

/**
 * True if any segment of `rel` is in {@link EXCLUDED_DIRS}.
 */
function relIsExcluded(rel: string): boolean {
  if (rel === "" || rel === ".") return false;
  for (const segment of rel.split(path.sep)) {
    if (EXCLUDED_DIRS.has(segment)) return true;
  }
  return false;
}

// Made with Bob
