import { createHmac, timingSafeEqual } from 'node:crypto';

import CryptoJS from 'crypto-js';

const SEP = '|';

export function appendBodyMessage(
  path: string,
  data: string,
  nonce: string,
  time: number,
  plan: number,
  usr: number | bigint,
): Buffer {
  return Buffer.from(`${path}${SEP}${data}${SEP}${nonce}${SEP}${time}${SEP}${plan}${SEP}${usr}`);
}

export function digestBodyMessage(
  path: string,
  data: string,
  nonce: string,
  time: number,
  plan: number,
  usr: number | bigint,
): Buffer {
  return sha256(appendBodyMessage(path, data, nonce, time, plan, usr));
}

export function signBodyMessage(
  path: string,
  data: string,
  nonce: string,
  time: number,
  plan: number,
  usr: number | bigint,
  key: Uint8Array,
): Buffer {
  return hmacSha256(appendBodyMessage(path, data, nonce, time, plan, usr), key);
}

export function signAndDigestBodyMessage(
  path: string,
  data: string,
  nonce: string,
  time: number,
  plan: number,
  usr: number | bigint,
  key: Uint8Array,
): { hmac: Buffer; digest: Buffer } {
  const msg = appendBodyMessage(path, data, nonce, time, plan, usr);
  return { hmac: hmacSha256(msg, key), digest: sha256(msg) };
}

export function compareBase64Sign(expected: Buffer, actualB64: string): boolean {
  const actual = Buffer.from(actualB64, 'base64');
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

export function unixSecond(): number {
  return Math.floor(Date.now() / 1000);
}

export function getRandomSecure(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

export function getMessageNonce(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

export function sha256(data: Buffer | Uint8Array): Buffer {
  const words = CryptoJS.lib.WordArray.create(
    data instanceof Buffer ? new Uint8Array(data) : data,
  );
  const hash = CryptoJS.SHA256(words);
  return wordArrayToBuffer(hash);
}

function hmacSha256(data: Buffer | Uint8Array, key: Uint8Array): Buffer {
  const dataWords = CryptoJS.lib.WordArray.create(
    data instanceof Buffer ? new Uint8Array(data) : data,
  );
  const keyWords = CryptoJS.lib.WordArray.create(key);
  return wordArrayToBuffer(CryptoJS.HmacSHA256(dataWords, keyWords));
}

function wordArrayToBuffer(wordArray: CryptoJS.lib.WordArray): Buffer {
  const buffer = Buffer.alloc(wordArray.sigBytes);
  const BYTE_MASK = 0xff;
  for (let i = 0; i < wordArray.words.length; i += 1) {
    const word = wordArray.words[i] ?? 0;
    const offset = i * 4;
    if (offset >= buffer.length) break;
    buffer[offset] = (word >>> 24) & BYTE_MASK;
    if (offset + 1 < buffer.length) buffer[offset + 1] = (word >>> 16) & BYTE_MASK;
    if (offset + 2 < buffer.length) buffer[offset + 2] = (word >>> 8) & BYTE_MASK;
    if (offset + 3 < buffer.length) buffer[offset + 3] = word & BYTE_MASK;
  }
  return buffer;
}

/** @deprecated use timingSafeEqual via compareBase64Sign */
export function hmacSha256Base64(data: Buffer, key: Uint8Array): string {
  return hmacSha256(data, key).toString('base64');
}

export { SEP };
