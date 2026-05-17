import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import {
  breakingChangeMaps,
  type BreakingChangeMapRow,
  type NewBreakingChangeMap,
} from "../schema/breaking-change-maps.js";
import {
  breakingChanges,
  type BreakingChangeRow,
  type NewBreakingChange,
} from "../schema/breaking-changes.js";
import type { AgentKind, Rule, RuleSeverity } from "@renatus/shared";

export type BreakingChangeMapSourceKind =
  | "pack"
  | "changelog"
  | "diff"
  | "guide-url"
  | "refactor-intent"
  | "cve-advisory";

export interface SaveBreakingChangeMapInput {
  cacheKey: string;
  agentKind: AgentKind;
  sourceKind: BreakingChangeMapSourceKind;
  ecosystem?: string;
  fromVersion?: string;
  toVersion?: string;
  rules: Rule[];
}

/**
 * Persistence for the Cartographer output cache:
 *   `breaking_change_maps` (1) ──< `breaking_changes` (N)
 *
 * `findByCacheKey` is the cache-hit path. `save` writes the map + all child
 * rules in a single neon-http transaction so partial writes can't leak.
 */
export class BreakingChangeMapRepository {
  private db;
  private pool;

  constructor(databaseUrl: string) {
    // neon-serverless (Pool) is required here because neon-http throws on
    // db.transaction(); save() needs an atomic map + child-rules insert.
    this.pool = new Pool({ connectionString: databaseUrl });
    this.db = drizzle(this.pool);
  }

  async findByCacheKey(
    cacheKey: string,
  ): Promise<{ map: BreakingChangeMapRow; rules: BreakingChangeRow[] } | null> {
    const [map] = await this.db
      .select()
      .from(breakingChangeMaps)
      .where(eq(breakingChangeMaps.cacheKey, cacheKey))
      .limit(1);

    if (!map) {
      return null;
    }

    const rules = await this.db
      .select()
      .from(breakingChanges)
      .where(eq(breakingChanges.mapId, map.id));

    return { map, rules };
  }

  async save(
    input: SaveBreakingChangeMapInput,
  ): Promise<BreakingChangeMapRow> {
    return await this.db.transaction(async (tx) => {
      const newMap: NewBreakingChangeMap = {
        cacheKey: input.cacheKey,
        agentKind: input.agentKind,
        sourceKind: input.sourceKind,
        ecosystem: input.ecosystem ?? null,
        fromVersion: input.fromVersion ?? null,
        toVersion: input.toVersion ?? null,
        ruleCount: input.rules.length,
      };

      const [insertedMap] = await tx
        .insert(breakingChangeMaps)
        .values(newMap)
        .returning();

      if (!insertedMap) {
        throw new Error("Failed to insert breaking_change_map");
      }

      if (input.rules.length > 0) {
        const childRows: NewBreakingChange[] = input.rules.map((rule) => ({
          mapId: insertedMap.id,
          ruleId: rule.id,
          kind: rule.kind,
          severity: rule.severity as RuleSeverity,
          category: rule.category,
          title: rule.title,
          rationale: rule.rationale,
          payload: rule,
        }));

        await tx.insert(breakingChanges).values(childRows);
      }

      return insertedMap;
    });
  }
}

// Made with Bob
