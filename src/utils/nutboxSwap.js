import { ethers } from 'ethers';
import { PancakeV4CLPoolManagerABI } from '../config/abis';

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

export const NUTBOX_SWAP_SOURCE_TYPES = {
  V2_PAIR: 0,
  V3_POOL: 1,
  PANCAKE_V4_CL: 3,
};

function requireAddress(value, label) {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${label} is unavailable`);
  }
  return ethers.getAddress(value);
}

/**
 * Build the caller-supplied DEX source expected by TagAI's BSC
 * ImportedTokenSwapWrapper (the Nutbox swap wrapper used by this UI).
 */
export async function buildNutboxSwapSource({ dexVersion, pair, contracts, readProvider }) {
  const version = Number(dexVersion);

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
