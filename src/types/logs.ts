import type { BaseReq } from './index.js';

export interface PageLimit {
  lastID?: number | string;
  prevID?: number | string;
}

export interface TradeLogResult {
  id?: number | string;
  appID?: string;
  walletID?: string;
  accountID?: string;
  sid?: string;
  txID?: string;
  txAction?: string;
  flowType?: string;
  fromAddress?: string[];
  fromAddressV?: string[];
  toAddress?: string[];
  toAddressV?: string[];
  amount?: string;
  fees?: string;
  mainSymbol?: string;
  symbol?: string;
  isContract?: boolean;
  blockHash?: string;
  blockHeight?: number | string;
  isMemo?: boolean;
  memo?: string;
  applyTime?: number | string;
  dataType?: number | string;
  dataTypeName?: string;
  blockTime?: number | string;
  decimals?: number | string;
  contractToken?: string;
  contractAddress?: string;
  success?: string;
  outputIndex?: number | string;
  signature?: string;
  createAt?: number | string;
  updateAt?: number | string;
  uniqueHash?: string;
  state?: number | string;
}

export interface BalanceLogResult {
  id?: number | string;
  appID?: string;
  walletID?: string;
  accountID?: string;
  scope?: string;
  address?: string;
  mainSymbol?: string;
  symbol?: string;
  contractAddress?: string;
  tradeLogID?: number | string;
  txID?: string;
  blockHeight?: number | string;
  networkBlockHeight?: number | string;
  txAction?: string;
  flowType?: string;
  balanceBefore?: string;
  balanceChange?: string;
  balanceAfter?: string;
  confirmBefore?: string;
  confirmChange?: string;
  confirmAfter?: string;
  createAt?: number | string;
}

export interface MonitorAlertResult {
  id?: number | string;
  appID?: string;
  domain?: string;
  ruleID?: number | string;
  ruleCode?: string;
  name?: string;
  category?: string;
  metric?: string;
  level?: number | string;
  windowType?: string;
  bucketType?: string;
  bucketStart?: number | string;
  scope?: string;
  symbol?: string;
  contractAddress?: string;
  address?: string;
  mainSymbol?: string;
  metricValue?: string;
  thresholdValue?: string;
  threshold2Value?: string;
  compareOp?: string;
  message?: string;
  payload?: string;
  alertLatency?: string;
  status?: number | string;
  createAt?: number | string;
  updateAt?: number | string;
}

export interface FindTradeLogReq extends BaseReq {}

export interface FindTradeLogRes {
  result?: TradeLogResult[];
  limit?: PageLimit;
}

export interface FindBalanceLogReq extends BaseReq {}

export interface FindBalanceLogRes {
  result?: BalanceLogResult[];
  limit?: PageLimit;
}

export interface FindMonitorAlertReq extends BaseReq {}

export interface FindMonitorAlertRes {
  result?: MonitorAlertResult[];
  limit?: PageLimit;
}
