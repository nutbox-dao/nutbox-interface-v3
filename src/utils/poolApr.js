import { Contract, AbiCoder, keccak256 } from 'ethers';

const communityAbi = [
  'function rewardCalculator() view returns (address)',
  'function feeRatio() view returns (uint16)',
  'function poolActived(address) view returns (bool)',
];
const calculatorAbi = [
  'function rewardHead() view returns (uint256)',
  'function calculateReward(address,uint256,uint256) view returns (uint256)',
];
const pairAbi = [
  'function token0() view returns (address)', 'function token1() view returns (address)',
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function totalSupply() view returns (uint256)',
];
const same = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export function annualizeRewards(hourly, daily) {
  return hourly * 8760n > daily * 365n ? hourly * 8760n : daily * 365n;
}

// All amounts stay in raw units of the reward token. No assumption that 1 LP = 1 reward token.
export function stakingAprBps({ annual, staked, stakeToken, rewardToken, pair, active }) {
  if (staked <= 0n) return null;
  if (!active) return 0n;
  if (same(stakeToken, rewardToken)) return annual * 10000n / staked;
  if (!pair || pair.supply <= 0n || pair.reserve0 <= 0n || pair.reserve1 <= 0n) return null;
  const reserve = same(pair.token0, rewardToken) ? pair.reserve0
    : same(pair.token1, rewardToken) ? pair.reserve1 : null;
  // Without a reward-token side, a separate price source is required.
  if (reserve === null) return null;
  return annual * pair.supply * 10000n / (2n * reserve * staked);
}

export async function readPoolApr({ provider, community, pool, stakeToken, rewardToken, contracts, network }) {
  const block = await provider.getBlock('latest');
  const at = { blockTag: block.number };
  const c = new Contract(community, communityAbi, provider);
  const staking = new Contract(pool, [
    'function totalStakedAmount() view returns (uint256)', 'function stakeToken() view returns (address)',
  ], provider);
  const slot = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [pool, 10n]));
  const [calculator, fee, active, staked, rawRatio, actualStakeToken] = await Promise.all([
    c.rewardCalculator(at), c.feeRatio(at), c.poolActived(pool, at),
    staking.totalStakedAmount(at), provider.getStorage(community, slot, block.number), staking.stakeToken(at),
  ]);
  if (!same(actualStakeToken, stakeToken)) throw new Error('Stake token changed');
  if (!rawRatio || fee > 10000n) throw new Error('Pool reward ratio unavailable');
  const ratio = BigInt(rawRatio);
  if (ratio > 10000n) throw new Error('Invalid pool reward ratio');
  if (staked === 0n) return null;
  if (!active) return 0n;

  let hour, day;
  if (same(calculator, contracts.HourlyTickCalculator) || same(calculator, contracts.LinearTimeCalculator)) {
    hour = 3600n; day = 86400n;
  } else if (same(calculator, contracts.LinearCalculator)) {
    hour = BigInt(network.blocksPerYear) / 8760n;
    day = BigInt(network.blocksPerYear) / 365n;
  } else {
    throw new Error('Unsupported reward calculator');
  }
  const calc = new Contract(calculator, calculatorAbi, provider);
  const head = await calc.rewardHead(at);
  const [grossHourly, grossDaily] = await Promise.all([
    calc.calculateReward(community, head, head + hour, at),
    calc.calculateReward(community, head, head + day, at),
  ]);
  const net = gross => gross * (10000n - fee) / 10000n * ratio / 10000n;
  const annual = annualizeRewards(net(grossHourly), net(grossDaily));

  let pair;
  if (!same(stakeToken, rewardToken)) {
    const lp = new Contract(stakeToken, pairAbi, provider);
    const [token0, token1, reserves, supply] = await Promise.all([
      lp.token0(at), lp.token1(at), lp.getReserves(at), lp.totalSupply(at),
    ]);
    pair = { token0, token1, reserve0: reserves[0], reserve1: reserves[1], supply };
  }
  return stakingAprBps({ annual, staked, stakeToken, rewardToken, pair, active });
}
