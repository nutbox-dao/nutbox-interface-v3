import { ethers } from 'ethers';

export const TradeCurationABI = ['function totalClaimed() view returns (uint256)'];
export const TradeCurationFactoryABI = ['function createdPoolOfCommunity(address) view returns (bool)'];

export async function prepareTradeCurationPool({ chainId, contracts, readProvider, communityAddress }) {
  const factoryAddress = contracts.TradeCurationFactory;
  if (Number(chainId) !== 56 || !ethers.isAddress(factoryAddress) || factoryAddress === ethers.ZeroAddress) {
    throw new Error('Trade curation is not available on this network');
  }
  const factory = new ethers.Contract(factoryAddress, TradeCurationFactoryABI, readProvider);
  const committee = new ethers.Contract(contracts.Committee, ['function verifyContract(address) view returns (bool)'], readProvider);
  const [created, approved] = await Promise.all([
    factory.createdPoolOfCommunity(communityAddress), committee.verifyContract(factoryAddress),
  ]);
  // The factory remembers closed pools too: closing a pool cannot permit a second one.
  if (created) throw new Error('This community already has a trade-curation pool (including closed pools)');
  if (!approved) throw new Error('The trade-curation factory is not approved by the committee');
  return { factoryAddress, meta: '0x' };
}

export function tradePoolRewardRate(rewardRate, feeRatio, poolRatio) {
  if (rewardRate == null || poolRatio == null) return null;
  const fee = BigInt(feeRatio ?? 0);
  const ratio = BigInt(poolRatio);
  if (fee < 0n || fee > 10000n || ratio < 0n || ratio > 10000n) return null;
  return BigInt(rewardRate) * (10000n - fee) / 10000n * ratio / 10000n;
}
