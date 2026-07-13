import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

/** Matches server AppLogin HMAC argument order (data=appKey, key=nonce+time+source). */
function appLoginSign(
  appKeyHex: string,
  nonce: string,
  time: number,
  source: string,
): string {
  const appKey = Buffer.from(appKeyHex, 'hex');
  return createHmac('sha256', `${nonce}${time}${source}`)
    .update(appKey)
    .digest('base64');
}

test('AppLogin HMAC uses appKey as data and nonce+time+source as key', () => {
  const appKeyHex =
    '61946de117c711defc65c16fdd8b205b841354a08c19a1b25a37b9d3066aaafb';
  const nonce = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const time = 1_700_000_000;
  const source = 'API';

  const expected = appLoginSign(appKeyHex, nonce, time, source);
  const wrongOrder = createHmac('sha256', Buffer.from(appKeyHex, 'hex'))
    .update(`${nonce}${time}${source}`)
    .digest('base64');

  assert.notEqual(expected, wrongOrder);
  assert.equal(
    expected,
    'fte/O8dDPJhi8O1Kw5XGFJh8t+CNfswopHi1vOBfjvk=',
  );
});
