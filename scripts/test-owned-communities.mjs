import { Interface, zeroPadValue } from 'ethers';
import { readCommunityCreator } from '../src/utils/communityCreator.js';
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


test('creator lookup pins factory, community topic and exact creation block, ignores ownership and token creator', async () => {
  const iface = new Interface(['event CommunityCreated(address indexed creator, address indexed community, address communityToken)']);
  const factory = `0x${'11'.repeat(20)}`;
  const address = `0x${'22'.repeat(20)}`;
  const encoded = iface.encodeEventLog(iface.getEvent('CommunityCreated'), [wallet, address, other]);
  const provider = { getLogs: async filter => {
    assert.equal(filter.address, factory);
    assert.deepEqual(filter.topics, [iface.getEvent('CommunityCreated').topicHash, null, zeroPadValue(address, 32)]);
    assert.equal(filter.fromBlock, 135143646);
    assert.equal(filter.toBlock, filter.fromBlock);
    return [{ address: factory, ...encoded }];
  }};
  const result = await readCommunityCreator(provider, factory, iface, {
    id: address, index: -135143646000762, owner: { id: other }, communityInfo: { creator: other },
  });
  assert.equal(result.toLowerCase(), wallet);
  await assert.rejects(readCommunityCreator({getLogs: async () => []}, factory, iface, {
    id: address, index: -135143646000762,
  }), /Creation event unavailable/);
});
