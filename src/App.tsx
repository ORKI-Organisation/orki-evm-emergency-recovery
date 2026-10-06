import { useState, useEffect, useCallback, useMemo } from 'react';
import { isAddress, parseUnits, parseEther, type Address } from 'viem';
import {
  Globe,
  Wallet,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ArrowUpRight,
  Fuel,
  PlusCircle,
  Coins,
  Zap,
  CheckSquare,
  Square,
  X,
} from 'lucide-react';
import { Header } from './components/Header';
import {
  connectWallet,
  fetchBalances,
  fetchCustomTokenMetadata,
  switchWalletNetwork,
  executeSweep,
  getNetwork,
} from './services/recoveryService';
import {
  getStoredTokens,
  saveStoredTokens,
  discoverAccountTokens,
} from './services/tokenDiscoveryService';
import { SUPPORTED_NETWORKS, getZeroDevBundlerUrl, ENTRY_POINT_0_7, ZERODEV_PROJECT_ID } from './constants/networks';
import { parseMetaMaskError, type FormattedError } from './utils/parseMetamaskError';
import type { AccountBalances, GasMode, SweepItem, SweepMode, SweepResult, SweepStep, TokenItem } from './types';

// Dynamic initial state helpers supporting Query Params, Hash Fragments, and Pre-baked Offline configs
function getInitialChainId(): number {
  if (typeof window === 'undefined') return SUPPORTED_NETWORKS[0]?.id || 8453;

  // 1. Pre-injected config (for offline single-file bundles)
  const preConfig = (window as unknown as { __ORKI_RECOVERY_CONFIG__?: { chainId?: number; chain?: number } }).__ORKI_RECOVERY_CONFIG__;
  if (preConfig?.chainId && SUPPORTED_NETWORKS.some((n) => n.id === preConfig.chainId)) return preConfig.chainId;
  if (preConfig?.chain && SUPPORTED_NETWORKS.some((n) => n.id === preConfig.chain)) return preConfig.chain;

  // 2. Query parameter (?chain=... or ?chainId=...)
  const urlParams = new URLSearchParams(window.location.search);
  const chainParam = urlParams.get('chain') || urlParams.get('chainId');
  if (chainParam) {
    const parsed = parseInt(chainParam, 10);
    if (SUPPORTED_NETWORKS.some((n) => n.id === parsed)) return parsed;
  }

  // 3. Hash parameter (#chain=... or #chainId=...)
  if (window.location.hash) {
    const rawHash = window.location.hash.replace(/^#\/?/, '').trim();
    const hashParams = new URLSearchParams(rawHash.includes('?') ? rawHash.split('?')[1] : rawHash);
    const hashChain = hashParams.get('chain') || hashParams.get('chainId');
    if (hashChain) {
      const parsed = parseInt(hashChain, 10);
      if (SUPPORTED_NETWORKS.some((n) => n.id === parsed)) return parsed;
    }
  }

  return SUPPORTED_NETWORKS[0]?.id || 8453;
}

function getInitialSmartAccount(): string {
  if (typeof window === 'undefined') return '';

  // 1. Pre-injected configuration (for downloaded offline HTML bundles)
  const preConfig = (window as unknown as { __ORKI_RECOVERY_CONFIG__?: { account?: string } }).__ORKI_RECOVERY_CONFIG__;
  if (preConfig?.account && isAddress(preConfig.account.trim())) return preConfig.account.trim();

  // 2. Single query parameter (?account=0x...)
  const urlParams = new URLSearchParams(window.location.search);
  const fromQuery = urlParams.get('account');
  if (fromQuery && isAddress(fromQuery.trim())) {
    return fromQuery.trim();
  }

  // 3. Hash parameter or raw hash fragment (#account=0x... or #0x...)
  if (window.location.hash) {
    const rawHash = window.location.hash.replace(/^#\/?/, '').trim();
    if (isAddress(rawHash)) {
      return rawHash;
    }
    const hashParams = new URLSearchParams(rawHash.includes('?') ? rawHash.split('?')[1] : rawHash);
    const fromHash = hashParams.get('account');
    if (fromHash && isAddress(fromHash.trim())) {
      return fromHash.trim();
    }
  }

  return '';
}

function getInitialTokens(): Address[] {
  if (typeof window === 'undefined') return [];
  const addrs: Address[] = [];

  // 1. Injected configuration
  const preConfig = (window as unknown as { __ORKI_RECOVERY_CONFIG__?: { tokens?: string[] } }).__ORKI_RECOVERY_CONFIG__;
  if (Array.isArray(preConfig?.tokens)) {
    for (const t of preConfig.tokens) {
      if (typeof t === 'string' && isAddress(t.trim())) {
        addrs.push(t.trim() as Address);
      }
    }
  }

  // 2. Query param ?tokens=0x...,0x...
  const urlParams = new URLSearchParams(window.location.search);
  const fromQuery = urlParams.get('tokens');
  if (fromQuery) {
    fromQuery.split(',').forEach((t) => {
      const trimmed = t.trim();
      if (isAddress(trimmed)) addrs.push(trimmed as Address);
    });
  }

  // 3. Hash param
  if (window.location.hash) {
    const rawHash = window.location.hash.replace(/^#\/?/, '').trim();
    const hashParams = new URLSearchParams(rawHash.includes('?') ? rawHash.split('?')[1] : rawHash);
    const fromHash = hashParams.get('tokens');
    if (fromHash) {
      fromHash.split(',').forEach((t) => {
        const trimmed = t.trim();
        if (isAddress(trimmed)) addrs.push(trimmed as Address);
      });
    }
  }

  const unique = Array.from(new Set(addrs.map((a) => a.toLowerCase())));
  return unique.map((a) => a as Address);
}

export function App() {
  // Network state: dynamically initialized from URL or first configured network
  const [selectedChainId, setSelectedChainId] = useState<number>(getInitialChainId);
  const currentNetwork = getNetwork(selectedChainId);


  // Gas mode: always self-funded native gas (Orki does not sponsor gas)
  const gasMode: GasMode = 'native';

  // Smart Account Address state: dynamically initialized from URL or starts empty
  const [smartAccountAddress, setSmartAccountAddress] = useState<string>(getInitialSmartAccount);

  // Extra custom/injected token addresses
  const [extraTokens, setExtraTokens] = useState<Address[]>(getInitialTokens);
  const [customTokenInput, setCustomTokenInput] = useState('');
  const [isAddingToken, setIsAddingToken] = useState(false);
  const [customTokenError, setCustomTokenError] = useState<string | null>(null);
  const [showCustomTokenBox, setShowCustomTokenBox] = useState(false);
  const [isDiscoveringTokens, setIsDiscoveringTokens] = useState(false);

  // Wallet / Signer state
  const [signerAddress, setSignerAddress] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);

  // Compute default bundler URL dynamically (ZeroDev Bundler RPC handles both paymaster and self-funded userOps)
  const computeDefaultBundlerUrl = useCallback((chainId: number) => {
    return getZeroDevBundlerUrl(chainId, ZERODEV_PROJECT_ID);
  }, []);

  // Compute default RPC URL (ZeroDev RPC provides full Node RPC + CORS support across all chains)
  const computeDefaultRpcUrl = useCallback((chainId: number) => {
    const zd = getZeroDevBundlerUrl(chainId, ZERODEV_PROJECT_ID);
    if (zd) return zd;
    return getNetwork(chainId).rpcUrl;
  }, []);

  // Endpoints
  const [rpcUrl, setRpcUrl] = useState<string>(() => {
    return computeDefaultRpcUrl(selectedChainId);
  });
  const [bundlerUrl, setBundlerUrl] = useState<string>(() => {
    return computeDefaultBundlerUrl(selectedChainId);
  });

  // Balances
  const [balances, setBalances] = useState<AccountBalances | null>(null);
  const [isLoadingBalances, setIsLoadingBalances] = useState<boolean>(false);

  // Recovery Mode & Selection
  const [sweepMode, setSweepMode] = useState<SweepMode>('batch');
  const [selectedSingleKey, setSelectedSingleKey] = useState<string>('native');
  const [batchSelectedKeys, setBatchSelectedKeys] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Execution states
  const [sweepStep, setSweepStep] = useState<SweepStep>('idle');
  const [stepMessage, setStepMessage] = useState<string>('');
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<FormattedError | null>(null);

  const setError = useCallback((err: unknown, customTitle?: string) => {
    if (!err) {
      setErrorMessage(null);
      return;
    }
    if (typeof err === 'string') {
      setErrorMessage({
        title: customTitle || 'Configuration Error',
        message: err,
      });
    } else {
      setErrorMessage(parseMetaMaskError(err));
    }
  }, []);

  // Copy helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Sync RPC and Bundler when chain changes
  const handleSelectChainId = useCallback((chainId: number) => {
    setSelectedChainId(chainId);
    setRpcUrl(computeDefaultRpcUrl(chainId));
    setBundlerUrl(computeDefaultBundlerUrl(chainId));
    setBalances(null);
  }, [computeDefaultRpcUrl, computeDefaultBundlerUrl]);


  // Sync URL changes dynamically without page reload
  useEffect(() => {
    const handleUrlChange = () => {
      const addr = getInitialSmartAccount();
      if (addr && addr !== smartAccountAddress) {
        setSmartAccountAddress(addr);
      }
      const chain = getInitialChainId();
      if (chain && chain !== selectedChainId) {
        handleSelectChainId(chain);
      }
      const tokens = getInitialTokens();
      if (tokens.length > 0) {
        setExtraTokens((prev) => {
          const merged = new Set([...prev.map((p) => p.toLowerCase()), ...tokens.map((t) => t.toLowerCase())]);
          return Array.from(merged) as Address[];
        });
      }
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, [smartAccountAddress, selectedChainId, handleSelectChainId]);

  // Unified Hybrid Balance Fetcher:
  // Step 1: Instant Multicall3 on all curated + stored custom tokens (sovereign, 0 API keys)
  // Step 2: Opportunistic explorer indexer scan for any unlisted active token contracts
  const loadBalances = useCallback(async () => {
    if (!isAddress(smartAccountAddress)) return;
    setIsLoadingBalances(true);

    const currentStored = getStoredTokens(selectedChainId, smartAccountAddress);
    const combinedTokens = Array.from(
      new Set([...extraTokens.map((t) => t.toLowerCase()), ...currentStored.map((s) => s.toLowerCase())])
    ) as Address[];

    try {
      const bals = await fetchBalances(
        selectedChainId,
        rpcUrl,
        smartAccountAddress as Address,
        combinedTokens
      );
      setBalances(bals);

      const withBal = new Set<string>();
      bals.tokens.forEach((t) => {
        if (t.balanceRaw > 0n) {
          withBal.add(t.address ? t.address.toLowerCase() : 'native');
        }
      });
      setBatchSelectedKeys(withBal);

      const firstWithBal = bals.tokens.find((t) => t.balanceRaw > 0n);
      if (firstWithBal) {
        setSelectedSingleKey(firstWithBal.address ? firstWithBal.address.toLowerCase() : 'native');
      }
    } catch (e) {
      console.warn('Error fetching balances:', e);
    } finally {
      setIsLoadingBalances(false);
    }

    // Background opportunistic token discovery via explorer indexers
    try {
      setIsDiscoveringTokens(true);
      const discovered = await discoverAccountTokens(
        selectedChainId,
        smartAccountAddress as Address
      );
      if (discovered.length > 0) {
        const knownSet = new Set(combinedTokens.map((e) => e.toLowerCase()));
        const newlyDiscovered = discovered.filter((d) => !knownSet.has(d.toLowerCase()));

        if (newlyDiscovered.length > 0) {
          saveStoredTokens(selectedChainId, smartAccountAddress, newlyDiscovered);
          setExtraTokens((prev) => {
            const nextSet = new Set(prev.map((p) => p.toLowerCase()));
            const additions = newlyDiscovered.filter((d) => !nextSet.has(d.toLowerCase()));
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });

          // Re-query Multicall3 with the newly discovered tokens included
          const updatedBals = await fetchBalances(
            selectedChainId,
            rpcUrl,
            smartAccountAddress as Address,
            [...combinedTokens, ...newlyDiscovered]
          );
          setBalances(updatedBals);
          const withBal = new Set<string>();
          updatedBals.tokens.forEach((t) => {
            if (t.balanceRaw > 0n) {
              withBal.add(t.address ? t.address.toLowerCase() : 'native');
            }
          });
          setBatchSelectedKeys(withBal);
        }
      }
    } catch (e) {
      console.debug('Opportunistic token discovery finished:', e);
    } finally {
      setIsDiscoveringTokens(false);
    }
  }, [selectedChainId, rpcUrl, smartAccountAddress, extraTokens]);

  useEffect(() => {
    let ignore = false;
    if (!isAddress(smartAccountAddress)) return;

    const timer = setTimeout(() => {
      if (!ignore) {
        void loadBalances();
      }
    }, 0);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [loadBalances, smartAccountAddress]);

  const [hasExplicitlyDisconnected, setHasExplicitlyDisconnected] = useState(false);

  // Connect Wallet
  const handleConnectWallet = async (forceSelect = false) => {
    setIsConnectingWallet(true);
    setErrorMessage(null);
    try {
      const shouldForce = forceSelect || hasExplicitlyDisconnected;
      const address = await connectWallet(shouldForce);
      setSignerAddress(address);
      setHasExplicitlyDisconnected(false);
      if (!recipientAddress) {
        setRecipientAddress(address);
      }
      if (window.ethereum) {
        const hexId = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
        setWalletChainId(parseInt(hexId, 16));
      }
    } catch (err: unknown) {
      setErrorMessage(parseMetaMaskError(err));
    } finally {
      setIsConnectingWallet(false);
    }
  };

  const handleDisconnectWallet = () => {
    setSignerAddress(null);
    setHasExplicitlyDisconnected(true);
  };

  const handleSwitchChain = async () => {
    try {
      await switchWalletNetwork(selectedChainId);
      setWalletChainId(selectedChainId);
    } catch (e: unknown) {
      setErrorMessage(parseMetaMaskError(e));
    }
  };

  // Listen for account/chain changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum?.on) {
      const handleAccountsChanged = (accounts: unknown) => {
        const accs = accounts as string[];
        if (accs.length > 0) {
          setSignerAddress(accs[0] as Address);
        } else {
          setSignerAddress(null);
        }
      };

      const handleChainChanged = (chainIdHex: unknown) => {
        setWalletChainId(parseInt(chainIdHex as string, 16));
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

      return () => {
        if (window.ethereum?.removeListener) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
      };
    }
  }, []);

  // Add custom token
  const handleAddCustomToken = async () => {
    const raw = customTokenInput.trim();
    if (!isAddress(raw)) {
      setCustomTokenError('Please enter a valid 0x hex contract address.');
      return;
    }
    if (!isAddress(smartAccountAddress)) {
      setCustomTokenError('Provide a valid smart account address first.');
      return;
    }

    setIsAddingToken(true);
    setCustomTokenError(null);
    try {
      const token = await fetchCustomTokenMetadata(
        selectedChainId,
        rpcUrl,
        smartAccountAddress as Address,
        raw as Address
      );
      saveStoredTokens(selectedChainId, smartAccountAddress, [raw as Address]);
      setExtraTokens((prev) => {
        const existing = new Set(prev.map((p) => p.toLowerCase()));
        if (!existing.has(raw.toLowerCase())) {
          return [...prev, raw as Address];
        }
        return prev;
      });
      setCustomTokenInput('');
      setShowCustomTokenBox(false);
      // Immediately include in single or batch
      setSelectedSingleKey(raw.toLowerCase());
      if (token.balanceRaw > 0n) {
        setBatchSelectedKeys((prev) => new Set([...prev, raw.toLowerCase()]));
      }
      await loadBalances();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to import token contract';
      setCustomTokenError(msg);
    } finally {
      setIsAddingToken(false);
    }
  };

  // Tokens with positive balance
  const positiveTokens = useMemo(() => {
    if (!balances?.tokens) return [];
    return balances.tokens.filter((t) => t.balanceRaw > 0n);
  }, [balances]);

  // Selected single token object
  const currentSingleToken = useMemo<TokenItem | undefined>(() => {
    if (!balances?.tokens) return undefined;
    return balances.tokens.find((t) => {
      const key = t.address ? t.address.toLowerCase() : 'native';
      return key === selectedSingleKey;
    }) || balances.tokens[0];
  }, [balances, selectedSingleKey]);

  // Single sweep max amount helper
  const handleMaxAmount = () => {
    if (!currentSingleToken) return;
    if (currentSingleToken.isNative) {
      const num = parseFloat(currentSingleToken.balance || '0');
      // If self-funded gas, leave ~0.001 ETH buffer
      const reserve = gasMode === 'native' ? 0.001 : 0.0001;
      const maxVal = Math.max(0, num - reserve);
      setAmount(maxVal > 0 ? maxVal.toFixed(5) : '0');
    } else {
      setAmount(currentSingleToken.balance || '0');
    }
  };

  // Toggle token in batch selection
  const handleToggleBatchToken = (key: string) => {
    setBatchSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSelectAllBatch = () => {
    const allKeys = new Set(positiveTokens.map((t) => (t.address ? t.address.toLowerCase() : 'native')));
    setBatchSelectedKeys(allKeys);
  };

  const handleDeselectAllBatch = () => {
    setBatchSelectedKeys(new Set());
  };

  // Batch items to sweep
  const batchSweepItems = useMemo<SweepItem[]>(() => {
    if (!balances?.tokens) return [];
    const items: SweepItem[] = [];

    balances.tokens.forEach((token) => {
      const key = token.address ? token.address.toLowerCase() : 'native';
      if (!batchSelectedKeys.has(key)) return;
      if (token.balanceRaw <= 0n) return;

      if (token.isNative) {
        // Reserve gas buffer if self-funded
        let effectiveRaw = token.balanceRaw;
        if (gasMode === 'native') {
          const gasReserve = 1000000000000000n; // ~0.001 native token
          effectiveRaw = token.balanceRaw > gasReserve ? token.balanceRaw - gasReserve : 0n;
        }

        if (effectiveRaw > 0n) {
          items.push({
            tokenAddress: null,
            symbol: token.symbol,
            decimals: token.decimals,
            amount: (Number(effectiveRaw) / 1e18).toFixed(5),
            amountRaw: effectiveRaw,
            isNative: true,
          });
        }
      } else if (token.address) {
        items.push({
          tokenAddress: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
          amount: token.balance,
          amountRaw: token.balanceRaw,
          isNative: false,
        });
      }
    });

    return items;
  }, [balances, batchSelectedKeys, gasMode]);

  // Execute Sweep
  const handleExecuteSweep = async () => {
    if (!signerAddress) {
      setError('Please connect your recovery signer wallet first.', 'Signer Required');
      return;
    }
    if (!isAddress(smartAccountAddress)) {
      setError('Invalid Orki smart account address.', 'Invalid Address');
      return;
    }
    const targetRecipient = signerAddress || recipientAddress;
    if (!targetRecipient || !isAddress(targetRecipient)) {
      setError('Please connect your recovery signer wallet first.', 'Signer Required');
      return;
    }

    if (gasMode === 'native' && balances && balances.nativeRaw === 0n) {
      setError(
        `Your smart account (${smartAccountAddress.slice(0, 8)}...) has 0 ${currentNetwork.nativeCurrency.symbol} for gas. Because recovery uses self-funded gas, please send a small amount of native ${currentNetwork.nativeCurrency.symbol} (e.g. 0.001 ${currentNetwork.nativeCurrency.symbol}) to your smart account address to pay for on-chain execution fees.`,
        'Native Gas Required'
      );
      return;
    }

    let itemsToSweep: SweepItem[] = [];

    if (sweepMode === 'batch') {
      if (batchSweepItems.length === 0) {
        setError('Please select at least one asset with a non-zero balance to sweep.', 'No Assets Selected');
        return;
      }
      itemsToSweep = batchSweepItems;
    } else {
      if (!currentSingleToken) {
        setError('Please select an asset to sweep.', 'No Asset Selected');
        return;
      }
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        setError('Please enter a valid amount greater than 0.', 'Invalid Amount');
        return;
      }

      let parsedRaw: bigint;
      if (currentSingleToken.isNative) {
        parsedRaw = parseEther(amount);
      } else {
        parsedRaw = parseUnits(amount, currentSingleToken.decimals);
      }

      itemsToSweep = [
        {
          tokenAddress: currentSingleToken.address,
          symbol: currentSingleToken.symbol,
          decimals: currentSingleToken.decimals,
          amount,
          amountRaw: parsedRaw,
          isNative: currentSingleToken.isNative,
        },
      ];
    }

    setErrorMessage(null);
    setSweepStep('validating');

    try {
      const result = await executeSweep({
        chainId: selectedChainId,
        rpcUrl,
        bundlerUrl,
        kernelAddress: smartAccountAddress as Address,
        signerAddress,
        recipientAddress: targetRecipient as Address,
        items: itemsToSweep,
        gasMode,
        onStepChange: (step, msg) => {
          setSweepStep(step);
          setStepMessage(msg);
        },
      });

      setSweepResult(result);
      loadBalances();
    } catch (err: unknown) {
      console.error('Sweep execution failed:', err);
      setSweepStep('error');
      setErrorMessage(parseMetaMaskError(err));
    }
  };

  const handleReset = () => {
    setSweepResult(null);
    setSweepStep('idle');
    setStepMessage('');
    setErrorMessage(null);
    loadBalances();
  };

  const isChainMismatch = signerAddress && walletChainId !== null && walletChainId !== selectedChainId;
  const isExecuting = sweepStep !== 'idle' && sweepStep !== 'success' && sweepStep !== 'error';
  const isValidSmartAccount = isAddress(smartAccountAddress);
  const targetRecipient = signerAddress || recipientAddress;
  const isValidRecipient = Boolean(targetRecipient && isAddress(targetRecipient));
  const isValidSingleAmount = parseFloat(amount) > 0;

  return (
    <div className="app-container">
      <Header />

      <main className="recovery-card">
        {/* Network Selector Bar */}
        <div className="network-bar">
          <div className="network-bar-header">
            <span className="network-bar-label">
              <Globe size={14} /> Recovery Network
            </span>
          </div>
          <div className="network-pills-row">
            {SUPPORTED_NETWORKS.map((net) => {
              const isSelected = selectedChainId === net.id;
              return (
                <button
                  key={net.id}
                  type="button"
                  onClick={() => handleSelectChainId(net.id)}
                  className={`network-pill ${isSelected ? 'active' : ''}`}
                >
                  {net.isTestnet && <span className="testnet-dot" />}
                  <span>{net.shortName}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Self-Funded Gas Notice Banner */}
        <div className="gas-banner">
          <div className="gas-banner-icon">
            <Fuel size={16} />
          </div>
          <div className="gas-banner-content">
            <span className="gas-banner-title">Self-Funded Recovery Gas</span>
            <span className="gas-banner-desc">
              Recovery transactions are executed directly on-chain from your Smart Account. Please ensure your Smart Account has a small balance of native <strong>{currentNetwork.nativeCurrency.symbol}</strong> (~$0.10) to cover network execution gas fees.
            </span>
          </div>
        </div>

        {/* Two-Column Setup & Action Grid */}
        <div className="recovery-grid">
          {/* Column 1: Account Architecture & Recovery Signer */}
          <div className="section-panel">
            <div className="section-panel-header">
              <h2 className="section-panel-title">
                <Wallet size={16} color="#783fe4" />
                Account & Signer
              </h2>
            </div>

            {/* Smart Account Address (Injected from URL / Recovery Link) */}
            <div className="field-group">
              <label className="field-label" htmlFor="smart-account-input">
                <span>Smart Account (Kernel v3.3)</span>
              </label>
              <div className="input-row">
                <input
                  id="smart-account-input"
                  type="text"
                  value={smartAccountAddress}
                  disabled
                  placeholder="0x... (Injected via recovery link)"
                  className="text-input mono"
                />
                {smartAccountAddress && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCopy(smartAccountAddress, 'smartAccount')}
                      className="input-action-btn"
                      title="Copy Address"
                    >
                      {copiedId === 'smartAccount' ? <Check size={14} color="#047857" /> : <Copy size={14} />}
                    </button>
                    <a
                      href={`${currentNetwork.explorerUrl}/address/${smartAccountAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="input-action-btn"
                      title="View on Explorer"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </>
                )}
              </div>
              {!isValidSmartAccount && smartAccountAddress && (
                <span style={{ fontSize: 11, color: '#b91c1c' }}>Invalid EVM hex address in link</span>
              )}
              {!smartAccountAddress && (
                <span style={{ fontSize: 11, color: '#667085' }}>
                  Smart account address is injected automatically via recovery link or <code>?account=0x...</code>
                </span>
              )}
            </div>

            {/* Available Balances & Token Discovery */}
            <div className="balances-box-multi">
              <div className="balances-header-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Coins size={14} color="#783fe4" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#344054' }}>
                    Available Balances ({positiveTokens.length} active)
                  </span>
                  {isDiscoveringTokens && (
                    <span
                      style={{
                        fontSize: 11,
                        color: '#667085',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        marginLeft: 4,
                      }}
                    >
                      <Loader2 size={11} className="spin" />
                      <span>Scanning...</span>
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setShowCustomTokenBox(!showCustomTokenBox)}
                    className="btn-link"
                    style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    <PlusCircle size={12} />
                    <span>{showCustomTokenBox ? 'Close' : 'Add Token'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={loadBalances}
                    disabled={isLoadingBalances || isDiscoveringTokens}
                    className="balance-refresh-btn"
                    title="Refresh balances & scan on-chain assets"
                  >
                    <RefreshCw size={13} className={isLoadingBalances || isDiscoveringTokens ? 'spin' : ''} />
                  </button>
                </div>
              </div>

              {/* Inline Custom Token Importer */}
              {showCustomTokenBox && (
                <div className="custom-token-box">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#475467' }}>
                      Import Custom ERC-20 Token
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCustomTokenBox(false)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#667085' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="input-row">
                    <input
                      type="text"
                      placeholder="0x... ERC-20 contract address"
                      value={customTokenInput}
                      onChange={(e) => setCustomTokenInput(e.target.value)}
                      className="text-input mono"
                      style={{ fontSize: 12 }}
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomToken}
                      disabled={isAddingToken || !customTokenInput.trim()}
                      className="btn-primary"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                    >
                      {isAddingToken ? <Loader2 size={12} className="spin" /> : 'Import'}
                    </button>
                  </div>
                  {customTokenError && (
                    <span style={{ fontSize: 11, color: '#b91c1c' }}>{customTokenError}</span>
                  )}
                </div>
              )}

              {/* Detected Token Balances List */}
              <div className="balances-tokens-grid">
                {balances?.tokens && balances.tokens.length > 0 ? (
                  balances.tokens
                    .filter((t) => t.balanceRaw > 0n || t.isNative || t.symbol === 'USDC')
                    .map((token) => {
                      const key = token.address ? token.address.toLowerCase() : 'native';
                      return (
                        <div key={key} className="balance-token-row">
                          <div className="balance-token-left">
                            <span
                              className={`token-badge ${
                                token.isNative
                                  ? 'token-badge-native'
                                  : token.isCustom
                                  ? 'token-badge-custom'
                                  : ''
                              }`}
                            >
                              {token.isNative ? 'NATIVE' : token.symbol}
                            </span>
                            <span style={{ fontWeight: 500, color: '#101828' }}>
                              {token.name || token.symbol}
                            </span>
                          </div>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#101828' }}>
                            {parseFloat(token.balance).toFixed(4)} {token.symbol}
                          </span>
                        </div>
                      );
                    })
                ) : (
                  <div style={{ textAlign: 'center', padding: '12px', color: '#667085', fontSize: 12 }}>
                    {isLoadingBalances || isDiscoveringTokens
                      ? 'Scanning on-chain token balances & activity...'
                      : 'No tokens detected yet.'}
                  </div>
                )}
              </div>
            </div>

            {/* Recovery Signer Connection */}
            <div className="field-group">
              <label className="field-label">
                <span>Emergency Signer (External Wallet)</span>
              </label>

              {!signerAddress ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => handleConnectWallet()}
                    disabled={isConnectingWallet}
                    className="btn-primary"
                    style={{ width: '100%' }}
                  >
                    <Wallet size={15} />
                    <span>{isConnectingWallet ? 'Connecting...' : 'Connect Recovery Wallet (Safe / MetaMask)'}</span>
                  </button>
                  <p style={{ fontSize: 11, color: '#667085', margin: 0 }}>
                    Connect the authorized backup signer address registered on your smart account.
                  </p>
                </div>
              ) : (
                <div className="signer-box">
                  <div className="signer-status-row">
                    <span className="status-badge-connected">
                      <CheckCircle2 size={12} /> Connected
                    </span>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleConnectWallet(true)}
                        className="btn-link"
                        style={{ fontSize: 11, color: '#783fe4' }}
                        title="Choose a different account in your wallet"
                      >
                        Switch Account
                      </button>
                      <button
                        type="button"
                        onClick={handleDisconnectWallet}
                        className="btn-link"
                        style={{ color: '#b91c1c', fontSize: 11 }}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                  <div className="signer-address-text">{signerAddress}</div>

                  {isChainMismatch && (
                    <div className="alert-box alert-warning">
                      <span>
                        Wallet is on Chain ID <code>{walletChainId}</code>, but {currentNetwork.name} is selected.
                      </span>
                      <button
                        type="button"
                        onClick={handleSwitchChain}
                        className="btn-outline"
                        style={{ marginTop: 4, alignSelf: 'flex-start', padding: '4px 8px', fontSize: 11 }}
                      >
                        <RefreshCw size={12} />
                        <span>Switch Wallet to {currentNetwork.name}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Column 2: Execute Recovery Sweep */}
          <div className="section-panel">
            <div className="section-panel-header">
              <h2 className="section-panel-title">
                <ArrowUpRight size={16} color="#047857" />
                Sweep Treasury Funds
              </h2>
            </div>

            {/* Mode Switch: Batch vs Single */}
            <div className="field-group">
              <label className="field-label">Recovery Mode</label>
              <div className="mode-toggle-group">
                <button
                  type="button"
                  onClick={() => setSweepMode('batch')}
                  className={`mode-toggle-btn ${sweepMode === 'batch' ? 'active' : ''}`}
                >
                  <Zap size={14} color="#783fe4" />
                  <span>Batch Sweep (All Assets)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSweepMode('single')}
                  className={`mode-toggle-btn ${sweepMode === 'single' ? 'active' : ''}`}
                >
                  <Coins size={14} />
                  <span>Single Asset</span>
                </button>
              </div>
            </div>

            {/* Batch Sweep UI */}
            {sweepMode === 'batch' && (
              <div className="field-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="field-label" style={{ margin: 0 }}>
                    Select Assets to Sweep in 1 Transaction
                  </span>
                  {positiveTokens.length > 0 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={handleSelectAllBatch} className="btn-link">
                        Select All
                      </button>
                      <button type="button" onClick={handleDeselectAllBatch} className="btn-link">
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                <div className="batch-card">
                  {positiveTokens.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px 8px', color: '#667085', fontSize: 12 }}>
                      No positive balances found on {currentNetwork.name}. Use &ldquo;Add Token&rdquo; on the left if you have unlisted custom tokens.
                    </div>
                  ) : (
                    <table className="batch-table">
                      <thead>
                        <tr>
                          <th style={{ width: 32 }}></th>
                          <th>Asset</th>
                          <th style={{ textAlign: 'right' }}>Available</th>
                          <th style={{ textAlign: 'right' }}>Sweep Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positiveTokens.map((token) => {
                          const key = token.address ? token.address.toLowerCase() : 'native';
                          const isChecked = batchSelectedKeys.has(key);
                          const sweepItem = batchSweepItems.find((i) =>
                            token.isNative ? i.isNative : i.tokenAddress?.toLowerCase() === token.address?.toLowerCase()
                          );

                          return (
                            <tr
                              key={key}
                              onClick={() => handleToggleBatchToken(key)}
                              style={{ cursor: 'pointer' }}
                            >
                              <td>
                                {isChecked ? (
                                  <CheckSquare size={16} color="#783fe4" />
                                ) : (
                                  <Square size={16} color="#98a2b3" />
                                )}
                              </td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontWeight: 600, color: '#101828' }}>{token.symbol}</span>
                                  <span style={{ fontSize: 11, color: '#667085' }}>
                                    {token.isNative ? 'Native' : token.name || ''}
                                  </span>
                                </div>
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                                {parseFloat(token.balance).toFixed(4)}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#047857' }}>
                                {isChecked && sweepItem ? `${sweepItem.amount} ${token.symbol}` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  {batchSweepItems.length > 0 && (
                    <div className="batch-summary-bar">
                      <span>Ready to sweep:</span>
                      <strong>{batchSweepItems.length} asset(s) simultaneously</strong>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Single Asset UI */}
            {sweepMode === 'single' && (
              <>
                {/* Asset Selection */}
                <div className="field-group">
                  <label className="field-label">Asset to Sweep</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {balances?.tokens && balances.tokens.length > 0 ? (
                      balances.tokens
                        .filter((t) => t.balanceRaw > 0n || t.isNative || t.symbol === 'USDC')
                        .map((token) => {
                          const key = token.address ? token.address.toLowerCase() : 'native';
                          const isSelected = selectedSingleKey === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => {
                                setSelectedSingleKey(key);
                                setAmount('');
                              }}
                              className={`network-pill ${isSelected ? 'active' : ''}`}
                              style={{ padding: '6px 12px' }}
                            >
                              <span>{token.symbol}</span>
                              <span style={{ opacity: 0.7, fontSize: 10 }}>
                                ({parseFloat(token.balance).toFixed(2)})
                              </span>
                            </button>
                          );
                        })
                    ) : (
                      <span style={{ fontSize: 12, color: '#667085' }}>Loading tokens...</span>
                    )}
                  </div>
                </div>

                {/* Amount */}
                <div className="field-group">
                  <div className="field-label">
                    <span>Amount</span>
                    <button type="button" onClick={handleMaxAmount} className="btn-link">
                      Sweep Max
                    </button>
                  </div>
                  <div className="input-row">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="text-input"
                    />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#667085', paddingRight: 4 }}>
                      {currentSingleToken?.symbol || ''}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Destination Recipient */}
            <div className="field-group">
              <label className="field-label">Destination Recipient</label>
              <div className="input-row">
                <input
                  type="text"
                  value={signerAddress || recipientAddress}
                  disabled
                  placeholder="0x... (Defaults to connected wallet)"
                  className="text-input mono"
                />
              </div>
            </div>

            {balances && balances.nativeRaw === 0n && (
              <div className="alert-box alert-warning">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <AlertTriangle size={15} /> Native Gas Required
                </div>
                <span>
                  Smart account currently has <strong>0.00 {currentNetwork.nativeCurrency.symbol}</strong> for gas.
                  Please send a small gas fee deposit (~$0.10 in {currentNetwork.nativeCurrency.symbol}) to your Smart Account address to pay for on-chain execution.
                </span>
              </div>
            )}

            {sweepMode === 'batch' && batchSweepItems.some((i) => i.isNative) && (
              <div style={{ fontSize: 11, color: '#b45309', background: '#fffbeb', padding: '6px 10px', borderRadius: 6, border: '1px solid #fde68a' }}>
                Note: In self-funded gas mode, ~0.001 {currentNetwork.nativeCurrency.symbol} is reserved in your smart account to pay bundler execution fees.
              </div>
            )}

            {/* Execution / Result Feedback */}
            {isExecuting && (
              <div className="status-executing-box">
                <Loader2 size={18} className="spin" />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>
                    {sweepStep === 'validating' && '1/5. Validating parameters...'}
                    {sweepStep === 'instantiating' && '2/5. Preparing Kernel account...'}
                    {sweepStep === 'requesting_signature' && '3/5. Requesting signature in wallet...'}
                    {sweepStep === 'submitting_userop' && '4/5. Submitting UserOp to bundler...'}
                    {sweepStep === 'confirming_onchain' && '5/5. Waiting for block confirmation...'}
                  </span>
                  <span style={{ fontSize: 11, opacity: 0.9 }}>{stepMessage}</span>
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="alert-box alert-error">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <AlertTriangle size={15} /> {errorMessage.title}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>{errorMessage.message}</div>
                {errorMessage.details && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      fontFamily: 'monospace',
                      background: 'rgba(185, 28, 28, 0.08)',
                      padding: '6px 8px',
                      borderRadius: 4,
                      border: '1px solid rgba(185, 28, 28, 0.15)',
                      wordBreak: 'break-word',
                    }}
                  >
                    <span style={{ fontWeight: 600, opacity: 0.85 }}>Provider detail: </span>
                    {errorMessage.details}
                  </div>
                )}
              </div>
            )}

            {sweepResult && (
              <div className="alert-box alert-success">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <CheckCircle2 size={15} /> Recovery Sweep Succeeded!
                </div>
                <span>
                  Transferred {sweepResult.amount} {sweepResult.asset} to {sweepResult.recipient.slice(0, 8)}...{sweepResult.recipient.slice(-6)}.
                </span>
                {sweepResult.sweptAssets && sweepResult.sweptAssets.length > 1 && (
                  <ul style={{ margin: '6px 0 2px 18px', fontSize: 12 }}>
                    {sweepResult.sweptAssets.map((a, i) => (
                      <li key={i}>
                        {a.amount} {a.symbol}
                      </li>
                    ))}
                  </ul>
                )}
                <a
                  href={sweepResult.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#047857',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    marginTop: 4,
                  }}
                >
                  <span>View on Explorer</span>
                  <ExternalLink size={12} />
                </a>
                <button
                  type="button"
                  onClick={handleReset}
                  className="btn-outline"
                  style={{ marginTop: 8, alignSelf: 'flex-start', padding: '4px 10px', fontSize: 11 }}
                >
                  Sweep Another
                </button>
              </div>
            )}

            {/* Sweep Button */}
            {!sweepResult && (
              <button
                type="button"
                onClick={handleExecuteSweep}
                disabled={
                  !signerAddress ||
                  !isValidSmartAccount ||
                  !isValidRecipient ||
                  (sweepMode === 'single' ? !isValidSingleAmount : batchSweepItems.length === 0) ||
                  isExecuting ||
                  (gasMode === 'native' && balances?.nativeRaw === 0n)
                }
                className="btn-sweep"
              >
                {isExecuting ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    <span>Processing Recovery...</span>
                  </>
                ) : !isValidSmartAccount ? (
                  <span>Provide Smart Account in Recovery Link</span>
                ) : !signerAddress ? (
                  <span>Connect Recovery Wallet to Sweep</span>
                ) : gasMode === 'native' && balances && balances.nativeRaw === 0n ? (
                  <span>Native Gas Required to Sweep ({currentNetwork.nativeCurrency.symbol})</span>
                ) : sweepMode === 'batch' ? (
                  batchSweepItems.length === 0 ? (
                    <span>Select Assets to Sweep</span>
                  ) : (
                    <>
                      <Zap size={16} />
                      <span>Sign & Batch Sweep {batchSweepItems.length} Asset(s) in 1 Transaction</span>
                    </>
                  )
                ) : !isValidSingleAmount ? (
                  <span>Enter Amount to Sweep</span>
                ) : (
                  <>
                    <ArrowUpRight size={16} />
                    <span>Sign & Sweep {amount} {currentSingleToken?.symbol}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </main>


      {/* Clean Footer */}
      <footer className="footer">
        <p>Orki Smart Account Disaster Recovery Vault • Built for Kernel v3.3 & ERC-4337</p>
        <p style={{ opacity: 0.7 }}>Canonical EntryPoint: <code>{ENTRY_POINT_0_7}</code></p>
      </footer>
    </div>
  );
}

export default App;
