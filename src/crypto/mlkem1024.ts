import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';

export const ENCAP_KEY_LEN = 1568;
export const CIPHERTEXT_LEN = 1568;
export const SHARED_SECRET_LEN = 32;
export const SHARED_INFO = 'freego-ecdh-aes-gcm';

export function encapsulateToPeer(serverEncapKeyB64: string): {
  sharedSecret: Buffer;
  kemCtB64: string;
} {
  const ekBytes = Buffer.from(serverEncapKeyB64, 'base64');
  if (ekBytes.length !== ENCAP_KEY_LEN) {
    throw new Error(
      `Invalid ML-KEM-1024 encapsulation key: expected ${ENCAP_KEY_LEN} bytes, got ${ekBytes.length}`,
    );
  }
  const { cipherText, sharedSecret } = ml_kem1024.encapsulate(new Uint8Array(ekBytes));
  if (cipherText.length !== CIPHERTEXT_LEN || sharedSecret.length !== SHARED_SECRET_LEN) {
    throw new Error('Invalid ML-KEM encapsulation output');
  }
  return {
    sharedSecret: Buffer.from(sharedSecret),
    kemCtB64: Buffer.from(cipherText).toString('base64'),
  };
}

export async function deriveNegotiatedKey(
  sharedSecret: Uint8Array,
  nocB64: string,
  info = SHARED_INFO,
  keyLength = 32,
): Promise<Uint8Array> {
  const saltBytes = nocB64 ? new Uint8Array(Buffer.from(nocB64, 'base64')) : new Uint8Array(0);
  const infoBytes = new TextEncoder().encode(info);
  const importedKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, [
    'deriveBits',
  ]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: infoBytes,
    },
    importedKey,
    keyLength * 8,
  );
  return new Uint8Array(derivedBits);
}
