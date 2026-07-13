import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { WalletClient, type Config } from '../src/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function envOr(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  return value || fallback;
}

function isAlreadyExistsErr(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : error).toLowerCase();
  return (
    msg.includes('already exists') ||
    msg.includes('duplicate key') ||
    msg.includes('uniq_') ||
    msg.includes('trade exist')
  );
}

function isAccountIndexMismatchErr(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : error).toLowerCase();
  return msg.includes('accountindex mismatch');
}

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

interface CliWalletRow {
  walletID?: string;
  rootPath?: string;
  algorithm?: string;
}

interface CliCreateAccountRes {
  accountID?: string;
  accountIndex?: number | string;
  hdPath?: string;
  publicKey?: string;
  reqSigs?: number | string;
}

interface FindAccountRow {
  accountIndex?: number | string;
}

interface CliAddressItem {
  addressIndex?: number | string;
  hdPath?: string;
  addressPubHex?: string;
}

interface ImportAddressItem {
  addrIndex?: number | string;
  publicKey?: string;
  hdPath?: string;
  address?: string;
}

test(
  'BTC wallet → account → address flow',
  { skip: process.env.RUN_BTC_WALLET_ADDRESS !== '1' },
  async () => {
    const client = await WalletClient.fromFiles(
      join(repoRoot, 'config/ops.json'),
      join(repoRoot, 'config/cli.json'),
      '',
      120,
      configHook,
    );

    try {
      const { ops, mpc } = client.connected();
      assert.equal(ops, true, 'ops websocket not connected');
      assert.equal(mpc, true, 'mpc websocket not connected');

      const symbol = envOr('TEST_OPS_SYMBOL', 'BTC');
      const expectedPrefix = envOr('TEST_BTC_ADDRESS_PREFIX', 'bcrt1');

      const wallets = await client.findWalletList({}) as { result?: CliWalletRow[] };
      const mpcWallet = wallets.result?.[0];
      assert.ok(mpcWallet?.walletID, 'no MPC wallets; start broker + nodes first');
      console.log(
        `mpc walletID=${mpcWallet.walletID} rootPath=${mpcWallet.rootPath} algorithm=${mpcWallet.algorithm}`,
      );

      const alias = `btc-wallet-${Math.floor(Date.now() / 1000)}`;
      try {
        await client.createWallet({
          walletID: mpcWallet.walletID,
          rootPath: mpcWallet.rootPath,
          alias,
          algorithm: mpcWallet.algorithm,
        });
      } catch (error) {
        if (!isAlreadyExistsErr(error)) throw error;
      }
      console.log(`OPS wallet registered alias=${alias}`);

      let lastAccountIndex = -1;
      try {
        const existing = await client.findAccountByWalletID({
          walletID: mpcWallet.walletID,
        }) as { result?: FindAccountRow[] };
        for (const row of existing.result ?? []) {
          const idx = Number(row.accountIndex ?? -1);
          if (idx > lastAccountIndex) lastAccountIndex = idx;
        }
      } catch {
        // optional lookup
      }

      let acc: CliCreateAccountRes | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        acc = await client.cliCreateAccount({
          walletID: mpcWallet.walletID,
          lastIndex: lastAccountIndex,
        }) as CliCreateAccountRes;
        assert.ok(acc.accountID, 'CliCreateAccount: missing accountID');
        try {
          await client.createAccount({
            walletID: mpcWallet.walletID,
            accountID: acc.accountID,
            alias: `btc-acct-${Math.floor(Date.now() / 1000)}-${attempt}`,
            symbol,
            publicKey: acc.publicKey,
            accountIndex: acc.accountIndex,
            hdPath: acc.hdPath,
            reqSigs: acc.reqSigs,
          });
          break;
        } catch (error) {
          if (isAlreadyExistsErr(error)) break;
          if (isAccountIndexMismatchErr(error)) {
            lastAccountIndex = Math.max(lastAccountIndex, Number(acc.accountIndex ?? -1));
            continue;
          }
          throw error;
        }
      }
      assert.ok(acc?.accountID, 'CliCreateAccount: missing accountID after retries');
      console.log(
        `CLI accountID=${acc.accountID} accountIndex=${acc.accountIndex} hdPath=${acc.hdPath} pub=${acc.publicKey}`,
      );
      console.log(`OPS account created symbol=${symbol} accountID=${acc.accountID}`);

      const addrs = await client.cliCreateAddress({
        walletID: mpcWallet.walletID,
        accountID: acc.accountID,
        accountIndex: acc.accountIndex,
        mainSymbol: symbol,
        lastIndex: -1,
        count: 1,
        change: 0,
      }) as { addressList?: CliAddressItem[] };
      const addrItem = addrs.addressList?.[0];
      assert.ok(addrItem, 'CliCreateAddress: empty addressList');
      console.log(
        `CLI derived index=${addrItem.addressIndex} hdPath=${addrItem.hdPath} pub=${addrItem.addressPubHex}`,
      );

      let chainAddr = '';
      try {
        const importRes = await client.importAddress({
          accountID: acc.accountID,
          addresses: [
            {
              addrIndex: addrItem.addressIndex,
              publicKey: addrItem.addressPubHex,
              hdPath: addrItem.hdPath,
            },
          ],
        }) as { addresses?: ImportAddressItem[] };
        chainAddr = importRes.addresses?.[0]?.address ?? '';
      } catch (error) {
        if (!isAlreadyExistsErr(error)) throw error;
      }

      if (!chainAddr) {
        const found = await client.findAddressByAccountID({
          accountID: acc.accountID,
        }) as { result?: ImportAddressItem[] };
        assert.ok(found.result?.length, 'no on-chain address after ImportAddress');
        chainAddr = found.result![0]!.address ?? '';
      }
      assert.ok(chainAddr, 'empty chain address');

      const verify = await client.verifyAddress({ symbol, address: chainAddr }) as {
        result?: boolean;
      };
      assert.equal(verify.result, true, `VerifyAddress returned false for ${chainAddr}`);

      console.log('=== BTC address result ===');
      console.log(`symbol=${symbol}`);
      console.log(`walletID=${mpcWallet.walletID}`);
      console.log(`accountID=${acc.accountID}`);
      console.log(`hdPath=${addrItem.hdPath}`);
      console.log(`address=${chainAddr}`);
      console.log(`verify=${verify.result}`);

      if (expectedPrefix && !chainAddr.startsWith(expectedPrefix)) {
        assert.fail(
          `address prefix mismatch: got "${chainAddr}" want prefix "${expectedPrefix}"`,
        );
      }
    } finally {
      client.close();
    }
  },
);
