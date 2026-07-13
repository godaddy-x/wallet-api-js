import type { RawTransaction } from '../types/trade.js';

function trim(value: string): string {
  return value.trim();
}

function parseAddrAmountLine(line: string): { addr: string; amt: string } | null {
  const trimmed = trim(line);
  const idx = trimmed.lastIndexOf(':');
  if (idx <= 0) {
    return null;
  }
  return {
    addr: trim(trimmed.slice(0, idx)),
    amt: trim(trimmed.slice(idx + 1)),
  };
}

function amountStringsEqual(a: string, b: string): boolean {
  const sa = trim(a);
  const sb = trim(b);
  const na = Number(sa);
  const nb = Number(sb);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return na === nb;
  }
  return sa === sb;
}

function isZeroAmount(value: string): boolean {
  const n = Number(trim(value));
  return Number.isFinite(n) && n === 0;
}

function txFromAddresses(txFrom: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const line of txFrom ?? []) {
    const idx = line.indexOf(':');
    const addr = idx >= 0 ? trim(line.slice(0, idx)) : trim(line);
    if (addr) {
      out.add(addr);
    }
  }
  return out;
}

function maxAllowedExtraOutputs(symbol: string): number {
  return symbol.toUpperCase() === 'BTC' ? 1 : 0;
}

function validateExactPendingOutputs(
  tx: RawTransaction,
  to: Record<string, string>,
  maxExtra: number,
): void {
  const wantLines = new Set<string>();
  for (const [addr, amt] of Object.entries(to)) {
    wantLines.add(`${trim(addr)}:${trim(amt)}`);
  }
  const found = new Set<string>();
  for (const line of tx.txTo ?? []) {
    if (wantLines.has(line)) {
      found.add(line);
    }
  }
  if (found.size !== wantLines.size) {
    for (const line of wantLines) {
      if (!found.has(line)) {
        throw new Error(`missing tx.To entry "${line}" in ${JSON.stringify(tx.txTo)}`);
      }
    }
  }
  const extra = (tx.txTo?.length ?? 0) - found.size;
  if (extra > maxExtra) {
    throw new Error(
      `unexpected extra outputs in tx.To: got ${tx.txTo?.length ?? 0} entries, want ${wantLines.size} (+ at most ${maxExtra} change)`,
    );
  }
}

function validateBTCPendingOutputs(tx: RawTransaction, to: Record<string, string>): void {
  const want = new Map<string, string>();
  for (const [addr, amt] of Object.entries(to)) {
    want.set(trim(addr), trim(amt));
  }
  const found = new Set<string>();
  const extraLines: string[] = [];
  const inputAddrs = txFromAddresses(tx.txFrom);

  for (const line of tx.txTo ?? []) {
    const parsed = parseAddrAmountLine(line);
    if (!parsed) {
      throw new Error(`invalid tx.To line "${line}"`);
    }
    const wantAmt = want.get(parsed.addr);
    if (wantAmt !== undefined) {
      if (isZeroAmount(wantAmt)) {
        if (!inputAddrs.has(parsed.addr)) {
          throw new Error(`cancel output not owned by input addresses: ${parsed.addr}`);
        }
        found.add(parsed.addr);
        continue;
      }
      if (!amountStringsEqual(wantAmt, parsed.amt)) {
        throw new Error(
          `tx.To amount mismatch for ${parsed.addr}: got "${parsed.amt}" want "${wantAmt}"`,
        );
      }
      found.add(parsed.addr);
      continue;
    }
    extraLines.push(line);
  }

  for (const addr of want.keys()) {
    if (!found.has(addr)) {
      throw new Error(`missing tx.To entry for "${addr}" in ${JSON.stringify(tx.txTo)}`);
    }
  }
  if (extraLines.length > 1) {
    throw new Error(
      `unexpected extra outputs in tx.To: got ${tx.txTo?.length ?? 0} entries, want ${want.size} (+ at most 1 change)`,
    );
  }
  if (extraLines.length === 1) {
    const parsed = parseAddrAmountLine(extraLines[0] ?? '');
    if (!parsed) {
      throw new Error(`invalid change output line "${extraLines[0]}"`);
    }
    if (!inputAddrs.has(parsed.addr)) {
      throw new Error(`change output not owned by input addresses: ${parsed.addr}`);
    }
  }
}

export function validateRawTradePending(
  tx: RawTransaction,
  sid: string,
  fromAccountID: string,
  symbol: string,
  contractAddress: string,
  to: Record<string, string>,
): void {
  if (tx.sid !== sid) {
    throw new Error('sid invalid');
  }
  if (tx.coin?.symbol !== symbol) {
    throw new Error('symbol invalid');
  }
  if ((tx.coin?.contract?.address ?? '') !== contractAddress) {
    throw new Error('contractAddress invalid');
  }
  if (tx.account?.accountID !== fromAccountID) {
    throw new Error(
      `accountID invalid, got=${tx.account?.accountID ?? ''} want=${fromAccountID}`,
    );
  }
  if (symbol.toUpperCase() === 'BTC') {
    validateBTCPendingOutputs(tx, to);
    return;
  }
  validateExactPendingOutputs(tx, to, maxAllowedExtraOutputs(symbol));
}

export function validateSummaryRawPending(
  tx: RawTransaction,
  sid: string,
  accountID: string,
  symbol: string,
  target: string,
): void {
  if (!tx.sid?.startsWith(sid)) {
    throw new Error(`sid invalid, got=${tx.sid ?? ''} want prefix=${sid}`);
  }
  if (tx.coin?.symbol !== symbol) {
    throw new Error('symbol invalid');
  }
  if (tx.account?.accountID !== accountID) {
    throw new Error(
      `accountID invalid, got=${tx.account?.accountID ?? ''} want=${accountID}`,
    );
  }
  const toEntries = tx.txTo ?? [];
  if (toEntries.length !== 1) {
    throw new Error(`summary tx target count=${toEntries.length} want 1`);
  }
  const parsed = parseAddrAmountLine(toEntries[0] ?? '');
  if (!parsed) {
    throw new Error(`invalid summary tx.To line "${toEntries[0]}"`);
  }
  if (parsed.addr.toLowerCase() !== trim(target).toLowerCase()) {
    throw new Error(`summary target mismatch, got=${parsed.addr} want=${target}`);
  }
}
