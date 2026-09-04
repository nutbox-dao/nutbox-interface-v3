import { ethers } from 'ethers';
import { PancakeV4CLPoolManagerABI } from '../config/abis';

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

export const NUTBOX_SWAP_SOURCE_TYPES = {
  V2_PAIR: 0,
  V3_POOL: 1,
  UNISWAP_V4: 2,
  PANCAKE_V4_CL: 3,
};

const UNISWAP_V4_INTERFACE = new ethers.Interface([
  'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
  'function extsload(bytes32 slot) view returns (bytes32 value)',
]);
const UNISWAP_V4_POOLS_SLOT = 6n;
const UNISWAP_V4_LIQUIDITY_OFFSET = 3n;

function requireAddress(value, label) {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${label} is unavailable`);
  }
  return ethers.getAddress(value);
}

/**
 * Build the caller-supplied DEX source expected by TagAI's chain-specific
 * ImportedTokenSwapWrapper (the Nutbox swap wrapper used by this UI).
 */
export async function resolveUniswapV4Pool({ poolId, poolManager, readProvider }) {
  if (!ethers.isHexString(poolId, 32)) throw new Error('Uniswap V4 Pool ID is unavailable');
  const managerAddress = requireAddress(poolManager, 'Uniswap V4 pool manager');
  const initialize = UNISWAP_V4_INTERFACE.getEvent('Initialize');
  const logs = await readProvider.getLogs({
    address: managerAddress,
    topics: [initialize.topicHash, poolId],
    fromBlock: 0,
    toBlock: 'latest',
  });
  const parsed = logs.length ? UNISWAP_V4_INTERFACE.parseLog(logs[logs.length - 1]) : null;
  if (!parsed) throw new Error(`PoolKey not found for Pool ID ${poolId}`);
  const poolKey = {
    poolManager: managerAddress,
    currency0: ethers.getAddress(parsed.args.currency0),
    currency1: ethers.getAddress(parsed.args.currency1),
    fee: Number(parsed.args.fee),
    tickSpacing: Number(parsed.args.tickSpacing),
    hooks: ethers.getAddress(parsed.args.hooks),
  };
  const resolvedPoolId = ethers.keccak256(abiCoder.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
  ));
  if (resolvedPoolId.toLowerCase() !== poolId.toLowerCase()) {
    throw new Error('Uniswap V4 Pool ID does not match the resolved PoolKey');
  }

  const poolSlot = ethers.keccak256(abiCoder.encode(['bytes32', 'uint256'], [poolId, UNISWAP_V4_POOLS_SLOT]));
  const manager = new ethers.Contract(managerAddress, UNISWAP_V4_INTERFACE, readProvider);
  const [slot0Word, liquidityWord] = await Promise.all([
    manager.extsload(poolSlot),
    manager.extsload(ethers.toBeHex(BigInt(poolSlot) + UNISWAP_V4_LIQUIDITY_OFFSET, 32)),
  ]);
  return {
    ...poolKey,
    sqrtPriceX96: BigInt(slot0Word) & ((1n << 160n) - 1n),
    liquidity: BigInt(liquidityWord) & ((1n << 128n) - 1n),
  };
}

export async function buildNutboxSwapSource({ dexVersion, pair, contracts, readProvider }) {
  const version = Number(dexVersion);
  const isUniswap = Boolean(contracts.UniswapV4Manager);

  if (version === 2) {
    return {
      sourceType: NUTBOX_SWAP_SOURCE_TYPES.V2_PAIR,
      sourceData: abiCoder.encode(
        ['tuple(address router,address pair)'],
        [[
          requireAddress(contracts.PancakeV2Router, 'Pancake V2 router'),
          requireAddress(pair, 'Pancake V2 pair'),
        ]],
      ),
    };
  }

  if (version === 3) {
    return {
      sourceType: NUTBOX_SWAP_SOURCE_TYPES.V3_POOL,
      sourceData: abiCoder.encode(
        ['tuple(address router,address quoter,address pool)'],
        [[
          requireAddress(contracts.PancakeV3SmartRouter, 'Pancake V3 router'),
          requireAddress(contracts.PancakeV3Quoter, 'Pancake V3 quoter'),
          requireAddress(pair, 'Pancake V3 pool'),
        ]],
      ),
    };
  }

  if (version === 4) {
    if (isUniswap) {
      const pool = await resolveUniswapV4Pool({
        poolId: pair,
        poolManager: contracts.UniswapV4Manager,
        readProvider,
      });
      return {
        sourceType: NUTBOX_SWAP_SOURCE_TYPES.UNISWAP_V4,
        sourceData: abiCoder.encode(
          ['tuple(address poolManager,address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)'],
          [[pool.poolManager, pool.currency0, pool.currency1, pool.fee, pool.tickSpacing, pool.hooks]],
        ),
      };
    }
    if (!ethers.isHexString(pair, 32)) throw new Error('Pancake V4 Pool ID is unavailable');
    const managerAddress = requireAddress(contracts.PancakeV4CLManager, 'Pancake V4 pool manager');
    const manager = new ethers.Contract(managerAddress, PancakeV4CLPoolManagerABI, readProvider);
    const pool = await manager.poolIdToPoolKey(pair);
    return {
      sourceType: NUTBOX_SWAP_SOURCE_TYPES.PANCAKE_V4_CL,
      sourceData: abiCoder.encode(
        ['tuple(address quoter,tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters) pool)'],
        [[
          requireAddress(contracts.PancakeV4Quoter, 'Pancake V4 quoter'),
          [pool.currency0, pool.currency1, pool.hooks, pool.poolManager, pool.fee, pool.parameters],
        ]],
      ),
    };
  }

  throw new Error(`Unsupported DEX version: ${version}`);
}

export function applySwapSlippage(amount, slippageBps = 100) {
  return amount * BigInt(10_000 - slippageBps) / 10_000n;
}
