export interface JsonBody {
  d: string;
  n: string;
  s: string;
  e?: string;
  r: string;
  t: number;
  p: number;
  u: number | bigint;
}

export interface JsonResp {
  m?: string;
  d: string;
  n: string;
  s: string;
  e?: string;
  r?: string;
  c: number;
  t: number;
  p: number;
}

export interface PublicKeyPayload {
  key: string;
  tag: string;
  noc: string;
  sig: string;
  exp: number;
  usr: number | bigint;
}

export interface AuthToken {
  token: string;
  secret: string;
  expired: number;
}

export function planRequiresOuterSignature(plan: number): boolean {
  return plan === 2;
}

export function jsonBodyRequiresOuterSignature(plan: number, plan2KeyBootstrap = false): boolean {
  if (plan === 2) return true;
  return plan2KeyBootstrap && plan === 0;
}
