import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatUnits,
  formatEther,
  encodeFunctionData,
  isAddress,
  type Address,
} from 'viem';
import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from '@zerodev/sdk';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { getEntryPoint, KERNEL_V3_3 } from '@zerodev/sdk/constants';
import { VIEM_CHAINS, ERC20_ABI, SUPPORTED_NETWORKS } from '../constants/networks';
import type { AccountBalances, GasMode, NetworkConfig, SweepItem, SweepResult, SweepStep, TokenItem } from '../types';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
      on?: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}

export function getNetwork(chainId: number): NetworkConfig {
  const found = SUPPORTED_NETWORKS.find((n) => n.id === chainId);
  if (!found) throw new Error(`Network with chain ID ${chainId} not supported`);
  return found;
}

export async function connectWallet(): Promise<Address> {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No Web3 wallet extension found (MetaMask, Rabby, Coinbase Wallet, etc.). Please install one.');
  }
  const accounts = (await window.ethereum.request({
    method: 'eth_requestAccounts',
  })) as string[];

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts authorized in your wallet.');
  }
  return accounts[0] as Address;
}

export async function switchWalletNetwork(chainId: number): Promise<void> {
  if (!window.ethereum) return;
  const hexChainId = `0x${chainId.toString(16)}`;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  } catch (error: unknown) {
    const err = error as { code?: number };
    if (err.code === 4902) {
      const net = getNetwork(chainId);
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: hexChainId,
            chainName: net.name,
            nativeCurrency: net.nativeCurrency,
            rpcUrls: [net.rpcUrl],
            blockExplorerUrls: [net.explorerUrl],
          },
        ],
      });
    } else {
      throw error;
    }
  }
}

// Fetch single custom token metadata & balance
export async function fetchCustomTokenMetadata(
  chainId: number,
  rpcUrl: string,
  accountAddress: Address,
  tokenAddress: Address
): Promise<TokenItem> {
  if (!isAddress(tokenAddress)) {
    throw new Error('Invalid token address');
  }

  const chain = VIEM_CHAINS[chainId];
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const code = await publicClient.getBytecode({ address: tokenAddress });
  if (!code || code === '0x') {
    throw new Error('The specified address is not a contract on this network.');
  }

  const results = await publicClient.multicall({
    contracts: [
      {
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [accountAddress],
      },
      {
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'decimals',
      },
      {
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'symbol',
      },
    ],
    allowFailure: true,
  });

  const balanceRaw = results[0]?.status === 'success' ? (results[0].result as bigint) : 0n;
  const decimals = results[1]?.status === 'success' ? (results[1].result as number) : 18;
  const symbol = results[2]?.status === 'success' ? (results[2].result as string) : 'TOKEN';

  return {
    address: tokenAddress,
    symbol,
    name: symbol,
    decimals,
    balance: formatUnits(balanceRaw, decimals),
    balanceRaw,
    isNative: false,
    isCustom: true,
  };
}

export async function fetchBalances(
  chainId: number,
  rpcUrl: string,
  accountAddress: Address,
  extraTokenAddresses: Address[] = []
): Promise<AccountBalances> {
  const chain = VIEM_CHAINS[chainId];
  const network = getNetwork(chainId);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // 1. Query Native Balance
  let nativeRaw = 0n;
  try {
    nativeRaw = await publicClient.getBalance({ address: accountAddress });
  } catch (e) {
    console.warn('Failed to fetch native balance:', e);
  }
  const native = formatEther(nativeRaw);

  const nativeItem: TokenItem = {
    address: null,
    symbol: network.nativeCurrency.symbol,
    name: network.nativeCurrency.name,
    decimals: network.nativeCurrency.decimals,
    balance: native,
    balanceRaw: nativeRaw,
    isNative: true,
  };

  // 2. Aggregate known tokens and extra tokens
  const tokenMap = new Map<string, { address: Address; symbol: string; name?: string; decimals: number }>();

  // Primary USDC
  tokenMap.set(network.usdcAddress.toLowerCase(), {
    address: network.usdcAddress,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  });

  // Known curated network tokens
  if (network.knownTokens) {
    for (const kt of network.knownTokens) {
      tokenMap.set(kt.address.toLowerCase(), kt);
    }
  }

  // Extra tokens (from config / URL / user input)
  const unknownTokensToQuery: Address[] = [];
  for (const rawAddr of extraTokenAddresses) {
    if (!isAddress(rawAddr)) continue;
    const lower = rawAddr.toLowerCase();
    if (!tokenMap.has(lower)) {
      unknownTokensToQuery.push(rawAddr as Address);
    }
  }

  // 3. Batch query balanceOf for known tokens
  const knownTokensList = Array.from(tokenMap.values());
  const multicallContracts: {
    address: Address;
    abi: typeof ERC20_ABI;
    functionName: 'balanceOf' | 'decimals' | 'symbol';
    args?: readonly unknown[];
  }[] = [];

  for (const token of knownTokensList) {
    multicallContracts.push({
      address: token.address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [accountAddress],
    });
  }

  // For unknown tokens, query balanceOf, decimals, symbol (3 calls each)
  for (const addr of unknownTokensToQuery) {
    multicallContracts.push(
      { address: addr, abi: ERC20_ABI, functionName: 'balanceOf', args: [accountAddress] },
      { address: addr, abi: ERC20_ABI, functionName: 'decimals' },
      { address: addr, abi: ERC20_ABI, functionName: 'symbol' }
    );
  }

  let multicallResults: ({ status: 'success' | 'failure'; result?: unknown })[] = [];
  if (multicallContracts.length > 0) {
    try {
      multicallResults = await publicClient.multicall({
        contracts: multicallContracts as never,
        allowFailure: true,
      });
    } catch (e) {
      console.warn('Multicall token balance check failed:', e);
    }
  }

  const tokenItems: TokenItem[] = [nativeItem];
  let usdcRaw = 0n;
  let usdc = '0.00';

  // Parse known token results
  knownTokensList.forEach((token, idx) => {
    const res = multicallResults[idx];
    const balanceRaw = res?.status === 'success' ? (res.result as bigint) : 0n;
    const formatted = formatUnits(balanceRaw, token.decimals);

    if (token.address.toLowerCase() === network.usdcAddress.toLowerCase()) {
      usdcRaw = balanceRaw;
      usdc = formatted;
    }

    tokenItems.push({
      address: token.address,
      symbol: token.symbol,
      name: token.name || token.symbol,
      decimals: token.decimals,
      balance: formatted,
      balanceRaw,
      isNative: false,
    });
  });

  // Parse unknown token results
  let unknownOffset = knownTokensList.length;
  unknownTokensToQuery.forEach((addr) => {
    const balRes = multicallResults[unknownOffset];
    const decRes = multicallResults[unknownOffset + 1];
    const symRes = multicallResults[unknownOffset + 2];
    unknownOffset += 3;

    if (balRes?.status === 'success') {
      const balanceRaw = balRes.result as bigint;
      const decimals = decRes?.status === 'success' ? (decRes.result as number) : 18;
      const symbol = symRes?.status === 'success' ? (symRes.result as string) : 'TOKEN';
      const formatted = formatUnits(balanceRaw, decimals);

      tokenItems.push({
        address: addr,
        symbol,
        name: symbol,
        decimals,
        balance: formatted,
        balanceRaw,
        isNative: false,
        isCustom: true,
      });
    }
  });

  // Sort: Tokens with non-zero balance first, then native & USDC, then rest
  tokenItems.sort((a, b) => {
    const aHasBal = a.balanceRaw > 0n;
    const bHasBal = b.balanceRaw > 0n;
    if (aHasBal && !bHasBal) return -1;
    if (!aHasBal && bHasBal) return 1;
    if (a.isNative) return -1;
    if (b.isNative) return 1;
    if (a.symbol === 'USDC') return -1;
    if (b.symbol === 'USDC') return 1;
    return a.symbol.localeCompare(b.symbol);
  });

  return {
    native,
    nativeRaw,
    usdc,
    usdcRaw,
    tokens: tokenItems,
  };
}

export interface SweepParams {
  chainId: number;
  rpcUrl: string;
  bundlerUrl: string;
  kernelAddress: Address;
  signerAddress: Address;
  recipientAddress: Address;
  items: SweepItem[];
  gasMode: GasMode;
  onStepChange: (step: SweepStep, message: string) => void;
}

export async function executeSweep(params: SweepParams): Promise<SweepResult> {
  const {
    chainId,
    rpcUrl,
    bundlerUrl,
    kernelAddress,
    signerAddress,
    recipientAddress,
    items,
    gasMode,
    onStepChange,
  } = params;

  if (!window.ethereum) {
    throw new Error('Web3 wallet is required to sign the recovery UserOperation.');
  }

  if (!items || items.length === 0) {
    throw new Error('No assets selected to sweep.');
  }

  onStepChange('validating', `Validating ${items.length} recovery asset transfer(s)...`);
  const chain = VIEM_CHAINS[chainId];
  const network = getNetwork(chainId);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account: signerAddress,
    chain,
    transport: custom(window.ethereum),
  });

  onStepChange('instantiating', 'Instantiating Kernel v3.3 smart account with ECDSA recovery validator...');
  const entryPoint = getEntryPoint('0.7');

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: walletClient as unknown as Parameters<typeof signerToEcdsaValidator>[1]['signer'],
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });

  let kernelAccount;
  try {
    kernelAccount = await createKernelAccount(publicClient, {
      plugins: {
        regular: ecdsaValidator,
        isPreInstalled: true,
      },
      entryPoint,
      kernelVersion: KERNEL_V3_3,
      address: kernelAddress,
    });
  } catch {
    kernelAccount = await createKernelAccount(publicClient, {
      plugins: {
        sudo: ecdsaValidator,
      },
      entryPoint,
      kernelVersion: KERNEL_V3_3,
      address: kernelAddress,
    });
  }

  onStepChange(
    'requesting_signature',
    items.length > 1
      ? `Encoding batch transfer of ${items.length} assets and requesting wallet signature...`
      : `Encoding transfer of ${items[0].symbol} and requesting wallet signature...`
  );

  // Construct calls array for atomic batch UserOperation
  const calls: { to: Address; value: bigint; data: `0x${string}` }[] = [];

  for (const item of items) {
    if (item.amountRaw <= 0n) continue;

    if (item.isNative || !item.tokenAddress) {
      calls.push({
        to: recipientAddress,
        value: item.amountRaw,
        data: '0x' as const,
      });
    } else {
      calls.push({
        to: item.tokenAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [recipientAddress, item.amountRaw],
        }),
      });
    }
  }

  if (calls.length === 0) {
    throw new Error('All selected assets have an effective amount of 0.');
  }

  // Configure Client based on Gas Strategy
  const kernelClient = createKernelAccountClient({
    account: kernelAccount,
    chain,
    bundlerTransport: http(bundlerUrl),
    client: publicClient,
    userOperation: {
      estimateFeesPerGas: async ({ bundlerClient }) => {
        try {
          const res = (await bundlerClient.request({
            method: 'zd_getUserOperationGasPrice' as unknown as 'eth_estimateUserOperationGas',
            params: [] as unknown as never,
          })) as { standard: { maxFeePerGas: string; maxPriorityFeePerGas: string } };
          if (res?.standard?.maxFeePerGas) {
            return {
              maxFeePerGas: BigInt(res.standard.maxFeePerGas),
              maxPriorityFeePerGas: BigInt(res.standard.maxPriorityFeePerGas),
            };
          }
        } catch {
          // Bundler or node does not support zd_getUserOperationGasPrice, fallback to standard fee data
        }
        const feeData = await publicClient.estimateFeesPerGas();
        return {
          maxFeePerGas: feeData.maxFeePerGas ?? 1000000000n,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 100000000n,
        };
      },
    },
    ...(gasMode === 'paymaster'
      ? {
          paymaster: {
            getPaymasterData: (userOperation) => {
              const paymaster = createZeroDevPaymasterClient({
                chain,
                transport: http(bundlerUrl),
              });
              return paymaster.sponsorUserOperation({ userOperation });
            },
          },
        }
      : {}),
  });

  onStepChange('submitting_userop', 'Submitting atomic UserOperation to ERC-4337 Bundler...');
  const userOpHash = await kernelClient.sendUserOperation({
    callData: await kernelAccount.encodeCalls(calls),
  });

  onStepChange('confirming_onchain', `UserOp submitted (${userOpHash.slice(0, 10)}...). Waiting for block confirmation...`);
  const receipt = await kernelClient.waitForUserOperationReceipt({
    hash: userOpHash,
  });

  const txHash = receipt.receipt.transactionHash;

  onStepChange(
    'success',
    items.length > 1
      ? `Successfully swept ${items.length} assets on-chain in 1 transaction!`
      : `Successfully swept ${items[0].amount} ${items[0].symbol} on-chain!`
  );

  return {
    txHash,
    userOpHash,
    explorerUrl: `${network.explorerUrl}/tx/${txHash}`,
    amount: items.length === 1 ? items[0].amount : `${items.length} assets`,
    asset: items.length === 1 ? items[0].symbol : 'Batch Recovery',
    recipient: recipientAddress,
    sweptAssets: items.map((i) => ({ symbol: i.symbol, amount: i.amount })),
  };
}
