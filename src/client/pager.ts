export const DEFAULT_PAGE_LIMIT = 200;

const paginatedPaths = new Set([
  '/api/FindAccountByWalletID',
  '/api/GetAccountBalanceList',
  '/api/FindAddressByAccountID',
  '/api/GetAddressBalanceList',
  '/api/GetContracts',
  '/api/GetContractTemplates',
  '/api/SymbolBlockList',
  '/api/FindTradeLog',
  '/api/FindBalanceLog',
  '/api/FindMonitorAlert',
  '/api/FindWalletList',
]);

/** Fields that api_main BaseReq expects as JSON numbers (Go int64), not quoted strings. */
const wireInt64Keys = new Set(['lastID', 'prevID', 'offset', 'limit', 'id']);

/**
 * Convert decimal string / number snowflake IDs to BigInt so json-bigint
 * (useNativeBigInt) emits unquoted JSON numbers that easyjson Int64() accepts.
 */
export function coerceWireInt64Fields(req: object): void {
  const record = req as Record<string, unknown>;
  for (const key of wireInt64Keys) {
    const value = record[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'bigint') continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (!Number.isSafeInteger(value)) {
        record[key] = BigInt(Math.trunc(value));
      }
      continue;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      record[key] = BigInt(value.trim());
    }
  }
}

export function clampPageLimit(path: string, req: object): void {
  if (!paginatedPaths.has(path)) return;
  coerceWireInt64Fields(req);
  const record = req as Record<string, unknown>;
  const limit = Number(record.limit ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    record.limit = DEFAULT_PAGE_LIMIT;
    return;
  }
  if (limit > DEFAULT_PAGE_LIMIT) {
    record.limit = DEFAULT_PAGE_LIMIT;
  }
}
