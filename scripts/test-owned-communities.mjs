import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOwnedCommunities, communityMatchesKeyword } from '../src/utils/ownedCommunities.js';

const wallet = `0x${'ab'.repeat(20)}`;
const other = `0x${'cd'.repeat(20)}`;
const community = (id, owner = wallet, extra = {}) => ({ id, owner: { id: owner }, ...extra });

test('finds older communities across every page, including empty pages, with exact case-insensitive owners', async () => {
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

test('personal search matches names, tokens, tags and addresses within the owned list', () => {
  const item = community('0x01', wallet, { name: 'Walnut', tick: 'NUT', cToken: other, tags: ['DeFi'] });
  for (const keyword of ['', 'walNUT', 'NUT', 'defi', other.toUpperCase(), wallet]) {
    assert.equal(communityMatchesKeyword(item, keyword), true);
  }
  assert.equal(communityMatchesKeyword(item, 'unrelated'), false);
});
