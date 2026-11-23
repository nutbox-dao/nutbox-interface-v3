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
  language, chainId, pool, communityToken, communityTokenPrice, nativePrice,
  referrerTokenId = '0', requiresSeedReveal,
}) {
  const request = JSON.stringify({
    chainId,
    pool,
    action: 'mint',
    referrerTokenId: String(referrerTokenId || '0'),
  }, null, 2);
  const reference = JSON.stringify({
    communityToken,
    communityTokenPriceRaw: communityTokenPrice.toString(),
    publicMintNativePriceWei: nativePrice.toString(),
  }, null, 2);
  if (language === 'zh') {
    return [
      '请使用你当前已连接、已注册 Binance Handle 的 Agent Wallet，为我铸造 1 枚 Nutbox NFT。',
      '铸造请求：', request,
      '页面参考价格（原始整数单位；实际费用须重新读取链上状态）：', reference,
      '使用 tagclaw-onchain 技能：先执行 wallet-check（operation: nutbox），将 Agent Wallet 自己的地址填入 from，再用 prepare-nft 准备上述 mint 请求。',
      '按 Agent Wallet 地址重新检查 Handle 注册、矿池状态、剩余额度、白名单、余额、授权和实际费用。不要使用浏览器钱包的地址或白名单额度。所有批量合约读取使用同一区块的链上 Multicall。',
      '交易方法是 NFT 合约的 mint(uint256 referrerTokenId)。Agent Wallet 有白名单额度时使用参数 0 和 value=0；否则使用请求中的推荐 ID，并支付最新 nativePrice。两种情况都需支付最新 communityTokenPrice 的社区代币。',
      '如需授权，只授权本次铸造所需代币额度给上述 NFT 合约；授权确认后重新准备 Mint。若社区代币或原生币铸造价格超过参考值（不含 Gas），请先让我确认。',
      '通过钱包预览并按正常授权流程签名，等待交易成功后返回交易哈希和 NFT Token ID。不要重复提交已广播的交易。',
      ...(requiresSeedReveal ? ['该 NFT 需要揭图：Mint 成功后读取目标区块，等待揭图窗口开启并在 256 个区块内完成 reveal，返回揭图交易哈希。'] : []),
    ].join('\n\n');
  }
  return [
    'Use your currently connected Agent Wallet with a registered Binance Handle to mint 1 Nutbox NFT for me.',
    'Mint request:', request,
    'Page reference prices (raw integer units; refresh actual costs on-chain):', reference,
    'Use the tagclaw-onchain skill: run wallet-check with operation nutbox, set from to the Agent Wallet’s own address, then prepare-nft for this mint request.',
    'Recheck the Agent Wallet’s Handle, pool status, supply, whitelist, balances, allowance and actual fees. Do not reuse the browser wallet’s address or whitelist. All batched contract reads must use on-chain Multicall at a fixed block.',
    'Call mint(uint256 referrerTokenId) on the NFT contract. If the Agent Wallet has a whitelist slot, use argument 0 and value=0; otherwise use the requested referral ID and pay the latest nativePrice. Both modes require the latest communityTokenPrice in community tokens.',
    'If approval is needed, approve only the required mint token amount to the NFT contract above, wait for confirmation, then rebuild the mint plan. Ask me before exceeding either reference mint price, excluding gas.',
    'Preview and sign through the normal wallet authorization flow. Wait for success and return the transaction hash and NFT token ID. Do not resubmit a broadcast transaction.',
    ...(requiresSeedReveal ? ['This NFT requires a reveal: after minting, read the target block, wait for the reveal window and complete reveal within 256 blocks. Return the reveal transaction hash.'] : []),
  ].join('\n\n');
}
