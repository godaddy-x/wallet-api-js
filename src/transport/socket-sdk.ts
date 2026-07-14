import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import WebSocket from 'ws';

import { parseClientNo } from '../client/client-no.js';

import {
  aesGcmDecryptBase64,
  aesGcmEncryptBase64,
} from '../crypto/aes-gcm.js';
import {
  appendBodyMessage,
  compareBase64Sign,
  getMessageNonce,
  getRandomSecure,
  signBodyMessage,
  unixSecond,
} from '../crypto/canonical.js';
import { deriveNegotiatedKey, encapsulateToPeer } from '../crypto/mlkem1024.js';
import {
  jsonBigParse,
  jsonBigStringify,
  jsonWireStringify,
} from '../json/jsonbig.js';
import type { AuthToken, JsonBody, JsonResp } from '../protocol/envelope.js';
import { planRequiresOuterSignature } from '../protocol/envelope.js';
import {
  buildPlan2EncryptedJsonBody,
  buildPlan2KeyRequestJsonBody,
  decryptPlan2Response,
  stringifyPublicKeyPayload,
  verifyPlan2ResponseHmac,
  verifyPlan2ResponseOuterSign,
  verifyPlan2ResponseTime,
} from '../protocol/plan2.js';
import {
  createPublicKeyPayload,
  checkPublicKey,
  verifyResponseTime,
} from '../protocol/public-key.js';

export interface SocketSdkOptions {
  domain: string;
  clientNo: number | string | bigint;
  clientPrk: string;
  serverPub: string;
  ssl?: boolean;
  wsPath?: string;
  language?: string;
  healthPingSec?: number;
}

type PendingResponse = {
  resolve: (resp: JsonResp) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class SocketSDK extends EventEmitter {
  readonly domain: string;
  readonly clientNo: bigint;
  readonly clientPrk: string;
  readonly serverPub: string;
  readonly ssl: boolean;
  readonly language: string;
  readonly healthPingSec: number;

  private wsPath: string;
  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private auth: AuthToken | null = null;
  private rawAuthHeader = '';
  private reconnectEnabled = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private tokenMonitorTimer: NodeJS.Timeout | null = null;
  private tokenRefreshCallback: (() => Promise<AuthToken | null>) | null = null;
  private readonly pending = new Map<string, PendingResponse>();
  private closed = false;

  constructor(options: SocketSdkOptions) {
    super();
    this.domain = options.domain;
    this.clientNo = parseClientNo(options.clientNo);
    this.clientPrk = options.clientPrk;
    this.serverPub = options.serverPub;
    this.ssl = options.ssl ?? false;
    this.wsPath = options.wsPath ?? '/ws';
    this.language = options.language ?? 'en-US';
    this.healthPingSec = options.healthPingSec ?? 10;
  }

  authToken(token: AuthToken): void {
    this.auth = token;
    this.rawAuthHeader = '';
  }

  getAuth(): AuthToken | null {
    return this.auth;
  }

  validToken(): boolean {
    if (!this.auth?.token || !this.auth.secret) return false;
    return unixSecond() < Number(this.auth.expired);
  }

  isWebSocketConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  enableReconnect(): void {
    this.reconnectEnabled = true;
  }

  setTokenExpiredCallback(callback: () => Promise<AuthToken | null>): void {
    this.tokenRefreshCallback = callback;
  }

  setWebSocketPath(path: string): void {
    this.wsPath = path.startsWith('/') ? path : `/${path}`;
  }

  private uri(path: string): string {
    const scheme = this.ssl ? 'wss' : 'ws';
    return `${scheme}://${this.domain}${path}`;
  }

  private tokenSecretBytes(): Buffer {
    if (!this.auth?.secret) {
      throw new Error('token secret missing');
    }
    const secret = Buffer.from(this.auth.secret, 'base64');
    if (secret.length === 0) {
      throw new Error('token secret invalid');
    }
    return secret;
  }

  async connectWebSocketWithRawAuth(path: string, authHeader: string): Promise<void> {
    if (!authHeader) {
      throw new Error('authorization header is empty');
    }
    this.rawAuthHeader = authHeader;
    this.setWebSocketPath(path);
    await this.connectWebSocket();
  }

  async connectWebSocket(): Promise<void> {
    if (this.connecting) {
      throw new Error('connection already in progress');
    }
    if (this.isWebSocketConnected()) {
      return;
    }
    if (!this.validToken() && !this.rawAuthHeader) {
      if (this.tokenRefreshCallback) {
        const refreshed = await this.tokenRefreshCallback();
        if (refreshed) {
          this.authToken(refreshed);
        }
      }
    }
    if (!this.validToken() && !this.rawAuthHeader) {
      throw new Error('token empty or token expired, and raw authorization is empty');
    }

    this.connecting = true;
    try {
      await this.openSocket();
      if (this.validToken()) {
        await this.sendAuthHandshake();
      }
      this.connected = true;
      this.startHeartbeat();
      this.startTokenMonitor();
    } catch (error) {
      this.connected = false;
      if (this.reconnectEnabled) {
        this.scheduleReconnect();
        return;
      }
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  disconnectWebSocket(): void {
    this.closed = true;
    this.connected = false;
    this.stopHeartbeat();
    this.stopTokenMonitor();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('WebSocket disconnected'));
    }
    this.pending.clear();
  }

  private async openSocket(): Promise<void> {
    const authHeader = this.validToken() ? this.auth!.token : this.rawAuthHeader;
    const url = this.uri(this.wsPath);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: {
          Authorization: authHeader,
          Language: this.language,
        },
      });
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onOpen = () => {
        cleanup();
        this.ws = ws;
        ws.on('message', (data) => this.handleMessage(data));
        ws.on('close', () => this.handleClose());
        ws.on('error', (err) => this.emit('error', err));
        resolve();
      };
      const cleanup = () => {
        ws.off('open', onOpen);
        ws.off('error', onError);
      };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });
  }

  private handleClose(): void {
    this.connected = false;
    this.ws = null;
    this.stopHeartbeat();
    if (this.reconnectEnabled && !this.closed) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWebSocket().catch(() => this.scheduleReconnect());
    }, 3000);
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let resp: JsonResp;
    try {
      resp = jsonBigParse<JsonResp>(raw.toString());
    } catch {
      return;
    }
    if (!resp?.n) return;

    const authKey = `auth_${resp.n}`;
    const pending =
      this.pending.get(resp.n) ??
      this.pending.get(authKey) ??
      (resp.r ? this.pending.get(resp.r) : undefined);

    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(resp.n);
      this.pending.delete(authKey);
      if (resp.r) this.pending.delete(resp.r);
      pending.resolve(resp);
    }
  }

  private waitForResponse(nonce: string, timeoutSec: number): Promise<JsonResp> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(
          new Error(
            `wait response timeout (nonce=${nonce}, timeout=${timeoutSec}s)`,
          ),
        );
      }, Math.max(1, timeoutSec) * 1000);
      this.pending.set(nonce, { resolve, reject, timer });
    });
  }

  private async writeBody(body: JsonBody, waitResponse: boolean, timeoutSec: number): Promise<JsonResp | null> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const payload = jsonWireStringify(body);
    if (waitResponse) {
      const promise = this.waitForResponse(body.n, timeoutSec);
      this.ws.send(payload);
      return promise;
    }
    this.ws.send(payload);
    return null;
  }

  async sendWebSocketRawBody(body: JsonBody, waitResponse: boolean, timeoutSec: number): Promise<JsonResp | null> {
    return this.writeBody(body, waitResponse, timeoutSec);
  }

  private async buildPlan2BootstrapAuthorization(): Promise<string> {
    const pub = await createPublicKeyPayload(
      Buffer.from(getRandomSecure(32)).toString('base64'),
      Buffer.from(getRandomSecure(32)).toString('base64'),
      this.clientNo,
      this.clientPrk,
    );
    return Buffer.from(stringifyPublicKeyPayload(pub)).toString('base64');
  }

  async getWebSocketPlan2Auth(keyRouter: string, timeoutSec: number): Promise<{ authHeader: string; sharedKey: Uint8Array }> {
    const reqPublic = await createPublicKeyPayload(
      Buffer.from(getRandomSecure(32)).toString('base64'),
      Buffer.from(getRandomSecure(32)).toString('base64'),
      this.clientNo,
      this.clientPrk,
    );
    const jsonBody = await buildPlan2KeyRequestJsonBody({
      router: keyRouter,
      usr: this.clientNo,
      clientPrk: this.clientPrk,
      payload: reqPublic,
    });

    const resp = await this.sendWebSocketRawBody(jsonBody, true, timeoutSec);
    if (!resp) throw new Error('plan2 key response is nil');
    if (resp.c !== 200) throw new Error(resp.m ?? 'plan2 key failed');
    verifyPlan2ResponseTime(resp.t);
    verifyPlan2ResponseHmac(keyRouter, resp, this.clientNo, new Uint8Array(0));
    await verifyPlan2ResponseOuterSign(keyRouter, resp, this.clientNo, this.serverPub);

    const serverPub = jsonBigParse(Buffer.from(resp.d, 'base64').toString('utf8')) as Awaited<
      ReturnType<typeof createPublicKeyPayload>
    >;
    await checkPublicKey(serverPub, this.serverPub);
    const { sharedSecret, kemCtB64 } = encapsulateToPeer(serverPub.key);
    const sharedKey = await deriveNegotiatedKey(sharedSecret, serverPub.noc);
    const authPub = await createPublicKeyPayload(serverPub.key, kemCtB64, this.clientNo, this.clientPrk);
    return {
      authHeader: Buffer.from(stringifyPublicKeyPayload(authPub)).toString('base64'),
      sharedKey,
    };
  }

  async sendWebSocketPlan2Message<TReq, TRes>(
    router: string,
    requestObj: TReq,
    sharedKey: Uint8Array,
    timeoutSec: number,
  ): Promise<TRes> {
    const jsonBody = await buildPlan2EncryptedJsonBody({
      router,
      usr: this.clientNo,
      clientPrk: this.clientPrk,
      sharedKey,
      requestObj,
    });

    const resp = await this.sendWebSocketRawBody(jsonBody, true, timeoutSec);
    if (!resp) throw new Error('plan2 response is nil');
    if (resp.c !== 200) throw new Error(resp.m ?? 'plan2 request failed');
    verifyPlan2ResponseTime(resp.t);
    verifyPlan2ResponseHmac(router, resp, this.clientNo, sharedKey);
    await verifyPlan2ResponseOuterSign(router, resp, this.clientNo, this.serverPub);

    const decrypted = await decryptPlan2Response(router, resp, this.clientNo, sharedKey);
    if (decrypted.length === 0) {
      throw new Error('response data is empty');
    }
    return jsonBigParse<TRes>(decrypted.toString('utf8'));
  }

  async loginByWebSocketPlan2Auto<TLoginReq>(
    keyRouter: string,
    loginRouter: string,
    requestObj: TLoginReq,
    timeoutSec: number,
  ): Promise<AuthToken> {
    const bootstrapAuth = await this.buildPlan2BootstrapAuthorization();
    this.disconnectWebSocket();
    this.closed = false;
    await this.connectWebSocketWithRawAuth(this.wsPath, bootstrapAuth);

    const { authHeader, sharedKey } = await this.getWebSocketPlan2Auth(keyRouter, timeoutSec);
    this.disconnectWebSocket();
    this.closed = false;
    await this.connectWebSocketWithRawAuth(this.wsPath, authHeader);

    const token = await this.sendWebSocketPlan2Message<TLoginReq, AuthToken>(
      loginRouter,
      requestObj,
      sharedKey,
      timeoutSec,
    );
    this.authToken(token);
    this.rawAuthHeader = '';
    return token;
  }

  async sendWebSocketMessage<TReq, TRes>(
    router: string,
    requestObj: TReq,
    waitResponse: boolean,
    encryptRequest: boolean,
    timeoutSec: number,
  ): Promise<TRes | null> {
    const jsonBody: JsonBody = {
      d: '',
      n: getMessageNonce(),
      s: '',
      r: router,
      t: unixSecond(),
      p: encryptRequest ? 1 : 0,
      u: this.clientNo,
    };
    const jsonData = Buffer.from(jsonWireStringify(requestObj));
    const secret = this.tokenSecretBytes();
    if (jsonBody.p === 1) {
      jsonBody.d = await aesGcmEncryptBase64(
        jsonData,
        secret.subarray(0, 32),
        appendBodyMessage(jsonBody.r, '', jsonBody.n, jsonBody.t, jsonBody.p, jsonBody.u),
      );
    } else {
      jsonBody.d = jsonData.toString('base64');
    }
    jsonBody.s = signBodyMessage(
      jsonBody.r,
      jsonBody.d,
      jsonBody.n,
      jsonBody.t,
      jsonBody.p,
      jsonBody.u,
      secret,
    ).toString('base64');

    const resp = await this.sendWebSocketRawBody(jsonBody, waitResponse, timeoutSec);
    if (!waitResponse) return null;
    if (!resp) throw new Error('response is nil');
    return this.verifyWebSocketResponse(router, resp) as TRes;
  }

  private async verifyWebSocketResponse<T>(router: string, resp: JsonResp): Promise<T> {
    if (resp.c !== 200) {
      throw new Error(resp.m ?? `response error (code=${resp.c})`);
    }
    verifyResponseTime(resp.t);
    const secret = this.tokenSecretBytes();
    const expected = signBodyMessage(router, resp.d, resp.n, resp.t, resp.p, this.clientNo, secret);
    if (!compareBase64Sign(expected, resp.s)) {
      throw new Error('response signature verification failed');
    }
    if (planRequiresOuterSignature(resp.p)) {
      await this.verifyOuterSign(router, resp);
    }
    let decrypted: Buffer;
    if (resp.p === 1) {
      decrypted = await aesGcmDecryptBase64(
        resp.d,
        secret.subarray(0, 32),
        appendBodyMessage(router, '', resp.n, resp.t, resp.p, this.clientNo),
      );
    } else {
      decrypted = Buffer.from(resp.d, 'base64');
    }
    return jsonBigParse<T>(decrypted.toString('utf8'));
  }

  private async verifyOuterSign(router: string, resp: JsonResp): Promise<void> {
    await verifyPlan2ResponseOuterSign(router, resp, this.clientNo, this.serverPub);
  }

  private async sendAuthHandshake(): Promise<void> {
    const path = this.wsPath;
    const jsonBody: JsonBody = {
      d: '',
      n: getMessageNonce(),
      s: '',
      r: path,
      t: unixSecond(),
      p: 1,
      u: this.clientNo,
    };
    const secret = this.tokenSecretBytes();
    const payload = Buffer.from(jsonBigStringify('auth_handshake'));
    jsonBody.d = await aesGcmEncryptBase64(
      payload,
      secret.subarray(0, 32),
      appendBodyMessage(jsonBody.r, '', jsonBody.n, jsonBody.t, jsonBody.p, jsonBody.u),
    );
    jsonBody.s = signBodyMessage(
      jsonBody.r,
      jsonBody.d,
      jsonBody.n,
      jsonBody.t,
      jsonBody.p,
      jsonBody.u,
      secret,
    ).toString('base64');

    const authKey = `auth_${jsonBody.n}`;
    const resp = await new Promise<JsonResp>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(authKey);
        reject(new Error('handshake timeout'));
      }, 5000);
      this.pending.set(authKey, {
        resolve,
        reject,
        timer,
      });
      void this.writeBody(jsonBody, false, 0).catch(reject);
    });
    await this.verifyWebSocketResponse(path, resp);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const intervalMs = Math.min(Math.max(this.healthPingSec, 1), 15) * 1000;
    this.heartbeatTimer = setInterval(() => {
      if (!this.isWebSocketConnected()) return;
      if (this.rawAuthHeader && !this.validToken()) return;
      void this.sendHeartbeat().catch(() => this.handleClose());
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const secret = this.tokenSecretBytes();
    const jsonBody: JsonBody = {
      d: Buffer.from(jsonBigStringify('ping')).toString('base64'),
      n: getMessageNonce(),
      s: '',
      r: '/ws/ping',
      t: unixSecond(),
      p: 0,
      u: this.clientNo,
    };
    jsonBody.s = signBodyMessage(
      jsonBody.r,
      jsonBody.d,
      jsonBody.n,
      jsonBody.t,
      jsonBody.p,
      jsonBody.u,
      secret,
    ).toString('base64');
    await this.writeBody(jsonBody, false, 0);
  }

  private startTokenMonitor(): void {
    this.stopTokenMonitor();
    this.tokenMonitorTimer = setInterval(() => {
      if (this.rawAuthHeader) return;
      if (!this.validToken() && !this.isWebSocketConnected() && this.tokenRefreshCallback) {
        void this.tokenRefreshCallback().then((token) => {
          if (token) this.authToken(token);
        });
      }
    }, 1000);
  }

  private stopTokenMonitor(): void {
    if (this.tokenMonitorTimer) {
      clearInterval(this.tokenMonitorTimer);
      this.tokenMonitorTimer = null;
    }
  }
}

export function createUuid(): string {
  return randomUUID().replaceAll('-', '');
}
