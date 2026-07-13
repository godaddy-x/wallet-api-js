import type { BaseReq, CoinInfo, PendingSignTx } from './index.js';

export interface SmartCoinInfo {
  symbol?: string;
  address?: string;
  token?: string;
  protocol?: string;
  name?: string;
  decimals?: number | string;
}

export interface RawTransactionCoin {
  symbol?: string;
  contract?: SmartCoinInfo;
}

export interface RawTransactionAccount {
  accountID?: string;
}

/** MPC sign type=0 payload embedded in pendingSignTx.data */
export interface RawTransaction {
  sid?: string;
  coin?: RawTransactionCoin;
  account?: RawTransactionAccount;
  txTo?: string[];
  txFrom?: string[];
}

/** MPC sign type=2 payload embedded in pendingSignTx.data */
export interface SmartContractRawTransaction {
  sid?: string;
  coin?: RawTransactionCoin;
  account?: RawTransactionAccount;
  [key: string]: unknown;
}

export interface CreateSummaryTxReq extends BaseReq {
  accountID?: string;
  minTransfer?: string;
  retainedBalance?: string;
  address?: string;
  coin?: CoinInfo;
  feeRate?: string;
  addressStartIndex?: number | string;
  addressLimit?: number | string;
  confirms?: number | string;
  memo?: string;
  sid?: string;
}

export interface SummaryFeeDeficit {
  [key: string]: unknown;
}

export interface CreateSummaryTxRes {
  summaryPendingSignTx?: PendingSignTx[];
  feeDeficits?: SummaryFeeDeficit[];
}

export interface SpeedUpTransferTradeReq extends BaseReq {
  accountID?: string;
  originSid?: string;
  sid?: string;
  feeRate?: string;
  baseFeeRate?: string;
  feeBumpPercent?: number | string;
  feeBumpWei?: string;
}

export interface CancelTransferTradeReq extends BaseReq {
  accountID?: string;
  originSid?: string;
  sid?: string;
  feeRate?: string;
  baseFeeRate?: string;
  feeBumpPercent?: number | string;
  feeBumpWei?: string;
}

export interface DeployContractRes {
  pendingSignTx?: PendingSignTx[];
  [key: string]: unknown;
}
