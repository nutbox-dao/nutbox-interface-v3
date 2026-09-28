import { Contract, ZeroAddress } from 'ethers';

const uniswapPool = 'tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const pancakePool = 'tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters)';

function basketRouteType(chainId, version) {
  if (![56, 4663].includes(Number(chainId))) throw new Error('Unsupported Basket chain');
  const pool = Number(chainId) === 56 ? pancakePool : uniswapPool;
  if (Number(version) >= 3) {
    return `tuple(uint8 venue,address poolQuoteToken,${pool} v4Pool,uint24 v3Fee,uint16 defaultMaxExecutionLossBps)`;
  }
  return Number(chainId) === 56
    ? `tuple(uint8 venue,uint8 quoteToken,${pool} v4Pool,uint24 v3Fee)`
    : `tuple(uint8 venue,${pool} v4Pool,uint24 v3Fee)`;
}

// Value active constituent reserves, excluding fee reserves, against effective
// supply (including accrued dilution). All reads use the same block. This does
// not depend on an NFT AMM reserve or simulate a buyback.
export async function readBasketNativeNav({ provider, address, chainId, version, decimals, blockTag }) {
  const routeType = basketRouteType(chainId, version);
  const basket = new Contract(address, [
    'function effectiveSupply() view returns (uint256)',
    'function rebalanceExecutor() view returns (address)',
    'function assetCount() view returns (uint256)',
    'function assetAt(uint256) view returns (address asset,uint16 targetWeightBps,uint256 activeReserve)',
    `function assetRouteAt(uint256) view returns (${routeType})`,
  ], provider);
  const at = { blockTag: blockTag ?? await provider.getBlockNumber() };
  const [supply, executorAddress, count] = await Promise.all([
    basket.effectiveSupply(at), basket.rebalanceExecutor(at), basket.assetCount(at),
  ]);
  if (supply <= 0n || count <= 0n || count > 64n || executorAddress === ZeroAddress) {
    throw new Error('Basket NAV unavailable');
  }
  const quoteFunction = Number(chainId) === 56 ? 'quoteAssetToWbnb' : 'quoteAssetToWeth';
  const executor = new Contract(executorAddress, [
    `function ${quoteFunction}(${routeType},address,uint256) view returns (uint256)`,
  ], provider);
  const values = await Promise.all(Array.from({ length: Number(count) }, async (_, index) => {
    const [asset, route] = await Promise.all([
      basket.assetAt(index, at), basket.assetRouteAt(index, at),
    ]);
    if (asset.activeReserve === 0n) return 0n;
    const value = await executor[quoteFunction](route.toArray(true), asset.asset, asset.activeReserve, at);
    // Never report a partial NAV when any funded constituent lacks a price.
    if (value <= 0n) throw new Error('Basket constituent price unavailable');
    return value;
  }));
  const nav = values.reduce((sum, value) => sum + value, 0n) * 10n ** BigInt(decimals) / supply;
  if (nav <= 0n) throw new Error('Basket NAV unavailable');
  return nav;
}
