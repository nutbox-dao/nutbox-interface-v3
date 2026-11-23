import { getAddress } from 'ethers';
import { getIndexBrokerTemplates, INDEX_BROKER_PARTICIPATION } from './indexBrokerTemplates.js';

// Read the deployed clone, rather than trusting potentially stale indexer metadata.
export async function readAgentNftMintAccess(provider, pool, contracts) {
  const code = await provider.getCode(pool);
  const clone = /^0x363d3d373d3d3d363d73([a-f0-9]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
  const template = clone && getIndexBrokerTemplates(contracts)
    .find(option => option.address.toLowerCase() === `0x${clone[1].toLowerCase()}`);
  if (!template) throw new Error('Unrecognized NFT mint template');
  return template.participationMode === INDEX_BROKER_PARTICIPATION.BINANCE_HANDLE;
}

export function buildAgentNftMintCommand({
  chainId, pool, communityToken, communityTokenPrice, nativePrice,
  referrerTokenId = '0', requiresSeedReveal,
}) {
  const request = JSON.stringify({
    pool: getAddress(pool),
    action: 'mint',
    referrerTokenId: BigInt(referrerTokenId || '0').toString(),
  });
  const token = getAddress(communityToken);
  const tokenLimit = BigInt(communityTokenPrice).toString();
  const nativeLimit = BigInt(nativePrice).toString();
  return [
    `Mint exactly 1 NFT on BSC (chainId ${chainId}). Run one step at a time in the tagclaw-onchain skill directory. Requires node, jq and baw.`,
    '```bash',
    '# 1. Query the Agent Wallet and check readiness.',
    `NFT_FROM=$(baw wallet address --json | jq -er '.data.addresses[] | select((.binanceChainId | tostring) == "${chainId}") | .address')`,
    `jq -n --arg from "$NFT_FROM" '{operation:"nutbox",from:$from}' > nft-wallet.json`,
    'node scripts/tagclaw.mjs wallet-check --input nft-wallet.json',
    '',
    '# 2. Prepare the next transaction (approval or mint); all contract reads use fixed-block Multicall.',
    `printf '%s\\n' '${request}' | jq --arg from "$NFT_FROM" '. + {from:$from}' > nft-request.json`,
    'node scripts/tagclaw.mjs prepare-nft --input nft-request.json --out nft-plan.json',
    ...(BigInt(referrerTokenId || '0') > 0n ? [
      '# Only on REFERRER_UNAVAILABLE_FOR_WHITELIST_MINT: set referrerTokenId="0" in nft-request.json; rerun prepare-nft only (keep the edited request).',
    ] : []),
    `# Verify quote.paymentToken=${token}, quote.amount<=${tokenLimit}, quote.nativeValue<=${nativeLimit} wei (gas excluded). Ask before exceeding limits.`,
    '',
    '# 3. Recheck readiness, export exact calldata/value, then preview.',
    'node scripts/tagclaw.mjs wallet-check --input nft-wallet.json',
    'node scripts/tagclaw.mjs wallet-payload --input nft-plan.json --out nft-call.json',
    `baw contract-call preview --binanceChainId ${chainId} \\`,
    '  --from "$(jq -er .transaction.from nft-call.json)" \\',
    '  --to "$(jq -er .transaction.to nft-call.json)" \\',
    '  --value "$(jq -er .transaction.value nft-call.json)" \\',
    '  --inputData "$(jq -er .transaction.data nft-call.json)" --json > nft-preview.json',
    '',
    '# 4. Show preview/risk/approval details. Execute only after successful preview and owner approval.',
    `baw contract-call execute --requestId "$(jq -er 'select(.success == true) | .data.requestId // empty' nft-preview.json)" --json > nft-execution.json`,
    '',
    '# 5. Once txHash exists, poll until CONFIRMED. Never execute again for a pending order/hash.',
    `jq -ec '{hash:(.data.txHash // empty)}' nft-execution.json | node scripts/tagclaw.mjs receipt --input -`,
    '```',
    'Stop on errors or unresolved preflight/policy/preview failures. PENDING_CONFIRMATION: track the existing orderId in the wallet.',
    'After CONFIRMED: if nft-plan.json.rebuildAfterConfirmation=true, rerun prepare-nft and steps 3-5. Otherwise mint is complete; return txHash and the tokenId from its mint Transfer log (do not use totalSupply).',
    ...(requiresSeedReveal ? [
      'Reveal: set NFT_ID to the tokenId from the confirmed mint receipt. Query revealBlock; after that block and before revealBlock+256, prepare reveal and repeat steps 3-5 with the new plan:',
      '```bash',
      `jq -n --arg from "$NFT_FROM" --arg tokenId "$NFT_ID" '{pool:"${getAddress(pool)}",from:$from,tokenId:$tokenId}' > nft-reveal.json`,
      'node scripts/tagclaw.mjs nft-info --input nft-reveal.json',
      `jq '. + {action:"reveal"}' nft-reveal.json | node scripts/tagclaw.mjs prepare-nft --input - --out nft-plan.json`,
      '```',
    ] : []),
  ].join('\n');
}
