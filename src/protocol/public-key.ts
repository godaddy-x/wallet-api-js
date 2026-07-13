import {
  compareBase64Sign,
  digestBodyMessage,
  getRandomSecure,
  SEP,
  signAndDigestBodyMessage,
  signBodyMessage,
  unixSecond,
} from '../crypto/canonical.js';
import { signWithPrivateKey, verifyWithPublicKey } from '../crypto/mldsa87.js';
import type { PublicKeyPayload } from './envelope.js';

const FIVE_MINUTES = 300;

export async function createPublicKeyPayload(
  key: string,
  tag: string,
  usr: number | bigint,
  clientPrivateKey: string,
): Promise<PublicKeyPayload> {
  const exp = unixSecond();
  const noc = Buffer.from(getRandomSecure(32)).toString('base64');
  const signData = `${key}${SEP}${tag}${SEP}${noc}${SEP}${exp}${SEP}${usr}`;
  const sig = await signWithPrivateKey(signData, clientPrivateKey);
  return { key, tag, noc, exp, usr, sig };
}

export async function checkPublicKey(
  payload: PublicKeyPayload,
  serverPublicKey: string,
): Promise<void> {
  if (!payload.key || payload.key.length < 32) {
    throw new Error('request key invalid');
  }
  if (!payload.tag || payload.tag.length < 32) {
    throw new Error('request tag invalid');
  }
  if (!payload.sig || payload.sig.length < 600) {
    throw new Error('request sig invalid');
  }
  if (!payload.noc || payload.noc.length < 32) {
    throw new Error('request noc invalid');
  }
  if (BigInt(payload.usr) < 0n) {
    throw new Error('request usr invalid');
  }
  if (Math.abs(unixSecond() - payload.exp) > FIVE_MINUTES) {
    throw new Error('request exp invalid');
  }
  const signData = `${payload.key}${SEP}${payload.tag}${SEP}${payload.noc}${SEP}${payload.exp}${SEP}${payload.usr}`;
  const ok = await verifyWithPublicKey(signData, payload.sig, serverPublicKey);
  if (!ok) {
    throw new Error('request signature invalid');
  }
}

export async function signJsonBodyOuter(
  router: string,
  data: string,
  nonce: string,
  time: number,
  plan: number,
  usr: number | bigint,
  clientPrivateKey: string,
): Promise<string> {
  const digest = digestBodyMessage(router, data, nonce, time, plan, usr);
  return signWithPrivateKey(digest, clientPrivateKey);
}

export function signJsonBodyHmac(
  router: string,
  data: string,
  nonce: string,
  time: number,
  plan: number,
  usr: number | bigint,
  key: Uint8Array,
): string {
  return signBodyMessage(router, data, nonce, time, plan, usr, key).toString('base64');
}

export function verifyJsonBodyHmac(
  router: string,
  data: string,
  nonce: string,
  time: number,
  plan: number,
  usr: number | bigint,
  key: Uint8Array,
  signB64: string,
): boolean {
  const expected = signBodyMessage(router, data, nonce, time, plan, usr, key);
  return compareBase64Sign(expected, signB64);
}

export function verifyResponseTime(time: number): void {
  if (time <= 0 || Math.abs(unixSecond() - time) > FIVE_MINUTES) {
    throw new Error('response time invalid');
  }
}

export { signAndDigestBodyMessage };
