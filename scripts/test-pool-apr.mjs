import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { annualizeRewards, stakingAprBps, readPoolApr } from '../src/utils/poolApr.js';

const addr = n => `0x${n.toString(16).padStart(40, '0')}`;
const rewardToken = addr(1), stakeToken = addr(2), asset = addr(3), community = addr(4), pool = addr(5), calculator = addr(6);
const unit = 10n ** 18n;
const position = { annual: 365n * unit, staked: 10n * unit, stakeToken, rewardToken, active: true,
  pair: { token0: rewardToken, token1: asset, reserve0: 1000n * unit, reserve1: 100n * 10n ** 6n, supply: 100n * unit } };

test('selects hourly, daily, equal, and zero annualized rewards', () => {
  assert.equal(annualizeRewards(10n, 100n), 87600n);
  assert.equal(annualizeRewards(1n, 100n), 36500n);
  assert.equal(annualizeRewards(10n, 240n), 87600n);
  assert.equal(annualizeRewards(0n, 0n), 0n);
});
test('LP value includes both sides and only the staked share, with mixed token decimals', () => {
  assert.equal(stakingAprBps(position), 18250n);
  assert.equal(stakingAprBps({ ...position, staked: 20n * unit }), 9125n);
  const p = position.pair;
  assert.equal(stakingAprBps({ ...position, pair: { ...p, token0: p.token1, token1: p.token0, reserve0: p.reserve1, reserve1: p.reserve0 } }), 18250n);
});
test('same-token staking uses token principal; unrelated tokens never assume equal value', () => {
  assert.equal(stakingAprBps({ ...position, stakeToken: rewardToken }), 365000n);
  assert.equal(stakingAprBps({ ...position, pair: undefined }), null);
  assert.equal(stakingAprBps({ ...position, rewardToken: addr(9) }), null);
});
test('empty stake, empty LP, inactive and zero rewards have explicit results', () => {
  assert.equal(stakingAprBps({ ...position, staked: 0n }), null);
  assert.equal(stakingAprBps({ ...position, pair: { ...position.pair, supply: 0n } }), null);
  assert.equal(stakingAprBps({ ...position, pair: { ...position.pair, reserve1: 0n } }), null);
  assert.equal(stakingAprBps({ ...position, active: false }), 0n);
  assert.equal(stakingAprBps({ ...position, annual: 0n }), 0n);
});

const abi = new Interface([
  'function rewardCalculator() view returns(address)', 'function feeRatio() view returns(uint16)',
  'function poolActived(address) view returns(bool)', 'function totalStakedAmount() view returns(uint256)',
  'function stakeToken() view returns(address)', 'function rewardHead() view returns(uint256)',
  'function calculateReward(address,uint256,uint256) view returns(uint256)',
  'function token0() view returns(address)', 'function token1() view returns(address)',
  'function getReserves() view returns(uint112,uint112,uint32)', 'function totalSupply() view returns(uint256)',
]);
function fixture({ hourly = unit, daily = 100n * unit, ratio = 7000n } = {}) {
  const calls = [];
  const provider = {
    getBlock: async () => ({ number: 123, timestamp: 36123 }),
    getStorage: async (...args) => { assert.equal(args[2], 123); return `0x${ratio.toString(16).padStart(64, '0')}`; },
    call: async tx => {
      assert.equal(tx.blockTag, 123);
      const { name, args } = abi.parseTransaction(tx);
      calls.push({ name, args });
      const values = { rewardCalculator: calculator, feeRatio: 1000n, poolActived: true,
        totalStakedAmount: position.staked, stakeToken, rewardHead: 36000n,
        token0: rewardToken, token1: asset, totalSupply: position.pair.supply };
      let result = name === 'getReserves' ? [position.pair.reserve0, position.pair.reserve1, 0]
        : [name === 'calculateReward' ? (args[2] - args[1] === 3600n ? hourly : daily) : values[name]];
      return abi.encodeFunctionResult(name, result);
    },
  };
  return { calls, input: { provider, community, pool, stakeToken, rewardToken,
    contracts: { HourlyTickCalculator: calculator }, network: { blocksPerYear: 10512000 } } };
}
test('reads both horizons, live allocation and DAO fee at one block, then values LP', async () => {
  const { input, calls } = fixture();
  const apr = await readPoolApr(input);
  assert.equal(apr, 1149750n); // 100 T/day * 90% * 70% * 365 / 200 T staked.
  assert.deepEqual(calls.filter(c => c.name === 'calculateReward').map(c => Array.from(c.args)),
    [[community, 36000n, 39600n], [community, 36000n, 122400n]]);
});
test('hourly can exceed daily; a zero pool allocation stays zero', async () => {
  const { input } = fixture({ hourly: 10n * unit, daily: 100n * unit });
  assert.equal(await readPoolApr(input), 2759400n);
  assert.equal(await readPoolApr(fixture({ ratio: 0n }).input), 0n);
});
test('unsupported calculators and invalid allocation fail without a fabricated APR', async () => {
  const { input } = fixture(); input.contracts = {};
  await assert.rejects(readPoolApr(input), /Unsupported/);
  await assert.rejects(readPoolApr(fixture({ ratio: 10001n }).input), /Invalid pool reward ratio/);
});
