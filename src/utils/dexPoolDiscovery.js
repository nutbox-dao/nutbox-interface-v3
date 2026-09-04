import { INDEX_BROKER_SOURCE_TYPES } from './indexBrokerNft';

const GECKO_NETWORKS = {
  bsc: { id: 'bsc', dexKind: 'pancake' },
  rh: { id: 'robinhood', dexKind: 'uniswap' },
};

const CACHE_TTL_MS = 60_000;
const discoveryCache = new Map();

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tokenAddressFromId(value) {
  return String(value || '').replace(/^.+_/, '');
}

function classifyPool(dexId, address, dexKind) {
  const normalized = String(dexId || '').toLowerCase();
  if (dexKind === 'pancake' && !normalized.includes('pancakeswap')) return null;
  const dexLabel = dexKind === 'uniswap' ? 'Uniswap' : 'Pancake';

  if (normalized.includes('infinity-clmm') || normalized.includes('clmm') || normalized.includes('v4')) {
    return /^0x[0-9a-f]{64}$/i.test(address)
      ? {
        sourceType: dexKind === 'uniswap'
          ? INDEX_BROKER_SOURCE_TYPES.UNISWAP_V4
          : INDEX_BROKER_SOURCE_TYPES.PANCAKE_V4_CL,
        versionLabel: `${dexLabel} V4${dexKind === 'pancake' ? ' CL' : ''}`,
      }
      : null;
  }
  if (normalized.includes('v3')) {
    return /^0x[0-9a-f]{40}$/i.test(address)
      ? { sourceType: INDEX_BROKER_SOURCE_TYPES.V3_POOL, versionLabel: `${dexLabel} V3` }
      : null;
  }
  if (normalized.includes('v2') || (dexKind === 'uniswap' && normalized.includes('v1'))) {
    return /^0x[0-9a-f]{40}$/i.test(address)
      ? { sourceType: INDEX_BROKER_SOURCE_TYPES.V2_PAIR, versionLabel: `${dexLabel} V2` }
      : null;
  }
  return null;
}

function parsePoolCandidate(pool, communityToken, includedTokens, dexKind) {
  const attributes = pool?.attributes || {};
  const address = String(attributes.address || '').trim();
  const dexId = pool?.relationships?.dex?.data?.id || '';
  const source = classifyPool(dexId, address, dexKind);
  if (!source) return null;

  const baseId = pool?.relationships?.base_token?.data?.id || '';
  const quoteId = pool?.relationships?.quote_token?.data?.id || '';
  const baseToken = tokenAddressFromId(baseId);
  const quoteToken = tokenAddressFromId(quoteId);
  const baseAttributes = includedTokens.get(baseId)
    || includedTokens.get(baseToken.toLowerCase())
    || {};
  const quoteAttributes = includedTokens.get(quoteId)
    || includedTokens.get(quoteToken.toLowerCase())
    || {};
  const communityIsBase = baseToken.toLowerCase() === communityToken.toLowerCase();
  const pairedToken = communityIsBase ? quoteToken : baseToken;
  const pairedAttributes = communityIsBase ? quoteAttributes : baseAttributes;
  const feeMatch = String(attributes.name || '').match(/([\d.]+)%/);
  const transactions = attributes.transactions?.h24 || {};

  return {
    id: `${source.sourceType}:${address.toLowerCase()}`,
    address,
    sourceType: source.sourceType,
    versionLabel: source.versionLabel,
    dexId,
    baseToken,
    quoteToken,
    baseTokenSymbol: baseAttributes.symbol || '',
    quoteTokenSymbol: quoteAttributes.symbol || '',
    pairedToken,
    pairedTokenSymbol: pairedAttributes.symbol || '',
    feeTier: feeMatch ? `${feeMatch[1]}%` : '',
    liquidityUsd: numberValue(attributes.reserve_in_usd),
    volume24hUsd: numberValue(attributes.volume_usd?.h24),
    transactions24h: numberValue(transactions.buys) + numberValue(transactions.sells),
  };
}

export async function discoverPancakePricePools({
  networkSlug,
  communityToken,
  signal,
  force = false,
}) {
  const geckoConfig = GECKO_NETWORKS[String(networkSlug || '').toLowerCase()];
  const geckoNetwork = geckoConfig?.id;
  if (!geckoNetwork) throw new Error('This network does not support automatic Pancake pool discovery');
  const token = String(communityToken || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(token)) throw new Error('Invalid Community Token address');

  const cacheKey = `${geckoNetwork}:${token}`;
  const cached = discoveryCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

  const url = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/tokens/${token}/pools?include=base_token%2Cquote_token&page=1`;
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) {
    if (response.status === 429) throw new Error('Pool discovery is temporarily rate limited. Please retry shortly.');
    throw new Error(`Pool discovery failed (HTTP ${response.status})`);
  }
  const payload = await response.json();
  const includedTokens = new Map();
  for (const item of payload?.included || []) {
    if (item?.type !== 'token' || !item?.id) continue;
    includedTokens.set(item.id, item.attributes || {});
    includedTokens.set(tokenAddressFromId(item.id).toLowerCase(), item.attributes || {});
  }

  const seen = new Set();
  const pools = (payload?.data || [])
    .map(pool => parsePoolCandidate(pool, token, includedTokens, geckoConfig.dexKind))
    .filter(candidate => {
      if (!candidate || seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    })
    .sort((left, right) => right.liquidityUsd - left.liquidityUsd);

  const data = { pools };
  discoveryCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}
