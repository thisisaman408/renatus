import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * KEK-derived encryption for ed25519 private keys at rest.
 *
 * Threat model: the database may be observed by an attacker who does not
 * have the application's environment. With `RENATUS_KEK` unset, private
 * keys land in the DB as plaintext (development only; the Auditor emits
 * a loud warning). With `RENATUS_KEK` set, private keys are AES-256-GCM
 * encrypted under a scrypt-derived 256-bit data key; only the ciphertext,
 * IV, and auth tag live in the DB.
 *
 * Rotation: the `kekId` field tags the KEK generation. Rotating the env
 * var means new keys land under the next generation while old ciphertexts
 * remain decryptable as long as the old KEK is available. (We ship only
 * `env-kek-v1` today; multi-KEK is a Wave 4 concern.)
 */
const ALGORITHM = "aes-256-gcm";
const KEK_ID = "env-kek-v1" as const;
const SCRYPT_SALT = "renatus-kek-v1"; // intentional constant; KEK rotates by env var change
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

export interface EncryptedPrivateKey {
  ciphertext: string;
  iv: string;
  authTag: string;
  alg: "aes-256-gcm";
  kekId: "env-kek-v1";
}

/**
 * Derive the AES-256-GCM key from `process.env.RENATUS_KEK` via scrypt.
 * Throws if KEK is unset or empty.
 */
export function deriveKekKey(): Buffer {
  const kek = process.env.RENATUS_KEK;
  if (!kek || kek.length === 0) {
    throw new Error("RENATUS_KEK environment variable is not set");
  }
  return scryptSync(kek, SCRYPT_SALT, KEY_LENGTH);
}

/**
 * Encrypt a hex-encoded ed25519 private key with the KEK-derived AES key.
 * Returns `null` if `RENATUS_KEK` is unset — caller is expected to fall
 * back to plaintext storage and emit a warning.
 */
export function encryptWithKek(
  privateKeyHex: string,
): EncryptedPrivateKey | null {
  if (!process.env.RENATUS_KEK || process.env.RENATUS_KEK.length === 0) {
    return null;
  }

  const key = deriveKekKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(privateKeyHex, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    alg: ALGORITHM,
    kekId: KEK_ID,
  };
}

/**
 * Decrypt an encrypted ed25519 private key. Throws if `RENATUS_KEK` is
 * unset or if the GCM auth tag does not validate.
 */
export function decryptWithKek(payload: EncryptedPrivateKey): string {
  const key = deriveKekKey();
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const ciphertext = Buffer.from(payload.ciphertext, "hex");

  const decipher = createDecipheriv(payload.alg, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
