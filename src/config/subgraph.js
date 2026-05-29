// Nutbox Backend API (replaces The Graph subgraph)
// Uses Vite proxy in dev: /nutbox -> https://bsc-api.tagai.fun/nutbox
// Production static hosting does not include the Vite dev proxy, so call the API directly.
const API_BASE = import.meta.env.VITE_NUTBOX_API_BASE
  || (import.meta.env.DEV ? '/nutbox' : 'https://bsc-api.tagai.fun/nutbox');

async function fetchAPI(path) {
  const response = await fetch(`${API_BASE}${path}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`API returned ${contentType || 'unknown content type'}`);
  }

  const json = await response.json();
  if (!response.ok || json.success === false) {
    throw new Error(json.message || 'API request failed');
  }
  return json;
}

// ──── Global stats ────
export async function fetchWalnutStats() {
  try {
    const data = await fetchAPI('/stats');
    return {
      totalCommunities: data.communityCount || 0,
      totalPools: data.poolCount || 0,
      totalUsers: data.userCount || 0,
    };
  } catch (err) {
    console.error('Failed to fetch stats:', err);
    return { totalCommunities: 0, totalPools: 0, totalUsers: 0 };
  }
}

// ──── All communities ────
export async function fetchCommunities(first = 100, skip = 0) {
  const page = Math.floor(skip / first);
  const data = await fetchAPI(`/communities?page=${page}&size=${first}`);
  // Map API response to match frontend expected format
  return (data.communities || []).map(mapCommunity);
}

// ──── Single community by address ────
export async function fetchCommunity(communityAddress) {
  // Fetch from communities list and find the specific one
  const data = await fetchAPI('/communities?size=1000');
  const communities = data.communities || [];
  const raw = communities.find(
    c => c.community.toLowerCase() === communityAddress.toLowerCase()
  );
  if (!raw) return null;

  // Also fetch operation history
  let operationHistory = [];
  try {
    const histData = await fetchAPI(`/communities/${communityAddress}/history?size=50`);
    operationHistory = (histData.history || []).map(mapOperation);
  } catch {
    // history endpoint might not exist for all communities
  }

  const mapped = mapCommunity(raw);
  mapped.operationHistory = operationHistory;
  return mapped;
}

// ──── Pools for a community (extracted from community data) ────
export async function fetchPoolsForCommunity(communityAddress) {
  const community = await fetchCommunity(communityAddress);
  return community?.pools || [];
}

// ──── User operation history ────
export async function fetchUserOperations(userAddress) {
  void userAddress;
  // Current API doesn't have per-user history endpoint
  // Return empty for now
  return {
    walnutOperationHistory: [],
    walnutOperationCount: 0,
  };
}

// ──── Social Curation Claims ────

export async function fetchSocialClaims(communityAddress, userAddress) {
  try {
    const data = await fetchAPI(`/communities/${communityAddress}/social-claims/${userAddress}`);
    return (data.claims || []).map(c => ({
      orderId: c.orderId,
      amount: c.amount,
      deadline: c.deadline,
      signature: c.signature,
      reason: c.reason || null,
    }));
  } catch (err) {
    console.error('Failed to fetch social claims:', err);
    return [];
  }
}

export async function fetchSocialClaimHistory(communityAddress, page = 0, size = 20) {
  try {
    const data = await fetchAPI(`/communities/${communityAddress}/social-claims/history?page=${page}&size=${size}`);
    return {
      claims: (data.claims || []).map(c => ({
        orderId: c.orderId,
        user: c.user,
        amount: c.amount,
        timestamp: c.timestamp,
        txHash: c.txHash,
      })),
      total: data.total || 0,
    };
  } catch (err) {
    console.error('Failed to fetch social claim history:', err);
    return { claims: [], total: 0 };
  }
}

// ──── Data Mapping Helpers ────

function mapCommunity(raw) {
  const info = raw.communityInfo;
  return {
    id: raw.community,
    index: raw.index,
    createdAt: raw.createdAtTs?.toString(),
    owner: { id: raw.owner },
    daoFund: raw.daoFund,
    feeRatio: raw.feeRatio,
    cToken: raw.cToken,
    distributedCToken: null,
    revenue: null,
    retainedRevenue: null,
    usersCount: 0,
    poolsCount: raw.pools?.length || 0,
    activePoolCount: raw.pools?.filter(p => p.status === 'OPENED').length || 0,
    pools: (raw.pools || []).map(mapPool),
    operationHistory: [],
    // communityInfo fields
    name: info?.name || null,
    description: info?.description || null,
    logo: info?.logo || null,
    tick: info?.tick || null,
    tags: info?.tags ? JSON.parse(info.tags) : [],
    twitter: info?.twitter || null,
    telegram: info?.telegram || null,
    official: info?.official || null,
    distribution: info?.distribution ? JSON.parse(info.distribution) : [],
    infoCreatedAt: info?.createAt || null,
  };
}

function mapPool(raw) {
  return {
    id: raw.pool,
    index: raw.index,
    poolIndex: raw.index,
    name: raw.name || '',
    status: raw.status || 'OPENED',
    poolType: raw.poolType || guessPoolType(raw.poolFactory),
    totalAmount: '0', // Will be read from chain
    asset: raw.asset,
    ratio: raw.ratio,
    stakersCount: 0, // Will be read from chain
    lockDuration: raw.lockDuration,
    poolFactory: raw.poolFactory,
    createdAt: raw.createdAtTs?.toString(),
  };
}

function mapOperation(raw) {
  return {
    id: `${raw.txHash}-${raw.index}`,
    type: raw.opType,
    account: { id: raw.account },
    pool: raw.pool ? { id: raw.pool, name: '' } : null,
    asset: raw.asset,
    amount: raw.amount,
    timestamp: raw.opTimestamp?.toString(),
    tx: raw.txHash,
  };
}

// Map factory address to pool type
function guessPoolType(factoryAddress) {
  if (!factoryAddress) return 'UNKNOWN';
  const addr = factoryAddress.toLowerCase();
  const map = {
    '0xdc3f940ac6da516d5c9cc59c8afe0f85a576e2a4': 'ERC20_STAKING',
    '0x8189a03cfa3d8919a2eb8f08e4f88c21cf78ca01': 'ERC20_LOCKING',
    '0x398ea6db014595f23d0c9cb1390a10472cdd43ba': 'ERC1155_STAKING',
    '0x47738e3420be8ced8a9476cf4daf84c549835d44': 'SP_STAKING',
    '0xc4674d3fbbd201ea401a8b7e7285f956178593d8': 'SOCIAL_CURATION',
  };
  return map[addr] || 'UNKNOWN';
}
