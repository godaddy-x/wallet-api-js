import { createHmac } from 'node:crypto';

import type { AuthToken } from '../protocol/envelope.js';
import { SocketSDK } from '../transport/socket-sdk.js';
import type { SdkConfig } from './config.js';
import { getRandomSecure, unixSecond } from '../crypto/canonical.js';
import type { AppLoginReq, CliPlan2LoginReq } from '../types/login.js';

let cliSignLock: Promise<void> = Promise.resolve();

export async function withCliSignLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = cliSignLock;
  let release!: () => void;
  cliSignLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function createAppLoginRequest(cfg: SdkConfig): AppLoginReq {
  const nonce = Buffer.from(getRandomSecure(32)).toString('base64');
  const time = unixSecond();
  const source = 'API';
  const appKey = Buffer.from(cfg.appKey ?? '', 'hex');
  if (appKey.length === 0) {
    throw new Error('invalid appKey hex');
  }
  // Server verifier: HMAC data=appKey, key=nonce+time+source.
  const sign = createHmac('sha256', `${nonce}${time}${source}`)
    .update(appKey)
    .digest('base64');
  return {
    appID: cfg.appID ?? '',
    nonce,
    time,
    source,
    sign,
  };
}

function loginRequestForConfig(cfg: SdkConfig): AppLoginReq | CliPlan2LoginReq {
  if (cfg.appID?.trim() && cfg.appKey?.trim()) {
    return createAppLoginRequest(cfg);
  }
  return { source: cfg.source?.trim() || 'API' };
}

async function loginSocket(cfg: SdkConfig): Promise<AuthToken> {
  return withCliSignLock(async () => {
    const sdk = new SocketSDK({
      domain: cfg.domain,
      clientNo: cfg.clientNo,
      clientPrk: cfg.clientPrk,
      serverPub: cfg.serverPub,
      ssl: cfg.ssl,
    });
    try {
      const req = loginRequestForConfig(cfg);
      return await sdk.loginByWebSocketPlan2Auto(
        cfg.keyPath ?? '/api/PublicKey',
        cfg.loginPath ?? '/api/Login',
        req,
        10,
      );
    } finally {
      sdk.disconnectWebSocket();
    }
  });
}

export async function newLongLivedSocket(cfg: SdkConfig): Promise<SocketSDK> {
  const sdk = new SocketSDK({
    domain: cfg.domain,
    clientNo: cfg.clientNo,
    clientPrk: cfg.clientPrk,
    serverPub: cfg.serverPub,
    ssl: cfg.ssl,
  });

  const token = await loginSocket(cfg);
  sdk.authToken(token);
  sdk.enableReconnect();
  sdk.setTokenExpiredCallback(async () => loginSocket(cfg));
  await sdk.connectWebSocket();
  return sdk;
}

export async function signTransaction<TReq, TRes>(
  sdk: SocketSDK,
  req: TReq,
  wsTimeoutSec: number,
): Promise<TRes> {
  return withCliSignLock(async () => {
    const res = await sdk.sendWebSocketMessage<TReq, TRes>(
      '/api/SignTransaction',
      req,
      true,
      true,
      wsTimeoutSec,
    );
    if (res === null) {
      throw new Error('SignTransaction: empty response');
    }
    return res;
  });
}
