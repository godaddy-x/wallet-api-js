export interface BaseReq {
  prevID?: number | string;
  lastID?: number | string;
  offset?: number;
  limit?: number;
  countQ?: boolean;
}

export interface CoinInfo {
  symbol: string;
  isContract?: boolean;
  contractAddress?: string;
  contractABI?: string;
}

export interface PendingSignTx {
  sid?: string;
  data?: string;
  dataSign?: string;
  tradeSign?: string;
  code?: string;
  message?: string;
  signerList?: Record<string, unknown>;
}

export interface CreateTradeReq {
  sid: string;
  accountID: string;
  coin: CoinInfo;
  to: Record<string, string>;
  feeRate?: string;
  fees?: string;
  extParam?: string;
}

export interface CreateTradeRes {
  pendingSignTx?: PendingSignTx[];
}

export interface SubmitRawTransactionReq {
  pendingSignTx?: PendingSignTx;
}

export interface SubmitRawTransactionRes {
  txID?: string;
  status?: string | number;
  message?: string;
}

export interface CliSignTransactionReq {
  type: number;
  data: string;
  tradeSign?: string;
}

export interface CliSignTransactionRes {
  signerList?: Record<string, unknown>;
}

export * from './login.js';
export * from './logs.js';
export * from './trade.js';
