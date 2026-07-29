// Nutbox Backend API (replaces The Graph subgraph)
// Uses Vite proxy in dev: /nutbox -> https://bsc-api.tagai.fun/nutbox
// Production static hosting does not include the Vite dev proxy, so call the API directly.
import { DEFAULT_CHAIN_ID, getNetworkConfig, getContracts } from './contracts';
import { ethers } from 'ethers';
import { CommunityABI, CommunityFactoryABI } from './abis';

const onChainCommunityCache = new Map();

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchCommunityMetadata(tick, chainId) {
  const apiBase = getNetworkConfig(chainId).communityMetadataApiBase;
  if (!apiBase || !tick) return null;

  try {
    const response = await fetch(`${apiBase}/community/detail?tick=${encodeURIComponent(tick)}`, {
      headers: { 'X-Chain-Id': String(chainId) },
    });
    if (!response.ok) return null;
    const metadata = await response.json();
    return metadata && Object.keys(metadata).length > 0 ? metadata : null;
  } catch (error) {
    console.warn(`Failed to fetch community metadata for ${tick}:`, error);
    return null;
  }
}

const poolHistoryInterface = new ethers.Interface([
  'event Deposited(address indexed community, address indexed who, uint256 amount)',
  'event Withdrawn(address indexed community, address indexed who, uint256 amount)',
  'event Locked(address indexed who, uint256 amount)',
  'event Unlocked(address indexed who, uint256 amount)',
  'event Redeemed(address indexed who, uint256 amount)',
  'event SocialClaimed(address indexed user, uint256 indexed orderId, uint256 amount, bool harvested)',
  'event NFTMinted(address indexed buyer, uint256 indexed tokenId, uint256 indexed batchId, uint256 referrerTokenId, address paymentAsset, uint256 mintPrice)',
]);

const poolFactoryEvents = [
  ['ERC20StakingFactory', 'event ERC20StakingCreated(address indexed pool, address indexed community, string name, address erc20Token)'],
  ['ERC20LockingFactory', 'event ERC20LockingCreated(address indexed pool, address indexed community, string name, address erc20Token, uint256 lockDuration)'],
  ['SocialCurationFactory', 'event SocialCurationCreated(address indexed pool, address indexed community, string name)'],
  ['NFTMiningPoolFactory', 'event NFTMiningPoolCreated(address indexed pool, address indexed community, address indexed admin, address renderer, string name, string symbol, address paymentAsset, uint256 mintPrice, uint256 firstBatchSupply, uint16 referralBps, uint8 paletteId)'],
];

function historyId(log) {
  return `${log.transactionHash}-${log.index}-${log.address}`;
}

async function fetchOnChainOperationHistory({
  provider, communityAddress, owner, pools, contracts, fromBlock, communityTokenDecimals,
}) {
  const communityInterface = new ethers.Interface(CommunityABI);
  const communityLogs = await provider.getLogs({
    address: communityAddress,
    fromBlock,
    toBlock: 'latest',
  });

  const poolLogsByAddress = await Promise.all(pools.map(pool => provider.getLogs({
    address: pool.id,
    fromBlock,
    toBlock: 'latest',
  }).catch(() => [])));

  const communityTopic = ethers.zeroPadValue(communityAddress, 32);
  const factoryLogs = await Promise.all(poolFactoryEvents.map(async ([contractKey, eventAbi]) => {
    const factoryAddress = contracts[contractKey];
    if (!factoryAddress) return [];
    const eventInterface = new ethers.Interface([eventAbi]);
    const event = eventInterface.fragments[0];
    const logs = await provider.getLogs({
      address: factoryAddress,
      topics: [event.topicHash, null, communityTopic],
      fromBlock,
      toBlock: 'latest',
    }).catch(() => []);
    return logs.map(log => ({ log, parsed: eventInterface.parseLog(log), poolFactory: factoryAddress }));
  }));

  const poolByAddress = new Map(pools.map(pool => [pool.id.toLowerCase(), pool]));
  const operations = [];

  for (const log of communityLogs) {
    let parsed;
    try {
      parsed = communityInterface.parseLog(log);
    } catch {
      continue;
    }
    if (!parsed) continue;
    const base = { id: historyId(log), account: { id: owner }, pool: null, asset: null, amount: null, tx: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.index };
    if (parsed.name === 'AdminSetFeeRatio') {
      operations.push({ ...base, type: 'ADMINSETFEE', ratioBps: Number(parsed.args.ratio) });
    } else if (parsed.name === 'AdminClosePool') {
      operations.push({ ...base, type: 'ADMINCLOSEPOOL', pool: { id: parsed.args.pool, name: '' } });
    } else if (parsed.name === 'AdminSetPoolRatio') {
      operations.push({ ...base, type: 'ADMINSETRATIO' });
    } else if (parsed.name === 'WithdrawRewards') {
      const poolAddresses = [...parsed.args.pool];
      operations.push({
        ...base,
        type: poolAddresses.length === 1 ? 'HARVEST' : 'HARVESTALL',
        account: { id: parsed.args.who },
        pool: poolAddresses.length === 1 ? { id: poolAddresses[0], name: '' } : null,
        amount: ethers.formatUnits(parsed.args.amount, communityTokenDecimals),
      });
    } else if (parsed.name === 'DevChanged') {
      operations.push({ ...base, type: 'ADMINSETDAOFUND', asset: parsed.args.newDev });
    } else if (parsed.name === 'RevenueWithdrawn') {
      operations.push({
        ...base,
        type: 'ADMINWITHDRAWNREVENUE',
        asset: parsed.args.devFund,
        amount: ethers.formatUnits(parsed.args.amount, communityTokenDecimals),
      });
    }
  }

  for (const entries of factoryLogs) {
    for (const { log, parsed, poolFactory } of entries) {
      operations.push({
        id: historyId(log),
        type: 'ADMINADDPOOL',
        account: { id: owner },
        pool: { id: parsed.args.pool, name: parsed.args.name || '' },
        poolFactory,
        asset: parsed.args.erc20Token || parsed.args.paymentAsset || null,
        amount: null,
        tx: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.index,
      });
    }
  }

  for (const logs of poolLogsByAddress) {
    for (const log of logs) {
      let parsed;
      try {
        parsed = poolHistoryInterface.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed) continue;
      const pool = poolByAddress.get(log.address.toLowerCase());
      const decimals = pool?.assetDecimals ?? communityTokenDecimals;
      const typeMap = {
        Deposited: 'DEPOSIT', Withdrawn: 'WITHDRAW', Locked: 'LOCK',
        Unlocked: 'UNLOCK', Redeemed: 'REDEEM', SocialClaimed: 'SOCIALCLAIMED', NFTMinted: 'NFTMINT',
      };
      const who = parsed.args.who || parsed.args.user || parsed.args.buyer;
      operations.push({
        id: historyId(log),
        type: typeMap[parsed.name],
        account: { id: who },
        pool: { id: log.address, name: pool?.name || '' },
        poolFactory: pool?.poolFactory || null,
        asset: parsed.args.paymentAsset || pool?.asset || null,
        amount: parsed.name === 'NFTMinted' ? null : ethers.formatUnits(parsed.args.amount ?? 0n, decimals),
        tx: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.index,
      });
    }
  }

  const blockNumbers = [...new Set(operations.map(operation => operation.blockNumber))];
  const blocks = await Promise.all(blockNumbers.map(blockNumber => provider.getBlock(blockNumber)));
  const timestamps = new Map(blocks.filter(Boolean).map(block => [block.number, block.timestamp]));

  return operations
    .map(operation => ({ ...operation, timestamp: String(timestamps.get(operation.blockNumber) || 0) }))
    .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
}

async function enrichOnChainCommunityHistory(community, chainId) {
  if (!community) return null;
  const network = getNetworkConfig(chainId);
  const provider = new ethers.JsonRpcProvider(network.rpcUrls[0], network.id);
  const operationHistory = await fetchOnChainOperationHistory({
    provider,
    communityAddress: community.id,
    owner: community.owner.id,
    pools: community.pools,
    contracts: getContracts(chainId),
    fromBlock: community.creationBlock || network.deploymentBlock || 0,
    communityTokenDecimals: community.tokenDecimals || 18,
  }).catch(error => {
    console.warn(`Failed to fetch operation history for ${community.id}:`, error);
    return [];
  });
  return { ...community, operationHistory };
}

async function fetchOnChainCommunities(chainId) {
  const cached = onChainCommunityCache.get(chainId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = (async () => {
    const network = getNetworkConfig(chainId);
    const contracts = getContracts(chainId);
    const provider = new ethers.JsonRpcProvider(network.rpcUrls[0], network.id);
    const factoryInterface = new ethers.Interface(CommunityFactoryABI);
    const event = factoryInterface.getEvent('CommunityCreated');
    const logs = await provider.getLogs({
      address: contracts.CommunityFactory,
      topics: [event.topicHash],
      fromBlock: network.deploymentBlock || 0,
      toBlock: 'latest',
    });

    return Promise.all(logs.map(async (log, index) => {
      const parsed = factoryInterface.parseLog(log);
      const communityAddress = parsed.args.community;
      const community = new ethers.Contract(communityAddress, CommunityABI, provider);
      const [owner, cToken, feeRatio] = await Promise.all([
        community.owner(), community.communityToken(), community.feeRatio(),
      ]);
      const token = new ethers.Contract(cToken, [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
      ], provider);
      const [tokenName, tokenSymbol, communityTokenDecimals] = await Promise.all([
        token.name().catch(() => null), token.symbol().catch(() => null), token.decimals().catch(() => 18),
      ]);
      const metadata = await fetchCommunityMetadata(tokenSymbol, chainId);

      const pools = [];
      for (let poolIndex = 0; poolIndex < 100; poolIndex += 1) {
        try {
          const poolAddress = await community.createdPools(poolIndex);
          const pool = new ethers.Contract(poolAddress, [
            'function name() view returns (string)',
            'function factory() view returns (address)',
            'function stakeToken() view returns (address)',
          ], provider);
          const [name, factory, isActive, asset] = await Promise.all([
            pool.name().catch(() => ''),
            pool.factory().catch(() => ethers.ZeroAddress),
            community.poolActived(poolAddress).catch(() => false),
            pool.stakeToken().catch(() => null),
          ]);
          let assetDecimals = Number(communityTokenDecimals);
          if (asset) {
            const assetContract = new ethers.Contract(asset, ['function decimals() view returns (uint8)'], provider);
            assetDecimals = Number(await assetContract.decimals().catch(() => communityTokenDecimals));
          }
          pools.push({
            id: poolAddress,
            index: poolIndex,
            poolIndex,
            name,
            status: isActive ? 'OPENED' : 'CLOSED',
            poolType: guessPoolType(factory, chainId),
            totalAmount: '0',
            asset,
            assetDecimals,
            ratio: 0,
            stakersCount: 0,
            lockDuration: null,
            poolFactory: factory,
            createdAt: null,
          });
        } catch {
          break;
        }
      }

      return {
        id: communityAddress,
        index,
        creationBlock: log.blockNumber,
        createdAt: null,
        owner: { id: owner },
        daoFund: null,
        feeRatio: Number(feeRatio),
        cToken,
        distributedCToken: null,
        revenue: null,
        retainedRevenue: null,
        usersCount: 0,
        poolsCount: pools.length,
        activePoolCount: pools.filter(pool => pool.status === 'OPENED').length,
        pools,
        operationHistory: [],
        tokenDecimals: Number(communityTokenDecimals),
        name: metadata?.name || tokenName,
        description: metadata?.description || null,
        logo: metadata?.logo || null,
        tick: metadata?.tick || tokenSymbol,
        tags: normalizeArray(metadata?.tags),
        twitter: metadata?.twitter || null,
        telegram: metadata?.telegram || null,
        official: metadata?.official || null,
        distribution: normalizeArray(metadata?.distribution),
        infoCreatedAt: null,
      };
    }));
  })();

  onChainCommunityCache.set(chainId, { promise, expiresAt: Date.now() + 15_000 });
  try {
    return await promise;
  } catch (error) {
    onChainCommunityCache.delete(chainId);
    throw error;
  }
}

async function fetchAPI(path, chainId = DEFAULT_CHAIN_ID) {
  const apiBase = getNetworkConfig(chainId).apiBase;
  if (!apiBase) throw new Error(`Nutbox API is not configured for chain ${chainId}`);
  return fetchAPIFromBase(apiBase, path, chainId);
}

async function fetchAPIFromBase(apiBase, path, chainId) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { 'X-Chain-Id': String(chainId) },
  });
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

function getSocialClaimsApiBase(chainId) {
  const network = getNetworkConfig(chainId);
  if (network.apiBase) return network.apiBase;
  if (!network.communityMetadataApiBase) return null;
  return `${network.communityMetadataApiBase.replace(/\/$/, '')}/nutbox`;
}

// ──── Global stats ────
export async function fetchWalnutStats(chainId = DEFAULT_CHAIN_ID) {
  try {
    if (!getNetworkConfig(chainId).apiBase) {
      const communities = await fetchOnChainCommunities(chainId);
      return {
        totalCommunities: communities.length,
        totalPools: communities.reduce((total, community) => total + community.poolsCount, 0),
        totalUsers: 0,
      };
    }
    const data = await fetchAPI('/stats', chainId);
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
export async function fetchCommunities(first = 100, skip = 0, chainId = DEFAULT_CHAIN_ID) {
  if (!getNetworkConfig(chainId).apiBase) {
    const communities = await fetchOnChainCommunities(chainId);
    return communities.slice(skip, skip + first);
  }
  const page = Math.floor(skip / first);
  const data = await fetchAPI(`/communities?page=${page}&size=${first}`, chainId);
  // Map API response to match frontend expected format
  return (data.communities || []).map(raw => mapCommunity(raw, chainId));
}

// ──── Single community by address ────
export async function fetchCommunity(communityAddress, chainId = DEFAULT_CHAIN_ID) {
  if (!getNetworkConfig(chainId).apiBase) {
    const communities = await fetchOnChainCommunities(chainId);
    const community = communities.find(item => item.id.toLowerCase() === communityAddress.toLowerCase());
    if (community) return enrichOnChainCommunityHistory(community, chainId);
    onChainCommunityCache.delete(chainId);
    const refreshed = await fetchOnChainCommunities(chainId);
    const refreshedCommunity = refreshed.find(item => item.id.toLowerCase() === communityAddress.toLowerCase()) || null;
    return enrichOnChainCommunityHistory(refreshedCommunity, chainId);
  }
  // Fetch from communities list and find the specific one
  const data = await fetchAPI('/communities?size=1000', chainId);
  const communities = data.communities || [];
  const raw = communities.find(
    c => c.community.toLowerCase() === communityAddress.toLowerCase()
  );
  if (!raw) return null;

  // Also fetch operation history
  let operationHistory = [];
  try {
    const histData = await fetchAPI(`/communities/${communityAddress}/history?size=50`, chainId);
    operationHistory = (histData.history || []).map(mapOperation);
  } catch {
    // history endpoint might not exist for all communities
  }

  const mapped = mapCommunity(raw, chainId);
  mapped.operationHistory = operationHistory;
  return mapped;
}

// ──── Pools for a community (extracted from community data) ────
export async function fetchPoolsForCommunity(communityAddress, chainId = DEFAULT_CHAIN_ID) {
  const community = await fetchCommunity(communityAddress, chainId);
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

export async function fetchSocialClaims(communityAddress, userAddress, chainId = DEFAULT_CHAIN_ID) {
  const apiBase = getSocialClaimsApiBase(chainId);
  if (!apiBase) return [];
  try {
    const data = await fetchAPIFromBase(
      apiBase,
      `/communities/${communityAddress}/social-claims/${userAddress}`,
      chainId
    );
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

export async function fetchSocialClaimHistory(communityAddress, page = 0, size = 20, chainId = DEFAULT_CHAIN_ID) {
  const apiBase = getSocialClaimsApiBase(chainId);
  if (!apiBase) return { claims: [], total: 0 };
  try {
    const data = await fetchAPIFromBase(
      apiBase,
      `/communities/${communityAddress}/social-claims/history?page=${page}&size=${size}`,
      chainId
    );
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

function mapCommunity(raw, chainId) {
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
    pools: (raw.pools || []).map(pool => mapPool(pool, chainId)),
    operationHistory: [],
    // communityInfo fields
    name: info?.name || null,
    description: info?.description || null,
    logo: info?.logo || null,
    tick: info?.tick || null,
    tags: normalizeArray(info?.tags),
    twitter: info?.twitter || null,
    telegram: info?.telegram || null,
    official: info?.official || null,
    distribution: normalizeArray(info?.distribution),
    infoCreatedAt: info?.createAt || null,
  };
}

function mapPool(raw, chainId) {
  return {
    id: raw.pool,
    index: raw.index,
    poolIndex: raw.index,
    name: raw.name || '',
    status: raw.status || 'OPENED',
    poolType: raw.poolType && raw.poolType !== 'UNKNOWN'
      ? raw.poolType
      : guessPoolType(raw.poolFactory, chainId),
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
function guessPoolType(factoryAddress, chainId) {
  if (!factoryAddress) return 'UNKNOWN';
  const addr = factoryAddress.toLowerCase();
  const contracts = getContracts(chainId);
  const map = Object.fromEntries([
    [contracts.ERC20StakingFactory, 'ERC20_STAKING'],
    [contracts.ERC20LockingFactory, 'ERC20_LOCKING'],
    [contracts.ERC1155StakingFactory, 'ERC1155_STAKING'],
    [contracts.SPStakingFactory, 'SP_STAKING'],
    [contracts.SocialCurationFactory, 'SOCIAL_CURATION'],
    [contracts.NFTMiningPoolFactory, 'NFT_MINING'],
  ].filter(([address]) => address).map(([address, type]) => [address.toLowerCase(), type]));
  return map[addr] || 'UNKNOWN';
}
