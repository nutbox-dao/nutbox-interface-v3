import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMatchingCommunities, communityMatchesKeyword } from '../src/utils/ownedCommunities.js';

const wallet = `0x${'ab'.repeat(20)}`;
const other = `0x${'cd'.repeat(20)}`;
const community = (id, owner = wallet, extra = {}) => ({ id, owner: { id: owner }, ...extra });

test('personal search matches names, tokens, tags and addresses by address and metadata', () => {
  const item = community('0x01', wallet, { name: 'Walnut', tick: 'NUT', cToken: other, tags: ['DeFi'] });
  for (const keyword of ['', 'walNUT', 'NUT', 'defi', other.toUpperCase(), wallet]) {
    assert.equal(communityMatchesKeyword(item, keyword), true);
  }
  assert.equal(communityMatchesKeyword(item, 'unrelated'), false);
});


test('favorites include later pages and exclude deleted communities regardless of ownership', async () => {
  const favorites = new Set(['saved', 'deleted']);
  const result = await loadMatchingCommunities(async page => ({
    communities: page === 0 ? [community('other')] : [community('saved', other), community('deleted', wallet, { isDeleted: true })],
    hasMore: page === 0,
  }), item => favorites.has(item.id));
  assert.deepEqual(result.map(item => item.id), ['saved']);
});
