import { readFile } from 'node:fs/promises';

import { jsonBigParse } from '../json/jsonbig.js';
import type { SdkConfig } from './config.js';

export class WalletApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletApiError';
  }
}

export const ERR_NIL_REQUEST = new WalletApiError('request is nil');

export function isNilRequest(value: unknown): boolean {
  return value === null || value === undefined;
}

export async function readSdkConfigFile(path: string): Promise<SdkConfig> {
  const raw = await readFile(path, 'utf8');
  return jsonBigParse<SdkConfig>(raw);
}

export function sdkConfigEnabled(cfg: SdkConfig | undefined): boolean {
  return Boolean(cfg?.domain?.trim());
}

export function normalizeConfig(cfg: {
  appKey?: string;
  ops?: SdkConfig;
  mpc?: SdkConfig;
}): void {
  if (!cfg.appKey?.trim() && cfg.ops?.appKey?.trim()) {
    cfg.appKey = cfg.ops.appKey;
  }
  if (!cfg.appKey?.trim()) return;
  if (cfg.ops && !cfg.ops.appKey?.trim()) {
    cfg.ops.appKey = cfg.appKey;
  }
  if (cfg.mpc && !cfg.mpc.appKey?.trim()) {
    cfg.mpc.appKey = cfg.appKey;
  }
}

export function wsTimeout(sec?: number): number {
  return sec && sec > 0 ? sec : 300;
}
