# Wallet API SDK (JavaScript)

Node.js SDK for **OPS** and **MPC** WebSocket integration: signed transfers, wallet lifecycle, and MPC signing.

## Requirements

- Node.js **18+** (Web Crypto API)
- **Node.js only** — backend services and scripts; not for browsers
- Reachable **OPS** and/or **MPC broker** endpoints

---

## Install

### From npm (recommended)

Pin a release version in production:

```bash
npm install @godaddy-x/wallet-api-js@0.1.0
```

Prefer an exact version in `package.json` when integrating against a live OPS/MPC stack.

### From GitHub

Install directly from the repository (tag or commit):

```bash
# By release tag
npm install github:godaddy-x/wallet-api-js#v0.1.0

# By commit
npm install github:godaddy-x/wallet-api-js#abcdef1234567890
```

### Local development

```bash
git clone https://github.com/godaddy-x/wallet-api-js.git
cd wallet-api-js
npm install
npm run build
```

---

## Third-party integration

### Credentials from the platform operator

The SDK does not mint credentials. Request the following from whoever operates OPS/MPC:

| Item | Used for |
|------|----------|
| OPS host (`domain`) | OPS WebSocket endpoint |
| MPC host (`domain`) | MPC WebSocket endpoint |
| `appID` | OPS app identity |
| `appKey` (hex) | OPS login HMAC + transfer `dataSign` validation |
| `clientNo` | ML-DSA user id on OPS (use a **string** in JSON if it exceeds JS safe integers) |
| `clientPrk` / `serverPub` | ML-DSA key pair for Plan2 login |
| MPC `clientNo`, `clientPrk`, `serverPub` | MPC broker session |
| IP whitelist entry | Required for non-loopback OPS clients |

Store secrets in environment variables or a secret manager. Never commit `appKey`, `clientPrk`, or private keys.

### Configuration files

Sample shapes ship in `config/`. Replace values with credentials issued for your app.

**OPS — `ops.json`**

```json
{
  "domain": "ops.example.com",
  "keyPath": "/api/PublicKey",
  "loginPath": "/api/Login",
  "appID": "your-app-id",
  "appKey": "hex-encoded-app-key",
  "clientNo": "202606271558577948",
  "ssl": false,
  "clientPrk": "base64-mldsa-private-key",
  "serverPub": "base64-mldsa-server-public-key"
}
```

**MPC — `cli.json`**

```json
{
  "domain": "mpc.example.com",
  "keyPath": "/api/PublicKey",
  "loginPath": "/api/Login",
  "clientNo": 3,
  "source": "your-app-id",
  "clientPrk": "base64-mldsa-private-key",
  "serverPub": "base64-mldsa-server-public-key",
  "ssl": false
}
```

Notes:

- `domain` is the host (and port, if required) issued by the platform operator.
- OPS login uses `appID` + `appKey` (HMAC: **data** = app key bytes, **key** = `nonce + time + source`).
- MPC Plan2 login uses `source` when no app key is configured on the MPC side.
- Large `clientNo` values **must** be JSON strings to avoid precision loss.

### Quick start — connect and transfer

```ts
import { WalletClient } from '@godaddy-x/wallet-api-js';

const client = await WalletClient.fromFiles(
  'config/ops.json',
  'config/cli.json',
  process.env.APP_KEY ?? '',
  300,
);

try {
  const { ops, mpc } = client.connected();
  if (!ops || !mpc) throw new Error('OPS and MPC must both be connected');

  const { result, timings } = await client.transfer(
    fromAccountID,
    { [toAddress]: amount },
    'ETH',
    '',
  );

  console.log(result.txID, result.status, timings);
} finally {
  client.close();
}
```

`transfer()` runs **OPS CreateTrade → MPC SignTransaction → OPS SubmitTrade**.

Connect only one side with an empty path:

```ts
const opsOnly = await WalletClient.fromFiles('config/ops.json', '', appKey, 300);
const mpcOnly = await WalletClient.fromFiles('', 'config/cli.json', '', 300);
```

### Programmatic configuration

```ts
import { WalletClient } from '@godaddy-x/wallet-api-js';

const client = await WalletClient.create({
  appKey: process.env.APP_KEY,
  wsTimeoutSec: 300,
  ops: {
    domain: process.env.OPS_DOMAIN!,
    appID: process.env.APP_ID!,
    appKey: process.env.APP_KEY!,
    clientNo: process.env.CLIENT_NO!,
    clientPrk: process.env.CLIENT_PRK!,
    serverPub: process.env.SERVER_PUB!,
    ssl: false,
  },
  mpc: {
    domain: process.env.MPC_DOMAIN!,
    clientNo: 3,
    source: process.env.APP_ID!,
    clientPrk: process.env.MPC_CLIENT_PRK!,
    serverPub: process.env.MPC_SERVER_PUB!,
    ssl: false,
  },
});
```

Runtime overrides:

```ts
await WalletClient.fromFiles(opsPath, mpcPath, appKey, 300, (cfg) => {
  if (process.env.OPS_DOMAIN) cfg.ops!.domain = process.env.OPS_DOMAIN;
  if (process.env.MPC_DOMAIN) cfg.mpc!.domain = process.env.MPC_DOMAIN;
  if (process.env.APP_KEY) {
    cfg.appKey = process.env.APP_KEY;
    cfg.ops!.appKey = process.env.APP_KEY;
  }
});
```

### Wallet onboarding

```ts
const wallets = await client.findWalletList({});
const w = wallets.result![0];

await client.createWallet({
  walletID: w.walletID,
  rootPath: w.rootPath,
  alias: 'my-wallet',
  algorithm: w.algorithm,
});

const acc = await client.cliCreateAccount({ walletID: w.walletID, lastIndex: -1 });

await client.createAccount({
  walletID: w.walletID,
  accountID: acc.accountID,
  alias: 'my-account',
  symbol: 'BTC',
  publicKey: acc.publicKey,
  accountIndex: acc.accountIndex,
  hdPath: acc.hdPath,
  reqSigs: acc.reqSigs,
});

const addrs = await client.cliCreateAddress({
  walletID: w.walletID,
  accountID: acc.accountID,
  accountIndex: acc.accountIndex,
  mainSymbol: 'BTC',
  lastIndex: -1,
  count: 1,
  change: 0,
});

const item = addrs.addressList![0];
await client.importAddress({
  accountID: acc.accountID,
  addresses: [
    { addrIndex: item.addressIndex, publicKey: item.addressPubHex, hdPath: item.hdPath },
  ],
});
```

### TypeScript and ESM

ESM package (`"type": "module"`). Types ship in `dist/index.d.ts`.

```ts
import { WalletClient, type CreateTradeReq } from '@godaddy-x/wallet-api-js';
```

### Security

- Do not log or persist `appKey`, `clientPrk`, or JWT secrets.
- OPS enforces client IP whitelist for non-loopback callers.
- Session: Plan2 login → JWT → encrypted business messages (`p=1`).
- With `appKey` set, default trade hooks verify `pendingSignTx.dataSign` before MPC signing.
- Call `client.close()` on shutdown.

### Versioning

1. Pin an exact npm version in production.
2. Read release notes before upgrading.
3. Run integration tests against your OPS/MPC stack after any bump.

---

## Protocol

| Phase | Plan | Transport |
|-------|------|-----------|
| Plan2 bootstrap + login | `p=2` | WebSocket `/ws` + ML-KEM + ML-DSA + AES-GCM |
| Post-login business | `p=1` | JWT `Authorization` + AES-GCM body |
| Heartbeat | `p=0` | `/ws/ping` |

---

## API surface

| Area | Methods |
|------|---------|
| Lifecycle | `WalletClient.create`, `WalletClient.fromFiles`, `connected`, `close`, `transfer` |
| OPS | `createWallet`, `createAccount`, `createTrade`, `submitTrade`, `importAddress`, … |
| MPC | `findWalletList`, `cliCreateAccount`, `cliCreateAddress`, `signTransaction` |
| Log watch | `watchTradeLog`, `watchBalanceLog`, `watchMonitorAlert` |
| Trade hooks | `addTradeCreatedHook`, `validatePendingDataSignHook`, … |

All methods require a non-null request; `null`/`undefined` throws `ERR_NIL_REQUEST`. Low-level transport: `SocketSDK` export.

---

## Trade hooks

```ts
const client = await WalletClient.create({
  appKey: process.env.APP_KEY,
  ops,
  mpc,
  disableDefaultTradeHooks: false,
});

client.addTradeCreatedHook(async (ctx) => {
  console.log(ctx.kind, ctx.pending.length);
});
```

---

## Log watch

```ts
const ac = new AbortController();
void client.watchTradeLog(ac.signal, lastID, async (row) => {
  console.log(row.id, row.txID, row.status);
});
ac.abort();
```

---

## Layout

| Path | Purpose |
|------|---------|
| `src/crypto/` | AES-GCM, ML-KEM, ML-DSA, HMAC |
| `src/protocol/` | JsonBody, Plan2, PublicKey |
| `src/transport/` | WebSocket client |
| `src/client/` | `WalletClient` facade |
| `src/types/` | TypeScript DTOs |
| `config/` | Sample `ops.json` / `cli.json` |

---

## Tests

```bash
npm test
RUN_INTEGRATION=1 npm run test:integration
RUN_BTC_WALLET_ADDRESS=1 npm run test:btc-wallet-address
```

### BTC scanner regression (parity with wallet-api-go)

Full suite (bitcoind regtest + mongo + scanner-btc + api/mpc). Reuses sibling `wallet-api-go/scripts` for wait-sync / lock release / health audits.

```powershell
# Full run
.\scripts\run_btc_regression.ps1

# Or via npm
npm run test:btc-regression

# Re-run E2E only (account already funded)
.\scripts\run_btc_regression.ps1 -SkipConnect -SkipWalletSetup -SkipFund -SkipBitcoindSetup
```

Individual gates (set `RUN_OPS_WRITE=1 RUN_OPS_SUBMIT=1 RUN_OPS_TRANSFER=1` plus one of):

| Env | npm script | Coverage |
|-----|------------|----------|
| `RUN_BTC_TRANSFER_E2E` | `test:btc-transfer` | Transfer + RBF cancel/speed-up |
| `RUN_BTC_DUST_CHANGE_E2E` | `test:btc-dust` | Dust→fee + scanner fee closed-loop |
| `RUN_BTC_INTERNAL_TRANSFER_E2E` | `test:btc-internal` | Managed→managed → `internal`(+fee) logs |
| `RUN_BTC_SUMMARY_MULTI_E2E` | `test:btc-summary-multi` | Multi-payer send+fee trade_log shape |
| `RUN_BTC_SUMMARY_E2E` | `test:btc-summary` | CreateSummaryTx + mine |
| `RUN_BTC_BALANCE_AUDIT` | `test:btc-balance-audit` | No negative balances |

Checklist: [`integration/BTC_SCANNER_REGRESSION.md`](integration/BTC_SCANNER_REGRESSION.md).

Also set `TEST_OPS_ACCOUNT_ID` / `TEST_OPS_ADDRESS` for funded account. Optional: `TEST_OPS_DOMAIN`, `TEST_MPC_DOMAIN`, `TEST_APP_KEY`.

---

## License

MIT
