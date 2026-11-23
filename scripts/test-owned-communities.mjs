import { Interface, zeroPadValue } from 'ethers';
import { readCreatedCommunityAddresses } from '../src/utils/communityCreator.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOwnedCommunities, loadMatchingCommunities, communityMatchesKeyword } from '../src/utils/ownedCommunities.js';

const wallet = `0x${'ab'.repeat(20)}`;
const other = `0x${'cd'.repeat(20)}`;
const community = (id, creator = wallet, extra = {}) => ({ id, creator: { id: creator }, owner: { id: wallet }, ...extra });

test('finds older communities across every page, including empty pages, with exact case-insensitive creators', async () => {
  const pages = [
    { communities: [community('0x01', other, { name: wallet }), community('0x02', `${wallet}00`)], hasMore: true },
    { communities: [], hasMore: true },
    { communities: [community('0x03', wallet.toUpperCase()), community('0x04', wallet, { isDeleted: true })], hasMore: false },
  ];
  const calls = [];
  const result = await loadOwnedCommunities(async page => { calls.push(page); return pages[page]; }, wallet);
  assert.deepEqual(calls, [0, 1, 2]);
  assert.deepEqual(result.map(item => item.id), ['0x03']);
});

test('deduplicates communities across pages and handles a wallet with no communities', async () => {
  const result = await loadOwnedCommunities(async page => ({
    communities: [community(page ? '0xAA' : '0xaa')], hasMore: page === 0,
  }), wallet);
  assert.equal(result.length, 1);
  assert.deepEqual(await loadOwnedCommunities(async () => ({ communities: [community('0x01', other)], hasMore: false }), wallet), []);
});

test('rejects a failed later page instead of returning a partial personal list', async () => {
  await assert.rejects(loadOwnedCommunities(async page => {
    if (page === 1) throw new Error('API unavailable');
    return { communities: [community('0x01')], hasMore: true };
  }, wallet), /API unavailable/);
});

test('stops an obsolete wallet or chain request before reading further pages', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(loadOwnedCommunities(async () => {
    calls += 1;
    controller.abort();
    return { communities: [community('0x01')], hasMore: true };
  }, wallet, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(loadOwnedCommunities(async () => { throw new Error('Should not fetch'); }, ''), /Invalid wallet/);
});

test('personal search matches names, tokens, tags and addresses within the created list', () => {
  const item = community('0x01', wallet, { name: 'Walnut', tick: 'NUT', cToken: other, tags: ['DeFi'] });
  for (const keyword of ['', 'walNUT', 'NUT', 'defi', other.toUpperCase(), wallet]) {
    assert.equal(communityMatchesKeyword(item, keyword), true);
  }
  assert.equal(communityMatchesKeyword(item, 'unrelated'), false);
});


test('matches the creator even after ownership transfer, excludes received communities and unknown creators', async () => {
  const result = await loadOwnedCommunities(async () => ({
    communities: [
      community('created', wallet, { owner: { id: other } }),
      community('received', other),
      community('unknown', wallet, { creator: null }),
    ], hasMore: false,
  }), wallet);
  assert.deepEqual(result.map(item => item.id), ['created']);
});

test('favorites include later pages and exclude deleted communities regardless of ownership', async () => {
  const favorites = new Set(['saved']);
  const result = await loadMatchingCommunities(async page => ({
    communities: page === 0 ? [community('other')] : [community('saved', other), community('deleted', wallet, { isDeleted: true })],
    hasMore: page === 0,
  }), item => favorites.has(item.id));
  assert.deepEqual(result.map(item => item.id), ['saved']);
});


test('wallet event lookup groups nearby blocks, retries on another node, and verifies creation blocks', async () => {
  const iface = new Interface(['event CommunityCreated(address indexed creator, address indexed community, address communityToken)']);
  const factory = `0x${'11'.repeat(20)}`;
  const address = `0x${'22'.repeat(20)}`;
  const another = `0x${'33'.repeat(20)}`;
  const event = iface.getEvent('CommunityCreated');
  const makeLog = (id, blockNumber, creator = wallet) => ({
    address: factory, blockNumber, ...iface.encodeEventLog(event, [creator, id, other]),
  });
  let retries = 0;
  const failing = { getLogs: async () => { retries++; throw new Error('RPC timeout'); } };
  const provider = { getLogs: async filter => {
    assert.equal(filter.address, factory);
    assert.deepEqual(filter.topics, [event.topicHash, zeroPadValue(wallet, 32)]);
    assert.equal(filter.fromBlock, 135143646);
    assert.equal(filter.toBlock, 135143650);
    return [makeLog(address, 135143646), makeLog(another, 135143649)];
  }};
  const communities = [
    { id: address, index: -135143646000762, owner: { id: other } },
    { id: another, index: -135143650000001 },
  ];
  assert.deepEqual(await readCreatedCommunityAddresses([failing, provider], factory, iface, wallet, communities), new Set([address]));
  assert.equal(retries, 1);
  await assert.rejects(readCreatedCommunityAddresses([failing], factory, iface, wallet, communities), /RPC timeout/);
});
