import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Interface } from 'ethers';
import { ERC20ABI, ERC20StakingABI, Multicall3ABI } from '../src/config/abis.js';
import { readV2LpPoolNames } from '../src/utils/poolDisplayName.js';

const multicall = '0xcA11bde05977b3631167028862bE2a173976CA11';
const aggregate = new Interface(Multicall3ABI);
const functions = new Interface([
  ...ERC20ABI,
  ERC20StakingABI.find(fragment => fragment.includes('stakeToken()')),
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]);
const address = value => `0x${value.toString(16).padStart(40, '0')}`;

function fixture(stages) {
  let blockReads = 0;
  let nextBatch = 0;
  return {
    provider: {
      getBlockNumber: async () => { blockReads++; return 123456; },
      call: async tx => {
        assert.equal(tx.to.toLowerCase(), multicall.toLowerCase());
        assert.equal(tx.blockTag, 123456);
        const parsed = aggregate.parseTransaction(tx);
        assert.equal(parsed.name, 'aggregate3');
        const expected = stages[nextBatch++];
        assert.ok(expected, 'Unexpected Multicall batch');
        assert.deepEqual(parsed.args[0].map(call => [
          call.target.toLowerCase(),
          functions.parseTransaction({ data: call.callData }).name,
          call.allowFailure,
        ]), expected.map(([target, name]) => [target, name, true]));
        return aggregate.encodeFunctionResult('aggregate3', [expected.map(([, name, value]) => (
          value === null ? { success: false, returnData: '0x' } : {
            success: true,
            returnData: value === undefined ? '0x' : functions.encodeFunctionResult(name, [value]),
          }
        ))]);
      },
    },
    verify() {
      assert.equal(blockReads, 1);
      assert.equal(nextBatch, stages.length);
    },
  };
}

test('reads V2 pairs and constituent names for newer pools and pools without an indexed asset', async () => {
  const [firstPool, secondPool, ordinaryPool, firstPair, secondPair, ordinaryToken, index, btc, eth] =
    Array.from({ length: 9 }, (_, i) => address(i + 1));
  const f = fixture([
    [[secondPool, 'stakeToken', secondPair]],
    [
      [firstPair, 'token0', btc], [firstPair, 'token1', index],
      [secondPair, 'token0', index], [secondPair, 'token1', eth],
      [ordinaryToken, 'token0', null], [ordinaryToken, 'token1', undefined],
    ],
    [
      [index, 'name', 'AI PRO'], [index, 'symbol', 'AIPRO'],
      [btc, 'name', 'Bitcoin'], [btc, 'symbol', 'BTC'],
      [eth, 'name', 'Wrapped Ether'], [eth, 'symbol', null],
    ],
  ]);
  const names = await readV2LpPoolNames(f.provider, multicall, {
    cToken: index,
    tokenVersion: 19,
    pools: [
      { id: firstPool, poolType: 'ERC20_STAKING', asset: firstPair, name: 'V2 LP Staking' },
      { id: secondPool, poolType: 'ERC20_LOCKING', name: 'V2 LP Staking' },
      { id: ordinaryPool, poolType: 'ERC20_STAKING', asset: ordinaryToken, name: 'Staking' },
      { id: address(10), poolType: 'NFT_MINING', asset: address(11) },
    ],
  });
  assert.deepEqual([...names], [
    [firstPool, { displayName: 'AIPRO / BTC', displaySubtitle: 'AI PRO / Bitcoin' }],
    [secondPool, { displayName: 'AIPRO / Wrapped Ether', displaySubtitle: 'AI PRO / Wrapped Ether' }],
  ]);
  f.verify();
});

test('keeps the fixed block across Multicall shards and rejects partial pair metadata', async () => {
  const assets = Array.from({ length: 76 }, (_, i) => address(i + 1));
  const firstToken = address(100);
  const secondToken = address(101);
  const calls = assets.flatMap(asset => [[asset, 'token0', firstToken], [asset, 'token1', secondToken]]);
  const f = fixture([
    calls.slice(0, 150), calls.slice(150),
    [[firstToken, 'name', 'First'], [firstToken, 'symbol', 'ONE'],
      [secondToken, 'name', null], [secondToken, 'symbol', null]],
  ]);
  const pool = (asset, i) => ({ id: address(i + 200), poolType: 'ERC20_STAKING', asset });
  const warnings = [];
  const originalWarn = console.warn;
  try {
    console.warn = message => warnings.push(message);
    const names = await readV2LpPoolNames(f.provider, multicall, { pools: assets.map(pool) });
    assert.equal(names.size, 0);
    assert.ok(warnings.some(warning => warning.includes('Could not resolve both V2 LP token names')));
  } finally {
    console.warn = originalWarn;
  }
  f.verify();
});
