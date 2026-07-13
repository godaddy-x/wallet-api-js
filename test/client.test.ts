import assert from 'node:assert/strict';
import test from 'node:test';

import { WalletClient } from '../src/client/wallet-client.js';

test('create skips empty config', async () => {
  const client = await WalletClient.create({});
  try {
    const { ops, mpc } = client.connected();
    assert.equal(ops, false);
    assert.equal(mpc, false);
  } finally {
    client.close();
  }
});

test('CLI requires MPC', async () => {
  const client = await WalletClient.create({});
  try {
    await assert.rejects(async () => client.findWalletList({}), /mpc not connected/);
    assert.throws(
      () => client.signTransaction({ type: 0, data: '{}' }),
      /mpc not connected/,
    );
  } finally {
    client.close();
  }
});

test('OPS requires OPS', async () => {
  const client = await WalletClient.create({});
  try {
    await assert.rejects(() => client.getBlockStatus({ symbol: 'BETH' }), /ops not connected/);
    await assert.rejects(
      () => client.createTrade({ sid: 's', accountID: 'a', coin: { symbol: 'ETH' }, to: {} }),
      /ops not connected/,
    );
  } finally {
    client.close();
  }
});

test('transfer requires both sessions', async () => {
  const client = await WalletClient.create({});
  try {
    await assert.rejects(
      () => client.transfer('acc', { '0x1': '1' }, 'BETH'),
      /ops and mpc must both be connected/,
    );
  } finally {
    client.close();
  }
});

test('nil request rejected', async () => {
  const client = await WalletClient.create({});
  try {
    await assert.rejects(() => client.findWalletList(null as never), /request is nil/);
    assert.throws(() => client.signTransaction(null as never), /request is nil/);
    await assert.rejects(() => client.getBlockStatus(null as never), /request is nil/);
    await assert.rejects(() => client.createTrade(null as never), /request is nil/);
    await assert.rejects(() => client.getContracts(null as never), /request is nil/);
  } finally {
    client.close();
  }
});
