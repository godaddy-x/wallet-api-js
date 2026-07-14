import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  TradeKindCreate,
  validateCreateTradeRequestHook,
  validatePendingDataSignHook,
  runTradeCreatedHooks,
} from '../src/client/trade-hook.js';
import { jsonBigStringify } from '../src/json/jsonbig.js';
import type { CreateTradeReq, PendingSignTx } from '../src/types/index.js';

test('validateCreateTradeRequestHook matches transfer request', () => {
  const raw = {
    sid: 'sid-1',
    coin: { symbol: 'ETH' },
    account: { accountID: 'acc-1' },
    txTo: ['0xabc:0.01'],
  };
  const pending: PendingSignTx = { data: jsonBigStringify(raw) };
  const req: CreateTradeReq = {
    sid: 'sid-1',
    accountID: 'acc-1',
    coin: { symbol: 'ETH' },
    to: { '0xabc': '0.01' },
  };
  validateCreateTradeRequestHook()({
    kind: TradeKindCreate,
    request: req,
    pending: [pending],
    client: null,
  });

  req.to['0xabc'] = '0.02';
  assert.throws(
    () =>
      validateCreateTradeRequestHook()({
        kind: TradeKindCreate,
        request: req,
        pending: [pending],
        client: null,
      }),
  );
});

test('validateCreateTradeRequestHook allows BTC change output', () => {
  const raw = {
    sid: 'sid-btc',
    coin: { symbol: 'BTC' },
    account: { accountID: 'acc-1' },
    txFrom: ['bcrt1qay6v8dmyqu6lu6z448fx9re0c5nzy2ye22shua:50'],
    txTo: [
      'bcrt1qzqwuj487l2weae4vqpdqfku5gk7ssj8h5ry6ec:0.0001',
      'bcrt1qay6v8dmyqu6lu6z448fx9re0c5nzy2ye22shua:41.79989000',
    ],
  };
  const pending: PendingSignTx = { data: jsonBigStringify(raw) };
  const req: CreateTradeReq = {
    sid: 'sid-btc',
    accountID: 'acc-1',
    coin: { symbol: 'BTC' },
    to: { bcrt1qzqwuj487l2weae4vqpdqfku5gk7ssj8h5ry6ec: '0.0001' },
  };
  validateCreateTradeRequestHook()({
    kind: TradeKindCreate,
    request: req,
    pending: [pending],
    client: null,
  });
});

test('validatePendingDataSignHook verifies HMAC', () => {
  const appKey = Buffer.from('0123456789abcdef', 'utf8').toString('hex');
  const key = Buffer.from('0123456789abcdef', 'utf8');
  const data = '{"sid":"s1"}';
  const dataSign = createHmac('sha256', key).update(data, 'utf8').digest('base64');
  const pending: PendingSignTx = { data, dataSign };
  validatePendingDataSignHook(appKey)({
    kind: TradeKindCreate,
    request: null,
    pending: [pending],
    client: null,
  });

  pending.dataSign = 'bad';
  assert.throws(() =>
    validatePendingDataSignHook(appKey)({
      kind: TradeKindCreate,
      request: null,
      pending: [pending],
      client: null,
    }),
  );
});

test('runTradeCreatedHooks rejects empty pending', async () => {
  await assert.rejects(() =>
    runTradeCreatedHooks(null, [], TradeKindCreate, null, undefined),
  );
});
