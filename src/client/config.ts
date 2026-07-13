import type { TradeCreatedHook } from './trade-hook.js';

export interface SdkConfig {
  domain: string;
  keyPath?: string;
  loginPath?: string;
  source?: string;
  appID?: string;
  appKey?: string;
  clientPrk: string;
  serverPub: string;
  clientNo: number | string;
  ssl?: boolean;
}

export interface Config {
  ops?: SdkConfig;
  mpc?: SdkConfig;
  appKey?: string;
  wsTimeoutSec?: number;
  tradeCreatedHooks?: TradeCreatedHook[];
  disableDefaultTradeHooks?: boolean;
}

export type { TradeCreatedHook } from './trade-hook.js';

export type ConfigHook = (cfg: Config) => void | Promise<void>;

export function normalizeConfigHooks(
  hooks?: ConfigHook | ConfigHook[] | null,
): ConfigHook[] {
  if (!hooks) return [];
  return Array.isArray(hooks) ? hooks.filter(Boolean) : [hooks];
}

export interface TransferTimings {
  createMs: number;
  signMs: number;
}
