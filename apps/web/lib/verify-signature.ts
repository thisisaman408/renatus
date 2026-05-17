import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { canonicalJson } from '@renatus/shared';
import { z } from 'zod';

/**
 * Pure-client signature verification.
 *
 * Mirrors `AuditorService.verifySignature` byte-for-byte. We re-implement it
 * here (rather than importing `AuditorService` from `@renatus/agents`) because
 * importing the agent entry point pulls in the orchestrator's workflows,
 * which transitively depend on `fs/promises` / `path` and can't tree-shake
 * out of the Next.js client bundle (`@renatus/agents` is a single tsup
 * bundle).
 *
 * The Zod schemas below MUST stay in sync with
 * `packages/agents/src/auditor/types.ts` — if the AuditReport shape changes
 * server-side, this verifier needs the same change or signature verification
 * will fail. The Wave-3 structural verifier (sec-g: signature roundtrip) is
 * the regression guard.
 */

// ────────────────────────────────────────────────────────────────────────────
// Schemas (mirror of packages/agents/src/auditor/types.ts — keep in sync)
// ────────────────────────────────────────────────────────────────────────────

export const AuditEventRecordSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  agentKind: z.string(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  // Allow both Date and ISO string at parse time, coerce to Date for the
  // canonicalJson call. canonicalJson serializes Date instances via the
  // default JSON.stringify behavior (which calls Date.prototype.toJSON →
  // ISO string), so coercion preserves the canonical byte sequence.
  timestamp: z.preprocess(
    (v) => (typeof v === 'string' ? new Date(v) : v),
    z.date(),
  ),
  entityId: z.string().uuid().nullable(),
  entityType: z.string().nullable(),
});

export const AuditReportSummarySchema = z.object({
  totalEvents: z.number().int().nonnegative(),
  byAgent: z.record(z.string(), z.number().int().nonnegative()),
  byEventType: z.record(z.string(), z.number().int().nonnegative()),
  patchesProposed: z.number().int().nonnegative(),
  patchesApplied: z.number().int().nonnegative(),
  patchesUnresolved: z.number().int().nonnegative(),
  testsGenerated: z.number().int().nonnegative(),
  testsPassed: z.number().int().nonnegative(),
  testsFailed: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
});

export const AuditReportSchema = z.object({
  jobId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  timestamp: z.string().datetime(),
  summary: AuditReportSummarySchema,
  events: z.array(AuditEventRecordSchema),
});

export const SignatureSchema = z.object({
  algorithm: z.literal('ed25519'),
  value: z.string().regex(/^[0-9a-f]+$/i),
  publicKey: z.string().regex(/^[0-9a-f]+$/i),
  messageHash: z.string().regex(/^[0-9a-f]+$/i),
  signedAt: z.string().datetime(),
  // The canonical-JSON bytes that were signed. Optional — present only for
  // post-W5 signatures (see `recordSignatureEvent` in packages/agents/src/
  // auditor/index.ts).
  canonicalReportBytes: z.string().optional(),
});

export type AuditReport = z.infer<typeof AuditReportSchema>;
export type Signature = z.infer<typeof SignatureSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Verifier
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verify an ed25519 signature over the canonical bytes of an audit report.
 *
 * Re-canonicalizes via `canonicalJson`, recomputes SHA-256, and then runs
 * ed25519.verify. The recomputed hash is checked against the
 * `signature.messageHash` field — so verifiers do NOT need to trust the
 * declared hash.
 *
 * Returns `false` on any error (malformed hex, mismatch, etc.).
 */
export function verifyAuditSignature(
  auditReport: AuditReport,
  signature: Signature,
): boolean {
  try {
    const canonical = canonicalJson(auditReport);
    const messageHash = sha256(canonical);
    const expectedHashHex = bytesToHex(messageHash);

    if (expectedHashHex !== signature.messageHash.toLowerCase()) {
      return false;
    }

    const signatureBytes = hexToBytes(signature.value);
    const publicKeyBytes = hexToBytes(signature.publicKey);

    return ed25519.verify(signatureBytes, messageHash, publicKeyBytes);
  } catch {
    return false;
  }
}

/**
 * Verify an ed25519 signature against the EXACT canonical bytes the Auditor
 * signed (returned by `/api/jobs/[jobId]/audit-report` on the new
 * `status: 'signed'` path).
 *
 * Sidesteps the `report.timestamp` drift bug entirely — we don't
 * re-canonicalize from a possibly-mismatched rebuilt report; we hash the
 * server-supplied bytes directly. The hash MUST match the signature's
 * declared `messageHash` AND the ed25519 verification MUST pass.
 *
 * Returns `{ ok, reason? }` rather than a plain boolean so the widget can
 * surface a specific failure mode (messageHash mismatch vs. ed25519
 * cryptographic failure vs. unexpected exception). The plain-boolean
 * `verifyAuditSignature` above is preserved for legacy/fallback callers.
 */
export function verifyAuditSignatureFromBytes(
  canonicalBytes: string,
  signature: { value: string; publicKey: string; messageHash: string },
): { ok: boolean; reason?: string } {
  try {
    const messageHashBytes = sha256(new TextEncoder().encode(canonicalBytes));
    const messageHashHex = bytesToHex(messageHashBytes);
    if (messageHashHex !== signature.messageHash.toLowerCase()) {
      return {
        ok: false,
        reason:
          'messageHash mismatch — report bytes do not match what was signed',
      };
    }
    const signatureBytes = hexToBytes(signature.value);
    const publicKeyBytes = hexToBytes(signature.publicKey);
    const ok = ed25519.verify(
      signatureBytes,
      messageHashBytes,
      publicKeyBytes,
    );
    return ok
      ? { ok: true }
      : { ok: false, reason: 'ed25519.verify returned false' };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
