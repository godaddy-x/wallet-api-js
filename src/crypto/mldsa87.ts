import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';

export const SIG_LEN = 4627;
export const PUB_LEN = 2592;
export const SEED_LEN = 32;

const keyPairCache = new Map<string, ReturnType<typeof ml_dsa87.keygen>>();

function normalizeSeed(raw: Buffer): Uint8Array {
  if (raw.length !== SEED_LEN) {
    throw new Error(
      `Invalid ML-DSA-87 private key length: expected ${SEED_LEN} bytes seed, got ${raw.length}`,
    );
  }
  return new Uint8Array(raw);
}

function getOrCreateKeyPair(base64PrivateKey: string) {
  const cacheKey = `private_${base64PrivateKey}`;
  const cached = keyPairCache.get(cacheKey);
  if (cached) return cached;
  const keys = ml_dsa87.keygen(normalizeSeed(Buffer.from(base64PrivateKey, 'base64')));
  keyPairCache.set(cacheKey, keys);
  return keys;
}

function getPublicKeyBytes(base64PublicKey: string): Uint8Array {
  const cacheKey = `public_${base64PublicKey}`;
  const cached = keyPairCache.get(cacheKey);
  if (cached) return cached.publicKey;
  const raw = Buffer.from(base64PublicKey, 'base64');
  if (raw.length !== PUB_LEN) {
    throw new Error(
      `Invalid ML-DSA-87 public key length: expected ${PUB_LEN} bytes, got ${raw.length}`,
    );
  }
  const pub = new Uint8Array(raw);
  keyPairCache.set(cacheKey, { publicKey: pub, secretKey: new Uint8Array(0) });
  return pub;
}

function messageBytes(message: string | Buffer | Uint8Array): Uint8Array {
  if (message instanceof Buffer || message instanceof Uint8Array) {
    return new Uint8Array(message);
  }
  return new TextEncoder().encode(message);
}

export async function signWithPrivateKey(
  message: string | Buffer | Uint8Array,
  privateKeyBase64: string,
): Promise<string> {
  const keys = getOrCreateKeyPair(privateKeyBase64);
  const msgBytes = messageBytes(message);
  if (msgBytes.length === 0) {
    throw new Error('message cannot be empty');
  }
  const sig = ml_dsa87.sign(msgBytes, keys.secretKey);
  return Buffer.from(sig).toString('base64');
}

export async function verifyWithPublicKey(
  message: string | Buffer | Uint8Array,
  signatureB64: string,
  publicKeyBase64: string,
): Promise<boolean> {
  const msgBytes = messageBytes(message);
  if (msgBytes.length === 0) {
    throw new Error('message cannot be empty');
  }
  const publicKey = getPublicKeyBytes(publicKeyBase64);
  const sigBytes = Buffer.from(signatureB64, 'base64');
  if (sigBytes.length !== SIG_LEN) {
    throw new Error(
      `Invalid ML-DSA-87 signature length: expected ${SIG_LEN} bytes, got ${sigBytes.length}`,
    );
  }
  return ml_dsa87.verify(new Uint8Array(sigBytes), msgBytes, publicKey);
}

export function clearKeyPairCache(): void {
  keyPairCache.clear();
}
