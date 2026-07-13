import { randomUUID } from 'node:crypto';

import type { SocketSDK } from '../transport/socket-sdk.js';
import type { Config, ConfigHook, TransferTimings } from './config.js';
import { normalizeConfigHooks } from './config.js';
import {
  normalizeConfig,
  readSdkConfigFile,
  sdkConfigEnabled,
  wsTimeout,
  ERR_NIL_REQUEST,
  isNilRequest,
} from './util.js';
import { newLongLivedSocket, signTransaction } from './socket.js';
import { clampPageLimit } from './pager.js';
import {
  INCREMENTAL_PAGE_SIZE,
  incrementalNextCursor,
  watchIncremental,
} from './log-watch.js';
import {
  TradeKindBatchApprove,
  TradeKindBatchCancel,
  TradeKindBatchSpeedUp,
  TradeKindBatchTransfer,
  TradeKindCancel,
  TradeKindCreate,
  TradeKindDeploy,
  TradeKindSpeedUp,
  TradeKindSummary,
  defaultTradeCreatedHooks,
  runTradeCreatedHooks,
  type TradeCreatedHook,
  type TradeKind,
} from './trade-hook.js';
import type {
  CliSignTransactionReq,
  CliSignTransactionRes,
  CreateTradeReq,
  CreateTradeRes,
  FindBalanceLogReq,
  FindBalanceLogRes,
  FindMonitorAlertReq,
  FindMonitorAlertRes,
  FindTradeLogReq,
  FindTradeLogRes,
  SubmitRawTransactionReq,
  SubmitRawTransactionRes,
  BalanceLogResult,
  MonitorAlertResult,
  TradeLogResult,
  CreateSummaryTxRes,
  DeployContractRes,
  PendingSignTx,
} from '../types/index.js';

export type { Config, ConfigHook, SdkConfig, TransferTimings } from './config.js';
export type { TradeCreatedHook, TradeCreatedContext, TradeKind } from './trade-hook.js';
export {
  TradeKindCreate,
  TradeKindSpeedUp,
  TradeKindCancel,
  TradeKindSummary,
  TradeKindBatchTransfer,
  TradeKindBatchApprove,
  TradeKindBatchSpeedUp,
  TradeKindBatchCancel,
  TradeKindDeploy,
  validatePendingDataSignHook,
  validateCreateTradeRequestHook,
  validateCreateSummaryTxRequestHook,
  validateRBFSidRequestHook,
} from './trade-hook.js';
export * from '../types/index.js';

export type TradeLogHandler = (entry: TradeLogResult) => void | Promise<void>;
export type BalanceLogHandler = (entry: BalanceLogResult) => void | Promise<void>;
export type MonitorAlertHandler = (entry: MonitorAlertResult) => void | Promise<void>;

export class WalletClient {
  private readonly appKey: string;
  private readonly wsTimeoutSec: number;
  private opsSDK: SocketSDK | null = null;
  private mpcSDK: SocketSDK | null = null;
  private tradeCreatedHooks: TradeCreatedHook[] = [];

  private constructor(appKey: string, wsTimeoutSec: number, tradeCreatedHooks: TradeCreatedHook[]) {
    this.appKey = appKey;
    this.wsTimeoutSec = wsTimeoutSec;
    this.tradeCreatedHooks = tradeCreatedHooks;
  }

  static async create(
    cfg: Config,
    hooks: ConfigHook | ConfigHook[] = [],
  ): Promise<WalletClient> {
    for (const hook of normalizeConfigHooks(hooks)) {
      if (hook) await hook(cfg);
    }
    normalizeConfig(cfg);
    const tradeHooks: TradeCreatedHook[] = [];
    if (!cfg.disableDefaultTradeHooks) {
      tradeHooks.push(...defaultTradeCreatedHooks(cfg.appKey ?? ''));
    }
    if (cfg.tradeCreatedHooks?.length) {
      tradeHooks.push(...cfg.tradeCreatedHooks);
    }
    const client = new WalletClient(cfg.appKey ?? '', wsTimeout(cfg.wsTimeoutSec), tradeHooks);

    if (cfg.ops && sdkConfigEnabled(cfg.ops)) {
      client.opsSDK = await newLongLivedSocket(cfg.ops);
    }
    try {
      if (cfg.mpc && sdkConfigEnabled(cfg.mpc)) {
        client.mpcSDK = await newLongLivedSocket(cfg.mpc);
      }
    } catch (error) {
      client.close();
      throw error;
    }
    return client;
  }

  static async fromFiles(
    opsPath: string,
    mpcPath: string,
    appKey = '',
    wsTimeoutSec?: number,
    hooks: ConfigHook | ConfigHook[] = [],
  ): Promise<WalletClient> {
    const cfg: Config = { appKey, wsTimeoutSec };
    if (opsPath.trim()) {
      cfg.ops = await readSdkConfigFile(opsPath);
    }
    if (mpcPath.trim()) {
      cfg.mpc = await readSdkConfigFile(mpcPath);
    }
    return WalletClient.create(cfg, hooks);
  }

  connected(): { ops: boolean; mpc: boolean } {
    return {
      ops: this.opsSDK?.isWebSocketConnected() ?? false,
      mpc: this.mpcSDK?.isWebSocketConnected() ?? false,
    };
  }

  close(): void {
    this.opsSDK?.disconnectWebSocket();
    this.mpcSDK?.disconnectWebSocket();
    this.opsSDK = null;
    this.mpcSDK = null;
  }

  private requireOPS(): SocketSDK {
    if (!this.opsSDK) {
      throw new Error('ops not connected');
    }
    return this.opsSDK;
  }

  private requireMPC(): SocketSDK {
    if (!this.mpcSDK) {
      throw new Error('mpc not connected');
    }
    return this.mpcSDK;
  }

  private async sendOPS<TReq extends object, TRes>(
    path: string,
    req: TReq,
  ): Promise<TRes> {
    if (isNilRequest(req)) throw ERR_NIL_REQUEST;
    clampPageLimit(path, req);
    const sdk = this.requireOPS();
    const res = await sdk.sendWebSocketMessage<TReq, TRes>(
      path,
      req,
      true,
      true,
      this.wsTimeoutSec,
    );
    if (res === null) {
      throw new Error(`${path}: empty response`);
    }
    return res;
  }

  private async sendCLI<TReq extends object, TRes>(
    path: string,
    req: TReq,
  ): Promise<TRes> {
    if (isNilRequest(req)) throw ERR_NIL_REQUEST;
    clampPageLimit(path, req);
    const sdk = this.requireMPC();
    const res = await sdk.sendWebSocketMessage<TReq, TRes>(
      path,
      req,
      true,
      true,
      this.wsTimeoutSec,
    );
    if (res === null) {
      throw new Error(`${path}: empty response`);
    }
    return res;
  }

  addTradeCreatedHook(hook: TradeCreatedHook): void {
    if (hook) {
      this.tradeCreatedHooks.push(hook);
    }
  }

  private async runHooks(
    kind: TradeKind,
    request: unknown,
    pending: PendingSignTx[] | undefined,
  ): Promise<void> {
    await runTradeCreatedHooks(this, this.tradeCreatedHooks, kind, request, pending);
  }

  private async sendOPSTrade<TReq extends object, TRes>(
    path: string,
    req: TReq,
    kind: TradeKind,
    extractPending: (res: TRes) => PendingSignTx[] | undefined,
  ): Promise<TRes> {
    const res = await this.sendOPS<TReq, TRes>(path, req);
    await this.runHooks(kind, req, extractPending(res));
    return res;
  }

  async watchTradeLog(
    signal: AbortSignal | undefined,
    startLastID: number | string,
    fn: TradeLogHandler,
  ): Promise<void> {
    if (!fn) {
      throw new Error('trade log handler is nil');
    }
    await watchIncremental(signal, startLastID, INCREMENTAL_PAGE_SIZE, async (cursor) => {
      const req: FindTradeLogReq = { lastID: cursor, limit: INCREMENTAL_PAGE_SIZE };
      const res = await this.findTradeLog(req);
      const rows = res.result ?? [];
      const next = incrementalNextCursor(cursor, res.limit?.lastID, rows.length, (i) => rows[i]?.id);
      for (const row of rows) {
        await fn(row);
      }
      return { count: rows.length, nextCursor: next };
    });
  }

  async watchBalanceLog(
    signal: AbortSignal | undefined,
    startLastID: number | string,
    fn: BalanceLogHandler,
  ): Promise<void> {
    if (!fn) {
      throw new Error('balance log handler is nil');
    }
    await watchIncremental(signal, startLastID, INCREMENTAL_PAGE_SIZE, async (cursor) => {
      const req: FindBalanceLogReq = { lastID: cursor, limit: INCREMENTAL_PAGE_SIZE };
      const res = await this.findBalanceLog(req);
      const rows = res.result ?? [];
      const next = incrementalNextCursor(cursor, res.limit?.lastID, rows.length, (i) => rows[i]?.id);
      for (const row of rows) {
        await fn(row);
      }
      return { count: rows.length, nextCursor: next };
    });
  }

  async watchMonitorAlert(
    signal: AbortSignal | undefined,
    startLastID: number | string,
    fn: MonitorAlertHandler,
  ): Promise<void> {
    if (!fn) {
      throw new Error('monitor alert handler is nil');
    }
    await watchIncremental(signal, startLastID, INCREMENTAL_PAGE_SIZE, async (cursor) => {
      const req: FindMonitorAlertReq = { lastID: cursor, limit: INCREMENTAL_PAGE_SIZE };
      const res = await this.findMonitorAlert(req);
      const rows = res.result ?? [];
      const next = incrementalNextCursor(cursor, res.limit?.lastID, rows.length, (i) => rows[i]?.id);
      for (const row of rows) {
        await fn(row);
      }
      return { count: rows.length, nextCursor: next };
    });
  }

  async transfer(
    fromAccountID: string,
    to: Record<string, string>,
    symbol: string,
    contractAddress = '',
  ): Promise<{ result: SubmitRawTransactionRes; timings: TransferTimings }> {
    if (!this.opsSDK || !this.mpcSDK) {
      throw new Error('ops and mpc must both be connected for Transfer');
    }

    const sid = randomUUID().replaceAll('-', '');
    const createStart = Date.now();
    const createRes = await this.createTrade({
      sid,
      accountID: fromAccountID,
      coin: { symbol, contractAddress },
      to,
    });
    const createMs = Date.now() - createStart;
    const pending = createRes.pendingSignTx?.[0];
    if (!pending?.data) {
      throw new Error(`CreateTrade sid=${sid}: missing pendingSignTx`);
    }

    const signStart = Date.now();
    const signReq: CliSignTransactionReq = {
      type: 0,
      data: pending.data,
      tradeSign: pending.tradeSign,
    };
    const signRes = await signTransaction<CliSignTransactionReq, CliSignTransactionRes>(
      this.mpcSDK,
      signReq,
      this.wsTimeoutSec,
    );
    const signMs = Date.now() - signStart;
    if (!signRes.signerList) {
      throw new Error(`SignTransaction sid=${sid}: signerList missing`);
    }
    pending.signerList = signRes.signerList;

    const submitReq: SubmitRawTransactionReq = { pendingSignTx: pending };
    const result = await this.submitTrade(submitReq);
    return { result, timings: { createMs, signMs } };
  }

  // --- OPS API ---

  createAccount<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/CreateAccount', req);
  }
  findAccountByAccountID<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/FindAccountByAccountID', req);
  }
  findAccountByWalletID<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/FindAccountByWalletID', req);
  }
  getBalanceByAccount<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/GetBalanceByAccount', req);
  }
  getAccountBalanceList<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/GetAccountBalanceList', req);
  }
  importAddress<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/ImportAddress', req);
  }
  findAddressByAddress<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/FindAddressByAddress', req);
  }
  findAddressByAccountID<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/FindAddressByAccountID', req);
  }
  verifyAddress<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/VerifyAddress', req);
  }
  getBalanceByAddress<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/GetBalanceByAddress', req);
  }
  getAddressBalanceList<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/GetAddressBalanceList', req);
  }
  getContracts<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/GetContracts', req);
  }
  getContractTemplates<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/GetContractTemplates', req);
  }
  deployContract<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, DeployContractRes>(
      '/api/DeployContract',
      req,
      TradeKindDeploy,
      (res) => res.pendingSignTx,
    );
  }
  submitDeployContract<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/SubmitDeployContract', req);
  }
  submitSmartContractTrade<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/SubmitSmartContractTrade', req);
  }
  symbolBlockList<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/SymbolBlockList', req);
  }
  getBlockStatus<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/GetBlockStatus', req);
  }
  createTrade(req: CreateTradeReq) {
    return this.sendOPSTrade<CreateTradeReq, CreateTradeRes>(
      '/api/CreateTrade',
      req,
      TradeKindCreate,
      (res) => res.pendingSignTx,
    );
  }
  submitTrade(req: SubmitRawTransactionReq) {
    return this.sendOPS<SubmitRawTransactionReq, SubmitRawTransactionRes>('/api/SubmitTrade', req);
  }
  speedUpTransferTrade<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, CreateTradeRes>(
      '/api/SpeedUpTransferTrade',
      req,
      TradeKindSpeedUp,
      (res) => res.pendingSignTx,
    );
  }
  cancelTransferTrade<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, CreateTradeRes>(
      '/api/CancelTransferTrade',
      req,
      TradeKindCancel,
      (res) => res.pendingSignTx,
    );
  }
  createSummaryTx<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, CreateSummaryTxRes>(
      '/api/CreateSummaryTx',
      req,
      TradeKindSummary,
      (res) => res.summaryPendingSignTx,
    );
  }
  evaluateSummaryFeeDeficit<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/EvaluateSummaryFeeDeficit', req);
  }
  findTradeLog(req: FindTradeLogReq) {
    return this.sendOPS<FindTradeLogReq, FindTradeLogRes>('/api/FindTradeLog', req);
  }
  findBalanceLog(req: FindBalanceLogReq) {
    return this.sendOPS<FindBalanceLogReq, FindBalanceLogRes>('/api/FindBalanceLog', req);
  }
  findMonitorAlert(req: FindMonitorAlertReq) {
    return this.sendOPS<FindMonitorAlertReq, FindMonitorAlertRes>('/api/FindMonitorAlert', req);
  }
  createBatchTransferTrade<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, CreateTradeRes>(
      '/api/CreateBatchTransferTrade',
      req,
      TradeKindBatchTransfer,
      (res) => res.pendingSignTx,
    );
  }
  createBatchTransferApproveTrade<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, CreateTradeRes>(
      '/api/CreateBatchTransferApproveTrade',
      req,
      TradeKindBatchApprove,
      (res) => res.pendingSignTx,
    );
  }
  getBatchTransferAllowance<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/GetBatchTransferAllowance', req);
  }
  createStakeTrade<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, CreateTradeRes>(
      '/api/CreateStakeTrade',
      req,
      TradeKindCreate,
      (res) => res.pendingSignTx,
    );
  }
  createUnstakeTrade<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, CreateTradeRes>(
      '/api/CreateUnstakeTrade',
      req,
      TradeKindCreate,
      (res) => res.pendingSignTx,
    );
  }
  createWithdrawUnfreezeTrade<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, CreateTradeRes>(
      '/api/CreateWithdrawUnfreezeTrade',
      req,
      TradeKindCreate,
      (res) => res.pendingSignTx,
    );
  }
  getAccountResourceDetail<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/GetAccountResourceDetail', req);
  }
  speedUpBatchTransferTrade<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, CreateTradeRes>(
      '/api/SpeedUpBatchTransferTrade',
      req,
      TradeKindBatchSpeedUp,
      (res) => res.pendingSignTx,
    );
  }
  cancelBatchTransferTrade<TReq extends Record<string, unknown>>(req: TReq) {
    return this.sendOPSTrade<TReq, CreateTradeRes>(
      '/api/CancelBatchTransferTrade',
      req,
      TradeKindBatchCancel,
      (res) => res.pendingSignTx,
    );
  }
  createWallet<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/CreateWallet', req);
  }
  findWalletByWalletID<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/FindWalletByWalletID', req);
  }
  createSubscribe<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendOPS<TReq, TRes>('/api/CreateSubscribe', req);
  }

  // --- MPC API ---

  findWalletList<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendCLI<TReq, TRes>('/api/FindWalletList', req);
  }
  createMPCWallet<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendCLI<TReq, TRes>('/api/CreateMPCWallet', req);
  }
  cliCreateAccount<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendCLI<TReq, TRes>('/api/CreateAccount', req);
  }
  cliCreateAddress<TReq extends Record<string, unknown>, TRes = Record<string, unknown>>(req: TReq) {
    return this.sendCLI<TReq, TRes>('/api/CreateAddress', req);
  }
  signTransaction(req: CliSignTransactionReq) {
    if (isNilRequest(req)) throw ERR_NIL_REQUEST;
    return signTransaction<CliSignTransactionReq, CliSignTransactionRes>(
      this.requireMPC(),
      req,
      this.wsTimeoutSec,
    );
  }
}

export { ERR_NIL_REQUEST };
