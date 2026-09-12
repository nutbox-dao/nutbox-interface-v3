import { Contract, isAddress } from 'ethers';

const V2_PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

const TOKEN_SYMBOL_ABI = ['function symbol() view returns (string)'];

const symbolReadsByProvider = new WeakMap();

function normalizeAddress(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function cleanSymbol(value) {
  return String(value || '').trim();
}

async function readTokenSymbol(provider, address) {
  const key = normalizeAddress(address);
  if (!key) return '';

  let symbolReads = symbolReadsByProvider.get(provider);
  if (!symbolReads) {
    symbolReads = new Map();
    symbolReadsByProvider.set(provider, symbolReads);
  }

  let promise = symbolReads.get(key);
  if (!promise) {
    promise = new Contract(address, TOKEN_SYMBOL_ABI, provider)
      .symbol()
      .then(cleanSymbol);
    symbolReads.set(key, promise);
  }

  try {
    return await promise;
  } catch (error) {
    symbolReads.delete(key);
    throw error;
  }
}

export function isVersion13LpPool(community, pool) {
  return Number(community?.tokenVersion) === 13
    && pool?.poolType === 'ERC20_STAKING'
    && isAddress(pool?.asset)
    && isAddress(community?.cToken);
}

export async function resolveVersion13LpPoolName(provider, community, pool) {
  if (!provider || !isVersion13LpPool(community, pool)) return null;

  try {
    const pair = new Contract(pool.asset, V2_PAIR_ABI, provider);
    const [token0, token1] = await Promise.all([pair.token0(), pair.token1()]);
    const communityAddress = normalizeAddress(community.cToken);
    const token0Address = normalizeAddress(token0);
    const token1Address = normalizeAddress(token1);

    if (token0Address !== communityAddress && token1Address !== communityAddress) return null;

    const assetAddress = token0Address === communityAddress ? token1 : token0;
    const [communitySymbol, assetSymbol] = await Promise.all([
      readTokenSymbol(provider, community.cToken),
      readTokenSymbol(provider, assetAddress),
    ]);

    if (!communitySymbol || !assetSymbol) return null;
    return `${communitySymbol} / ${assetSymbol}`;
  } catch (error) {
    console.warn(`Failed to resolve LP token pair for ${pool.asset}:`, error);
    return null;
  }
}

export async function enrichVersion13LpPoolNames(provider, community) {
  if (!community || Number(community.tokenVersion) !== 13) return community;

  const pools = await Promise.all((community.pools || []).map(async pool => {
    const displayName = await resolveVersion13LpPoolName(provider, community, pool);
    return displayName ? { ...pool, displayName } : pool;
  }));

  return { ...community, pools };
}
