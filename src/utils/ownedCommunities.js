export function communityMatchesKeyword(community, keyword) {
  const values = [
    community.name, community.tick, community.tokenName, community.tokenSymbol,
    community.id, community.cToken, community.owner?.id,
    ...(Array.isArray(community.tags) ? community.tags : []),
  ];
  return values.some(value => String(value || '').toLowerCase().includes(keyword.toLowerCase()));
}

// Read every API page: filtering just the homepage would omit older communities.
// Match addresses exactly; keyword searches can also match unrelated metadata.
export async function loadOwnedCommunities(fetchPage, account, { signal } = {}) {
  if (!/^0x[0-9a-f]{40}$/i.test(account || '')) throw new Error('Invalid wallet address');
  const owned = new Map();
  let page = 0;
  let result;
  do {
    signal?.throwIfAborted();
    result = await fetchPage(page, signal);
    signal?.throwIfAborted();
    for (const community of result.communities) {
      if (!community.isDeleted && community.owner?.id?.toLowerCase() === account.toLowerCase()) {
        owned.set(community.id.toLowerCase(), community);
      }
    }
    page += 1;
  } while (result.hasMore);
  return [...owned.values()];
}
