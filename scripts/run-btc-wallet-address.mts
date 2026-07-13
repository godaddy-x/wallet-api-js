#!/usr/bin/env node
/**
 * Run BTC wallet → account → address flow against a live OPS/MPC stack.
 *
 *   npm run test:btc-wallet-address
 *
 * Or directly:
 *   set RUN_BTC_WALLET_ADDRESS=1
 *   node --import tsx --test integration/btc-wallet-address.test.ts
 *
 * Optional env:
 *   TEST_OPS_DOMAIN, TEST_MPC_DOMAIN, TEST_APP_KEY
 *   TEST_OPS_SYMBOL=BTC
 *   TEST_BTC_ADDRESS_PREFIX=bcrt1
 */
process.env.RUN_BTC_WALLET_ADDRESS ??= '1';

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testFile = fileURLToPath(new URL('../integration/btc-wallet-address.test.ts', import.meta.url));
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', testFile],
  { stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);
