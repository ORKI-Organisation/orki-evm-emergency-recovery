import type { NetworkConfig } from '../types';
import { 
  base, 
  polygon, 
  mainnet, 
  baseSepolia, 
  polygonAmoy, 
  sepolia,
  type Chain
} from 'viem/chains';

export const ENTRY_POINT_0_7 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;
export const ECDSA_VALIDATOR_V3_3 = '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57' as const;

export const ZERODEV_PROJECT_ID = '51922720-35d4-4b02-8573-990cb333b238';

export function getZeroDevBundlerUrl(chainId: number, projectId: string = ZERODEV_PROJECT_ID): string {
  const pid = (projectId || ZERODEV_PROJECT_ID).trim();
  if (!pid) return '';
  return `https://rpc.zerodev.app/api/v3/${pid}/chain/${chainId}`;
}

export const SUPPORTED_NETWORKS: NetworkConfig[] = [
  // Production mainnets
  {
    id: base.id, // 8453
    name: 'Base Mainnet',
    shortName: 'Base',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://mainnet.base.org',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorerUrl: 'https://basescan.org',
    isTestnet: false,
    knownTokens: [
      { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
      { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
      { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
      { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
      { address: '0x60a3E35Cc30DaA0070d69f89902Ce2D706380666', symbol: 'EURC', name: 'Euro Coin', decimals: 6 },
      { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', decimals: 8 },
    ],
  },
  {
    id: polygon.id, // 137
    name: 'Polygon Mainnet',
    shortName: 'Polygon',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrl: 'https://polygon-bor-rpc.publicnode.com',
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    explorerUrl: 'https://polygonscan.com',
    isTestnet: false,
    knownTokens: [
      { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC', name: 'USD Coin (Native)', decimals: 6 },
      { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC.e', name: 'Bridged USDC', decimals: 6 },
      { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
      { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
      { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WPOL', name: 'Wrapped POL', decimals: 18 },
      { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    ],
  },
  {
    id: mainnet.id, // 1
    name: 'Ethereum Mainnet',
    shortName: 'Ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://cloudflare-eth.com',
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    explorerUrl: 'https://etherscan.io',
    isTestnet: false,
    knownTokens: [
      { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
      { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
      { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
      { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
      { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
    ],
  },
  // Testnets
  {
    id: baseSepolia.id, // 84532
    name: 'Base Sepolia',
    shortName: 'Base Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorerUrl: 'https://sepolia.basescan.org',
    isTestnet: true,
    knownTokens: [
      { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', symbol: 'USDC', name: 'USD Coin (Testnet)', decimals: 6 },
      { address: '0x808456652fdb597867f38412077A9182bf77359F', symbol: 'EURC', name: 'Euro Coin (Testnet)', decimals: 6 },
      { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    ],
  },
  {
    id: polygonAmoy.id, // 80002
    name: 'Polygon Amoy',
    shortName: 'Polygon Amoy',
    nativeCurrency: { name: 'Amoy POL', symbol: 'POL', decimals: 18 },
    rpcUrl: 'https://polygon-amoy-bor-rpc.publicnode.com',
    usdcAddress: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    explorerUrl: 'https://amoy.polygonscan.com',
    isTestnet: true,
    knownTokens: [
      { address: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', symbol: 'USDC', name: 'USD Coin (Testnet)', decimals: 6 },
    ],
  },
  {
    id: sepolia.id, // 11155111
    name: 'Ethereum Sepolia',
    shortName: 'Ethereum Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    explorerUrl: 'https://sepolia.etherscan.io',
    isTestnet: true,
    knownTokens: [
      { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', name: 'USD Coin (Testnet)', decimals: 6 },
      { address: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4', symbol: 'EURC', name: 'Euro Coin (Testnet)', decimals: 6 },
      { address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06', symbol: 'USDT', name: 'Tether USD (Testnet)', decimals: 6 },
      { address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    ],
  },
];

export const VIEM_CHAINS: Record<number, Chain> = {
  [base.id]: base,
  [polygon.id]: polygon,
  [mainnet.id]: mainnet,
  [baseSepolia.id]: baseSepolia,
  [polygonAmoy.id]: polygonAmoy,
  [sepolia.id]: sepolia,
};

export const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;
