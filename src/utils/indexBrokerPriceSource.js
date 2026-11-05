import { ethers } from 'ethers';
import { IndexBrokerNFTFactoryABI, PancakeV4CLPoolManagerABI } from '../config/abis.js';
import { INDEX_BROKER_SOURCE_TYPES, getIndexBrokerV4PoolId, isIndexBrokerV4Source } from './indexBrokerNft.js';
import { multicallRead } from './multicall.js';
import { resolveUniswapV4Pool } from './nutboxSwap.js';

const { V2_PAIR, V3_POOL, UNISWAP_V4, PANCAKE_V4_CL } = INDEX_BROKER_SOURCE_TYPES;

const POOL_INTERFACE = new ethers.Interface([
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint32,bool)',
]);
const FACTORY_INTERFACE = new ethers.Interface([
  'function getPair(address tokenA,address tokenB) view returns (address)',
  'function getPool(address tokenA,address tokenB,uint24 fee) view returns (address)',
]);
const ROUTER_INTERFACE = new ethers.Interface([
  'function allowedV2Factory(address factory) view returns (bool)',
  'function allowedV3Factory(address factory) view returns (bool)',
  'function allowedUniswapV4Manager(address manager) view returns (bool)',
  'function allowedPancakeV4CLManager(address manager) view returns (bool)',
  'function wrappedNative() view returns (address)',
  'function validateRoute(address tokenIn,address tokenOut) view',
]);
const NFT_FACTORY_INTERFACE = new ethers.Interface(IndexBrokerNFTFactoryABI);
const PANCAKE_V4_INTERFACE = new ethers.Interface(PancakeV4CLPoolManagerABI);

export function getIndexBrokerPriceSourceValue(config) {
  return (isIndexBrokerV4Source(config.sourceType) ? config.sourcePoolId : config.sourcePool).trim();
}

export async function readIndexBrokerPriceSource({ readProvider, contracts, sourceType, poolId, communityToken, zh }) {
  const isV4 = isIndexBrokerV4Source(sourceType);
  const isV2 = sourceType === V2_PAIR;
  if (isV4 ? !ethers.isHexString(poolId, 32) : !ethers.isAddress(poolId) || poolId === ethers.ZeroAddress) {
    throw new Error(isV4
      ? (zh ? '请输入 32 字节的 V4 Pool ID' : 'Enter a 32-byte V4 Pool ID')
      : (zh ? '请输入有效的交易池地址' : 'Enter a valid pool address'));
  }
  const sourceAddress = {
    [V2_PAIR]: contracts.PancakeV2Factory,
    [V3_POOL]: contracts.PancakeV3Factory,
    [UNISWAP_V4]: contracts.UniswapV4Manager,
    [PANCAKE_V4_CL]: contracts.PancakeV4CLManager,
  }[sourceType];
  if (!ethers.isAddress(sourceAddress) || sourceAddress === ethers.ZeroAddress) {
    throw new Error(zh ? '当前网络未配置这种价格源' : 'This price source is not configured on this network');
  }
  if (!readProvider || !contracts.Multicall3 || !contracts.IndexBrokerNFTFactory || !ethers.isAddress(communityToken)) {
    throw new Error(zh ? '当前无法连接链上验证价格池' : 'The price pool cannot be verified on-chain right now');
  }

  const blockTag = await readProvider.getBlockNumber();
  const read = calls => multicallRead(readProvider, contracts.Multicall3, calls, { blockTag });
  const routerCall = {
    key: 'router', target: contracts.IndexBrokerNFTFactory,
    contractInterface: NFT_FACTORY_INTERFACE, functionName: 'nutboxRouter',
  };
  let router;
  let currency0;
  let currency1;
  let config;
  let registeredPoolCall;

  if (isV4) {
    let pool;
    if (sourceType === UNISWAP_V4) {
      ({ router } = await read([routerCall]));
      pool = await resolveUniswapV4Pool({
        poolId, poolManager: sourceAddress, readProvider, multicallAddress: contracts.Multicall3, blockTag,
      });
    } else {
      const state = await read([
        routerCall,
        ...['poolIdToPoolKey', 'getSlot0', 'getLiquidity'].map(functionName => ({
          key: functionName, target: sourceAddress, contractInterface: PANCAKE_V4_INTERFACE, functionName, args: [poolId],
        })),
      ]);
      router = state.router;
      pool = {
        ...state.poolIdToPoolKey.toObject(),
        sqrtPriceX96: state.getSlot0[0],
        liquidity: state.getLiquidity,
      };
    }
    ({ currency0, currency1 } = pool);
    config = {
      sourcePoolManager: pool.poolManager,
      sourceCurrency0: currency0,
      sourceCurrency1: currency1,
      sourceHooks: pool.hooks,
      sourceFee: String(pool.fee),
      sourceTickSpacing: pool.tickSpacing == null ? '' : String(pool.tickSpacing),
      sourceParameters: pool.parameters || '',
    };
    if (pool.poolManager.toLowerCase() !== sourceAddress.toLowerCase()
      || getIndexBrokerV4PoolId({ sourceType, ...config }).toLowerCase() !== poolId.toLowerCase()) {
      throw new Error(zh ? 'Pool ID 与当前网络的 PoolKey 不匹配' : 'The Pool ID does not match the PoolKey on this network');
    }
    if (pool.sqrtPriceX96 === 0n || pool.liquidity === 0n) {
      throw new Error(zh ? '该池尚未初始化或没有流动性' : 'The pool is not initialized or has no liquidity');
    }
  } else {
    const normalizedPool = ethers.getAddress(poolId);
    const methods = isV2 ? ['getReserves'] : ['fee', 'liquidity', 'slot0'];
    const pool = await read([
      routerCall,
      ...['factory', 'token0', 'token1', ...methods].map(functionName => ({
        key: functionName, target: normalizedPool, contractInterface: POOL_INTERFACE, functionName,
      })),
    ]);
    ({ router, token0: currency0, token1: currency1 } = pool);
    if (pool.factory.toLowerCase() !== sourceAddress.toLowerCase()) {
      throw new Error(zh ? '该池不属于当前网络配置的 DEX Factory' : 'The pool does not belong to the configured DEX Factory');
    }
    const hasLiquidity = isV2
      ? pool.getReserves[0] > 0n && pool.getReserves[1] > 0n
      : pool.liquidity > 0n && pool.slot0[0] > 0n;
    if (!hasLiquidity) {
      throw new Error(zh ? '该池尚未初始化或没有流动性' : 'The pool is not initialized or has no liquidity');
    }
    config = { sourceFactory: pool.factory };
    registeredPoolCall = {
      key: 'registeredPool', target: pool.factory, contractInterface: FACTORY_INTERFACE,
      functionName: isV2 ? 'getPair' : 'getPool',
      args: isV2 ? [currency0, currency1] : [currency0, currency1, pool.fee],
    };
  }

  const token = communityToken.toLowerCase();
  const currencies = [currency0.toLowerCase(), currency1.toLowerCase()];
  const tokenIndex = currencies.indexOf(token);
  if (tokenIndex < 0 || currencies[0] === currencies[1]) {
    throw new Error(zh ? '该交易池必须包含当前社区代币及另一种报价币' : 'The pool must contain this Community Token and another quote token');
  }
  const quoteToken = currencies[1 - tokenIndex];
  if (!ethers.isAddress(router) || router === ethers.ZeroAddress) {
    throw new Error(zh ? 'NFT Factory 未配置 Nutbox Router' : 'The NFT Factory has no Nutbox Router configured');
  }

  const allowedMethod = {
    [V2_PAIR]: 'allowedV2Factory',
    [V3_POOL]: 'allowedV3Factory',
    [UNISWAP_V4]: 'allowedUniswapV4Manager',
    [PANCAKE_V4_CL]: 'allowedPancakeV4CLManager',
  }[sourceType];
  const { allowed, registeredPool, wrappedNative } = await read([
    { key: 'allowed', target: router, contractInterface: ROUTER_INTERFACE, functionName: allowedMethod, args: [sourceAddress] },
    { key: 'wrappedNative', target: router, contractInterface: ROUTER_INTERFACE, functionName: 'wrappedNative' },
    ...(registeredPoolCall ? [registeredPoolCall] : []),
  ]);
  if (!allowed) {
    throw new Error(zh ? '该池的 Factory 或 Pool Manager 未获 Nutbox Router 支持' : 'The pool Factory or Pool Manager is not supported by the Nutbox Router');
  }
  if (registeredPoolCall && registeredPool.toLowerCase() !== poolId.toLowerCase()) {
    throw new Error(zh ? '交易池与 Factory 登记地址不匹配' : 'The pool address does not match the Factory registration');
  }
  if (quoteToken !== ethers.ZeroAddress && quoteToken !== wrappedNative.toLowerCase()) {
    const { route } = await read([{
      key: 'route', target: router, contractInterface: ROUTER_INTERFACE,
      functionName: 'validateRoute', args: [quoteToken, wrappedNative], allowFailure: true,
    }]);
    if (route === undefined) {
      throw new Error(zh ? '报价代币尚未配置到包装原生币的 Nutbox Router 路由' : 'The quote token has no Nutbox Router route to the wrapped native token');
    }
  }
  return config;
}
