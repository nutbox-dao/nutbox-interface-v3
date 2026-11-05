import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Interface, AbiCoder, keccak256, toBeHex } from 'ethers';
import { Multicall3ABI, PancakeV4CLPoolManagerABI } from '../src/config/abis.js';
import { INDEX_BROKER_SOURCE_TYPES as TYPES, getIndexBrokerV4PoolId } from '../src/utils/indexBrokerNft.js';
import { readIndexBrokerPriceSource } from '../src/utils/indexBrokerPriceSource.js';

const address = n => toBeHex(n, 20);
const [nftFactory, router, v2Factory, v3Factory, pancake, uniswap, community, wrapped, quote, pool, hooks] =
  Array.from({ length: 11 }, (_, index) => address(index + 1));
const multicall = '0xcA11bde05977b3631167028862bE2a173976CA11';
const snapshot = 123456;
const aggregate = new Interface(Multicall3ABI);
const methods = new Interface([
  ...PancakeV4CLPoolManagerABI,
  'function nutboxRouter() view returns (address)',
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint32,bool)',
  'function getPair(address,address) view returns (address)',
  'function getPool(address,address,uint24) view returns (address)',
  'function allowedV2Factory(address) view returns (bool)',
  'function allowedV3Factory(address) view returns (bool)',
  'function allowedUniswapV4Manager(address) view returns (bool)',
  'function allowedPancakeV4CLManager(address) view returns (bool)',
  'function wrappedNative() view returns (address)',
  'function validateRoute(address,address) view',
  'function extsload(bytes32) view returns (bytes32)',
  'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
]);
const contracts = {
  Multicall3: multicall,
  IndexBrokerNFTFactory: nftFactory,
  PancakeV2Factory: v2Factory,
  PancakeV3Factory: v3Factory,
  PancakeV4CLManager: pancake,
  UniswapV4Manager: uniswap,
};
const factoryRouter = [nftFactory, 'nutboxRouter', [], [router]];
const routerNative = [router, 'wrappedNative', [], [wrapped]];

function fixture(stages, initialize) {
  let batches = 0;
  let blockReads = 0;
  let logReads = 0;
  const provider = {
    getBlockNumber: async () => { blockReads++; return snapshot; },
    getLogs: async filter => {
      logReads++;
      assert.ok(initialize, 'Unexpected V4 log request');
      assert.deepEqual(filter, {
        address: uniswap,
        topics: initialize.topics.slice(0, 2),
        fromBlock: 0,
        toBlock: snapshot,
      });
      return [initialize];
    },
    call: async tx => {
      assert.equal(tx.to.toLowerCase(), multicall.toLowerCase());
      assert.equal(tx.blockTag, snapshot);
      const parsed = aggregate.parseTransaction(tx);
      assert.equal(parsed.name, 'aggregate3');
      const expected = stages[batches++];
      assert.ok(expected, 'Unexpected Multicall stage');
      assert.deepEqual(parsed.args[0].map(call => [call.target.toLowerCase(), call.callData, call.allowFailure]), expected.map(
        ([target, name, args]) => [target, methods.encodeFunctionData(name, args), name === 'validateRoute'],
      ));
      return aggregate.encodeFunctionResult('aggregate3', [expected.map(([, name, , output]) => ({
        success: output !== null,
        returnData: output === null ? '0x' : methods.encodeFunctionResult(name, output),
      }))]);
    },
  };
  return {
    read: (sourceType, poolId = pool) => readIndexBrokerPriceSource({
      readProvider: provider, contracts, sourceType, poolId, communityToken: community, zh: false,
    }),
    verify() {
      assert.equal(batches, stages.length);
      assert.equal(blockReads, 1);
      assert.equal(logReads, initialize ? 1 : 0);
    },
  };
}

function v2Stages(allowed = true, registered = pool) {
  return [
    [
      factoryRouter, [pool, 'factory', [], [v2Factory]], [pool, 'token0', [], [community]],
      [pool, 'token1', [], [wrapped]], [pool, 'getReserves', [], [10n, 20n, 0]],
    ],
    [
      [router, 'allowedV2Factory', [v2Factory], [allowed]], routerNative,
      [v2Factory, 'getPair', [community, wrapped], [registered]],
    ],
  ];
}

test('validates a manually entered V2 pair against its registered pool and NFT Factory Router', async () => {
  const f = fixture(v2Stages());
  assert.deepEqual(await f.read(TYPES.V2_PAIR), { sourceFactory: v2Factory });
  f.verify();
});

test('validates a V3 pool and its quote-token route at the same block', async () => {
  const stages = [
    [
      factoryRouter, [pool, 'factory', [], [v3Factory]], [pool, 'token0', [], [community]],
      [pool, 'token1', [], [quote]], [pool, 'fee', [], [500]], [pool, 'liquidity', [], [10n]],
      [pool, 'slot0', [], [1n, 0, 0, 0, 0, 0, true]],
    ],
    [
      [router, 'allowedV3Factory', [v3Factory], [true]], routerNative,
      [v3Factory, 'getPool', [community, quote, 500], [pool]],
    ],
  ];
  const f = fixture([...stages, [[router, 'validateRoute', [quote, wrapped], []]]]);
  assert.deepEqual(await f.read(TYPES.V3_POOL), { sourceFactory: v3Factory });
  f.verify();
  const missingRoute = fixture([...stages, [[router, 'validateRoute', [quote, wrapped], null]]]);
  await assert.rejects(missingRoute.read(TYPES.V3_POOL), /no Nutbox Router route/);
  missingRoute.verify();
});

test('resolves a Pancake V4 Pool ID and checks the PoolManager allowlist', async () => {
  const config = {
    sourcePoolManager: pancake, sourceCurrency0: community, sourceCurrency1: wrapped, sourceHooks: hooks,
    sourceFee: '500', sourceTickSpacing: '', sourceParameters: toBeHex(0, 32),
  };
  const id = getIndexBrokerV4PoolId({ sourceType: TYPES.PANCAKE_V4_CL, ...config });
  const f = fixture([
    [
      factoryRouter, [pancake, 'poolIdToPoolKey', [id], [[community, wrapped, hooks, pancake, 500, config.sourceParameters]]],
      [pancake, 'getSlot0', [id], [1n, 0, 0, 0]], [pancake, 'getLiquidity', [id], [10n]],
    ],
    [[router, 'allowedPancakeV4CLManager', [pancake], [true]], routerNative],
  ]);
  assert.deepEqual(await f.read(TYPES.PANCAKE_V4_CL, id), config);
  f.verify();
});

test('resolves a Uniswap V4 Pool ID with a pinned event lookup and Multicall state read', async () => {
  const config = {
    sourcePoolManager: uniswap, sourceCurrency0: community, sourceCurrency1: wrapped, sourceHooks: hooks,
    sourceFee: '500', sourceTickSpacing: '10', sourceParameters: '',
  };
  const id = getIndexBrokerV4PoolId({ sourceType: TYPES.UNISWAP_V4, ...config });
  const initialize = methods.encodeEventLog('Initialize', [id, community, wrapped, 500, 10, hooks, 1n, 0]);
  const slot = keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256'], [id, 6n]));
  const liquiditySlot = toBeHex(BigInt(slot) + 3n, 32);
  const f = fixture([
    [factoryRouter],
    [[uniswap, 'extsload', [slot], [toBeHex(1, 32)]], [uniswap, 'extsload', [liquiditySlot], [toBeHex(10, 32)]]],
    [[router, 'allowedUniswapV4Manager', [uniswap], [true]], routerNative],
  ], initialize);
  assert.deepEqual(await f.read(TYPES.UNISWAP_V4, id), config);
  f.verify();
});

test('rejects an unapproved source, a pool with a mismatched registration, and the wrong input format', async () => {
  const unsupported = fixture(v2Stages(false));
  await assert.rejects(unsupported.read(TYPES.V2_PAIR), /not supported by the Nutbox Router/);
  unsupported.verify();

  const unregistered = fixture(v2Stages(true, wrapped));
  await assert.rejects(unregistered.read(TYPES.V2_PAIR), /does not match the Factory registration/);
  unregistered.verify();

  await assert.rejects(fixture([]).read(TYPES.PANCAKE_V4_CL), /32-byte V4 Pool ID/);
  await assert.rejects(fixture([]).read(TYPES.V3_POOL, toBeHex(1, 32)), /valid pool address/);
});
