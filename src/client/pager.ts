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

export function clampPageLimit(path: string, req: object): void {
  if (!paginatedPaths.has(path)) return;
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
