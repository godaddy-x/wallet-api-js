export async function aesGcmEncryptBase(
  plaintext: Uint8Array,
  key: Uint8Array,
  additionalData: Uint8Array,
): Promise<Buffer> {
  if (key.length !== 32) {
    throw new Error('key must be 32 bytes for AES-256');
  }
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData },
    cryptoKey,
    plaintext,
  );
  return Buffer.concat([Buffer.from(nonce), Buffer.from(encrypted)]);
}

export async function aesGcmDecryptBase(
  encryptedData: Uint8Array,
  key: Uint8Array,
  additionalData: Uint8Array,
): Promise<Buffer> {
  if (key.length !== 32) {
    throw new Error('key must be 32 bytes for AES-256');
  }
  if (encryptedData.length < 28) {
    throw new Error('encrypted data too short');
  }
  const nonce = encryptedData.slice(0, 12);
  const ciphertextWithTag = encryptedData.slice(12);
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData },
      cryptoKey,
      ciphertextWithTag,
    );
    return Buffer.from(decrypted);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AES-GCM decryption failed: ${message}`);
  }
}

export async function aesGcmEncryptBase64(
  plaintext: Uint8Array,
  key: Uint8Array,
  additionalData: Uint8Array,
): Promise<string> {
  const encrypted = await aesGcmEncryptBase(plaintext, key, additionalData);
  return encrypted.toString('base64');
}

export async function aesGcmDecryptBase64(
  encryptedB64: string,
  key: Uint8Array,
  additionalData: Uint8Array,
): Promise<Buffer> {
  return aesGcmDecryptBase(Buffer.from(encryptedB64, 'base64'), key, additionalData);
}
