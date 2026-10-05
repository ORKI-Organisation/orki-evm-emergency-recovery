export interface KnownToken {
  address: `0x${string}`;
  symbol: string;
  name?: string;
  decimals: number;
}

export interface NetworkConfig {
  id: number;
  name: string;
  shortName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  defaultBundlerUrl?: string;
  usdcAddress: `0x${string}`;
  explorerUrl: string;
  isTestnet: boolean;
  knownTokens?: KnownToken[];
}

export type GasMode = 'native' | 'paymaster';

export type SweepMode = 'single' | 'batch';

export interface TokenItem {
  address: `0x${string}` | null; // null for native asset
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceRaw: bigint;
  isNative: boolean;
  isCustom?: boolean;
}

export interface AccountBalances {
  native: string;
  nativeRaw: bigint;
  usdc: string;
  usdcRaw: bigint;
  tokens: TokenItem[];
}

export type SweepStep = 
  | 'idle'
  | 'validating'
  | 'instantiating'
  | 'requesting_signature'
  | 'submitting_userop'
  | 'confirming_onchain'
  | 'success'
  | 'error';

export interface SweepItem {
  tokenAddress: `0x${string}` | null;
  symbol: string;
  decimals: number;
  amount: string;
  amountRaw: bigint;
  isNative: boolean;
}

export interface SweptAssetSummary {
  symbol: string;
  amount: string;
}

export interface SweepResult {
  txHash: string;
  userOpHash: string;
  explorerUrl: string;
  amount: string;
  asset: string;
  recipient: string;
  sweptAssets?: SweptAssetSummary[];
}
