/**
 * Deterministic JSON serialization for signature inputs.
 *
 * Standard `JSON.stringify` is implementation-defined for object key ordering.
 * The Auditor signs hashes of audit reports; if the same logical report
 * serializes to different bytes under different runtimes, verification fails.
 *
 * Rules:
 * 1. Object keys are sorted alphabetically (string compare on UTF-16 code units).
 * 2. No whitespace, no trailing newline.
 * 3. Arrays preserve insertion order (intentional — arrays are ordered).
 * 4. Numbers serialize with the JS default; NaN/Infinity throw (not valid JSON).
 * 5. undefined keys are omitted (matching JSON.stringify).
 * 6. Cycles throw with a clear error.
 *
 * Performance: not optimized — used for audit signing (rare path).
 */
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return encode(value, seen);
}

function encode(value: unknown, seen: WeakSet<object>): string {
  if (value === null) {
    return "null";
  }

  const type = typeof value;

  if (type === "string") {
    return JSON.stringify(value);
  }

  if (type === "boolean") {
    return value ? "true" : "false";
  }

  if (type === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new Error("NaN and Infinity are not valid JSON");
    }
    return JSON.stringify(n);
  }

  if (type === "bigint") {
    // BigInt is not a JSON primitive; JSON.stringify throws too. Surface it
    // explicitly so callers know exactly why.
    throw new TypeError("BigInt is not serializable to canonical JSON");
  }

  if (type === "undefined" || type === "function" || type === "symbol") {
    // At the top level these collapse to `undefined` — matching JSON.stringify
    // semantics. Inside objects/arrays we handle them before recursing.
    return "null";
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error("Cycle detected in canonical JSON serialization");
    }
    seen.add(value);
    const parts: string[] = [];
    for (const item of value) {
      // Per JSON.stringify, array slots that are undefined / functions /
      // symbols serialize as `null`.
      if (
        item === undefined ||
        typeof item === "function" ||
        typeof item === "symbol"
      ) {
        parts.push("null");
      } else {
        parts.push(encode(item, seen));
      }
    }
    seen.delete(value);
    return `[${parts.join(",")}]`;
  }

  if (type === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) {
      throw new Error("Cycle detected in canonical JSON serialization");
    }
    seen.add(obj);
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      // Skip undefined / function / symbol values — matches JSON.stringify.
      if (v === undefined || typeof v === "function" || typeof v === "symbol") {
        continue;
      }
      parts.push(`${JSON.stringify(key)}:${encode(v, seen)}`);
    }
    seen.delete(obj);
    return `{${parts.join(",")}}`;
  }

  // Unreachable — every typeof branch handled above.
  throw new TypeError(`Unsupported value in canonical JSON: ${String(value)}`);
}

// Example (do not run at import time):
//   canonicalJson({ b: 1, a: 2 }) === '{"a":2,"b":1}'
//   canonicalJson({ a: { y: 1, x: 2 } }) === '{"a":{"x":2,"y":1}}'
//   canonicalJson([1, 2, 3]) === '[1,2,3]'
//   canonicalJson({ a: undefined, b: 1 }) === '{"b":1}'

// Made with Bob
