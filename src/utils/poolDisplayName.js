import { isAddress, ZeroAddress } from 'ethers';
import { ERC20ABI, ERC20StakingABI } from '../config/abis.js';
import { multicallRead } from './multicall.js';

const V2_PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];
const CALLS_PER_BATCH = 150;

function isTokenAddress(value) {
  return isAddress(value) && value !== ZeroAddress;
}

export async function readV2LpPoolNames(provider, multicallAddress, community) {
  const pools = (community?.pools || []).filter(pool => (
    (pool.poolType === 'ERC20_STAKING' || pool.poolType === 'ERC20_LOCKING') && isAddress(pool.id)
  ));
  const names = new Map();
  if (pools.length === 0) return names;

  const blockTag = await provider.getBlockNumber();
  const read = async calls => {
    const results = {};
    for (let offset = 0; offset < calls.length; offset += CALLS_PER_BATCH) {
      const batch = calls.slice(offset, offset + CALLS_PER_BATCH);
      Object.assign(results, await multicallRead(provider, multicallAddress, batch, { blockTag }));
    }
    return results;
  };

  const missingAssets = await read(pools.filter(pool => !isTokenAddress(pool.asset)).map(pool => ({
    key: pool.id, target: pool.id, contractInterface: ERC20StakingABI,
    functionName: 'stakeToken', allowFailure: true,
  })));
  const assetByPool = new Map(pools.map(pool => [
    pool.id, isTokenAddress(pool.asset) ? pool.asset.toLowerCase() : missingAssets[pool.id]?.toLowerCase(),
  ]));
  const assets = [...new Set([...assetByPool.values()].filter(isTokenAddress))];
  const pairTokens = await read(assets.flatMap(asset => ['token0', 'token1'].map(functionName => ({
    key: `${asset}:${functionName}`, target: asset, contractInterface: V2_PAIR_ABI,
    functionName, allowFailure: true,
  }))));

  const pairs = new Map();
  const communityToken = community.cToken?.toLowerCase();
  for (const asset of assets) {
    const token0 = pairTokens[`${asset}:token0`]?.toLowerCase();
    const token1 = pairTokens[`${asset}:token1`]?.toLowerCase();
    if (!isTokenAddress(token0) || !isTokenAddress(token1) || token0 === token1) continue;
    pairs.set(asset, token1 === communityToken ? [token1, token0] : [token0, token1]);
  }

  const tokens = [...new Set([...pairs.values()].flat())];
  const metadata = await read(tokens.flatMap(token => ['name', 'symbol'].map(functionName => ({
    key: `${token}:${functionName}`, target: token, contractInterface: ERC20ABI,
    functionName, allowFailure: true,
  }))));

  for (const pool of pools) {
    const pair = pairs.get(assetByPool.get(pool.id));
    if (!pair) {
      if (pool.name === 'V2 LP Staking') console.warn(`Could not resolve V2 LP tokens for pool ${pool.id}`);
      continue;
    }
    const tokenNames = pair.map(token => metadata[`${token}:name`]?.trim());
    const labels = pair.map((token, index) => metadata[`${token}:symbol`]?.trim() || tokenNames[index]);
    if (!labels.every(Boolean)) {
      console.warn(`Could not resolve both V2 LP token names for pool ${pool.id}`);
      continue;
    }
    const displayName = labels.join(' / ');
    const fullName = tokenNames.every(Boolean) ? tokenNames.join(' / ') : null;
    names.set(pool.id.toLowerCase(), {
      displayName,
      displaySubtitle: fullName !== displayName ? fullName : null,
    });
  }
  return names;
}
