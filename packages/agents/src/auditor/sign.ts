import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import type {
  NewSigningKey,
  SigningKeyRepository,
  SigningKeyRow,
} from "@renatus/db";
import { AuditorError, AuditorSigningError } from "./errors.js";
import {
  decryptWithKek,
  encryptWithKek,
  type EncryptedPrivateKey,
} from "./kek.js";
import type { Signature } from "./types.js";

/**
 * Shared signing primitives extracted from `AuditorService`.
 *
 * Two responsibilities live here:
 *   1. {@link getOrCreateJobKeypair} — get-or-create the per-job ed25519
 *      keypair via the {@link SigningKeyRepository}. KEK-encrypted at rest
 *      when `RENATUS_KEK` is set; plaintext + a loud warning otherwise.
 *   2. {@link signCanonicalText} — given the canonical-JSON text of a payload
 *      and the keypair, produce the typed {@link Signature} envelope
 *      (algorithm / value / publicKey / messageHash / signedAt).
 *
 * The Q&A agent (Wave 4) signs transcripts using the same primitives the
 * Auditor uses for audit reports — re-using this helper keeps the verifier
 * code, the signature shape, and the KEK semantics in lockstep between the
 * two agents. Refactoring `AuditorService` to delegate here must preserve
 * its external behaviour exactly (Wave-3 verifier asserts the
 * canonicalJson + ed25519 roundtrip).
 */

/**
 * Get the existing ed25519 keypair for a job, or generate + persist a fresh
 * one. Idempotent: the second invocation for the same jobId reads the
 * persisted row and returns the same keypair bytes.
 *
 * The optional `agentLabel` is used solely in the plaintext-key warning so
 * operators see which subsystem emitted it (`Auditor` vs `Qa`).
 */
export async function getOrCreateJobKeypair(
  signingKeyRepo: SigningKeyRepository,
  jobId: string,
  agentLabel: "Auditor" | "Qa" = "Auditor",
): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const existing = await signingKeyRepo.getByJobId(jobId, "ed25519");
  if (existing) {
    const privateKey = loadPrivateKeyFromRow(existing);
    const publicKey = ed25519.getPublicKey(privateKey);
    return { privateKey, publicKey };
  }

  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const privateKeyHex = bytesToHex(privateKey);
  const publicKeyHex = bytesToHex(publicKey);

  const encrypted = encryptWithKek(privateKeyHex);
  const row: NewSigningKey = {
    jobId,
    algorithm: "ed25519",
    publicKeyHex,
    privateKeyHex: encrypted ? null : privateKeyHex,
    encryptedPrivateKey: encrypted,
  };

  if (!encrypted) {
    console.warn(
      `[${agentLabel}] RENATUS_KEK is not set. Persisting ed25519 private key ` +
        `as plaintext for jobId=${jobId}. DO NOT USE THIS IN PRODUCTION.`,
    );
  }

  await signingKeyRepo.create(row);
  return { privateKey, publicKey };
}

/**
 * Given the canonical-JSON byte sequence of a payload, hash with SHA-256 and
 * sign with ed25519. Returns the typed {@link Signature} envelope.
 *
 * `canonicalText` MUST be `canonicalJson(payload)` (or any deterministic byte
 * sequence) — verifiers re-canonicalize and re-hash before verifying, so the
 * caller's chosen canonicalization is the contract.
 *
 * Throws {@link AuditorSigningError} on any failure inside the noble curves
 * stack; callers wrap in their own domain-specific error type as needed.
 */
export function signCanonicalText(
  canonicalText: string,
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Signature {
  try {
    const messageHash = sha256(canonicalText);
    const messageHashHex = bytesToHex(messageHash);

    const signatureBytes = ed25519.sign(messageHash, privateKey);
    const signatureHex = bytesToHex(signatureBytes);

    return {
      algorithm: "ed25519",
      value: signatureHex,
      publicKey: bytesToHex(publicKey),
      messageHash: messageHashHex,
      signedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new AuditorSigningError(
      error instanceof Error ? error.message : "Unknown error",
      error,
    );
  }
}

/**
 * One-call sign-with-job-keypair convenience. Combines
 * {@link getOrCreateJobKeypair} + {@link signCanonicalText} for callers that
 * just want a signature over a canonical text bound to a job. The Q&A agent
 * uses this directly.
 */
export async function signWithJobKeypair(
  canonicalText: string,
  jobId: string,
  signingKeyRepo: SigningKeyRepository,
  agentLabel: "Auditor" | "Qa" = "Qa",
): Promise<Signature> {
  const { privateKey, publicKey } = await getOrCreateJobKeypair(
    signingKeyRepo,
    jobId,
    agentLabel,
  );
  return signCanonicalText(canonicalText, privateKey, publicKey);
}

/**
 * Decrypt-or-read the ed25519 private key from a persisted signing_keys row.
 * Mirrors the original AuditorService private helper byte-for-byte.
 */
function loadPrivateKeyFromRow(row: SigningKeyRow): Uint8Array {
  if (row.encryptedPrivateKey) {
    const decrypted = decryptWithKek(
      row.encryptedPrivateKey as EncryptedPrivateKey,
    );
    return hexToBytes(decrypted);
  }
  if (row.privateKeyHex) {
    return hexToBytes(row.privateKeyHex);
  }
  throw new AuditorError(
    `signing_keys row ${row.id} has neither privateKeyHex nor encryptedPrivateKey`,
  );
}
