import { isAddress, type Address } from 'viem';

const EXPLORER_API_ENDPOINTS: Record<number, string> = {
  // Base
  8453: 'https://base.blockscout.com/api/v2',
  84532: 'https://base-sepolia.blockscout.com/api/v2',
  // Ethereum
  1: 'https://eth.blockscout.com/api/v2',
  11155111: 'https://eth-sepolia.blockscout.com/api/v2',
  // Polygon
  137: 'https://polygon.blockscout.com/api/v2',
  80002: 'https://polygon-amoy.blockscout.com/api/v2',
};

const STORAGE_PREFIX = 'orki_recovery_tokens_';

/**
 * Retrieve cached/imported token addresses from localStorage for a specific chain and account
 */
export function getStoredTokens(chainId: number, accountAddress: string): Address[] {
  if (typeof window === 'undefined' || !isAddress(accountAddress)) return [];
  try {
    const key = `${STORAGE_PREFIX}${chainId}_${accountAddress.toLowerCase()}`;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((a) => typeof a === 'string' && isAddress(a)) as Address[];
  } catch (e) {
    console.warn('Failed to read stored tokens from localStorage:', e);
    return [];
  }
}

/**
 * Save token addresses to localStorage for a specific chain and account
 */
export function saveStoredTokens(chainId: number, accountAddress: string, tokens: Address[]): void {
  if (typeof window === 'undefined' || !isAddress(accountAddress)) return;
  try {
    const key = `${STORAGE_PREFIX}${chainId}_${accountAddress.toLowerCase()}`;
    const existing = new Set(getStoredTokens(chainId, accountAddress).map((a) => a.toLowerCase()));
    tokens.forEach((t) => {
      if (isAddress(t)) existing.add(t.toLowerCase());
    });
    localStorage.setItem(key, JSON.stringify(Array.from(existing)));
  } catch (e) {
    console.warn('Failed to save stored tokens to localStorage:', e);
  }
}

/**
 * Opportunistically discover tokens held by or interacted with by an account address.
 * Uses public explorer APIs with an aggressive timeout (3.5s) and graceful error handling.
 * Never throws — returns an empty array on any failure or block.
 */
export async function discoverAccountTokens(
  chainId: number,
  accountAddress: Address
): Promise<Address[]> {
  const baseEndpoint = EXPLORER_API_ENDPOINTS[chainId];
  if (!baseEndpoint || !isAddress(accountAddress)) {
    return [];
  }

  const url = `${baseEndpoint}/addresses/${accountAddress}/tokens`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      // 403, 429, or 500 — silently degrade to sovereign Multicall
      return [];
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.items)) {
      return [];
    }

    const discoveredAddresses: Address[] = [];
    for (const item of data.items) {
      const rawAddr = item?.token?.address_hash || item?.token?.address;
      if (rawAddr && isAddress(rawAddr)) {
        discoveredAddresses.push(rawAddr as Address);
      }
    }

    return discoveredAddresses;
  } catch {
    // Timeout, network error, or aborted — safe fallback
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
