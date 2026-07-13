#!/usr/bin/env node
/**
 * Run BTC wallet → account → address flow against a live OPS/MPC stack.
 *
 *   npm run build
 *   set RUN_BTC_WALLET_ADDRESS=1
 *   node --import tsx integration/btc-wallet-address.test.ts
 *
 * Optional env:
 *   TEST_OPS_DOMAIN, TEST_MPC_DOMAIN, TEST_APP_KEY
 *   TEST_OPS_SYMBOL=BTC
 *   TEST_BTC_ADDRESS_PREFIX=bcrt1
 */
process.env.RUN_BTC_WALLET_ADDRESS ??= '1';

import { run } from 'node:test';
import { spec } from 'node:test/reporters';

const result = await run({
  files: [new URL('../integration/btc-wallet-address.test.ts', import.meta.url)],
});
result.compose(new spec()).pipe(process.stdout);
process.exitCode = result.ok ? 0 : 1;
