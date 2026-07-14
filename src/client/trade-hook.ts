import { createHmac } from 'node:crypto';

import { compareBase64Sign } from '../crypto/canonical.js';
import { jsonBigParse } from '../json/jsonbig.js';
import type {
  CancelTransferTradeReq,
  CreateSummaryTxReq,
  CreateTradeReq,
  PendingSignTx,
  RawTransaction,
  SmartContractRawTransaction,
  SpeedUpTransferTradeReq,
} from '../types/index.js';
import {
  validateRawTradePending,
  validateSummaryRawPending,
} from './trade-validate.js';

export type TradeKind =
  | 'create_trade'
  | 'speed_up'
  | 'cancel'
  | 'summary'
  | 'batch_transfer'
  | 'batch_approve'
  | 'batch_speed_up'
  | 'batch_cancel'
  | 'deploy';

export const TradeKindCreate: TradeKind = 'create_trade';
export const TradeKindSpeedUp: TradeKind = 'speed_up';
export const TradeKindCancel: TradeKind = 'cancel';
export const TradeKindSummary: TradeKind = 'summary';
export const TradeKindBatchTransfer: TradeKind = 'batch_transfer';
export const TradeKindBatchApprove: TradeKind = 'batch_approve';
export const TradeKindBatchSpeedUp: TradeKind = 'batch_speed_up';
export const TradeKindBatchCancel: TradeKind = 'batch_cancel';
export const TradeKindDeploy: TradeKind = 'deploy';

export interface TradeCreatedContext {
  kind: TradeKind;
  request: unknown;
  pending: PendingSignTx[];
  client: unknown;
}

export type TradeCreatedHook = (ctx: TradeCreatedContext) => void | Promise<void>;

export function firstPending(ctx: TradeCreatedContext): PendingSignTx {
  if (!ctx.pending.length) {
    throw new Error('empty pendingSignTx');
  }
  return ctx.pending[0]!;
}

export function decodeRaw(ctx: TradeCreatedContext): RawTransaction {
  const pending = firstPending(ctx);
  if (!pending.data) {
    throw new Error('pendingSignTx.data is empty');
  }
  try {
    return jsonBigParse<RawTransaction>(pending.data);
  } catch (error) {
    throw new Error(`unmarshal raw tx: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function decodeSmart(ctx: TradeCreatedContext): SmartContractRawTransaction {
  const pending = firstPending(ctx);
  if (!pending.data) {
    throw new Error('pendingSignTx.data is empty');
  }
  try {
    return jsonBigParse<SmartContractRawTransaction>(pending.data);
  } catch (error) {
    throw new Error(
      `unmarshal smart contract tx: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function decodePendingRaw(pending: PendingSignTx): RawTransaction {
  if (!pending.data) {
    throw new Error('pendingSignTx.data is empty');
  }
  try {
    return jsonBigParse<RawTransaction>(pending.data);
  } catch (error) {
    throw new Error(`unmarshal raw tx: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validatePendingDataSign(appKey: Buffer, tx: PendingSignTx): void {
  if (!tx.data) {
    throw new Error('pendingSignTx.data is empty');
  }
  const checkSign = createHmac('sha256', appKey).update(tx.data, 'utf8').digest();
  if (!compareBase64Sign(checkSign, tx.dataSign ?? '')) {
    throw new Error('tx data check sign invalid');
  }
}

export function validatePendingDataSignHook(appKey: string): TradeCreatedHook {
  let key: Buffer;
  try {
    key = Buffer.from(appKey, 'hex');
  } catch (error) {
    return () => {
      throw new Error(`invalid appKey: ${error instanceof Error ? error.message : String(error)}`);
    };
  }
  if (key.length === 0) {
    return () => {
      throw new Error('invalid appKey: empty hex');
    };
  }
  return (ctx) => {
    ctx.pending.forEach((tx, i) => {
      try {
        validatePendingDataSign(key, tx);
      } catch (error) {
        throw new Error(
          `pending[${i}]: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  };
}

export function validateCreateTradeRequestHook(): TradeCreatedHook {
  return (ctx) => {
    if (ctx.kind !== TradeKindCreate) {
      return;
    }
    const req = ctx.request as CreateTradeReq | null | undefined;
    if (!req?.sid || !req.accountID || !req.coin?.symbol || !req.to) {
      return;
    }
    const tx = decodeRaw(ctx);
    validateRawTradePending(
      tx,
      req.sid,
      req.accountID,
      req.coin.symbol,
      req.coin.contractAddress ?? '',
      req.to,
    );
  };
}

export function validateCreateSummaryTxRequestHook(): TradeCreatedHook {
  return (ctx) => {
    if (ctx.kind !== TradeKindSummary) {
      return;
    }
    const req = ctx.request as CreateSummaryTxReq | null | undefined;
    if (!req) {
      throw new Error('CreateSummaryTx hook: invalid request type');
    }
    const target = (req.address ?? '').trim();
    if (!target) {
      throw new Error('summary target address is empty');
    }
    ctx.pending.forEach((pending, i) => {
      try {
        const tx = decodePendingRaw(pending);
        validateSummaryRawPending(
          tx,
          req.sid ?? '',
          req.accountID ?? '',
          req.coin?.symbol ?? '',
          target,
        );
      } catch (error) {
        throw new Error(
          `pending[${i}]: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  };
}

export function validateRBFSidRequestHook(): TradeCreatedHook {
  return (ctx) => {
    let sid = '';
    let accountID = '';
    if (ctx.kind === TradeKindSpeedUp) {
      const req = ctx.request as SpeedUpTransferTradeReq | null | undefined;
      if (!req) {
        throw new Error('SpeedUp hook: invalid request type');
      }
      sid = req.sid ?? '';
      accountID = req.accountID ?? '';
    } else if (ctx.kind === TradeKindCancel) {
      const req = ctx.request as CancelTransferTradeReq | null | undefined;
      if (!req) {
        throw new Error('Cancel hook: invalid request type');
      }
      sid = req.sid ?? '';
      accountID = req.accountID ?? '';
    } else {
      return;
    }
    ctx.pending.forEach((pending, i) => {
      try {
        const tx = decodePendingRaw(pending);
        if (tx.sid !== sid) {
          throw new Error(`sid invalid, got=${tx.sid ?? ''} want=${sid}`);
        }
        if (tx.account?.accountID !== accountID) {
          throw new Error(
            `accountID invalid, got=${tx.account?.accountID ?? ''} want=${accountID}`,
          );
        }
      } catch (error) {
        throw new Error(
          `pending[${i}]: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  };
}

export function defaultTradeCreatedHooks(appKey: string): TradeCreatedHook[] {
  if (!appKey.trim()) {
    return [];
  }
  return [
    validatePendingDataSignHook(appKey),
    validateCreateTradeRequestHook(),
    validateCreateSummaryTxRequestHook(),
    validateRBFSidRequestHook(),
  ];
}

export async function runTradeCreatedHooks(
  client: unknown,
  hooks: TradeCreatedHook[],
  kind: TradeKind,
  request: unknown,
  pending: PendingSignTx[] | undefined,
): Promise<void> {
  if (!pending?.length) {
    throw new Error('empty pendingSignTx');
  }
  const ctx: TradeCreatedContext = {
    kind,
    request,
    pending,
    client,
  };
  for (const hook of hooks) {
    if (!hook) continue;
    await hook(ctx);
  }
}
