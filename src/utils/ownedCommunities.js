export function communityMatchesKeyword(community, keyword) {
  const values = [
    community.name, community.tick, community.tokenName, community.tokenSymbol,
    community.id, community.cToken, community.owner?.id,
    ...(Array.isArray(community.tags) ? community.tags : []),
  ];
  return values.some(value => String(value || '').toLowerCase().includes(keyword.toLowerCase()));
}

export async function loadMatchingCommunities(fetchPage, matches, { signal } = {}) {
  const owned = new Map();
  let page = 0;
  let result;
  do {
    signal?.throwIfAborted();
    result = await fetchPage(page, signal);
    signal?.throwIfAborted();
    for (const community of result.communities) {
      if (!community.isDeleted && matches(community)) {
        owned.set(community.id.toLowerCase(), community);
      }
    }
    page += 1;
  } while (result.hasMore);
  return [...owned.values()];
}
