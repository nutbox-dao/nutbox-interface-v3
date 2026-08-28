import { ethers } from 'ethers';

const BSC_CHAIN_ID = 56;
const MAX_BASKET_ASSETS = 64;

/**
 * Basket buy hooks require one explicit minimum per constituent. Supplying an
 * empty hook payload makes the hook derive its own minima from spot prices;
 * that fallback does not account for every pool fee and can reject otherwise
 * valid buybacks. The AMM-level minIndexOut remains the aggregate slippage
 * guard, while these non-zero leg minima bypass the inaccurate fallback.
 */
export function encodeIndexBuybackHookData({ chainId, version, assetCount }) {
  const count = Number(assetCount);
  if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_BASKET_ASSETS) {
    throw new Error(`Invalid basket asset count: ${assetCount}`);
  }

  const legMins = Array.from({ length: count }, () => 1n);
  const common = [
    ethers.ZeroAddress,
    0n,
    0n,
    legMins,
    [],
  ];
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  if (Number(chainId) === BSC_CHAIN_ID && Number(version) >= 3) {
    return abiCoder.encode(
      ['tuple(address,uint256,uint256,uint256[],uint160[],uint160,bool[])'],
      [[...common, 0n, []]],
    );
  }

  if (Number(chainId) === BSC_CHAIN_ID) {
    return abiCoder.encode(
      ['tuple(address,uint256,uint256,uint256[],uint160[],uint160,uint160,bool[])'],
      [[...common, 0n, 0n, []]],
    );
  }

  return abiCoder.encode(
    ['tuple(address,uint256,uint256,uint256[],uint160[],uint160,bool[])'],
    [[...common, 0n, []]],
  );
}
