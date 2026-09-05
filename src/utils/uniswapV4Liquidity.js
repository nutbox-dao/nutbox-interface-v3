import { ethers } from 'ethers';
import { ERC20ABI } from '../config/abis.js';
import { resolveUniswapV4Pool } from './nutboxSwap.js';

const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const Q96 = 1n << 96n;
const Q128 = 1n << 128n;
const UINT256_MODULUS = 1n << 256n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;
const MIN_TICK = -887272;
const MAX_TICK = 887272;
const DEADLINE_SECONDS = 20 * 60;
const LOG_CHUNK_SIZE = 2_000_000;
const LOG_QUERY_CONCURRENCY = 6;
const POSITION_ID_CACHE_MS = 30_000;
const positionIdCache = new Map();

const ACTIONS = {
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  SETTLE_PAIR: 0x0d,
  TAKE_PAIR: 0x11,
};

const POOL_KEY_TYPE = 'tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const PositionManagerABI = [
  'function modifyLiquidities(bytes unlockData,uint256 deadline) payable',
  `function getPoolAndPositionInfo(uint256 tokenId) view returns (${POOL_KEY_TYPE} poolKey,uint256 info)`,
  'function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
];
const StateViewABI = [
  'function getPositionInfo(bytes32 poolId,address owner,int24 tickLower,int24 tickUpper,bytes32 salt) view returns (uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128)',
  'function getFeeGrowthInside(bytes32 poolId,int24 tickLower,int24 tickUpper) view returns (uint256 feeGrowthInside0X128,uint256 feeGrowthInside1X128)',
];
const Permit2ABI = [
  'function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)',
  'function approve(address token,address spender,uint160 amount,uint48 expiration)',
];

function mulDiv(a, b, denominator) {
  return a * b / denominator;
}

function decodeInt24(value) {
  const masked = Number(BigInt(value) & 0xffffffn);
  return masked >= 0x800000 ? masked - 0x1000000 : masked;
}

function sortSqrtPrices(a, b) {
  return a < b ? [a, b] : [b, a];
}

export function getSqrtRatioAtTick(tick) {
  const safeTick = Math.trunc(tick);
  if (safeTick < MIN_TICK || safeTick > MAX_TICK) throw new Error('Tick is outside the Uniswap V4 range');
  const absTick = BigInt(safeTick < 0 ? -safeTick : safeTick);
  let ratio = (absTick & 0x1n) !== 0n
    ? 0xfffcb933bd6fad37aa2d162d1a594001n
    : 0x100000000000000000000000000000000n;
  const multipliers = [
    0xfff97272373d413259a46990580e213an,
    0xfff2e50f5f656932ef12357cf3c7fdccn,
    0xffe5caca7e10e4e61c3624eaa0941cd0n,
    0xffcb9843d60f6159c9db58835c926644n,
    0xff973b41fa98c081472e6896dfb254c0n,
    0xff2ea16466c96a3843ec78b326b52861n,
    0xfe5dee046a99a2a811c461f1969c3053n,
    0xfcbe86c7900a88aedcffc83b479aa3a4n,
    0xf987a7253ac413176f2b074cf7815e54n,
    0xf3392b0822b70005940c7a398e4b70f3n,
    0xe7159475a2c29b7443b29c7fa6e889d9n,
    0xd097f3bdfd2022b8845ad8f792aa5825n,
    0xa9f746462d870fdf8a65dc1f90e061e5n,
    0x70d869a156d2a1b890bb3df62baf32f7n,
    0x31be135f97d08fd981231505542fcfa6n,
    0x9aa508b5b7a84e1c677de54f3e99bc9n,
    0x5d6af8dedb81196699c329225ee604n,
    0x2216e584f5fa1ea926041bedfe98n,
    0x48a170391f7dc42444e8fa2n,
  ];
  multipliers.forEach((multiplier, index) => {
    if ((absTick & (1n << BigInt(index + 1))) !== 0n) ratio = ratio * multiplier >> 128n;
  });
  if (safeTick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  const remainder = ratio & ((1n << 32n) - 1n);
  return (ratio >> 32n) + (remainder === 0n ? 0n : 1n);
}

export function nearestUsableTick(tick, tickSpacing, mode = 'nearest') {
  const spacing = Math.max(1, Math.abs(Number(tickSpacing) || 1));
  const ratio = Number(tick) / spacing;
  const snapped = (mode === 'down' ? Math.floor(ratio) : mode === 'up' ? Math.ceil(ratio) : Math.round(ratio)) * spacing;
  const min = Math.ceil(MIN_TICK / spacing) * spacing;
  const max = Math.floor(MAX_TICK / spacing) * spacing;
  return Math.min(max, Math.max(min, snapped));
}

export function fullRangeTicks(tickSpacing) {
  return {
    tickLower: nearestUsableTick(MIN_TICK, tickSpacing, 'up'),
    tickUpper: nearestUsableTick(MAX_TICK, tickSpacing, 'down'),
  };
}

export function tickToNativePrice(tick, tokenDecimals = 18, nativeDecimals = 18) {
  const decimalScale = 10 ** (Number(tokenDecimals) - Number(nativeDecimals));
  return decimalScale / (1.0001 ** Number(tick));
}

export function nativePriceToTick(price, tickSpacing, tokenDecimals = 18, nativeDecimals = 18) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const decimalScale = 10 ** (Number(tokenDecimals) - Number(nativeDecimals));
  const rawRatio = decimalScale / price;
  return nearestUsableTick(Math.log(rawRatio) / Math.log(1.0001), tickSpacing);
}

export function rangeTicksFromPercent(currentPrice, percent, tickSpacing, tokenDecimals = 18, nativeDecimals = 18) {
  if (percent === 'full') return fullRangeTicks(tickSpacing);
  const width = Math.max(1, Number(percent)) / 100;
  const minPrice = Math.max(currentPrice * (1 - width), Number.MIN_VALUE);
  const maxPrice = currentPrice * (1 + width);
  let tickLower = nativePriceToTick(maxPrice, tickSpacing, tokenDecimals, nativeDecimals);
  let tickUpper = nativePriceToTick(minPrice, tickSpacing, tokenDecimals, nativeDecimals);
  if (tickLower >= tickUpper) tickUpper = nearestUsableTick(tickLower + Number(tickSpacing), tickSpacing, 'up');
  return { tickLower, tickUpper };
}

export function amountsForLiquidity(sqrtPriceX96, tickCurrent, tickLower, tickUpper, liquidity) {
  const sqrtLower = getSqrtRatioAtTick(tickLower);
  const sqrtUpper = getSqrtRatioAtTick(tickUpper);
  const [sa, sb] = sortSqrtPrices(sqrtLower, sqrtUpper);
  let amount0 = 0n;
  let amount1 = 0n;
  if (tickCurrent < tickLower) {
    amount0 = mulDiv(mulDiv(liquidity, sb - sa, sb), Q96, sa);
  } else if (tickCurrent < tickUpper) {
    amount0 = mulDiv(mulDiv(liquidity, sb - sqrtPriceX96, sb), Q96, sqrtPriceX96);
    amount1 = mulDiv(liquidity, sqrtPriceX96 - sa, Q96);
  } else {
    amount1 = mulDiv(liquidity, sb - sa, Q96);
  }
  return { amount0, amount1 };
}

export function liquidityForAmounts(sqrtPriceX96, tickCurrent, tickLower, tickUpper, amount0, amount1) {
  const sqrtLower = getSqrtRatioAtTick(tickLower);
  const sqrtUpper = getSqrtRatioAtTick(tickUpper);
  const [sa, sb] = sortSqrtPrices(sqrtLower, sqrtUpper);
  let liquidity;
  if (tickCurrent < tickLower) {
    liquidity = mulDiv(mulDiv(amount0, sa, Q96), sb, sb - sa);
  } else if (tickCurrent < tickUpper) {
    const liquidity0 = mulDiv(mulDiv(amount0, sqrtPriceX96, Q96), sb, sb - sqrtPriceX96);
    const liquidity1 = mulDiv(amount1, Q96, sqrtPriceX96 - sa);
    liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  } else {
    liquidity = mulDiv(amount1, Q96, sb - sa);
  }
  return liquidity;
}

function poolIdFromKey(poolKey) {
  return ethers.keccak256(abiCoder.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
  ));
}

function encodeActions(actions, params) {
  const actionBytes = ethers.concat(actions.map(action => ethers.toBeHex(action, 1)));
  return abiCoder.encode(['bytes', 'bytes[]'], [actionBytes, params]);
}

function applySlippageMax(amount, slippageBps) {
  return amount + amount * BigInt(slippageBps) / 10_000n;
}

function applySlippageMin(amount, slippageBps) {
  return amount - amount * BigInt(slippageBps) / 10_000n;
}

function subtractUint256(current, previous) {
  return current >= previous ? current - previous : UINT256_MODULUS - previous + current;
}

export function supportsCurrentUniswapV4Pool({ community, contracts }) {
  return Number(community?.dexVersion) === 4
    && ethers.isHexString(community?.tradePair, 32)
    && ethers.isAddress(contracts?.UniswapV4Manager)
    && ethers.isAddress(contracts?.UniswapV4PositionManager)
    && ethers.isAddress(contracts?.Permit2);
}

export async function loadCurrentUniswapV4Pool({ community, contracts, readProvider, tokenAddress, tokenDecimals, nativeDecimals }) {
  if (!supportsCurrentUniswapV4Pool({ community, contracts })) throw new Error('This liquidity manager only supports the current Uniswap V4 pool');
  const pool = await resolveUniswapV4Pool({
    poolId: community.tradePair,
    poolManager: contracts.UniswapV4Manager,
    readProvider,
  });
  const normalizedToken = ethers.getAddress(tokenAddress);
  const currencies = [pool.currency0.toLowerCase(), pool.currency1.toLowerCase()];
  if (!currencies.includes(normalizedToken.toLowerCase()) || !currencies.includes(ethers.ZeroAddress)) {
    throw new Error('The configured pool is not the current community token/native pair');
  }
  const currentPrice = tickToNativePrice(pool.tick, tokenDecimals, nativeDecimals);
  return { ...pool, poolId: community.tradePair, currentPrice };
}

async function ensurePermit2Allowance({ tokenAddress, amount, account, signer, permit2Address, spender, onApproval }) {
  if (amount <= 0n) return;
  const token = new ethers.Contract(tokenAddress, ERC20ABI, signer);
  const currentTokenAllowance = await token.allowance(account, permit2Address);
  if (currentTokenAllowance < amount) {
    onApproval?.('token');
    const approval = await token.approve(permit2Address, ethers.MaxUint256);
    await approval.wait();
  }
  const permit2 = new ethers.Contract(permit2Address, Permit2ABI, signer);
  const allowance = await permit2.allowance(account, tokenAddress, spender);
  if (BigInt(allowance.amount ?? allowance[0]) < amount || Number(allowance.expiration ?? allowance[1]) <= Math.floor(Date.now() / 1000)) {
    onApproval?.('permit2');
    const approval = await permit2.approve(tokenAddress, spender, MAX_UINT160, MAX_UINT48);
    await approval.wait();
  }
}

export async function addCurrentUniswapV4Liquidity({
  pool, amountNative, amountToken, tickLower, tickUpper, slippageBps,
  account, signer, contracts, onApproval,
}) {
  const positionManagerAddress = ethers.getAddress(contracts.UniswapV4PositionManager);
  const nativeIsCurrency0 = pool.currency0 === ethers.ZeroAddress;
  const amount0 = nativeIsCurrency0 ? amountNative : amountToken;
  const amount1 = nativeIsCurrency0 ? amountToken : amountNative;
  const liquidity = liquidityForAmounts(pool.sqrtPriceX96, pool.tick, tickLower, tickUpper, amount0, amount1);
  if (liquidity <= 0n || liquidity > MAX_UINT128) throw new Error('Invalid liquidity amount');
  const amount0Max = applySlippageMax(amount0, slippageBps);
  const amount1Max = applySlippageMax(amount1, slippageBps);
  if (pool.currency0 !== ethers.ZeroAddress) {
    await ensurePermit2Allowance({ tokenAddress: pool.currency0, amount: amount0Max, account, signer, permit2Address: contracts.Permit2, spender: positionManagerAddress, onApproval });
  }
  if (pool.currency1 !== ethers.ZeroAddress) {
    await ensurePermit2Allowance({ tokenAddress: pool.currency1, amount: amount1Max, account, signer, permit2Address: contracts.Permit2, spender: positionManagerAddress, onApproval });
  }

  const mintParams = abiCoder.encode(
    [`tuple(${POOL_KEY_TYPE} poolKey,int24 tickLower,int24 tickUpper,uint256 liquidity,uint128 amount0Max,uint128 amount1Max,address owner,bytes hookData)`],
    [[[pool.currency0, pool.currency1, pool.fee, pool.tickSpacing, pool.hooks], tickLower, tickUpper, liquidity, amount0Max, amount1Max, account, '0x']],
  );
  const settleParams = abiCoder.encode(['address', 'address'], [pool.currency0, pool.currency1]);
  const unlockData = encodeActions([ACTIONS.MINT_POSITION, ACTIONS.SETTLE_PAIR], [mintParams, settleParams]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
  const positionManager = new ethers.Contract(positionManagerAddress, PositionManagerABI, signer);
  const nativeValue = nativeIsCurrency0 ? amount0Max : amount1Max;
  const tx = await positionManager.modifyLiquidities(unlockData, deadline, { value: nativeValue, gasLimit: 3_000_000n });
  return tx.wait();
}

async function queryFilterInChunks(positionManager, filter, fromBlock, toBlock) {
  const ranges = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_SIZE) {
    ranges.push([start, Math.min(toBlock, start + LOG_CHUNK_SIZE - 1)]);
  }
  const results = [];
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(LOG_QUERY_CONCURRENCY, ranges.length) },
    async () => {
      while (cursor < ranges.length) {
        const rangeIndex = cursor;
        cursor += 1;
        const [start, end] = ranges[rangeIndex];
        results[rangeIndex] = await positionManager.queryFilter(filter, start, end);
      }
    },
  );
  await Promise.all(workers);
  return results.flat();
}

async function queryTransferLogs(positionManager, filter, fromBlock, toBlock) {
  try {
    // Robinhood Chain can resolve an address-indexed Transfer query across the
    // full PositionManager history in a single request (normally sub-second).
    return await positionManager.queryFilter(filter, fromBlock, toBlock);
  } catch (error) {
    if (toBlock - fromBlock < LOG_CHUNK_SIZE) throw error;
    // Some RPC providers impose a maximum block range. Fall back to a bounded,
    // concurrent scan instead of making hundreds of sequential requests.
    return queryFilterInChunks(positionManager, filter, fromBlock, toBlock);
  }
}

async function queryOwnedPositionIds(positionManager, account, readProvider, fromBlock, forceRefresh = false) {
  const latest = await readProvider.getBlockNumber();
  const firstBlock = Math.max(0, Number(fromBlock) || 0);
  const cacheKey = `${String(positionManager.target).toLowerCase()}:${account.toLowerCase()}:${firstBlock}`;
  const cached = positionIdCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.updatedAt < POSITION_ID_CACHE_MS) {
    return cached.tokenIds;
  }
  if (!forceRefresh && cached?.request) return cached.request;

  const incomingFilter = positionManager.filters.Transfer(null, account);
  const outgoingFilter = positionManager.filters.Transfer(account, null);
  const request = (async () => {
    const [incoming, outgoing] = await Promise.all([
      queryTransferLogs(positionManager, incomingFilter, firstBlock, latest),
      queryTransferLogs(positionManager, outgoingFilter, firstBlock, latest),
    ]);
    const logs = [...incoming, ...outgoing];
    logs.sort((a, b) => a.blockNumber - b.blockNumber || (a.index ?? 0) - (b.index ?? 0));
    const owned = new Set();
    logs.forEach((log) => {
      const from = String(log.args?.from || '').toLowerCase();
      const to = String(log.args?.to || '').toLowerCase();
      const tokenId = log.args?.tokenId;
      if (tokenId == null) return;
      if (to === account.toLowerCase()) owned.add(tokenId.toString());
      if (from === account.toLowerCase() && to !== account.toLowerCase()) owned.delete(tokenId.toString());
    });
    return [...owned].map(BigInt);
  })();

  positionIdCache.set(cacheKey, { request, tokenIds: cached?.tokenIds || [], updatedAt: cached?.updatedAt || 0 });
  try {
    const tokenIds = await request;
    positionIdCache.set(cacheKey, { request: null, tokenIds, updatedAt: Date.now() });
    return tokenIds;
  } catch (error) {
    positionIdCache.delete(cacheKey);
    throw error;
  }
}

export async function loadCurrentUniswapV4Positions({
  pool, account, contracts, readProvider, deploymentBlock = 0, forceRefresh = false,
}) {
  if (!account) return [];
  const positionManager = new ethers.Contract(contracts.UniswapV4PositionManager, PositionManagerABI, readProvider);
  const stateView = ethers.isAddress(contracts.UniswapV4StateView)
    ? new ethers.Contract(contracts.UniswapV4StateView, StateViewABI, readProvider)
    : null;
  const tokenIds = await queryOwnedPositionIds(positionManager, account, readProvider, deploymentBlock, forceRefresh);
  const positions = await Promise.all(tokenIds.map(async (tokenId) => {
    try {
      const [poolAndInfo, liquidity] = await Promise.all([
        positionManager.getPoolAndPositionInfo(tokenId),
        positionManager.getPositionLiquidity(tokenId),
      ]);
      if (liquidity <= 0n) return null;
      const keyResult = poolAndInfo.poolKey ?? poolAndInfo[0];
      const info = BigInt(poolAndInfo.info ?? poolAndInfo[1]);
      const poolKey = {
        currency0: keyResult.currency0 ?? keyResult[0],
        currency1: keyResult.currency1 ?? keyResult[1],
        fee: Number(keyResult.fee ?? keyResult[2]),
        tickSpacing: Number(keyResult.tickSpacing ?? keyResult[3]),
        hooks: keyResult.hooks ?? keyResult[4],
      };
      if (poolIdFromKey(poolKey).toLowerCase() !== pool.poolId.toLowerCase()) return null;
      const tickLower = decodeInt24(info >> 8n);
      const tickUpper = decodeInt24(info >> 32n);
      const amounts = amountsForLiquidity(pool.sqrtPriceX96, pool.tick, tickLower, tickUpper, liquidity);
      let fee0 = 0n;
      let fee1 = 0n;
      if (stateView) {
        try {
          const salt = ethers.zeroPadValue(ethers.toBeHex(tokenId), 32);
          const [positionState, currentFeeGrowth] = await Promise.all([
            stateView.getPositionInfo(pool.poolId, contracts.UniswapV4PositionManager, tickLower, tickUpper, salt),
            stateView.getFeeGrowthInside(pool.poolId, tickLower, tickUpper),
          ]);
          const positionLiquidity = BigInt(positionState.liquidity ?? positionState[0]);
          const feeGrowth0Last = BigInt(positionState.feeGrowthInside0LastX128 ?? positionState[1]);
          const feeGrowth1Last = BigInt(positionState.feeGrowthInside1LastX128 ?? positionState[2]);
          const feeGrowth0 = BigInt(currentFeeGrowth.feeGrowthInside0X128 ?? currentFeeGrowth[0]);
          const feeGrowth1 = BigInt(currentFeeGrowth.feeGrowthInside1X128 ?? currentFeeGrowth[1]);
          fee0 = subtractUint256(feeGrowth0, feeGrowth0Last) * positionLiquidity / Q128;
          fee1 = subtractUint256(feeGrowth1, feeGrowth1Last) * positionLiquidity / Q128;
        } catch (feeError) {
          console.warn(`Failed to read V4 fees for position ${tokenId}:`, feeError);
        }
      }
      return {
        tokenId, tickLower, tickUpper, liquidity,
        amount0: amounts.amount0,
        amount1: amounts.amount1,
        fee0,
        fee1,
        inRange: pool.tick >= tickLower && pool.tick < tickUpper,
      };
    } catch (error) {
      console.warn(`Failed to read V4 position ${tokenId}:`, error);
      return null;
    }
  }));
  return positions.filter(Boolean);
}

export async function collectCurrentUniswapV4Fees({ pool, position, account, signer, contracts }) {
  const collectParams = abiCoder.encode(
    ['uint256', 'uint256', 'uint128', 'uint128', 'bytes'],
    [position.tokenId, 0n, 0n, 0n, '0x'],
  );
  const takeParams = abiCoder.encode(['address', 'address', 'address'], [pool.currency0, pool.currency1, account]);
  const unlockData = encodeActions(
    [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
    [collectParams, takeParams],
  );
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
  const positionManager = new ethers.Contract(contracts.UniswapV4PositionManager, PositionManagerABI, signer);
  const tx = await positionManager.modifyLiquidities(unlockData, deadline, { gasLimit: 1_000_000n });
  return tx.wait();
}

export async function removeCurrentUniswapV4Liquidity({
  pool, position, percent, slippageBps, account, signer, contracts,
}) {
  const liquidity = position.liquidity * BigInt(Math.round(percent)) / 100n;
  if (liquidity <= 0n) throw new Error('Invalid remove amount');
  const amounts = amountsForLiquidity(pool.sqrtPriceX96, pool.tick, position.tickLower, position.tickUpper, liquidity);
  const amount0Min = applySlippageMin(amounts.amount0, slippageBps);
  const amount1Min = applySlippageMin(amounts.amount1, slippageBps);
  const burn = percent >= 100;
  const modifyParams = burn
    ? abiCoder.encode(['uint256', 'uint128', 'uint128', 'bytes'], [position.tokenId, amount0Min, amount1Min, '0x'])
    : abiCoder.encode(['uint256', 'uint256', 'uint128', 'uint128', 'bytes'], [position.tokenId, liquidity, amount0Min, amount1Min, '0x']);
  const takeParams = abiCoder.encode(['address', 'address', 'address'], [pool.currency0, pool.currency1, account]);
  const unlockData = encodeActions(
    [burn ? ACTIONS.BURN_POSITION : ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
    [modifyParams, takeParams],
  );
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
  const positionManager = new ethers.Contract(contracts.UniswapV4PositionManager, PositionManagerABI, signer);
  const tx = await positionManager.modifyLiquidities(unlockData, deadline, { gasLimit: 3_000_000n });
  return tx.wait();
}

export function readableLiquidityError(error, zh) {
  const message = String(error?.shortMessage || error?.reason || error?.message || '');
  if (/user rejected|user denied|action_rejected/i.test(message)) return zh ? '你取消了钱包操作' : 'The wallet action was cancelled';
  if (/insufficient funds/i.test(message)) return zh ? '原生币余额不足，请预留 Gas' : 'Insufficient native balance; keep some for gas';
  if (/allowance|transfer amount exceeds/i.test(message)) return zh ? '代币余额或授权额度不足' : 'Insufficient token balance or allowance';
  if (/deadline/i.test(message)) return zh ? '交易已过期，请重试' : 'The transaction expired; try again';
  return message.split('\n')[0].slice(0, 180) || (zh ? '流动性操作失败' : 'Liquidity action failed');
}
