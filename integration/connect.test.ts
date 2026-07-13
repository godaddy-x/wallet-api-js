import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { WalletClient, type Config } from '../src/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function configHook(cfg: Config): void {
  if (!cfg.appKey?.trim()) {
    cfg.appKey = cfg.ops?.appKey;
  }
  if (process.env.TEST_OPS_DOMAIN) {
    cfg.ops!.domain = process.env.TEST_OPS_DOMAIN;
  }
  if (process.env.TEST_MPC_DOMAIN) {
    cfg.mpc!.domain = process.env.TEST_MPC_DOMAIN;
  }
  if (process.env.TEST_APP_KEY) {
    cfg.appKey = process.env.TEST_APP_KEY;
    if (cfg.ops) cfg.ops.appKey = process.env.TEST_APP_KEY;
  }
}

test('connect OPS and MPC', { skip: process.env.RUN_INTEGRATION !== '1' }, async () => {
  const client = await WalletClient.fromFiles(
    join(repoRoot, 'config/ops.json'),
    join(repoRoot, 'config/cli.json'),
    '',
    30,
    configHook,
  );
  try {
    const { ops, mpc } = client.connected();
    assert.equal(ops, true, 'ops websocket not connected');
    assert.equal(mpc, true, 'mpc websocket not connected');
  } finally {
    client.close();
  }
});
