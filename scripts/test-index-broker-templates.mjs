import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, Interface, keccak256, toUtf8Bytes } from 'ethers';
import { CommitteeABI, ERC20ABI, IndexBrokerNFTFactoryABI, Multicall3ABI } from '../src/config/abis.js';
import { getIndexBrokerTemplates, readIndexBrokerCreationChecks, readIndexBrokerCreationContext, requireSupportedIndexBrokerTemplate, selectIndexBrokerTemplate } from '../src/utils/indexBrokerTemplates.js';
import { buildAddPoolDraft, loadAddPoolDraft, saveAddPoolDraft } from '../src/utils/addPoolDraft.js';
import { DEFAULT_INDEX_BROKER_CONFIG, encodeIndexBrokerNftPoolMeta } from '../src/utils/indexBrokerNft.js';

const address = n => `0x${n.toString(16).padStart(40, '0')}`;
const contracts = {
  Multicall3: address(1), Committee: address(2), IndexBrokerNFTFactory: address(3),
  IndexBrokerNFTBurnTemplate: address(4), IndexBrokerNFTStakeTemplate: address(5),
  IndexBrokerNFTHandleBurnTemplate: address(6), IndexBrokerNFTHandleStakeTemplate: address(7),
};
const options = getIndexBrokerTemplates(contracts).map(option => ({ ...option, supported: true }));
const aggregate = new Interface(Multicall3ABI);
const factory = new Interface(IndexBrokerNFTFactoryABI);
const committee = new Interface(CommitteeABI);
const erc20 = new Interface(ERC20ABI);
function fixture({ fail, omit = false, revoked = false } = {}) {
  const batches = [];
  let blocks = 0;
  return {
    batches,
    get blocks() { return blocks; },
    provider: {
      getBlockNumber: async () => { blocks++; return 123456; },
      call: async tx => {
        assert.equal(tx.to.toLowerCase(), contracts.Multicall3.toLowerCase(), 'Every contract read must target Multicall3');
        assert.equal(tx.blockTag, 123456, 'Every batch must use the fixed snapshot');
        const parsed = aggregate.parseTransaction(tx);
        assert.equal(parsed.name, 'aggregate3');
        const calls = parsed.args[0];
        batches.push(calls);
        let results = calls.map(call => {
          assert.equal(call.target.toLowerCase(), (call.callData.startsWith(erc20.getFunction('symbol').selector) ? address(8) : call.callData.startsWith(committee.getFunction('getCommunitySettingsFee').selector) ? contracts.Committee : contracts.IndexBrokerNFTFactory).toLowerCase());
          if (fail?.(call)) return { success: false, returnData: '0x' };
          let iface, name, value;
          if (call.callData.startsWith(erc20.getFunction('symbol').selector)) { iface = erc20; name = 'symbol'; value = 'TEST'; }
          else if (call.callData.startsWith(committee.getFunction('getCommunitySettingsFee').selector)) { iface = committee; name = 'getCommunitySettingsFee'; value = 10n; }
          else { iface = factory; name = factory.parseTransaction({ data: call.callData }).name; value = name === 'supportedNFTTemplate' ? !revoked : false; }
          return { success: true, returnData: iface.encodeFunctionResult(name, [value]) };
        });
        if (omit) results = results.slice(0, -1);
        return aggregate.encodeFunctionResult('aggregate3', [results]);
      },
    },
  };
}

test('reads all four exact template registrations and bootstrap data through one fixed-block Multicall', async () => {
  const f = fixture();
  const result = await readIndexBrokerCreationContext(f.provider, contracts, [{ key: 'symbol', target: address(8), contractInterface: ERC20ABI, functionName: 'symbol' }]);
  assert.equal(result.symbol, 'TEST');
  assert.equal(f.blocks, 1);
  assert.equal(f.batches.length, 1);
  const calls = f.batches[0];
  assert.equal(calls.length, 5);
  assert.equal(calls[0].allowFailure, false);
  assert.deepEqual(calls.slice(1).map(call => {
    assert.equal(call.allowFailure, false);
    return factory.decodeFunctionData('supportedNFTTemplate', call.callData)[0].toLowerCase();
  }), options.map(option => option.address.toLowerCase()));
  assert.deepEqual(result.templateOptions, options);
});

test('creation preflight checks fee, exact name hash and selected template in the same aggregate', async () => {
  const f = fixture();
  const result = await readIndexBrokerCreationChecks(f.provider, contracts, ' Collection ', options[3]);
  assert.equal(result.fee, 10n);
  assert.equal(result.reserved, false);
  assert.equal(f.blocks, 1);
  assert.equal(f.batches.length, 1);
  const calls = f.batches[0];
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.target.toLowerCase()), [contracts.Committee, contracts.IndexBrokerNFTFactory, contracts.IndexBrokerNFTFactory]);
  assert.equal(factory.decodeFunctionData('reservedCollectionNameHash', calls[1].callData)[0], keccak256(toUtf8Bytes('Collection')));
  assert.equal(factory.decodeFunctionData('supportedNFTTemplate', calls[2].callData)[0].toLowerCase(), options[3].address);
  await assert.rejects(readIndexBrokerCreationChecks(fixture({ revoked: true }).provider, contracts, 'Collection', options[3]), /no longer registered/);
});

test('failed or missing required data rejects the snapshot, with no individual-read fallback', async () => {
  for (const overrides of [{ fail: () => true }, { omit: true }]) {
    const f = fixture(overrides);
    await assert.rejects(readIndexBrokerCreationContext(f.provider, contracts, []));
    assert.equal(f.batches.length, 1);
  }
  const f = fixture({ fail: call => call.target.toLowerCase() === address(8) });
  const result = await readIndexBrokerCreationContext(f.provider, contracts, [{ key: 'optional', target: address(8), contractInterface: ERC20ABI, functionName: 'symbol', allowFailure: true }]);
  assert.equal(result.optional, undefined);
  assert.equal(result.templateOptions.length, 4);
});

test('maps all wallet-access/mining-mode combinations to their own exact implementation', () => {
  for (const option of options) {
    const config = selectIndexBrokerTemplate({ ...DEFAULT_INDEX_BROKER_CONFIG, participationMode: option.participationMode, miningMode: option.miningMode }, options);
    assert.equal(config.nftTemplate, option.address);
    assert.equal(requireSupportedIndexBrokerTemplate(config, options), option);
    assert.throws(() => requireSupportedIndexBrokerTemplate({ ...config, nftTemplate: address(99) }, options), /unavailable/);
  }
});

test('unregistered Handle templates never fall back to unrestricted templates; unsupported chains have no Handle options', () => {
  const pending = options.map(option => ({ ...option, supported: option.participationMode === 'open' }));
  const config = selectIndexBrokerTemplate({ ...DEFAULT_INDEX_BROKER_CONFIG, participationMode: 'binance-handle' }, pending);
  assert.equal(config.participationMode, 'binance-handle');
  assert.equal(config.nftTemplate, '');
  assert.throws(() => requireSupportedIndexBrokerTemplate(config, pending), /unavailable/);
  const one = pending.map(option => ({ ...option, supported: option.miningMode === 'stake' && option.participationMode === 'binance-handle' }));
  assert.equal(selectIndexBrokerTemplate(config, one).nftTemplate, contracts.IndexBrokerNFTHandleStakeTemplate);
  assert.equal(getIndexBrokerTemplates({ IndexBrokerNFTBurnTemplate: address(4), IndexBrokerNFTStakeTemplate: address(5) }).length, 2);
});

test('creation metadata encodes the selected template and only Stake encodes the staking-token configuration', () => {
  const tuple = 'tuple(string,address,address,address,uint256[],uint256[],uint256,uint256,uint256,uint256,uint256,uint16,bytes,bytes,bool,bool,address[],uint256[])';
  for (const option of options) {
    const config = selectIndexBrokerTemplate({ ...DEFAULT_INDEX_BROKER_CONFIG, ...option, symbol: 'NFT', communityTokenPrice: '1', nativePrice: '0.1', maxSupply: '10', officialToken: true, pump: address(10), stakingToken: address(11) }, options);
    const [decoded] = AbiCoder.defaultAbiCoder().decode([tuple], encodeIndexBrokerNftPoolMeta(config));
    assert.equal(decoded[3].toLowerCase(), option.address);
    assert.equal(decoded[13], option.miningMode === 'stake' ? AbiCoder.defaultAbiCoder().encode(['address'], [address(11)]) : '0x');
  }
});

test('drafts retain wallet-access choice and mining mode but reject legacy NFT-mining creation', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const draft = buildAddPoolDraft({ poolType: 'index-broker-nft', wizardStep: 1, indexBrokerConfig: { participationMode: 'binance-handle', miningMode: 'stake' }, inputRatios: [] });
  saveAddPoolDraft('nft', draft, storage);
  const restored = loadAddPoolDraft('nft', storage);
  assert.equal(restored.indexBrokerConfig.participationMode, 'binance-handle');
  assert.equal(restored.indexBrokerConfig.miningMode, 'stake');
  storage.setItem('legacy', JSON.stringify({ version: 1, poolType: 'nft-mining' }));
  assert.equal(loadAddPoolDraft('legacy', storage), null);
});
