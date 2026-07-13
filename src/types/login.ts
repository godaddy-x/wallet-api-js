export interface AppLoginReq {
  appID: string;
  sign: string;
  nonce: string;
  time: number;
  source: string;
}

export interface CliPlan2LoginReq {
  source: string;
}
