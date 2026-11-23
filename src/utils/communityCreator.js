// Query only the connected wallet's factory events. The index gives the
// candidate block, and each returned event must match that block and community.
export async function readCreatedCommunityAddresses(providers, factoryAddress, factoryInterface, account, communities, signal) {
  const windows = new Map();
  for (const community of communities) {
    const block = Math.floor(Math.abs(Number(community.index)) / 1_000_000);
    if (!Number.isSafeInteger(block) || block <= 0) throw new Error(`Missing creation block for ${community.id}`);
    const key = Math.floor(block / 2_000);
    if (!windows.has(key)) windows.set(key, { fromBlock: block, toBlock: block, byAddress: new Map() });
    const window = windows.get(key);
    window.fromBlock = Math.min(window.fromBlock, block);
    window.toBlock = Math.max(window.toBlock, block);
    window.byAddress.set(community.id.toLowerCase(), block);
  }

  const results = new Set();
  const ranges = [...windows.values()];
  const topics = factoryInterface.encodeFilterTopics('CommunityCreated', [account]);
  for (let offset = 0; offset < ranges.length; offset += 6) {
    signal?.throwIfAborted();
    await Promise.all(ranges.slice(offset, offset + 6).map(async ({ fromBlock, toBlock, byAddress }) => {
      const logs = await readLogs(providers, { address: factoryAddress, topics, fromBlock, toBlock }, signal);
      for (const log of logs) {
        if (log.removed || log.address.toLowerCase() !== factoryAddress.toLowerCase()) continue;
        const event = factoryInterface.parseLog(log);
        if (event?.args.creator.toLowerCase() !== account.toLowerCase()) continue;
        const address = event.args.community.toLowerCase();
        if (byAddress.get(address) === log.blockNumber) results.add(address);
      }
    }));
  }
  return results;
}

async function readLogs(providers, filter, signal) {
  let error;
  for (const provider of providers) {
    signal?.throwIfAborted();
    try {
      const logs = await provider.getLogs(filter);
      signal?.throwIfAborted();
      return logs;
    } catch (cause) {
      error = cause;
    }
  }
  throw error;
}
