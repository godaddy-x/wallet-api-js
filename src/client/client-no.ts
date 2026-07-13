export type ClientNoInput = number | string | bigint;

export function parseClientNo(value: ClientNoInput): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`clientNo ${value} exceeds JS safe integer; use string in config`);
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`invalid clientNo: ${value}`);
  }
  return BigInt(trimmed);
}

export function clientNoToCanonical(value: ClientNoInput): string {
  return parseClientNo(value).toString();
}
