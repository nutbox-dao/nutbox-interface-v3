// Never substitute current ownership or token metadata for the community creator.
export async function readCommunityCreator(provider, factoryAddress, factoryInterface, community) {
  // The index provides a candidate creation block. Require the exact factory
  // event at that block before accepting it, so a changed index format fails
  // visibly instead of misidentifying the creator.
  const blockNumber = Math.floor(Math.abs(Number(community.index)) / 1_000_000);
  if (!Number.isSafeInteger(blockNumber) || blockNumber <= 0) {
    throw new Error(`Missing creation block for ${community.id}`);
  }
  const logs = await provider.getLogs({
    address: factoryAddress,
    topics: factoryInterface.encodeFilterTopics('CommunityCreated', [null, community.id]),
    fromBlock: blockNumber,
    toBlock: blockNumber,
  });
  const event = logs
    .filter(log => log.address.toLowerCase() === factoryAddress.toLowerCase())
    .map(log => factoryInterface.parseLog(log))
    .find(event => event?.args.community.toLowerCase() === community.id.toLowerCase());
  if (!event) throw new Error(`Creation event unavailable for ${community.id}`);
  return event.args.creator;
}
