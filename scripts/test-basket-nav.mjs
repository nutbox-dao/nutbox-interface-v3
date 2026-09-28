import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, ZeroAddress, ZeroHash, parseEther } from 'ethers';
import { readBasketNativeNav } from '../src/utils/basketNav.js';

const basketAddress = '0x1111111111111111111111111111111111111111';
const executorAddress = '0x2222222222222222222222222222222222222222';
const assets = ['0x3333333333333333333333333333333333333333', '0x4444444444444444444444444444444444444444'];

function fixture(chainId = 4663, version = 3) {
  const bsc = chainId === 56;
  const poolType = bsc ? '(address,address,address,address,uint24,bytes32)' : '(address,address,uint24,int24,address)';
  const routeType = version >= 3 ? `(uint8,address,${poolType},uint24,uint16)`
    : bsc ? `(uint8,uint8,${poolType},uint24)` : `(uint8,${poolType},uint24)`;
  const pool = bsc ? [ZeroAddress, assets[0], ZeroAddress, executorAddress, 3000, ZeroHash]
    : [ZeroAddress, assets[0], 3000, 60, ZeroAddress];
  const route = version >= 3 ? [1, assets[1], pool, 3000, 100]
    : bsc ? [1, 0, pool, 3000] : [1, pool, 3000];
  const quote = bsc ? 'quoteAssetToWbnb' : 'quoteAssetToWeth';
  const abi = new Interface([
    'function effectiveSupply() view returns(uint256)',
    'function rebalanceExecutor() view returns(address)',
    'function assetCount() view returns(uint256)',
    'function assetAt(uint256) view returns(address,uint16,uint256)',
    `function assetRouteAt(uint256) view returns(${routeType})`,
    `function ${quote}(${routeType},address,uint256) view returns(uint256)`,
  ]);
  const state = { supply: 50_000_000n, values: [parseEther('1'), parseEther('3')], reserves: [123n, 456n], blockReads: 0 };
  const provider = {
    async getBlockNumber() {
      return 123 + state.blockReads++;
    },
    async call(tx) {
      assert.equal(tx.blockTag, 123);
      const { name, args } = abi.parseTransaction(tx);
      assert.equal(tx.to.toLowerCase(), name === quote ? executorAddress : basketAddress);
      const index = name === 'assetAt' || name === 'assetRouteAt' ? Number(args[0]) : -1;
      let result;
      if (name === 'effectiveSupply') result = [state.supply];
      else if (name === 'rebalanceExecutor') result = [executorAddress];
      else if (name === 'assetCount') result = [2n];
      else if (name === 'assetAt') result = [assets[index], 5000, state.reserves[index]];
      else if (name === 'assetRouteAt') result = [route];
      else {
        assert.equal(name, quote);
        assert.deepEqual(args[0].toArray(true), abi.decodeFunctionResult('assetRouteAt',
          abi.encodeFunctionResult('assetRouteAt', [route]))[0].toArray(true));
        const assetIndex = assets.indexOf(args[1]);
        assert.equal(args[2], state.reserves[assetIndex]);
        if (state.values[assetIndex] === null) throw new Error('price read failed');
        result = [state.values[assetIndex]];
      }
      return abi.encodeFunctionResult(name, result);
    },
  };
  return { state, input: { provider, address: basketAddress, chainId, version, decimals: 6 } };
}

for (const [chainId, version] of [[4663, 1], [4663, 3], [56, 2], [56, 3], [56, 4]]) {
  test(`chain ${chainId} Basket V${version}: values all active reserves per effective share without AMM funds`, async () => {
    const { input } = fixture(chainId, version);
    assert.equal(await readBasketNativeNav(input), parseEther('0.08'));
  });
}

test('never reports a partial NAV when a funded constituent fails or returns zero', async () => {
  const { input, state } = fixture();
  state.values[1] = null;
  await assert.rejects(readBasketNativeNav(input), /price read failed/);
  state.blockReads = 0;
  state.values[1] = 0n;
  await assert.rejects(readBasketNativeNav(input), /price unavailable/);
});

test('zero reserves contribute zero, while zero effective supply is unavailable', async () => {
  const { input, state } = fixture();
  state.reserves[1] = 0n;
  state.values[1] = null;
  assert.equal(await readBasketNativeNav(input), parseEther('0.02'));
  state.blockReads = 0;
  state.supply = 0n;
  await assert.rejects(readBasketNativeNav(input), /NAV unavailable/);
});

test('pins every NAV read to one RPC height, ignoring a contract block number', async () => {
  const { input, state } = fixture();
  // RH contract block.number differs from eth_blockNumber. A stale caller must
  // never direct these reads to unavailable historical state using that value.
  assert.equal(await readBasketNativeNav({ ...input, blockTag: 42 }), parseEther('0.08'));
  assert.equal(state.blockReads, 1);
});
