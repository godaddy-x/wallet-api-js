import { createHmac } from 'node:crypto';

import {
  aesGcmDecryptBase64,
  aesGcmEncryptBase64,
} from '../crypto/aes-gcm.js';
import {
  appendBodyMessage,
  digestBodyMessage,
  getMessageNonce,
  unixSecond,
} from '../crypto/canonical.js';
import { signWithPrivateKey, verifyWithPublicKey } from '../crypto/mldsa87.js';
import { jsonWireStringify } from '../json/jsonbig.js';
import type { JsonBody, JsonResp } from './envelope.js';
import {
  jsonBodyRequiresOuterSignature,
  planRequiresOuterSignature,
} from './envelope.js';

export type Plan2ClientNo = number | bigint;

function toCanonicalUsr(usr: Plan2ClientNo): string {
  return typeof usr === 'bigint' ? usr.toString() : String(usr);
}

/** HMAC-SHA256 over canonical body bytes (platform Plan2 wire format). */
export function plan2BodyHmac(
  router: string,
  data: string,
  nonce: string,
  time: number,
  plan: number,
  usr: Plan2ClientNo,
  sharedKey: Uint8Array,
): string {
  const msg = appendBodyMessage(router, data, nonce, time, plan, usr);
  return createHmac('sha256', sharedKey.length ? sharedKey : Buffer.alloc(0))
    .update(msg)
    .digest('base64');
}

/** ML-DSA-87 outer sign over SHA256(canonical body). */
export async function plan2OuterSign(
  router: string,
  data: string,
  nonce: string,
  time: number,
  plan: number,
  usr: Plan2ClientNo,
  clientPrivateKey: string,
): Promise<string> {
  const digest = digestBodyMessage(router, data, nonce, time, plan, usr);
  return signWithPrivateKey(digest, clientPrivateKey);
}

export async function buildPlan2JsonBody(params: {
  router: string;
  plan: number;
  usr: Plan2ClientNo;
  clientPrk: string;
  sharedKey: Uint8Array;
  plaintext: Buffer;
  plan2KeyBootstrap?: boolean;
}): Promise<JsonBody> {
  const jsonBody: JsonBody = {
    d: '',
    n: getMessageNonce(),
    s: '',
    r: params.router,
    t: unixSecond(),
    p: params.plan,
    u: params.usr,
  };

  jsonBody.d = await aesGcmEncryptBase64(
    params.plaintext,
    params.sharedKey.slice(0, 32),
    appendBodyMessage(jsonBody.r, '', jsonBody.n, jsonBody.t, jsonBody.p, jsonBody.u),
  );

  jsonBody.s = plan2BodyHmac(
    jsonBody.r,
    jsonBody.d,
    jsonBody.n,
    jsonBody.t,
    jsonBody.p,
    jsonBody.u,
    params.sharedKey,
  );

  if (jsonBodyRequiresOuterSignature(params.plan, params.plan2KeyBootstrap ?? false)) {
    jsonBody.e = await plan2OuterSign(
      jsonBody.r,
      jsonBody.d,
      jsonBody.n,
      jsonBody.t,
      jsonBody.p,
      jsonBody.u,
      params.clientPrk,
    );
  }

  return jsonBody;
}

export async function buildPlan2KeyRequestJsonBody(params: {
  router: string;
  usr: Plan2ClientNo;
  clientPrk: string;
  payload: unknown;
}): Promise<JsonBody> {
  const jsonBody: JsonBody = {
    d: Buffer.from(jsonWireStringify(params.payload)).toString('base64'),
    n: getMessageNonce(),
    s: '',
    r: params.router,
    t: unixSecond(),
    p: 0,
    u: params.usr,
  };
  jsonBody.s = plan2BodyHmac(
    jsonBody.r,
    jsonBody.d,
    jsonBody.n,
    jsonBody.t,
    jsonBody.p,
    jsonBody.u,
    new Uint8Array(0),
  );
  jsonBody.e = await plan2OuterSign(
    jsonBody.r,
    jsonBody.d,
    jsonBody.n,
    jsonBody.t,
    jsonBody.p,
    jsonBody.u,
    params.clientPrk,
  );
  return jsonBody;
}

export async function buildPlan2EncryptedJsonBody(params: {
  router: string;
  usr: Plan2ClientNo;
  clientPrk: string;
  sharedKey: Uint8Array;
  requestObj: unknown;
}): Promise<JsonBody> {
  const plaintext = Buffer.from(jsonWireStringify(params.requestObj));
  return buildPlan2JsonBody({
    router: params.router,
    plan: 2,
    usr: params.usr,
    clientPrk: params.clientPrk,
    sharedKey: params.sharedKey,
    plaintext,
  });
}

export function verifyPlan2ResponseTime(time: number): void {
  if (time <= 0 || Math.abs(unixSecond() - time) > 300) {
    throw new Error('response time invalid');
  }
}

export function verifyPlan2ResponseHmac(
  router: string,
  resp: JsonResp,
  usr: Plan2ClientNo,
  sharedKey: Uint8Array,
): void {
  const expected = plan2BodyHmac(router, resp.d, resp.n, resp.t, resp.p, usr, sharedKey);
  const actual = Buffer.from(resp.s, 'base64');
  const expBuf = Buffer.from(expected, 'base64');
  if (actual.length !== expBuf.length || !actual.equals(expBuf)) {
    throw new Error('plan2 response signature verification failed');
  }
}

export async function verifyPlan2ResponseOuterSign(
  router: string,
  resp: JsonResp,
  usr: Plan2ClientNo,
  serverPublicKey: string,
): Promise<void> {
  if (!planRequiresOuterSignature(resp.p)) {
    return;
  }
  if (!resp.e) {
    throw new Error('response outer signature missing');
  }
  const digest = digestBodyMessage(router, resp.d, resp.n, resp.t, resp.p, usr);
  const ok = await verifyWithPublicKey(digest, resp.e, serverPublicKey);
  if (!ok) {
    throw new Error('response ML-DSA sign verify invalid');
  }
}

export async function decryptPlan2Response(
  router: string,
  resp: JsonResp,
  usr: Plan2ClientNo,
  sharedKey: Uint8Array,
): Promise<Buffer> {
  if (resp.p === 2 || resp.p === 1) {
    return aesGcmDecryptBase64(
      resp.d,
      sharedKey.slice(0, 32),
      appendBodyMessage(router, '', resp.n, resp.t, resp.p, usr),
    );
  }
  return Buffer.from(resp.d, 'base64');
}

export function stringifyPublicKeyPayload(payload: unknown): string {
  return jsonWireStringify(payload);
}

export { toCanonicalUsr };
