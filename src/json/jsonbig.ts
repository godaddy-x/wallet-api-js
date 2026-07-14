import JSONbig from 'json-bigint';

/**
 * Shared json-bigint helpers for wallet-api-js.
 *
 * Never use native JSON.parse/stringify on OPS/MPC wire bodies or pending.tx
 * payloads that may contain snowflake int64 IDs (> 2^53).
 *
 * - jsonBig:   parse → large ints as decimal strings (safe in JS)
 * - jsonWire:  stringify BigInt as unquoted JSON numbers (Go easyjson int64)
 */
export const jsonBig = JSONbig({ storeAsString: true, strict: true });

export const jsonWire = JSONbig({ useNativeBigInt: true, strict: true });

export function jsonBigParse<T = unknown>(text: string): T {
  return jsonBig.parse(text) as T;
}

export function jsonBigStringify(value: unknown): string {
  return jsonBig.stringify(value);
}

export function jsonWireStringify(value: unknown): string {
  return jsonWire.stringify(value);
}
