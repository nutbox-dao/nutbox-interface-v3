import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { prepareTradeCurationPool, tradePoolRewardRate } from '../src/utils/tradeCuration.js';

const communityAddress = '0x' + '11'.repeat(20);
const contracts = { TradeCurationFactory: '0x774A48Ba391a1013Ae43289eBdf871618822CD67', Committee: '0x' + '22'.repeat(20) };
const iface = new ethers.Interface(['function createdPoolOfCommunity(address) view returns (bool)', 'function verifyContract(address) view returns (bool)']);
function setup(created = false, approved = true) {
  const calls = [];
  const readProvider = { call: async tx => {
    const parsed = iface.parseTransaction(tx);
    calls.push(parsed.name);
    if (parsed.name === 'createdPoolOfCommunity') {
      assert.equal(tx.to.toLowerCase(), contracts.TradeCurationFactory.toLowerCase());
      assert.equal(parsed.args[0], communityAddress);
    } else {
      assert.equal(parsed.args[0].toLowerCase(), contracts.TradeCurationFactory.toLowerCase());
    }
    return iface.encodeFunctionResult(parsed.name, [parsed.name === 'createdPoolOfCommunity' ? created : approved]);
  } };
  return { input: { chainId: 56, contracts, communityAddress, readProvider }, calls };
}
test('new trade pool uses the deployed factory and exactly empty metadata', async () => {
  const { input, calls } = setup();
  assert.deepEqual(await prepareTradeCurationPool(input), { factoryAddress: contracts.TradeCurationFactory, meta: '0x' });
  assert.deepEqual(calls.sort(), ['createdPoolOfCommunity', 'verifyContract']);
});
test('existing pool, including a closed pool, cannot be created again', async () => {
  await assert.rejects(prepareTradeCurationPool(setup(true).input), /already has/);
});
test('unsupported chain and missing factory cannot read or create a BSC pool', async () => {
  const s = setup();
  await assert.rejects(prepareTradeCurationPool({ ...s.input, chainId: 4663 }), /not available/);
  await assert.rejects(prepareTradeCurationPool({ ...s.input, contracts: {} }), /not available/);
  assert.deepEqual(s.calls, []);
});
test('unapproved factory and failed RPC prevent proceeding to creation', async () => {
  await assert.rejects(prepareTradeCurationPool(setup(false, false).input), /not approved/);
  const s = setup();
  s.input.readProvider.call = async () => { throw new Error('RPC unavailable'); };
  await assert.rejects(prepareTradeCurationPool(s.input), /RPC unavailable/);
});
test('zero allocation stays zero; missing allocation is unknown instead of 100%', () => {
  assert.equal(tradePoolRewardRate(10000n, 0, 0), 0n);
  assert.equal(tradePoolRewardRate(10000n, 1000, 8000), 7200n);
  assert.equal(tradePoolRewardRate(10000n, 0, undefined), null);
  assert.equal(tradePoolRewardRate(null, 0, 10000), null);
});
test('large reward values retain integer precision and invalid ratios are not displayed', () => {
  const max = 2n ** 256n - 1n;
  assert.equal(tradePoolRewardRate(max, 0, 10000), max);
  assert.equal(tradePoolRewardRate(max, 10001, 10000), null);
  assert.equal(tradePoolRewardRate(max, 0, -1), null);
});
