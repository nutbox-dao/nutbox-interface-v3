import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  CommitteeABI,
  CommunityABI,
  ERC20ABI,
  IndexBrokerNFTABI,
  IndexBrokerNFTAMMABI,
  Multicall3ABI,
} from '../../config/abis';
import { getChainPath } from '../../config/contracts';
import { indexBrokerRendererRequiresSeed } from '../../config/indexBrokerNft';
import useTimedActionLoading from '../../hooks/useTimedActionLoading';
import { fetchIndexBrokerNftInsights } from '../../config/subgraph';
import {
  copyToClipboard,
  formatDate,
  formatTokenAmount,
  getPoolTypeBadgeClass,
  shortenAddress,
} from '../../utils/helpers';
import { multicallRead } from '../../utils/multicall';
import { applySwapSlippage } from '../../utils/nutboxSwap';
import { PoolCardFooter, PoolCardHeader } from './PoolCardTemplate';
import './IndexBrokerNFTPoolCard.css';

const COPY = {
  en: {
    type: 'Index Broker NFT', totalSupply: 'NFT supply', totalWeight: 'Community mining weight',
    indexWeight: 'Active index weight', mintCost: 'Mint cost',
    nativeCost: 'Public mint price', whitelistFree: 'Whitelist BNB fee', remainingPublic: 'Public mints left',
    referralRate: 'Public-mint referral', copyReferral: 'Copy referral link', referralCopied: 'Referral link copied', referralCopyFailed: 'Could not copy referral link',
    myWeight: 'My community weight', communityRewards: 'Community rewards', claimCommunity: 'Claim community rewards',
    approveMint: 'Approve mint token', mint: 'Mint NFT', referrer: 'Referrer NFT ID (optional)',
    whitelistMint: 'Your next mint uses a whitelist slot and only requires the Community Token payment.',
    publicMint: 'Public mint requires both the Community Token and BNB payments shown below.',
    mintPayment: 'Mint payment',
    whitelistPaymentOnly: 'Whitelist mint only charges Community Tokens; no BNB mint price is required (gas still applies).',
    mintBalances: 'Wallet balance',
    mintTokenInsufficient: 'Insufficient {symbol}: minting requires {required}, but this wallet has {balance}.',
    mintNativeInsufficient: 'Insufficient {symbol}: public minting requires {required}, and the wallet must also keep some {symbol} for gas. Current balance: {balance}.',
    mintGasInsufficient: 'Insufficient {symbol} for gas. Add some {symbol} before minting.',
    viewDetails: 'Open NFT, mining & AMM', myNfts: 'My Index Broker NFTs', noNfts: 'This wallet does not own an NFT from this pool.',
    communityMining: 'Community mining', indexMining: 'Index mining', active: 'Active', inactive: 'Inactive',
    pendingIndex: 'Pending index rewards', upgrade: 'Burn tokens to increase weight', activate: 'Reactivate index mining',
    burnMode: 'Burn mining', stakeMode: 'Stake mining', stake: 'Stake tokens', unstake: 'Unstake tokens',
    approveStake: 'Approve staking token', stakingToken: 'Staking token', miningBalance: 'Mining token balance',
    claimIndex: 'Claim index rewards', reveal: 'Reveal NFT', recommit: 'Commit a new reveal', reroll: 'Reroll NFT',
    revealWaiting: 'Reveal after block {block}', revealExpired: 'Reveal window expired; recommit is required.',
    approveUpgrade: 'Approve Community Token', amount: 'Community Token amount',
    amm: 'Dedicated NFT AMM', ammActive: 'AMM active', ammWaiting: 'Waiting for official token listing',
    activateAmm: 'Activate AMM', inventory: 'NFT inventory', reserve: 'Community Token reserve', tradeAmount: 'Community Token per trade',
    normalFee: 'Normal BNB fee', specificFee: 'Specific NFT BNB fee', buyNext: 'Buy oldest NFT',
    buy: 'Buy this NFT', sell: 'Sell to AMM', approveAmmToken: 'Approve AMM token', approveNft: 'Approve NFT, then sell',
    approveBeforeSell: 'Approve the AMM first; the Sell button will become available after confirmation.',
    transferWarning: 'AMM trades transfer the NFT, disable index mining, and retain only 80% of its index weight per transfer.',
    stakeTransferWarning: 'The staked principal and its index-mining weight follow the NFT when it is transferred.',
    emptyInventory: 'The AMM has no NFT inventory.', rankings: 'Holder ranking', activity: 'Recent activity',
    noIndexedData: 'Indexed data is not available yet. Live contract data above is unaffected.',
    nftCount: '{count} NFTs', updateReceiver: 'Update public mint receiver', receiver: 'New receiver address',
    nftCountLimited: 'Showing the first {shown} of {total} NFTs',
    queuedRewards: 'Queued index rewards', connect: 'Connect your wallet to mint and manage NFTs.',
    rewardTools: 'Index reward tools', rewardToolsHint: 'Inject index tokens for active NFT miners, or permissionlessly harvest holder fees into the AMM buyback reserve.',
    rewardAmount: 'Index token amount', approveIndexToken: 'Approve index token', injectRewards: 'Inject index rewards', balance: 'Balance',
    harvestFees: 'Harvest holder fees', approveRecommit: 'Approve reroll cost',
    buyback: 'Execute index buyback', buybackHint: 'Use the current BNB reserve to buy index tokens with the platform default quote and slippage protection.',
    nativeReserve: 'BNB buyback reserve',
    about: 'Pool overview', aboutHint: 'Core collection, minting and mining information for this NFT pool.',
    swapNext: 'Swap', nextAvailable: 'Next available', snipe: 'Snipe', chooseNft: 'Choose NFT',
    youSend: 'You send', youReceive: 'You receive', inVault: 'in vault', selectNft: 'Select an NFT to snipe',
    rate: 'Rate', ammFee: 'AMM fee', maxNativeFee: 'Maximum BNB fee', mode: 'Mode', totalPayment: 'Community Token payment',
    approveTrade: 'Approve Community Token', buySelected: 'Buy selected NFT', insufficientBalance: 'Insufficient Community Token balance',
    buyNftMode: 'Buy NFT', sellNftMode: 'Sell NFT', selectOwnedNft: 'Select an NFT from your wallet', inWallet: 'in wallet',
    estimatedPayout: 'Payout', approveSell: 'Approve selected NFT', sellSelected: 'Sell selected NFT', insufficientReserve: 'AMM Community Token reserve is insufficient',
    connectTrade: 'Connect wallet',
    loading: 'Loading live contract state…', txFailed: 'Transaction failed',
  },
  zh: {
    type: 'Index Broker NFT', totalSupply: 'NFT 供应量', totalWeight: '社区挖矿总权重',
    indexWeight: '有效指数挖矿权重', mintCost: '每枚铸造成本',
    nativeCost: '公开铸造价格', whitelistFree: '白名单 BNB 费用', remainingPublic: '剩余公开额度',
    referralRate: '公开 Mint 推荐返佣', copyReferral: '复制推荐链接', referralCopied: '推荐链接已复制', referralCopyFailed: '复制推荐链接失败',
    myWeight: '我的社区挖矿权重', communityRewards: '社区奖励', claimCommunity: '领取社区奖励',
    approveMint: '授权铸造代币', mint: '铸造 NFT', referrer: '推荐 NFT ID（可选）',
    whitelistMint: '你下一次铸造使用白名单额度，只需支付社区代币。',
    publicMint: '公开铸造需同时支付下方展示的社区代币和 BNB。',
    mintPayment: '本次铸造支付',
    whitelistPaymentOnly: '白名单铸造只收取社区代币，无需支付 BNB 铸造价格（仍需预留少量 BNB 支付 Gas）。',
    mintBalances: '钱包余额',
    mintTokenInsufficient: '{symbol} 余额不足：铸造需要 {required}，当前只有 {balance}。',
    mintNativeInsufficient: '{symbol} 余额不足：公开铸造需要 {required}，并且还要预留少量 {symbol} 支付 Gas；当前余额为 {balance}。',
    mintGasInsufficient: '{symbol} 余额不足，无法支付 Gas，请先补充 {symbol}。',
    viewDetails: '打开 NFT、挖矿和 AMM', myNfts: '我的 Index Broker NFT', noNfts: '当前钱包没有持有该矿池 NFT。',
    communityMining: '社区挖矿', indexMining: '指数挖矿', active: '生效中', inactive: '未激活',
    pendingIndex: '待领取指数奖励', upgrade: '销毁代币增加权重', activate: '重新激活指数挖矿',
    burnMode: '销毁挖矿', stakeMode: '质押挖矿', stake: '质押代币', unstake: '赎回代币',
    approveStake: '授权质押代币', stakingToken: '质押代币', miningBalance: '挖矿代币余额',
    claimIndex: '领取指数奖励', reveal: '揭示 NFT', recommit: '重新提交揭图', reroll: '重新生成 NFT',
    revealWaiting: '区块 {block} 之后可以揭图', revealExpired: '揭图窗口已过期，需要重新提交。',
    approveUpgrade: '授权社区代币', amount: '社区代币数量',
    amm: '专属 NFT AMM', ammActive: 'AMM 已激活', ammWaiting: '等待官方代币上市',
    activateAmm: '激活 AMM', inventory: 'NFT 库存', reserve: '社区代币储备', tradeAmount: '每次交易社区代币数量',
    normalFee: '普通交易 BNB 费用', specificFee: '指定 NFT BNB 费用', buyNext: '买入队首 NFT',
    buy: '买入该 NFT', sell: '出售给 AMM', approveAmmToken: '授权 AMM 使用代币', approveNft: '授权 NFT，随后出售',
    approveBeforeSell: '需要先授权 AMM 接收该 NFT；授权确认后即可点击“出售给 AMM”。',
    transferWarning: 'AMM 交易会转移 NFT、停用指数挖矿，并在每次转移时只保留 80% 的指数权重。',
    stakeTransferWarning: 'NFT 转移时，已质押本金及对应指数挖矿权重会随 NFT 一并转移。',
    emptyInventory: 'AMM 当前没有 NFT 库存。', rankings: '持有人排行', activity: '最近动态',
    noIndexedData: '专属索引数据尚未开放；上方实时链上数据不受影响。',
    nftCount: '{count} 个 NFT', updateReceiver: '更新公开铸造收款地址', receiver: '新的收款地址',
    nftCountLimited: '共 {total} 个 NFT，当前展示前 {shown} 个',
    queuedRewards: '排队中的指数奖励', connect: '连接钱包后可铸造并管理 NFT。',
    rewardTools: '指数奖励工具', rewardToolsHint: '向活跃 NFT 矿工注入指数代币，或无权限地收割 holder fee 进入 AMM 回购储备。',
    rewardAmount: '指数代币数量', approveIndexToken: '授权指数代币', injectRewards: '注入指数奖励', balance: '余额',
    harvestFees: '收割 holder fee', approveRecommit: '授权重抽费用',
    buyback: '执行指数回购', buybackHint: '使用当前 BNB 储备，按平台默认报价与滑点保护自动回购指数代币。',
    nativeReserve: 'BNB 回购储备',
    about: '矿池简介', aboutHint: '展示该 NFT 矿池的合集、铸造与挖矿基础信息。',
    swapNext: '购买队首', nextAvailable: '下一个可购买', snipe: '指定购买', chooseNft: '选择 NFT',
    youSend: '你支付', youReceive: '你将收到', inVault: '个库存', selectNft: '选择要购买的 NFT',
    rate: '兑换比例', ammFee: 'AMM 费率', maxNativeFee: '最多支付 BNB 费用', mode: '购买方式', totalPayment: '社区代币支付',
    approveTrade: '授权社区代币', buySelected: '买入选中 NFT', insufficientBalance: '社区代币余额不足',
    buyNftMode: '买入 NFT', sellNftMode: '卖出 NFT', selectOwnedNft: '从钱包中选择要卖出的 NFT', inWallet: '个在钱包中',
    estimatedPayout: '卖出所得', approveSell: '授权选中 NFT', sellSelected: '卖出选中 NFT', insufficientReserve: 'AMM 社区代币储备不足',
    connectTrade: '连接钱包',
    loading: '正在读取链上实时状态…', txFailed: '操作失败',
  },
};

const EVENT_LABELS = {
  INDEX_BROKER_NFT_MINTED: ['NFT Minted', '铸造 NFT'],
  INDEX_BROKER_NFT_LEVEL_UP: ['NFT Level Up', 'NFT 等级提升'],
  INDEX_BROKER_NFT_REFERRAL_RECORDED: ['Referral Recorded', '推荐已记录'],
  INDEX_BROKER_INDEX_MINING_ACTIVATED: ['Index Mining Activated', '指数挖矿已激活'],
  INDEX_BROKER_INDEX_MINING_WEIGHT_UPGRADED: ['Index Weight Upgraded', '指数权重已提升'],
  INDEX_BROKER_INDEX_MINING_STAKED: ['Index Mining Staked', '指数挖矿已质押'],
  INDEX_BROKER_INDEX_MINING_UNSTAKED: ['Index Mining Unstaked', '指数挖矿已赎回'],
  INDEX_BROKER_INDEX_REWARDS_CLAIMED: ['Index Rewards Claimed', '指数奖励已领取'],
  INDEX_BROKER_NFT_REVEALED: ['NFT Revealed', 'NFT 已揭示'],
  INDEX_BROKER_NFT_SOLD: ['NFT Sold to AMM', 'NFT 已出售给 AMM'],
  INDEX_BROKER_NFT_BOUGHT: ['NFT Bought from AMM', '已从 AMM 买入 NFT'],
  INDEX_BROKER_INDEX_TOKEN_PURCHASED: ['Index Buyback Executed', '指数回购已执行'],
};

function eventLabel(eventType, language) {
  const labels = EVENT_LABELS[eventType];
  return labels ? labels[language === 'zh' ? 1 : 0] : eventType;
}

const POOL_INTERFACE = new ethers.Interface(IndexBrokerNFTABI);
const AMM_INTERFACE = new ethers.Interface(IndexBrokerNFTAMMABI);
const COMMUNITY_INTERFACE = new ethers.Interface(CommunityABI);
const COMMITTEE_INTERFACE = new ethers.Interface(CommitteeABI);
const ERC20_INTERFACE = new ethers.Interface(ERC20ABI);
const MULTICALL_INTERFACE = new ethers.Interface(Multicall3ABI);
const READ_CALL_BATCH_SIZE = 250;
const NFT_DETAIL_BATCH_SIZE = 12;
const PLATFORM_FEE_BPS = 50;
const BUYBACK_SLIPPAGE_BPS = 100;
const INDEX_BUYBACK_GAS_LIMIT = 5_000_000n;
const REVEAL_WINDOW_BLOCKS = 256n;

function readCall(key, target, contractInterface, functionName, args = [], allowFailure = false) {
  return { key, target, contractInterface, functionName, args, allowFailure };
}

async function multicallReadBatches(provider, multicallAddress, calls, batchSize = READ_CALL_BATCH_SIZE) {
  if (calls.length === 0) return {};
  const batches = [];
  for (let offset = 0; offset < calls.length; offset += batchSize) {
    batches.push(multicallRead(provider, multicallAddress, calls.slice(offset, offset + batchSize)));
  }
  return Object.assign({}, ...(await Promise.all(batches)));
}

function toBigInt(value, fallback = 0n) {
  try {
    return value === undefined || value === null || value === '' ? fallback : BigInt(value);
  } catch {
    return fallback;
  }
}

function nftArtworkUrl(svg) {
  if (!svg) return '';
  const imageHref = svg.match(/<image\b[^>]*(?:href|xlink:href)\s*=\s*["']([^"']+)["']/i)?.[1]
    ?.replaceAll('&amp;', '&');
  if (/^https?:\/\//i.test(imageHref || '')) return imageHref;
  if (/^ipfs:\/\//i.test(imageHref || '')) {
    return `https://ipfs.io/ipfs/${imageHref.slice('ipfs://'.length)}`;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mintedTokenIdFromReceipt(receipt, poolAddress, recipient) {
  const normalizedPool = String(poolAddress || '').toLowerCase();
  const normalizedRecipient = String(recipient || '').toLowerCase();
  for (const log of receipt?.logs || []) {
    if (String(log.address || '').toLowerCase() !== normalizedPool) continue;
    try {
      const event = POOL_INTERFACE.parseLog(log);
      if (
        event?.name === 'Transfer'
        && String(event.args.from).toLowerCase() === ethers.ZeroAddress.toLowerCase()
        && String(event.args.to).toLowerCase() === normalizedRecipient
      ) {
        return toBigInt(event.args.tokenId);
      }
    } catch {
      // Ignore logs emitted by other interfaces on the same transaction.
    }
  }
  return 0n;
}

function NftArtwork({ src, alt, fallback }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return <div className="index-broker-image-placeholder">{fallback}</div>;
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

function AboutContractRow({ label, address, explorerUrl }) {
  const available = ethers.isAddress(address) && address !== ethers.ZeroAddress;
  return (
    <div className="index-broker-about-row">
      <span>{label}</span>
      {available ? (
        <a href={`${explorerUrl}/address/${address}`} target="_blank" rel="noreferrer">
          {shortenAddress(address, 6)} ↗
        </a>
      ) : <strong>—</strong>}
    </div>
  );
}

function withFeeBuffer(value) {
  return value > 0n ? value + ((value + 99n) / 100n) : 0n;
}

function feeAmountForBps(value, feeBps) {
  if (value <= 0n || feeBps <= 0) return 0n;
  return (value * BigInt(feeBps) + 9_999n) / 10_000n;
}

function parseUnitsSafe(value, decimals) {
  try {
    return ethers.parseUnits(String(value || '0'), decimals);
  } catch {
    return 0n;
  }
}

function interpolate(value, params) {
  return Object.entries(params || {}).reduce(
    (result, [key, item]) => result.replaceAll(`{${key}}`, String(item)),
    value,
  );
}

function revealWindowState(info, currentBlock) {
  if (!info?.revealPending) return { status: 'revealed', blocks: 0n };
  const revealBlock = toBigInt(info.revealBlock);
  const startBlock = revealBlock + 1n;
  const endBlock = revealBlock + REVEAL_WINDOW_BLOCKS;
  const blockNumber = toBigInt(currentBlock);
  if (blockNumber < startBlock) {
    return {
      status: 'waiting',
      blocks: startBlock - blockNumber,
      startBlock,
      endBlock,
    };
  }
  if (blockNumber <= endBlock) {
    return {
      status: 'ready',
      blocks: endBlock - blockNumber + 1n,
      startBlock,
      endBlock,
    };
  }
  return { status: 'expired', blocks: 0n, startBlock, endBlock };
}

function revealCountdownText(state, language) {
  if (state.status === 'waiting') {
    return language === 'zh'
      ? `距离可揭图还有 ${state.blocks} 个区块；随后开启 256 个区块的揭图窗口。`
      : `${state.blocks} blocks until reveal; the 256-block reveal window opens afterward.`;
  }
  if (state.status === 'ready') {
    return language === 'zh'
      ? `揭图窗口剩余 ${state.blocks} / 256 个区块，请立即揭图。`
      : `${state.blocks} / 256 reveal blocks remain. Reveal now.`;
  }
  if (state.status === 'expired') {
    return language === 'zh'
      ? '256 个区块的揭图窗口已结束，本轮图片无法继续揭示。'
      : 'The 256-block reveal window has ended; this round can no longer be revealed.';
  }
  return language === 'zh' ? '图片已揭示' : 'Artwork revealed';
}

export default function IndexBrokerNFTPoolCard({
  pool,
  communityAddress,
  communityToken,
  isOwner,
  onRefresh,
  detail = false,
  section = '',
  embedded = false,
  organized = false,
  onSectionChange,
}) {
  const {
    account, getWriteSigner, readProvider, isConnected, connecting, connect, contracts, network,
  } = useWeb3();
  const { language } = useLanguage();
  const toast = useToast();
  const c = COPY[language] || COPY.en;
  const requestRef = useRef(0);
  const poolAddressesRef = useRef(null);
  const inventoryIdsRef = useRef(null);
  const indexedInsightsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionLoading, setActionLoading] = useTimedActionLoading('');
  const [referrerTokenId, setReferrerTokenId] = useState('');
  const [upgradeAmounts, setUpgradeAmounts] = useState({});
  const [indexRewardAmount, setIndexRewardAmount] = useState('');
  const [mintResult, setMintResult] = useState(null);
  const [buybackQuote, setBuybackQuote] = useState({
    loading: false,
    nativeReserve: 0n,
    settlementOut: 0n,
    indexOut: 0n,
    error: '',
  });
  const [ammTradeSide, setAmmTradeSide] = useState('buy');
  const [ammTradeMode, setAmmTradeMode] = useState('swap');
  const [selectedInventoryTokenId, setSelectedInventoryTokenId] = useState('');
  const [selectedOwnedTokenId, setSelectedOwnedTokenId] = useState('');
  const [newReceiver, setNewReceiver] = useState('');
  const [ownedNfts, setOwnedNfts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [indexedLoading, setIndexedLoading] = useState(detail);
  const [data, setData] = useState({
    name: pool.name || c.type,
    symbol: 'INDEX',
    fundsReceiver: '',
    rendererAddress: '',
    ammAddress: '',
    indexToken: { address: '', symbol: 'INDEX', decimals: 18 },
    miningToken: { address: '', symbol: '', decimals: 18 },
    settlementToken: { address: '', symbol: 'SETTLE', decimals: 18 },
    miningMode: 'burn',
    communityAsset: communityToken || { address: '', symbol: '', decimals: 18 },
    communityTokenPrice: 0n,
    activationPrice: 0n,
    recommitPrice: 0n,
    minimumIndexMiningWeight: 0n,
    nativePrice: 0n,
    maxSupply: 0n,
    referralBps: 0,
    levelRules: [],
    rerollEnabled: false,
    totalSupply: 0n,
    totalWeight: 0n,
    totalActiveIndexWeight: 0n,
    queuedIndexRewards: 0n,
    remainingPaidMints: 0n,
    whitelistRemaining: 0n,
    ownedNftCount: 0n,
    userWeight: 0n,
    pendingCommunityRewards: 0n,
    communityBalance: 0n,
    nativeBalance: 0n,
    mintAllowance: 0n,
    ammAllowance: 0n,
    indexBalance: 0n,
    indexAllowance: 0n,
    miningBalance: 0n,
    miningAllowance: 0n,
    poolOperationFee: 0n,
    currentBlock: 0n,
    amm: {
      active: false,
      inventoryCount: 0n,
      oldestTokenId: 0n,
      newestTokenId: 0n,
      normalFeeBps: 0,
      specificFeeBps: 0,
      normalFee: 0n,
      specificFee: 0n,
      nativeValue: 0n,
      tokensPerNFT: 0n,
      tokenReserve: 0n,
      nativeReserve: 0n,
      basketVersion: 0,
      basketSwapRouter: '',
    },
  });

  useEffect(() => {
    requestRef.current += 1;
    setOwnedNfts([]);
    setUpgradeAmounts({});
    setMintResult(null);
  }, [account, pool.id]);

  useEffect(() => {
    if (!detail) return;
    const value = new URLSearchParams(window.location.search).get('referrerTokenId');
    if (value && /^\d+$/.test(value) && BigInt(value) > 0n) {
      setReferrerTokenId(value);
    }
  }, [detail, pool.id]);

  const loadIndexedInsights = useCallback(async () => {
    if (!detail) return null;
    const key = `${network.id}:${pool.id.toLowerCase()}`;
    const cached = indexedInsightsRef.current;
    if (cached?.key === key && cached.data) return cached.data;
    if (cached?.key === key && cached.promise) return cached.promise;

    setIndexedLoading(true);
    const promise = fetchIndexBrokerNftInsights(
      pool.id,
      { accountsSize: 10, eventsSize: 12, inventorySize: 24 },
      network.id,
    ).then((insights) => {
      if (indexedInsightsRef.current?.key !== key) return insights;
      indexedInsightsRef.current = { key, data: insights, promise: null };
      setRecentEvents(insights.recentEvents || []);
      return insights;
    }).catch((error) => {
      console.error('Failed to load Index Broker indexed insights:', error);
      const empty = { topAccounts: [], recentEvents: [], inventoryTokenIds: [], pool: null };
      if (indexedInsightsRef.current?.key === key) {
        // Do not cache transport/indexer failures as a real empty result. The
        // regular 15-second refresh should be able to recover automatically.
        indexedInsightsRef.current = null;
        setRecentEvents([]);
        setIndexedLoading(false);
      }
      return empty;
    }).finally(() => {
      if (indexedInsightsRef.current?.key === key) setIndexedLoading(false);
    });
    indexedInsightsRef.current = { key, data: null, promise };
    return promise;
  }, [detail, network.id, pool.id]);

  const loadPoolData = useCallback(async () => {
    if (!readProvider || !contracts.Multicall3) return;
    const requestId = ++requestRef.current;
    setLoadError('');
    try {
      const indexedInsightsPromise = detail ? loadIndexedInsights() : Promise.resolve(null);
      const primaryCalls = [
        ['factoryAddress', 'factory'],
        ['name', 'name'],
        ['symbol', 'symbol'],
        ['fundsReceiver', 'fundsReceiver'],
        ['rendererAddress', 'renderer'],
        ['ammAddress', 'ammVault'],
        ['indexTokenAddress', 'indexToken'],
        ['miningTokenAddress', 'indexMiningToken'],
        ['communityTokenAddress', 'communityToken'],
        ['communityTokenPrice', 'communityTokenPrice'],
        ['activationPrice', 'indexMiningActivationTokenAmount'],
        ['recommitPrice', 'recommitPrice'],
        ['minimumIndexMiningWeight', 'minimumIndexMiningWeight'],
        ['nativePrice', 'nativePrice'],
        ['maxSupply', 'maxSupply'],
        ['referralBps', 'referralBps'],
        ['levelCount', 'levelCount'],
        ['rerollEnabled', 'rerollEnabled'],
        ['totalSupply', 'totalSupply'],
        ['totalWeight', 'getTotalStakedAmount'],
        ['totalActiveIndexWeight', 'totalActiveIndexMiningWeight'],
        ['queuedIndexRewards', 'queuedIndexRewards'],
        ['remainingPaidMints', 'remainingPaidMints'],
      ].map(([key, functionName]) => readCall(
        key,
        pool.id,
        POOL_INTERFACE,
        functionName,
      ));
      primaryCalls.push(readCall(
        'stakingTokenAddress',
        pool.id,
        POOL_INTERFACE,
        'stakingToken',
        [],
        true,
      ));
      primaryCalls.push(readCall(
        'currentBlock',
        contracts.Multicall3,
        MULTICALL_INTERFACE,
        'getBlockNumber',
      ));
      const indexedPool = pool.indexBroker;
      if (
        ethers.isAddress(indexedPool?.amm)
        && ethers.isAddress(indexedPool?.indexToken)
        && ethers.isAddress(indexedPool?.communityToken)
      ) {
        poolAddressesRef.current = {
          poolId: pool.id.toLowerCase(),
          networkId: network.id,
          ammAddress: indexedPool.amm,
          indexTokenAddress: indexedPool.indexToken,
          communityTokenAddress: indexedPool.communityToken,
        };
      }
      const addressCache = poolAddressesRef.current;
      const hasAddressCache = addressCache?.poolId === pool.id.toLowerCase()
        && addressCache.networkId === network.id;
      let primary = null;
      let ammAddress = hasAddressCache ? addressCache.ammAddress : '';
      let indexTokenAddress = hasAddressCache ? addressCache.indexTokenAddress : '';
      let communityTokenAddress = hasAddressCache ? addressCache.communityTokenAddress : '';
      if (!hasAddressCache) {
        primary = await multicallRead(
          readProvider,
          contracts.Multicall3,
          primaryCalls,
        );
        ammAddress = primary.ammAddress;
        indexTokenAddress = primary.indexTokenAddress;
        communityTokenAddress = primary.communityTokenAddress;
        poolAddressesRef.current = {
          poolId: pool.id.toLowerCase(),
          networkId: network.id,
          ammAddress,
          indexTokenAddress,
          communityTokenAddress,
        };
      }
      const hasCommunityMetadata = Boolean(
        communityToken?.address
        && communityToken.address.toLowerCase() === communityTokenAddress.toLowerCase()
        && communityToken.symbol
        && communityToken.decimals !== undefined,
      );
      const miningTokenAddressForCalls = primary?.miningTokenAddress
        || await new ethers.Contract(pool.id, IndexBrokerNFTABI, readProvider).indexMiningToken();

      const secondaryCalls = [
        readCall('indexSymbol', indexTokenAddress, ERC20_INTERFACE, 'symbol', [], true),
        readCall('indexDecimals', indexTokenAddress, ERC20_INTERFACE, 'decimals', [], true),
        readCall('miningSymbol', miningTokenAddressForCalls, ERC20_INTERFACE, 'symbol', [], true),
        readCall('miningDecimals', miningTokenAddressForCalls, ERC20_INTERFACE, 'decimals', [], true),
        readCall('ammActive', ammAddress, AMM_INTERFACE, 'active'),
        readCall('inventoryCount', ammAddress, AMM_INTERFACE, 'inventoryCount'),
        readCall('oldestTokenId', ammAddress, AMM_INTERFACE, 'oldestTokenId'),
        readCall('newestTokenId', ammAddress, AMM_INTERFACE, 'newestTokenId'),
        readCall('normalFeeBps', ammAddress, AMM_INTERFACE, 'normalFeeBps'),
        readCall('specificFeeBps', ammAddress, AMM_INTERFACE, 'specificFeeBps'),
        readCall('tokensPerNFT', ammAddress, AMM_INTERFACE, 'tokensPerNFT'),
        readCall('settlementTokenAddress', ammAddress, AMM_INTERFACE, 'indexSettlementToken'),
        readCall('basketVersion', ammAddress, AMM_INTERFACE, 'indexBasketVersion'),
        readCall('basketSwapRouter', ammAddress, AMM_INTERFACE, 'basketSwapRouter'),
        readCall('tokenReserve', communityTokenAddress, ERC20_INTERFACE, 'balanceOf', [ammAddress]),
        readCall('normalFee', ammAddress, AMM_INTERFACE, 'quoteNormalNativeFee', [], true),
        readCall('specificFee', ammAddress, AMM_INTERFACE, 'quoteSpecificNativeFee', [], true),
        readCall('nativeValue', ammAddress, AMM_INTERFACE, 'quoteNativeValue', [], true),
      ];
      for (let index = 0; index < 16; index += 1) {
        secondaryCalls.push(
          readCall(`levelThreshold:${index}`, pool.id, POOL_INTERFACE, 'levelThresholds', [index], true),
          readCall(`levelWeight:${index}`, pool.id, POOL_INTERFACE, 'levelWeights', [index], true),
        );
      }
      if (!hasCommunityMetadata) {
        secondaryCalls.push(
          readCall('communitySymbol', communityTokenAddress, ERC20_INTERFACE, 'symbol', [], true),
          readCall('communityDecimals', communityTokenAddress, ERC20_INTERFACE, 'decimals', [], true),
        );
      }
      if (contracts.Committee) {
        secondaryCalls.push(readCall(
          'poolOperationFee',
          contracts.Committee,
          COMMITTEE_INTERFACE,
          'getPoolOperationFee',
          [],
          true,
        ));
      }
      if (account) {
        secondaryCalls.push(
          readCall('whitelistRemaining', pool.id, POOL_INTERFACE, 'remainingWhitelistMints', [account]),
          readCall('ownedNftCount', pool.id, POOL_INTERFACE, 'balanceOf', [account]),
          readCall('userWeight', pool.id, POOL_INTERFACE, 'getUserStakedAmount', [account]),
          readCall('pendingCommunityRewards', communityAddress, COMMUNITY_INTERFACE, 'getPoolPendingRewards', [pool.id, account], true),
          readCall('communityBalance', communityTokenAddress, ERC20_INTERFACE, 'balanceOf', [account]),
          readCall('mintAllowance', communityTokenAddress, ERC20_INTERFACE, 'allowance', [account, pool.id]),
          readCall('ammAllowance', communityTokenAddress, ERC20_INTERFACE, 'allowance', [account, ammAddress]),
          readCall('indexBalance', indexTokenAddress, ERC20_INTERFACE, 'balanceOf', [account]),
          readCall('indexAllowance', indexTokenAddress, ERC20_INTERFACE, 'allowance', [account, pool.id]),
          readCall('miningBalance', miningTokenAddressForCalls, ERC20_INTERFACE, 'balanceOf', [account]),
          readCall('miningAllowance', miningTokenAddressForCalls, ERC20_INTERFACE, 'allowance', [account, pool.id]),
        );
        if (detail) {
          secondaryCalls.push(readCall(
            'ownedTokenIds',
            pool.id,
            POOL_INTERFACE,
            'tokensOfOwner',
            [account, 0n, 100n],
          ));
        }
      }
      const secondary = await multicallRead(
        readProvider,
        contracts.Multicall3,
        primary ? secondaryCalls : [...primaryCalls, ...secondaryCalls],
      );
      if (!primary) primary = secondary;

      if (primary.factoryAddress?.toLowerCase() !== contracts.IndexBrokerNFTFactory?.toLowerCase()) {
        throw new Error('Unsupported legacy Index Broker NFT contract');
      }

      const name = primary.name;
      const symbol = primary.symbol;
      const fundsReceiver = primary.fundsReceiver;
      const rendererAddress = primary.rendererAddress;
      const totalSupply = toBigInt(primary.totalSupply);
      const levelCount = Math.min(Number(primary.levelCount || 0), 16);
      const levelRules = Array.from({ length: levelCount }, (_, index) => ({
        level: index + 1,
        threshold: toBigInt(secondary[`levelThreshold:${index}`]),
        weight: toBigInt(secondary[`levelWeight:${index}`]),
      }));

      const communityAsset = hasCommunityMetadata
        ? { ...communityToken, address: communityTokenAddress, decimals: Number(communityToken.decimals) }
        : {
          address: communityTokenAddress,
          symbol: secondary.communitySymbol || 'COMM',
          decimals: Number(secondary.communityDecimals ?? 18),
        };
      const indexToken = {
        address: indexTokenAddress,
        symbol: secondary.indexSymbol || 'INDEX',
        decimals: Number(secondary.indexDecimals ?? 18),
      };
      const settlementTokenAddress = secondary.settlementTokenAddress || ethers.ZeroAddress;
      let settlementSymbol = 'SETTLE';
      let settlementDecimals = 18;
      if (ethers.isAddress(settlementTokenAddress) && settlementTokenAddress !== ethers.ZeroAddress) {
        const settlementContract = new ethers.Contract(settlementTokenAddress, ERC20ABI, readProvider);
        [settlementSymbol, settlementDecimals] = await Promise.all([
          settlementContract.symbol().catch(() => 'SETTLE'),
          settlementContract.decimals().then(Number).catch(() => 18),
        ]);
      }
      const settlementToken = {
        address: settlementTokenAddress,
        symbol: settlementSymbol,
        decimals: Number(settlementDecimals),
      };
      const [nativeReserve, nativeBalance] = await Promise.all([
        readProvider.getBalance(ammAddress),
        account ? readProvider.getBalance(account) : Promise.resolve(0n),
      ]);
      const miningTokenAddress = primary.miningTokenAddress || communityTokenAddress;
      const miningToken = {
        address: miningTokenAddress,
        symbol: secondary.miningSymbol || communityAsset.symbol,
        decimals: Number(secondary.miningDecimals ?? communityAsset.decimals),
      };
      const miningMode = ethers.isAddress(primary.stakingTokenAddress)
        && primary.stakingTokenAddress !== ethers.ZeroAddress
        ? 'stake'
        : 'burn';
      const inventoryCount = toBigInt(secondary.inventoryCount);
      const oldestTokenId = toBigInt(secondary.oldestTokenId);
      const newestTokenId = toBigInt(secondary.newestTokenId);
      const ownedTokenIds = detail && account ? [...(secondary.ownedTokenIds || [])] : [];
      const indexedInsights = await indexedInsightsPromise;

      const inventoryCache = inventoryIdsRef.current;
      const hasInventoryCache = detail
        && inventoryCache?.ammAddress?.toLowerCase() === ammAddress.toLowerCase()
        && inventoryCache.inventoryCount === inventoryCount
        && inventoryCache.oldestTokenId === oldestTokenId
        && inventoryCache.newestTokenId === newestTokenId;
      const visibleCount = Math.min(Number(inventoryCount), 24);
      const indexedInventoryIds = (indexedInsights?.inventoryTokenIds || [])
        .map(value => toBigInt(value));
      const indexedInventoryMatches = detail
        && toBigInt(indexedInsights?.pool?.inventoryCount) === inventoryCount
        && toBigInt(indexedInsights?.pool?.oldestTokenId) === oldestTokenId
        && toBigInt(indexedInsights?.pool?.newestTokenId) === newestTokenId
        && indexedInventoryIds.length === visibleCount
        && (visibleCount === 0 || indexedInventoryIds[0] === oldestTokenId);
      let inventoryTokenIds = hasInventoryCache
        ? inventoryCache.tokenIds
        : (indexedInventoryMatches ? indexedInventoryIds : []);
      if (
        detail && !hasInventoryCache && !indexedInventoryMatches
        && inventoryCount > 0n && oldestTokenId > 0n
      ) {
        const linkedReads = Math.max(0, visibleCount - 1);
        const scanBatches = (totalSupply + BigInt(READ_CALL_BATCH_SIZE - 1))
          / BigInt(READ_CALL_BATCH_SIZE);
        const canScanInFewerCalls = totalSupply <= BigInt(Number.MAX_SAFE_INTEGER)
          && scanBatches <= BigInt(linkedReads);

        if (canScanInFewerCalls) {
          const linkCalls = [];
          for (let tokenId = 1n; tokenId <= totalSupply; tokenId += 1n) {
            linkCalls.push(readCall(
              `inventory-next:${tokenId}`,
              ammAddress,
              AMM_INTERFACE,
              'nextInventoryToken',
              [tokenId],
              true,
            ));
          }
          const links = await multicallReadBatches(
            readProvider,
            contracts.Multicall3,
            linkCalls,
          );
          let tokenId = oldestTokenId;
          for (let index = 0; index < visibleCount && tokenId > 0n; index += 1) {
            inventoryTokenIds.push(tokenId);
            tokenId = toBigInt(links[`inventory-next:${tokenId}`]);
          }
        } else {
          const ammContract = new ethers.Contract(ammAddress, IndexBrokerNFTAMMABI, readProvider);
          let tokenId = oldestTokenId;
          for (let index = 0; index < visibleCount && tokenId > 0n; index += 1) {
            inventoryTokenIds.push(tokenId);
            tokenId = index + 1 < visibleCount
              ? await ammContract.nextInventoryToken(tokenId)
              : 0n;
          }
        }
      }
      if (detail && !hasInventoryCache) {
        inventoryIdsRef.current = {
          ammAddress,
          inventoryCount,
          oldestTokenId,
          newestTokenId,
          tokenIds: inventoryTokenIds,
        };
      }

      const ownedTokenKeys = new Set(ownedTokenIds.map(tokenId => tokenId.toString()));
      const uniqueTokenIds = [...new Map(
        [...ownedTokenIds, ...inventoryTokenIds]
          .map(tokenId => [tokenId.toString(), tokenId]),
      ).values()];
      const nftCalls = uniqueTokenIds.flatMap(tokenId => {
        const key = tokenId.toString();
        const calls = [
          readCall(`nft-info:${key}`, pool.id, POOL_INTERFACE, 'getNFTInfo', [tokenId]),
          readCall(`nft-svg:${key}`, pool.id, POOL_INTERFACE, 'tokenSVG', [tokenId], true),
        ];
        if (ownedTokenKeys.has(key)) {
          calls.push(readCall(`nft-approved:${key}`, pool.id, POOL_INTERFACE, 'getApproved', [tokenId], true));
        }
        return calls;
      });
      const nftData = await multicallReadBatches(
        readProvider,
        contracts.Multicall3,
        nftCalls,
        NFT_DETAIL_BATCH_SIZE * 3,
      );
      const mapNft = tokenId => {
        const key = tokenId.toString();
        const info = nftData[`nft-info:${key}`];
        if (!info) return null;
        return {
          tokenId,
          info,
          image: nftArtworkUrl(nftData[`nft-svg:${key}`] || ''),
          approved: nftData[`nft-approved:${key}`] || ethers.ZeroAddress,
        };
      };
      const nextOwnedNfts = ownedTokenIds.map(mapNft).filter(Boolean);
      const nextInventory = inventoryTokenIds.map(mapNft).filter(Boolean);

      const accountState = account ? {
        whitelistRemaining: toBigInt(secondary.whitelistRemaining),
        ownedNftCount: toBigInt(secondary.ownedNftCount),
        userWeight: toBigInt(secondary.userWeight),
        pendingCommunityRewards: toBigInt(secondary.pendingCommunityRewards),
        communityBalance: toBigInt(secondary.communityBalance),
        nativeBalance,
        mintAllowance: toBigInt(secondary.mintAllowance),
        ammAllowance: toBigInt(secondary.ammAllowance),
        indexBalance: toBigInt(secondary.indexBalance),
        indexAllowance: toBigInt(secondary.indexAllowance),
        miningBalance: toBigInt(secondary.miningBalance),
        miningAllowance: toBigInt(secondary.miningAllowance),
      } : {
        whitelistRemaining: 0n,
        ownedNftCount: 0n,
        userWeight: 0n,
        pendingCommunityRewards: 0n,
        communityBalance: 0n,
        nativeBalance: 0n,
        mintAllowance: 0n,
        ammAllowance: 0n,
        indexBalance: 0n,
        indexAllowance: 0n,
        miningBalance: 0n,
        miningAllowance: 0n,
      };

      if (requestId !== requestRef.current) return;
      setData({
        name, symbol, fundsReceiver, rendererAddress, ammAddress, indexToken, communityAsset, miningToken, miningMode, settlementToken,
        communityTokenPrice: toBigInt(primary.communityTokenPrice),
        activationPrice: toBigInt(primary.activationPrice),
        recommitPrice: toBigInt(primary.recommitPrice),
        minimumIndexMiningWeight: toBigInt(primary.minimumIndexMiningWeight),
        nativePrice: toBigInt(primary.nativePrice),
        maxSupply: toBigInt(primary.maxSupply),
        referralBps: Number(primary.referralBps),
        levelRules,
        rerollEnabled: Boolean(primary.rerollEnabled),
        totalSupply,
        totalWeight: toBigInt(primary.totalWeight),
        totalActiveIndexWeight: toBigInt(primary.totalActiveIndexWeight),
        queuedIndexRewards: toBigInt(primary.queuedIndexRewards),
        remainingPaidMints: toBigInt(primary.remainingPaidMints),
        ...accountState,
        poolOperationFee: toBigInt(secondary.poolOperationFee),
        currentBlock: toBigInt(primary.currentBlock),
        amm: {
          active: Boolean(secondary.ammActive), inventoryCount, oldestTokenId, newestTokenId,
          normalFeeBps: Number(secondary.normalFeeBps),
          specificFeeBps: Number(secondary.specificFeeBps),
          normalFee: toBigInt(secondary.normalFee),
          specificFee: toBigInt(secondary.specificFee),
          nativeValue: toBigInt(secondary.nativeValue),
          tokensPerNFT: toBigInt(secondary.tokensPerNFT),
          tokenReserve: toBigInt(secondary.tokenReserve),
          nativeReserve,
          basketVersion: Number(secondary.basketVersion || 0),
          basketSwapRouter: secondary.basketSwapRouter || '',
        },
      });
      setOwnedNfts(nextOwnedNfts);
      setInventory(nextInventory);
      setNewReceiver(current => current || fundsReceiver);
    } catch (error) {
      console.error('Failed to load Index Broker NFT pool:', error);
      if (requestId === requestRef.current) {
        setLoadError(error.message || c.txFailed);
        setOwnedNfts([]);
        setInventory([]);
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [
    account,
    communityAddress,
    communityToken,
    contracts.Committee,
    contracts.IndexBrokerNFTFactory,
    contracts.Multicall3,
    detail,
    loadIndexedInsights,
    network.id,
    pool.id,
    pool.indexBroker,
    readProvider,
    c.txFailed,
  ]);

  useEffect(() => {
    loadPoolData();
    const timer = setInterval(loadPoolData, 15_000);
    return () => clearInterval(timer);
  }, [loadPoolData]);

  const pendingRevealKey = indexBrokerRendererRequiresSeed(data.rendererAddress)
    ? ownedNfts
      .filter(nft => nft.info?.revealPending)
      .map(nft => `${nft.tokenId}:${nft.info.revealBlock}:${nft.info.revealRound}`)
      .join('|')
    : '';

  useEffect(() => {
    if (!readProvider || !pendingRevealKey) return undefined;
    let cancelled = false;
    const refreshBlockNumber = async () => {
      try {
        const currentBlock = BigInt(await readProvider.getBlockNumber());
        if (!cancelled) {
          setData(current => current.currentBlock === currentBlock
            ? current
            : { ...current, currentBlock });
        }
      } catch (error) {
        console.warn('Failed to refresh reveal block countdown:', error);
      }
    };
    refreshBlockNumber();
    const intervalMs = Math.max(1_000, Math.min(5_000, Number(network.blockTimeSeconds || 3) * 1_000));
    const timer = window.setInterval(refreshBlockNumber, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [network.blockTimeSeconds, pendingRevealKey, readProvider]);

  useEffect(() => {
    const nativeReserve = data.amm.nativeReserve;
    if (
      !readProvider
      || !data.amm.active
      || nativeReserve <= 0n
      || !ethers.isAddress(data.ammAddress)
    ) {
      setBuybackQuote({
        loading: false,
        nativeReserve,
        settlementOut: 0n,
        indexOut: 0n,
        error: '',
      });
      return undefined;
    }

    let cancelled = false;
    setBuybackQuote(current => ({
      ...current,
      loading: true,
      nativeReserve,
      error: '',
    }));

    const quoteCaller = ethers.isAddress(account)
      ? account
      : '0x0000000000000000000000000000000000000001';
    const amm = new ethers.Contract(data.ammAddress, IndexBrokerNFTAMMABI, readProvider);
    const loadQuote = () => {
      amm.getFunction('buyIndexWithNativeReserve').staticCall(
        0n,
        0n,
        '0x',
        { from: quoteCaller },
      ).then((quote) => {
        if (cancelled) return;
        setBuybackQuote({
          loading: false,
          nativeReserve,
          settlementOut: toBigInt(quote.settlementOut ?? quote[1]),
          indexOut: toBigInt(quote.indexOut ?? quote[2]),
          error: '',
        });
      }).catch((error) => {
        console.warn('Failed to quote Index Broker buyback:', error);
        if (cancelled) return;
        setBuybackQuote({
          loading: false,
          nativeReserve,
          settlementOut: 0n,
          indexOut: 0n,
          error: language === 'zh' ? '暂时无法获取回购报价' : 'Buyback quote is temporarily unavailable',
        });
      });
    };

    loadQuote();
    const timer = window.setInterval(loadQuote, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [account, data.amm.active, data.amm.nativeReserve, data.ammAddress, language, readProvider]);

  const execute = async (key, pending, success, transaction) => {
    setActionLoading(key);
    try {
      const writeSigner = await getWriteSigner();
      const tx = await transaction(writeSigner);
      toast.info(pending);
      const receipt = await tx.wait();
      toast.success(success);
      await loadPoolData();
      onRefresh?.();
      return receipt;
    } catch (error) {
      toast.error(error.shortMessage || error.reason || error.message || c.txFailed);
      return false;
    } finally {
      setActionLoading('');
    }
  };

  const approveCommunityToken = (spender, key) => execute(
    key,
    language === 'zh' ? '正在授权社区代币…' : 'Approving Community Token…',
    language === 'zh' ? '社区代币授权成功' : 'Community Token approved',
    writeSigner => new ethers.Contract(data.communityAsset.address, ERC20ABI, writeSigner).approve(spender, ethers.MaxUint256),
  );

  const approveMiningToken = key => execute(
    key,
    language === 'zh' ? '正在授权指数挖矿代币…' : 'Approving index mining token…',
    language === 'zh' ? '指数挖矿代币授权成功' : 'Index mining token approved',
    writeSigner => new ethers.Contract(data.miningToken.address, ERC20ABI, writeSigner)
      .approve(pool.id, ethers.MaxUint256),
  );

  const executeWithMiningApproval = async ({
    key, requiredAmount, pending, success, transaction,
  }) => {
    setActionLoading(key);
    try {
      const writeSigner = await getWriteSigner();
      if (requiredAmount > 0n && data.miningAllowance < requiredAmount) {
        const approvalTx = await new ethers.Contract(data.miningToken.address, ERC20ABI, writeSigner)
          .approve(pool.id, ethers.MaxUint256);
        toast.info(language === 'zh' ? '正在授权挖矿代币…' : 'Approving mining token…');
        await approvalTx.wait();
      }
      const tx = await transaction(writeSigner);
      toast.info(pending);
      await tx.wait();
      toast.success(success);
      await loadPoolData();
      onRefresh?.();
    } catch (error) {
      toast.error(error.shortMessage || error.reason || error.message || c.txFailed);
    } finally {
      setActionLoading('');
    }
  };

  const getMintBalanceError = (communityBalance, nativeBalance) => {
    if (communityBalance < data.communityTokenPrice) {
      return interpolate(c.mintTokenInsufficient, {
        symbol: data.communityAsset.symbol,
        required: formatTokenAmount(data.communityTokenPrice, data.communityAsset.decimals),
        balance: formatTokenAmount(communityBalance, data.communityAsset.decimals),
      });
    }
    const usesWhitelist = data.whitelistRemaining > 0n;
    if (!usesWhitelist && nativeBalance <= data.nativePrice) {
      return interpolate(c.mintNativeInsufficient, {
        symbol: network.nativeCurrency.symbol,
        required: formatTokenAmount(data.nativePrice, network.nativeCurrency.decimals),
        balance: formatTokenAmount(nativeBalance, network.nativeCurrency.decimals),
      });
    }
    if (usesWhitelist && nativeBalance <= 0n) {
      return interpolate(c.mintGasInsufficient, { symbol: network.nativeCurrency.symbol });
    }
    return '';
  };

  const validateMintBalances = async () => {
    try {
      const token = new ethers.Contract(data.communityAsset.address, ERC20ABI, readProvider);
      const [communityBalance, nativeBalance] = await Promise.all([
        token.balanceOf(account),
        readProvider.getBalance(account),
      ]);
      setData(current => ({ ...current, communityBalance, nativeBalance }));
      const error = getMintBalanceError(communityBalance, nativeBalance);
      if (error) {
        toast.error(error);
        return false;
      }
      return true;
    } catch (error) {
      console.warn('Failed to refresh mint balances:', error);
      const balanceError = getMintBalanceError(data.communityBalance, data.nativeBalance);
      if (balanceError) {
        toast.error(balanceError);
        return false;
      }
      return true;
    }
  };

  const loadMintResult = async (tokenId) => {
    setMintResult({ tokenId, image: '', info: null, loading: true, error: '' });
    try {
      const nft = new ethers.Contract(pool.id, IndexBrokerNFTABI, readProvider);
      const [info, svg] = await Promise.all([
        nft.getNFTInfo(tokenId),
        nft.tokenSVG(tokenId).catch(() => ''),
      ]);
      setMintResult({
        tokenId,
        image: nftArtworkUrl(svg),
        info,
        loading: false,
        error: '',
      });
    } catch (error) {
      console.warn('Failed to load newly minted NFT:', error);
      setMintResult({
        tokenId,
        image: '',
        info: null,
        loading: false,
        error: language === 'zh' ? 'NFT 已铸造，但图片暂时读取失败。' : 'The NFT was minted, but its artwork could not be loaded yet.',
      });
    }
  };

  const handleMint = async () => {
    if (!(await validateMintBalances())) return;
    const receipt = await execute(
      'mint',
      language === 'zh' ? '正在铸造 Index Broker NFT…' : 'Minting Index Broker NFT…',
      language === 'zh' ? 'NFT 铸造成功' : 'NFT minted',
      writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner).mint(
        data.whitelistRemaining > 0n ? 0n : toBigInt(referrerTokenId),
        { value: data.whitelistRemaining > 0n ? 0n : data.nativePrice },
      ),
    );
    if (!receipt) return;

    let tokenId = mintedTokenIdFromReceipt(receipt, pool.id, account);
    if (tokenId <= 0n) {
      try {
        const nft = new ethers.Contract(pool.id, IndexBrokerNFTABI, readProvider);
        const latestTokenId = await nft.totalSupply();
        const latestOwner = await nft.ownerOf(latestTokenId);
        if (latestOwner.toLowerCase() === account.toLowerCase()) tokenId = latestTokenId;
      } catch (error) {
        console.warn('Failed to resolve newly minted NFT token ID:', error);
      }
    }
    if (tokenId > 0n) {
      await loadMintResult(tokenId);
    } else {
      setMintResult({
        tokenId: 0n,
        image: '',
        info: null,
        loading: false,
        error: language === 'zh' ? 'NFT 已铸造，但暂时无法识别 Token ID。' : 'The NFT was minted, but its token ID could not be resolved yet.',
      });
    }

    if (requiresSeedReveal) {
      toast.info(language === 'zh'
        ? 'NFT 已进入揭图倒计时，请在 256 个区块的窗口内及时完成揭图。'
        : 'The NFT reveal countdown has started. Reveal it within the 256-block window.');
    }
  };

  const handleApproveMint = async () => {
    if (!(await validateMintBalances())) return;
    await approveCommunityToken(pool.id, 'approve-mint');
  };

  const claimCommunityRewards = () => execute(
    'community-claim',
    language === 'zh' ? '正在领取社区奖励…' : 'Claiming community rewards…',
    language === 'zh' ? '社区奖励已领取' : 'Community rewards claimed',
    writeSigner => new ethers.Contract(communityAddress, CommunityABI, writeSigner)
      .withdrawPoolsRewards([pool.id], { value: data.poolOperationFee }),
  );

  const tokenAction = (key, tokenId, functionName, pending, success, args = []) => execute(
    `${key}-${tokenId}`,
    pending,
    success,
    writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner)[functionName](tokenId, ...args),
  );

  const changeIndexMiningWeight = (nft, unstake = false) => {
    const rawAmount = upgradeAmounts[nft.tokenId.toString()] || '';
    const amount = parseUnitsSafe(rawAmount, data.miningToken.decimals);
    if (amount <= 0n || (!unstake && amount < data.minimumIndexMiningWeight)) {
      return toast.error(language === 'zh'
        ? `最少需要 ${formatTokenAmount(data.minimumIndexMiningWeight, data.miningToken.decimals)} ${data.miningToken.symbol}`
        : `Minimum ${formatTokenAmount(data.minimumIndexMiningWeight, data.miningToken.decimals)} ${data.miningToken.symbol}`);
    }
    if (unstake) {
      const remaining = nft.info.indexMiningWeight - amount;
      if (amount > nft.info.indexMiningWeight || (remaining !== 0n && remaining < data.minimumIndexMiningWeight)) {
        return toast.error(language === 'zh'
          ? '赎回后剩余质押必须为 0，或至少保留一个最小质押单位'
          : 'The remaining stake must be zero or at least one minimum staking unit');
      }
    }
    const stakeMode = data.miningMode === 'stake';
    const functionName = stakeMode
      ? (unstake ? 'unstakeIndexMining' : 'stakeIndexMining')
      : 'upgradeIndexMining';
    return executeWithMiningApproval({
      key: `${unstake ? 'unstake' : 'upgrade'}-${nft.tokenId}`,
      requiredAmount: unstake ? 0n : amount,
      pending: unstake
        ? (language === 'zh' ? '正在赎回质押代币…' : 'Unstaking index mining tokens…')
        : (language === 'zh' ? '正在增加指数挖矿权重…' : 'Increasing index mining weight…'),
      success: unstake
        ? (language === 'zh' ? '质押代币已赎回' : 'Staking tokens withdrawn')
        : (language === 'zh' ? '指数挖矿权重已增加' : 'Index mining weight increased'),
      transaction: writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner)[functionName](nft.tokenId, amount),
    });
  };

  const activateIndexMining = nft => executeWithMiningApproval({
    key: `activate-index-${nft.tokenId}`,
    requiredAmount: data.activationPrice,
    pending: language === 'zh' ? '正在激活指数挖矿…' : 'Activating index mining…',
    success: language === 'zh' ? '指数挖矿已激活' : 'Index mining activated',
    transaction: writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner)
      .activateIndexMining(nft.tokenId),
  });

  const approveIndexToken = () => execute(
    'approve-index-token',
    language === 'zh' ? '正在授权指数代币…' : 'Approving index token…',
    language === 'zh' ? '指数代币授权成功' : 'Index token approved',
    writeSigner => new ethers.Contract(data.indexToken.address, ERC20ABI, writeSigner).approve(pool.id, ethers.MaxUint256),
  );

  const injectIndexRewards = () => {
    const amount = parseUnitsSafe(indexRewardAmount, data.indexToken.decimals);
    if (amount <= 0n) return toast.error(language === 'zh' ? '请输入有效数量' : 'Enter a valid amount');
    return execute(
      'inject-index-rewards',
      language === 'zh' ? '正在注入指数奖励…' : 'Injecting index rewards…',
      language === 'zh' ? '指数奖励已注入' : 'Index rewards injected',
      writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner).injectIndexRewards(amount),
    );
  };

  const harvestIndexHolderFees = () => execute(
    'harvest-index-holder-fees',
    language === 'zh' ? '正在收割 holder fee…' : 'Harvesting holder fees…',
    language === 'zh' ? 'holder fee 已转入 AMM 回购储备' : 'Holder fees moved to the AMM buyback reserve',
    writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner).harvestIndexHolderFees(),
  );

  const executeIndexBuyback = () => {
    if (buybackQuote.loading || buybackQuote.indexOut <= 0n || data.amm.nativeReserve <= 0n) {
      return toast.error(language === 'zh' ? '当前没有可执行的回购报价' : 'No executable buyback quote is available');
    }
    return execute(
      'index-buyback',
      language === 'zh' ? '正在执行指数回购…' : 'Executing index buyback…',
      language === 'zh' ? '指数回购完成，奖励已注入矿池' : 'Index buyback completed and rewards injected',
      async writeSigner => {
        const amm = new ethers.Contract(data.ammAddress, IndexBrokerNFTAMMABI, writeSigner);
        const liveQuote = await amm.getFunction('buyIndexWithNativeReserve').staticCall(0n, 0n, '0x');
        const settlementOut = toBigInt(liveQuote.settlementOut ?? liveQuote[1]);
        const indexOut = toBigInt(liveQuote.indexOut ?? liveQuote[2]);
        if (settlementOut <= 0n || indexOut <= 0n) {
          throw new Error(language === 'zh' ? '无法生成有效的回购报价' : 'Could not produce a valid buyback quote');
        }
        return amm.buyIndexWithNativeReserve(
          applySwapSlippage(settlementOut, BUYBACK_SLIPPAGE_BPS),
          applySwapSlippage(indexOut, BUYBACK_SLIPPAGE_BPS),
          '0x',
          { gasLimit: INDEX_BUYBACK_GAS_LIMIT },
        );
      },
    );
  };

  const approveNftSale = nft => execute(
    `approve-sale-${nft.tokenId}`,
    language === 'zh' ? '正在授权 AMM 接收 NFT…' : 'Approving NFT for AMM…',
    language === 'zh' ? 'NFT 出售授权成功' : 'NFT sale approved',
    writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner).approve(data.ammAddress, nft.tokenId),
  );

  const copyReferralLink = async tokenId => {
    const detailPath = getChainPath(
      network.id,
      `community/${communityAddress}/pool/${pool.id}`,
    );
    const url = new URL(detailPath, window.location.origin);
    url.searchParams.set('referrerTokenId', tokenId.toString());
    if (await copyToClipboard(url.toString())) {
      toast.success(c.referralCopied);
    } else {
      toast.error(c.referralCopyFailed);
    }
  };

  const sellNft = nft => execute(
    `sell-${nft.tokenId}`,
    language === 'zh' ? '正在向 AMM 出售 NFT…' : 'Selling NFT to AMM…',
    language === 'zh' ? 'NFT 已出售给 AMM' : 'NFT sold to AMM',
    async writeSigner => {
      const amm = new ethers.Contract(data.ammAddress, IndexBrokerNFTAMMABI, writeSigner);
      const fee = await amm.quoteNormalNativeFee();
      return amm.sellNFT(nft.tokenId, { value: withFeeBuffer(fee) });
    },
  );

  const buyNft = tokenId => execute(
    `buy-${tokenId || 'next'}`,
    language === 'zh' ? '正在从 AMM 买入 NFT…' : 'Buying NFT from AMM…',
    language === 'zh' ? 'NFT 买入成功' : 'NFT purchased',
    async writeSigner => {
      const amm = new ethers.Contract(data.ammAddress, IndexBrokerNFTAMMABI, writeSigner);
      if (tokenId) {
        const fee = await amm.quoteSpecificNativeFee();
        return amm.buySpecificNFT(tokenId, { value: withFeeBuffer(fee) });
      }
      const fee = await amm.quoteNormalNativeFee();
      return amm.buyNextNFT({ value: withFeeBuffer(fee) });
    },
  );

  const busy = Boolean(actionLoading);
  const mintUsesWhitelist = data.whitelistRemaining > 0n;
  const canMint = data.totalSupply < data.maxSupply && (mintUsesWhitelist || data.remainingPaidMints > 0n);
  const mintApprovalNeeded = data.mintAllowance < data.communityTokenPrice;
  const mintBalanceError = isConnected
    ? getMintBalanceError(data.communityBalance, data.nativeBalance)
    : '';
  const recommitApprovalNeeded = data.recommitPrice > 0n && data.mintAllowance < data.recommitPrice;
  const ammApprovalNeeded = data.ammAllowance < data.amm.tokensPerNFT;
  const parsedIndexRewardAmount = parseUnitsSafe(indexRewardAmount, data.indexToken.decimals);
  const indexApprovalNeeded = parsedIndexRewardAmount > 0n && data.indexAllowance < parsedIndexRewardAmount;
  const rendererKnown = ethers.isAddress(data.rendererAddress)
    && data.rendererAddress !== ethers.ZeroAddress;
  const requiresSeedReveal = rendererKnown
    && indexBrokerRendererRequiresSeed(data.rendererAddress);
  const mintResultRevealState = requiresSeedReveal && mintResult?.info?.revealPending
    ? revealWindowState(mintResult.info, data.currentBlock)
    : null;
  const seedRevealNfts = requiresSeedReveal
    ? ownedNfts
      .filter(nft => nft.info?.revealPending)
      .map(nft => ({ ...nft, revealState: revealWindowState(nft.info, data.currentBlock) }))
    : [];
  const urgentRevealNft = seedRevealNfts.find(nft => nft.revealState.status === 'ready')
    || seedRevealNfts.find(nft => nft.revealState.status === 'expired')
    || seedRevealNfts[0]
    || null;
  const showAllDetail = detail && !section;
  const showMint = detail && (showAllDetail || section === 'mint-amm' || section === 'mint' || section === 'overview');
  const showAmm = detail && (showAllDetail || section === 'mint-amm' || section === 'amm');
  const showReferral = detail && section === 'referral';
  const showMining = detail && section === 'mining';
  const showOwnedCollection = detail && section === 'holdings';
  const showHoldings = showAllDetail;
  const compactDetailLayout = embedded || organized;
  const showActivity = detail && (
    showAllDetail
    || section === 'activity'
    || (compactDetailLayout && section === 'mint-amm')
    || (organized && section === 'about')
  );
  const showAbout = detail && section === 'about';
  const showFullHeaderDetails = !compactDetailLayout || showAbout;
  const showAdvancedTools = detail && !embedded && (showAllDetail || section === 'rewards');
  const showAdmin = detail && !embedded && isOwner && (showAllDetail || section === 'admin');
  const nextInventoryNft = inventory.find(nft => nft.tokenId === data.amm.oldestTokenId) || inventory[0] || null;
  const selectedInventoryNft = inventory.find(nft => nft.tokenId.toString() === selectedInventoryTokenId) || null;
  const tradeNft = ammTradeMode === 'snipe' ? selectedInventoryNft : nextInventoryNft;
  const tradeNativeFee = ammTradeMode === 'snipe' ? data.amm.specificFee : data.amm.normalFee;
  const tradeFeeBps = (ammTradeMode === 'snipe' ? data.amm.specificFeeBps : data.amm.normalFeeBps) + PLATFORM_FEE_BPS;
  const tradeTokenFee = feeAmountForBps(data.amm.tokensPerNFT, tradeFeeBps);
  const normalTradeFeeBps = data.amm.normalFeeBps + PLATFORM_FEE_BPS;
  const normalTradeTokenFee = feeAmountForBps(data.amm.tokensPerNFT, normalTradeFeeBps);
  const ammUtilization = data.maxSupply > 0n
    ? Math.min(100, Number(data.amm.inventoryCount * 10_000n / data.maxSupply) / 100)
    : 0;
  const hasTradeBalance = data.communityBalance >= data.amm.tokensPerNFT;
  const selectedOwnedNft = ownedNfts.find(nft => nft.tokenId.toString() === selectedOwnedTokenId) || null;
  const selectedOwnedNftApproved = Boolean(selectedOwnedNft)
    && selectedOwnedNft.approved?.toLowerCase() === data.ammAddress.toLowerCase();
  const hasSellReserve = data.amm.tokenReserve >= data.amm.tokensPerNFT;

  const handleRevealAlertAction = () => {
    if (!urgentRevealNft) return;
    if (urgentRevealNft.revealState.status === 'ready') {
      tokenAction(
        'reveal',
        urgentRevealNft.tokenId,
        'reveal',
        language === 'zh' ? '正在揭示 NFT…' : 'Revealing NFT…',
        language === 'zh' ? 'NFT 已揭示' : 'NFT revealed',
      );
      return;
    }
    if (urgentRevealNft.revealState.status === 'expired') {
      if (recommitApprovalNeeded) {
        approveCommunityToken(pool.id, 'approve-recommit');
      } else {
        tokenAction(
          'recommit',
          urgentRevealNft.tokenId,
          'commitReveal',
          language === 'zh' ? '正在重新提交揭图…' : 'Committing reveal…',
          language === 'zh' ? '揭图已重新提交' : 'Reveal recommitted',
        );
      }
      return;
    }
    if (organized) onSectionChange?.('holdings');
  };

  if (loadError === 'Unsupported legacy Index Broker NFT contract') return null;
  if (loadError) {
    return (
      <div className="pool-card index-broker-card glass-card index-broker-load-error">
        <PoolCardHeader
          name={pool.name || c.type}
          typeLabel={c.type}
          typeClassName={getPoolTypeBadgeClass(pool.poolType)}
          ratio={pool.ratio}
          status={pool.status}
        />
        <p>{language === 'zh' ? '读取新版 Index Broker NFT 合约失败。' : 'Failed to read the new Index Broker NFT contract.'}</p>
        <button className="btn btn-secondary btn-sm" onClick={loadPoolData}>{language === 'zh' ? '重试' : 'Retry'}</button>
      </div>
    );
  }

  return (
    <>
      <div className={`pool-card index-broker-card ${detail ? 'index-broker-detail' : 'index-broker-summary'} ${compactDetailLayout ? 'index-broker-embedded' : ''} ${organized ? 'index-broker-organized' : ''} glass-card`} id={`pool-${pool.id}`}>
        {compactDetailLayout ? (
          <div className="index-broker-compact-header">
            <div className="index-broker-compact-identity">
              <strong>{data.name}</strong>
              <span>{data.symbol}</span>
              <span className="index-broker-compact-ratio">{(Number(pool.ratio || 0) / 100).toFixed(1)}%</span>
            </div>
            <div>
              <span>{c.totalSupply}</span>
              <strong>{loading ? '…' : `${data.totalSupply} / ${data.maxSupply}`}</strong>
            </div>
            <div>
              <span>{c.mintCost}</span>
              <strong>{formatTokenAmount(data.communityTokenPrice, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong>
            </div>
            <div>
              <span>{c.nativeCost}</span>
              <strong>{formatTokenAmount(data.nativePrice, 18)} {network.nativeCurrency.symbol}</strong>
            </div>
            <div>
              <span>{c.referralRate}</span>
              <strong>{(data.referralBps / 100).toFixed(2)}%</strong>
            </div>
          </div>
        ) : (
          <PoolCardHeader
            name={data.name}
            subtitle={detail ? data.symbol : ''}
            typeLabel={c.type}
            typeClassName={getPoolTypeBadgeClass(pool.poolType)}
            ratio={pool.ratio}
            status={pool.status}
          />
        )}

        {urgentRevealNft && (
          <section className={`index-broker-reveal-alert is-${urgentRevealNft.revealState.status}`} role="alert">
            <div className="index-broker-reveal-alert-icon">!</div>
            <div>
              <strong>
                {urgentRevealNft.revealState.status === 'ready'
                  ? (language === 'zh'
                    ? `NFT #${urgentRevealNft.tokenId} 现在可以揭图`
                    : `NFT #${urgentRevealNft.tokenId} is ready to reveal`)
                  : urgentRevealNft.revealState.status === 'expired'
                    ? (language === 'zh'
                      ? `NFT #${urgentRevealNft.tokenId} 已错过揭图窗口`
                      : `NFT #${urgentRevealNft.tokenId} missed its reveal window`)
                    : (language === 'zh'
                      ? `NFT #${urgentRevealNft.tokenId} 正在等待揭图`
                      : `NFT #${urgentRevealNft.tokenId} is waiting for reveal`)}
              </strong>
              <p>
                {urgentRevealNft.revealState.status === 'ready'
                  ? (language === 'zh'
                    ? `揭图窗口仅有 256 个区块，当前还剩 ${urgentRevealNft.revealState.blocks} / 256 个区块，请立即完成揭图。`
                    : `The reveal window lasts only 256 blocks. ${urgentRevealNft.revealState.blocks} / 256 blocks remain; reveal now.`)
                  : urgentRevealNft.revealState.status === 'expired'
                    ? (language === 'zh'
                      ? '本轮使用的区块随机数已经失效，必须重新提交揭图并再次等待。'
                      : 'This round’s block randomness is no longer available. Submit a new reveal and wait again.')
                    : (language === 'zh'
                      ? `距离可揭图还有 ${urgentRevealNft.revealState.blocks} 个区块；到达后将开启 256 个区块的揭图窗口。`
                      : `${urgentRevealNft.revealState.blocks} blocks until reveal; a 256-block reveal window opens afterward.`)}
              </p>
              <small>
                {data.rerollEnabled
                  ? (language === 'zh'
                    ? `错过窗口后重新提交将额外销毁 ${formatTokenAmount(data.recommitPrice, data.communityAsset.decimals)} ${data.communityAsset.symbol}。`
                    : `Missing the window requires another commit and burns ${formatTokenAmount(data.recommitPrice, data.communityAsset.decimals)} ${data.communityAsset.symbol}.`)
                  : (language === 'zh'
                    ? '错过窗口会导致本轮图片无法揭示，需要重新提交并重新等待。'
                    : 'Missing the window makes this round unrevealable; you must submit again and wait for a new window.')}
              </small>
            </div>
            {(urgentRevealNft.revealState.status !== 'waiting' || organized) && (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleRevealAlertAction}>
                {urgentRevealNft.revealState.status === 'ready'
                  ? c.reveal
                  : urgentRevealNft.revealState.status === 'expired'
                    ? (recommitApprovalNeeded ? c.approveRecommit : c.recommit)
                    : (language === 'zh' ? '查看倒计时' : 'View countdown')}
              </button>
            )}
          </section>
        )}

        {showFullHeaderDetails && (
          <section className={showAbout ? 'index-broker-about' : ''}>
            {showAbout ? (
              <>
                <div className="index-broker-section-heading">
                  <div><h2>{c.about}</h2><p>{c.aboutHint}</p></div>
                </div>
                <div className="index-broker-about-dashboard">
                  <article className="index-broker-about-card">
                    <h3>▥ {language === 'zh' ? '费率结构' : 'Fee schedule'}</h3>
                    <div className="index-broker-about-row"><span>{language === 'zh' ? '购买队首' : 'Queue trade'}</span><strong>{(data.amm.normalFeeBps / 100).toFixed(2)}%</strong></div>
                    <div className="index-broker-about-row"><span>{language === 'zh' ? '指定购买' : 'Specific NFT'}</span><strong>{(data.amm.specificFeeBps / 100).toFixed(2)}%</strong></div>
                    <div className="index-broker-about-row"><span>{language === 'zh' ? '协议费率' : 'Protocol fee'}</span><strong>{(PLATFORM_FEE_BPS / 100).toFixed(2)}%</strong></div>
                    <div className="index-broker-about-row"><span>{language === 'zh' ? '当前队首 BNB 费用' : 'Current queue BNB fee'}</span><strong className="native">{formatTokenAmount(data.amm.normalFee, 18)} {network.nativeCurrency.symbol}</strong></div>
                  </article>

                  <article className="index-broker-about-card index-broker-utilization-card">
                    <h3>{language === 'zh' ? 'AMM 库存利用率' : 'AMM utilization'}</h3>
                    <p>{language === 'zh' ? 'AMM 库存 NFT / 合集最大发行量' : 'NFT inventory / maximum collection supply'}</p>
                    <strong className="index-broker-utilization-value">{ammUtilization.toFixed(2)}%</strong>
                    <div className="index-broker-utilization-track"><i style={{ width: `${ammUtilization}%` }} /></div>
                    <div className="index-broker-about-row"><span>{language === 'zh' ? '库存 NFT' : 'NFTs in AMM'}</span><strong>{data.amm.inventoryCount.toString()} / {data.maxSupply.toString()}</strong></div>
                  </article>

                  <article className="index-broker-about-card">
                    <h3>{language === 'zh' ? '相关合约' : 'Contracts'}</h3>
                    <AboutContractRow label={language === 'zh' ? 'NFT 合集' : 'Collection'} address={pool.id} explorerUrl={network.explorerUrl} />
                    <AboutContractRow label="Renderer" address={data.rendererAddress} explorerUrl={network.explorerUrl} />
                    <AboutContractRow label={language === 'zh' ? 'AMM 金库' : 'AMM vault'} address={data.ammAddress} explorerUrl={network.explorerUrl} />
                    <AboutContractRow label={language === 'zh' ? '社区代币' : 'Community Token'} address={data.communityAsset.address} explorerUrl={network.explorerUrl} />
                    <AboutContractRow label={language === 'zh' ? '指数代币' : 'Index token'} address={data.indexToken.address} explorerUrl={network.explorerUrl} />
                  </article>

                  <article className="index-broker-about-card">
                    <h3>{language === 'zh' ? '市场信息' : 'Market info'}</h3>
                    <div className="index-broker-about-row"><span>{language === 'zh' ? '最大发行量' : 'Collection size'}</span><strong>{data.maxSupply.toString()} NFTs</strong></div>
                    <div className="index-broker-about-row"><span>{language === 'zh' ? '已铸造' : 'Minted'}</span><strong>{data.totalSupply.toString()} NFTs</strong></div>
                    <div className="index-broker-about-row"><span>{language === 'zh' ? '每枚 AMM 价格' : 'Tokens / NFT'}</span><strong>{formatTokenAmount(data.amm.tokensPerNFT, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
                    <div className="index-broker-about-row"><span>{language === 'zh' ? '公开 Mint 价格' : 'Public mint price'}</span><strong>{formatTokenAmount(data.nativePrice, 18)} {network.nativeCurrency.symbol}</strong></div>
                    <div className="index-broker-about-row"><span>{language === 'zh' ? '指数挖矿模式' : 'Index mining mode'}</span><strong>{data.miningMode === 'stake' ? c.stakeMode : c.burnMode}</strong></div>
                  </article>

                  <article className="index-broker-about-card index-broker-about-wide">
                    <h3>{data.miningMode === 'stake' ? '◈' : '♨'} {language === 'zh' ? '挖矿统计' : 'Mining stats'}</h3>
                    <div className="index-broker-about-metrics">
                      <div><span>{c.totalWeight}</span><strong>{data.totalWeight.toString()}</strong></div>
                      <div><span>{c.indexWeight}</span><strong>{formatTokenAmount(data.totalActiveIndexWeight, data.miningToken.decimals)} {data.miningToken.symbol}</strong></div>
                      <div><span>{c.queuedRewards}</span><strong>{formatTokenAmount(data.queuedIndexRewards, data.indexToken.decimals)} {data.indexToken.symbol}</strong></div>
                    </div>
                  </article>
                </div>
              </>
            ) : (
              <>
                <div className="index-broker-stats">
                  <div><span>{c.totalSupply}</span><strong>{loading ? '…' : `${data.totalSupply} / ${data.maxSupply}`}</strong></div>
                  <div><span>{c.totalWeight}</span><strong>{loading ? '…' : data.totalWeight.toString()}</strong></div>
                  <div><span>{c.indexWeight}</span><strong>{loading ? '…' : formatTokenAmount(data.totalActiveIndexWeight, data.miningToken.decimals)}</strong></div>
                </div>

                <div className="index-broker-economics">
                  <div><span>{c.mintCost}</span><strong>{formatTokenAmount(data.communityTokenPrice, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
                  <div><span>{c.nativeCost}</span><strong>{formatTokenAmount(data.nativePrice, 18)} {network.nativeCurrency.symbol}</strong></div>
                  <div><span>{c.referralRate}</span><strong>{(data.referralBps / 100).toFixed(2)}%</strong></div>
                  <div><span>{c.stakingToken}</span><strong>{data.miningToken.symbol || '…'} · {data.miningMode === 'stake' ? c.stakeMode : c.burnMode}</strong></div>
                  <div><span>{c.remainingPublic}</span><strong>{data.remainingPaidMints.toString()}</strong></div>
                  <div><span>{c.queuedRewards}</span><strong>{formatTokenAmount(data.queuedIndexRewards, data.indexToken.decimals)} {data.indexToken.symbol}</strong></div>
                </div>
              </>
            )}
          </section>
        )}

        {isConnected && (!compactDetailLayout || showHoldings) && (
          <div className="index-broker-user-summary">
            <div><span>{c.myWeight}</span><strong>{data.userWeight.toString()}</strong></div>
            <div><span>{c.communityRewards}</span><strong>{formatTokenAmount(data.pendingCommunityRewards, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
            <button className="btn btn-success btn-sm" disabled={busy || data.pendingCommunityRewards <= 0n} onClick={claimCommunityRewards}>{c.claimCommunity}</button>
          </div>
        )}

        {!detail && (
          <PoolCardFooter address={pool.id} explorerUrl={network.explorerUrl}>
            <Link className="btn btn-primary btn-sm" to={getChainPath(network.id, `community/${communityAddress}/pool/${pool.id}`)}>{c.viewDetails} →</Link>
          </PoolCardFooter>
        )}

        {showMint && (
          <section className="index-broker-mint-panel">
            <div>
              <h3>{c.mint}</h3>
              <p>{mintUsesWhitelist ? c.whitelistMint : c.publicMint}</p>
              <div className={`index-broker-mint-costs ${mintUsesWhitelist ? 'is-whitelist' : ''}`}>
                <span>{c.mintPayment}{language === 'zh' ? '：' : ':'}</span>
                <strong>{formatTokenAmount(data.communityTokenPrice, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong>
                {!mintUsesWhitelist && (
                  <>
                    <i>+</i>
                    <strong>{formatTokenAmount(data.nativePrice, network.nativeCurrency.decimals)} {network.nativeCurrency.symbol}</strong>
                  </>
                )}
                {mintUsesWhitelist && <small>{c.whitelistPaymentOnly}</small>}
              </div>
              {requiresSeedReveal && (
                <div className="index-broker-mint-reveal-warning">
                  <strong>{language === 'zh' ? 'Mint 后必须及时揭图' : 'Reveal promptly after minting'}</strong>
                  <span>
                    {language === 'zh'
                      ? 'Mint 成功后，系统会等待目标区块并开启仅 256 个区块的揭图窗口。请保持关注并在窗口内完成揭图。'
                      : 'After minting, the app waits for the target block and opens a reveal window lasting only 256 blocks. Complete the reveal inside that window.'}
                  </span>
                  <small>
                    {data.rerollEnabled
                      ? (language === 'zh'
                        ? `如果错过窗口，本轮随机图片将无法揭示；重新提交需要额外销毁 ${formatTokenAmount(data.recommitPrice, data.communityAsset.decimals)} ${data.communityAsset.symbol}。`
                        : `If you miss the window, this round cannot be revealed. A new commit burns another ${formatTokenAmount(data.recommitPrice, data.communityAsset.decimals)} ${data.communityAsset.symbol}.`)
                      : (language === 'zh'
                        ? '如果错过窗口，本轮随机图片将无法揭示，需要重新提交并重新等待。'
                        : 'If you miss the window, this round cannot be revealed and you must submit and wait again.')}
                  </small>
                </div>
              )}
              {isConnected && !loading && (
                <div className="index-broker-mint-balance">
                  <span>
                    {c.mintBalances}: {formatTokenAmount(data.communityBalance, data.communityAsset.decimals)} {data.communityAsset.symbol}
                    {' · '}{formatTokenAmount(data.nativeBalance, network.nativeCurrency.decimals)} {network.nativeCurrency.symbol}
                  </span>
                  {mintBalanceError && <strong>{mintBalanceError}</strong>}
                </div>
              )}
            </div>
            {!isConnected ? (
              <button className="btn btn-primary" disabled={connecting} onClick={connect}>{c.connect}</button>
            ) : (
              <>
                {!mintUsesWhitelist && (
                  <input className="input" type="number" min="0" step="1" value={referrerTokenId} onChange={event => setReferrerTokenId(event.target.value)} placeholder={c.referrer} />
                )}
                {mintApprovalNeeded ? (
                  <button className="btn btn-primary" disabled={busy} onClick={handleApproveMint}>{c.approveMint}</button>
                ) : (
                  <button className="btn btn-primary" disabled={busy || !canMint} onClick={handleMint}>{c.mint}</button>
                )}
              </>
            )}
          </section>
        )}
      </div>

      {showMining && (
        <section className="index-broker-nft-section glass-card index-broker-owned-feature">
          <div className="index-broker-section-heading">
            <div>
              <h2>{language === 'zh' ? '激活指数挖矿' : 'Activate index mining'}</h2>
              <p>
                {data.miningMode === 'stake'
                  ? (language === 'zh'
                    ? `为每枚 NFT 质押 ${data.miningToken.symbol} 以激活或增加指数挖矿权重；质押资产会随 NFT 转移，也可以赎回。`
                    : `Stake ${data.miningToken.symbol} for each NFT to activate or increase its index-mining weight. The stake follows the NFT when transferred and can be withdrawn.`)
                  : (language === 'zh'
                    ? `为每枚 NFT 销毁 ${data.miningToken.symbol} 以激活或增加指数挖矿权重；已销毁代币无法恢复。`
                    : `Burn ${data.miningToken.symbol} for each NFT to activate or increase its index-mining weight. Burned tokens cannot be recovered.`)}
              </p>
            </div>
            <span className="index-broker-feature-mode">{data.miningMode === 'stake' ? c.stakeMode : c.burnMode}</span>
          </div>
          {!isConnected ? (
            <div className="index-broker-owned-gate">
              <p>{language === 'zh' ? '连接钱包后查看你持有的 NFT 并激活挖矿。' : 'Connect your wallet to view your NFTs and activate mining.'}</p>
              <button className="btn btn-primary" disabled={connecting} onClick={connect}>{language === 'zh' ? '连接钱包' : 'Connect wallet'}</button>
            </div>
          ) : ownedNfts.length === 0 ? (
            <div className="index-broker-owned-gate">
              <p>{c.noNfts}</p>
              <button className="btn btn-primary" type="button" onClick={() => onSectionChange?.('mint-amm')}>Mint &amp; AMM {language === 'zh' ? '交易' : 'trading'}</button>
            </div>
          ) : (
            <div className="index-broker-nft-grid">
              {ownedNfts.map(nft => {
                const id = nft.tokenId.toString();
                const info = nft.info;
                const enteredAmount = parseUnitsSafe(upgradeAmounts[id], data.miningToken.decimals);
                return (
                  <article className="index-broker-nft index-broker-mining-nft" key={id}>
                    <NftArtwork src={nft.image} alt={`${data.name} #${id}`} fallback={`NFT #${id}`} />
                    <div className="index-broker-nft-body">
                      <div className="index-broker-nft-title">
                        <strong>{data.name} #{id}</strong>
                        <span className={info.indexMiningActive ? 'is-active' : ''}>{info.indexMiningActive ? c.active : c.inactive}</span>
                      </div>
                      <div className="index-broker-mining-metrics">
                        <div><span>{language === 'zh' ? '指数挖矿权重' : 'Index mining weight'}</span><strong>{formatTokenAmount(info.indexMiningWeight, data.miningToken.decimals)} {data.miningToken.symbol}</strong></div>
                        <div><span>{c.pendingIndex}</span><strong>{formatTokenAmount(info.pendingIndexRewards, data.indexToken.decimals)} {data.indexToken.symbol}</strong></div>
                      </div>
                      <button
                        className="btn btn-success btn-sm index-broker-full-action"
                        disabled={busy || info.pendingIndexRewards <= 0n}
                        onClick={() => tokenAction('claim-index', nft.tokenId, 'claimIndexRewards', language === 'zh' ? '正在领取指数奖励…' : 'Claiming index rewards…', language === 'zh' ? '指数奖励已领取' : 'Index rewards claimed')}
                      >
                        {c.claimIndex}
                      </button>
                      {data.miningMode === 'burn' && !info.indexMiningActive ? (
                        <div className="index-broker-mining-activation">
                          <small>{language === 'zh' ? '激活需销毁' : 'Activation burns'} {formatTokenAmount(data.activationPrice, data.miningToken.decimals)} {data.miningToken.symbol}</small>
                          <button className="btn btn-primary btn-sm" disabled={busy || data.miningBalance < data.activationPrice} onClick={() => activateIndexMining(nft)}>{language === 'zh' ? '激活' : 'Activate'}</button>
                        </div>
                      ) : (
                        <div className="index-broker-upgrade-row">
                          <input className="input" type="number" min="0" step="any" placeholder={`${c.amount} (${data.miningToken.symbol})`} value={upgradeAmounts[id] || ''} onChange={event => setUpgradeAmounts(current => ({ ...current, [id]: event.target.value }))} />
                          <button className="btn btn-primary btn-xs" disabled={busy || enteredAmount <= 0n || enteredAmount > data.miningBalance} onClick={() => changeIndexMiningWeight(nft)}>{language === 'zh' ? '升级' : 'Upgrade'}</button>
                          {data.miningMode === 'stake' && info.indexMiningWeight > 0n && (
                            <button className="btn btn-secondary btn-xs" disabled={busy || enteredAmount <= 0n || enteredAmount > info.indexMiningWeight} onClick={() => changeIndexMiningWeight(nft, true)}>{c.unstake}</button>
                          )}
                          <small>{c.miningBalance}: {formatTokenAmount(data.miningBalance, data.miningToken.decimals)} {data.miningToken.symbol}</small>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {showOwnedCollection && (
        <section className="index-broker-nft-section glass-card index-broker-owned-feature">
          <div className="index-broker-section-heading">
            <div>
              <h2>{language === 'zh' ? '我的 NFT 持仓' : 'My NFT holdings'}</h2>
              <p>
                {isConnected && account
                  ? (language === 'zh'
                    ? `${shortenAddress(account)} 当前持有 ${data.ownedNftCount.toString()} 枚 NFT`
                    : `${shortenAddress(account)} currently holds ${data.ownedNftCount.toString()} NFTs`)
                  : (language === 'zh' ? '连接钱包后查看当前地址的 NFT 持仓。' : 'Connect a wallet to view NFTs held by the current address.')}
              </p>
            </div>
          </div>
          {!isConnected ? (
            <div className="index-broker-owned-gate">
              <p>{language === 'zh' ? '连接钱包后查看你持有的 NFT。' : 'Connect your wallet to view your NFTs.'}</p>
              <button className="btn btn-primary" disabled={connecting} onClick={connect}>{language === 'zh' ? '连接钱包' : 'Connect wallet'}</button>
            </div>
          ) : ownedNfts.length === 0 ? (
            <div className="index-broker-owned-gate">
              <p>{c.noNfts}</p>
              <button className="btn btn-primary" type="button" onClick={() => onSectionChange?.('mint-amm')}>Mint &amp; AMM {language === 'zh' ? '交易' : 'trading'}</button>
            </div>
          ) : (
            <div className="index-broker-nft-grid">
              {ownedNfts.map(nft => {
                const id = nft.tokenId.toString();
                const info = nft.info;
                const revealState = revealWindowState(info, data.currentBlock);
                const revealReady = requiresSeedReveal && revealState.status === 'ready';
                const revealExpired = requiresSeedReveal && revealState.status === 'expired';
                return (
                  <article className={`index-broker-nft index-broker-management-nft${requiresSeedReveal && info.revealPending ? ' has-pending-reveal' : ''}`} key={id}>
                    <div className="index-broker-artwork-state">
                      <NftArtwork src={nft.image} alt={`${data.name} #${id}`} fallback={`NFT #${id}`} />
                      {requiresSeedReveal && info.revealPending && (
                        <span className={`is-${revealState.status}`}>
                          {revealState.status === 'ready'
                            ? (language === 'zh' ? '请立即揭图' : 'Reveal now')
                            : revealState.status === 'expired'
                              ? (language === 'zh' ? '揭图已超时' : 'Reveal expired')
                              : (language === 'zh' ? '等待揭图' : 'Waiting for reveal')}
                        </span>
                      )}
                    </div>
                    <div className="index-broker-nft-body">
                      <div className="index-broker-nft-title"><strong>{data.name} #{id}</strong><span>Lv.{Number(info.level)}</span></div>
                      {requiresSeedReveal && info.revealPending && (
                        <div className="index-broker-management-status">
                          <span>{language === 'zh' ? '揭图状态' : 'Reveal status'}</span>
                          <strong>{revealCountdownText(revealState, language)}</strong>
                        </div>
                      )}
                      {(revealReady || revealExpired || (requiresSeedReveal && !info.revealPending && data.rerollEnabled)) && (
                        <div className="index-broker-nft-actions">
                          {revealReady && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => tokenAction('reveal', nft.tokenId, 'reveal', language === 'zh' ? '正在揭示 NFT…' : 'Revealing NFT…', language === 'zh' ? 'NFT 已揭示' : 'NFT revealed')}>{c.reveal}</button>}
                          {revealExpired && (
                            recommitApprovalNeeded
                              ? <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => approveCommunityToken(pool.id, 'approve-recommit')}>{c.approveRecommit}</button>
                              : <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => tokenAction('recommit', nft.tokenId, 'commitReveal', language === 'zh' ? '正在重新提交揭图…' : 'Committing reveal…', language === 'zh' ? '揭图已重新提交' : 'Reveal recommitted')}>{c.recommit}</button>
                          )}
                          {requiresSeedReveal && !info.revealPending && data.rerollEnabled && (
                            recommitApprovalNeeded
                              ? <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => approveCommunityToken(pool.id, 'approve-reroll')}>{c.approveRecommit}</button>
                              : <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => tokenAction('reroll', nft.tokenId, 'commitReveal', language === 'zh' ? '正在提交重新生成…' : 'Committing reroll…', language === 'zh' ? '重新生成已提交' : 'Reroll committed')}>{c.reroll}</button>
                          )}
                        </div>
                      )}
                      {requiresSeedReveal && info.revealPending && (
                        <small className={`index-broker-reveal-status is-${revealState.status}`}>
                          {revealCountdownText(revealState, language)}
                          {revealExpired && data.rerollEnabled
                            ? (language === 'zh'
                              ? ` 重新提交将额外销毁 ${formatTokenAmount(data.recommitPrice, data.communityAsset.decimals)} ${data.communityAsset.symbol}。`
                              : ` A new commit burns ${formatTokenAmount(data.recommitPrice, data.communityAsset.decimals)} ${data.communityAsset.symbol}.`)
                            : ''}
                        </small>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {showHoldings && (
        <section className="index-broker-nft-section glass-card">
          <div className="index-broker-section-heading"><div><h2>{c.myNfts}</h2><p>{data.ownedNftCount > BigInt(ownedNfts.length) ? interpolate(c.nftCountLimited, { shown: ownedNfts.length, total: data.ownedNftCount.toString() }) : interpolate(c.nftCount, { count: ownedNfts.length })}</p></div></div>
          {!isConnected ? <div className="index-broker-empty">{c.connect}</div> : ownedNfts.length === 0 ? <div className="index-broker-empty">{c.noNfts}</div> : (
            <div className="index-broker-nft-grid">
              {ownedNfts.map(nft => {
                const id = nft.tokenId.toString();
                const info = nft.info;
                const revealState = revealWindowState(info, data.currentBlock);
                const revealReady = requiresSeedReveal && revealState.status === 'ready';
                const revealExpired = requiresSeedReveal && revealState.status === 'expired';
                const saleApproved = nft.approved?.toLowerCase() === data.ammAddress.toLowerCase();
                return (
                  <article className="index-broker-nft" key={id}>
                    <NftArtwork src={nft.image} alt={`${data.name} #${id}`} fallback={`NFT #${id}`} />
                    <div className="index-broker-nft-body">
                      <div className="index-broker-nft-title"><strong>#{id} · Lv.{Number(info.level)}</strong><span>{info.referralCount.toString()} refs</span></div>
                      <div className="index-broker-mining-columns">
                        <div><span>{c.communityMining}</span><strong>{info.miningWeight.toString()}</strong><small>{info.miningActive ? c.active : c.inactive}</small></div>
                        <div><span>{c.indexMining}</span><strong>{formatTokenAmount(info.indexMiningWeight, data.miningToken.decimals)} {data.miningToken.symbol}</strong><small>{info.indexMiningActive ? c.active : c.inactive}</small></div>
                      </div>
                      <div className="index-broker-pending"><span>{c.pendingIndex}</span><strong>{formatTokenAmount(info.pendingIndexRewards, data.indexToken.decimals)} {data.indexToken.symbol}</strong></div>
                      <div className="index-broker-nft-actions">
                        {data.referralBps > 0 && <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => copyReferralLink(nft.tokenId)}>{c.copyReferral}</button>}
                        {info.pendingIndexRewards > 0n && <button className="btn btn-success btn-xs" disabled={busy} onClick={() => tokenAction('claim-index', nft.tokenId, 'claimIndexRewards', language === 'zh' ? '正在领取指数奖励…' : 'Claiming index rewards…', language === 'zh' ? '指数奖励已领取' : 'Index rewards claimed')}>{c.claimIndex}</button>}
                        {data.miningMode === 'burn' && !info.indexMiningActive && (
                          data.miningAllowance < data.activationPrice
                            ? <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => approveMiningToken('approve-activate')}>{c.approveUpgrade}</button>
                            : <button className="btn btn-primary btn-xs" disabled={busy} onClick={() => tokenAction('activate-index', nft.tokenId, 'activateIndexMining', language === 'zh' ? '正在激活指数挖矿…' : 'Activating index mining…', language === 'zh' ? '指数挖矿已激活' : 'Index mining activated')}>{c.activate}</button>
                        )}
                        {revealReady && <button className="btn btn-primary btn-xs" disabled={busy} onClick={() => tokenAction('reveal', nft.tokenId, 'reveal', language === 'zh' ? '正在揭示 NFT…' : 'Revealing NFT…', language === 'zh' ? 'NFT 已揭示' : 'NFT revealed')}>{c.reveal}</button>}
                        {revealExpired && (
                          recommitApprovalNeeded
                            ? <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => approveCommunityToken(pool.id, 'approve-recommit')}>{c.approveRecommit}</button>
                            : <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => tokenAction('recommit', nft.tokenId, 'commitReveal', language === 'zh' ? '正在重新提交揭图…' : 'Committing reveal…', language === 'zh' ? '揭图已重新提交' : 'Reveal recommitted')}>{c.recommit}</button>
                        )}
                        {requiresSeedReveal && !info.revealPending && data.rerollEnabled && (
                          recommitApprovalNeeded
                            ? <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => approveCommunityToken(pool.id, 'approve-reroll')}>{c.approveRecommit}</button>
                            : <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => tokenAction('reroll', nft.tokenId, 'commitReveal', language === 'zh' ? '正在提交重新生成…' : 'Committing reroll…', language === 'zh' ? '重新生成已提交' : 'Reroll committed')}>{c.reroll}</button>
                        )}
                      </div>
                      {requiresSeedReveal && info.revealPending && <small className={`index-broker-reveal-status is-${revealState.status}`}>{revealCountdownText(revealState, language)}</small>}
                      {(data.miningMode === 'stake' || info.indexMiningActive) && (
                        <div className="index-broker-upgrade-row">
                          <input className="input" type="number" min="0" step="any" placeholder={c.amount} value={upgradeAmounts[id] || ''} onChange={event => setUpgradeAmounts(current => ({ ...current, [id]: event.target.value }))} />
                          {data.miningAllowance < parseUnitsSafe(upgradeAmounts[id], data.miningToken.decimals) ? (
                            <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => approveMiningToken('approve-upgrade')}>{data.miningMode === 'stake' ? c.approveStake : c.approveUpgrade}</button>
                          ) : (
                            <button className="btn btn-primary btn-xs" disabled={busy || !upgradeAmounts[id] || parseUnitsSafe(upgradeAmounts[id], data.miningToken.decimals) > data.miningBalance} onClick={() => changeIndexMiningWeight(nft)}>{data.miningMode === 'stake' ? c.stake : c.upgrade}</button>
                          )}
                          {data.miningMode === 'stake' && info.indexMiningWeight > 0n && (
                            <button className="btn btn-secondary btn-xs" disabled={busy || !upgradeAmounts[id] || parseUnitsSafe(upgradeAmounts[id], data.miningToken.decimals) > info.indexMiningWeight} onClick={() => changeIndexMiningWeight(nft, true)}>{c.unstake}</button>
                          )}
                          <small>{c.miningBalance}: {formatTokenAmount(data.miningBalance, data.miningToken.decimals)} {data.miningToken.symbol}</small>
                        </div>
                      )}
                      {data.ammAddress && (
                        <div className="index-broker-sell-row">
                          {!saleApproved && <button className="btn btn-secondary btn-xs" disabled={busy || !data.amm.active} onClick={() => approveNftSale(nft)}>{c.approveNft}</button>}
                          <button
                            className="btn btn-danger btn-xs"
                            disabled={busy || !data.amm.active || !saleApproved || data.amm.tokenReserve < data.amm.tokensPerNFT}
                            onClick={() => sellNft(nft)}
                          >
                            {c.sell}
                          </button>
                          {!saleApproved && <small>{c.approveBeforeSell}</small>}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {showAdvancedTools && (
        <section className="index-broker-rewards glass-card">
          <div className="index-broker-section-heading">
            <div><h2>{organized ? (language === 'zh' ? '奖励与指数回购' : 'Rewards & index buyback') : c.rewardTools}</h2><p>{c.rewardToolsHint}</p></div>
            {isConnected && (
              <div className="index-broker-heading-actions">
                {!data.amm.active && <button className="btn btn-primary btn-sm" disabled={busy || loading || !data.ammAddress} onClick={() => execute('activate-amm', language === 'zh' ? '正在激活 AMM…' : 'Activating AMM…', language === 'zh' ? 'AMM 已激活' : 'AMM activated', writeSigner => new ethers.Contract(data.ammAddress, IndexBrokerNFTAMMABI, writeSigner).activate())}>{c.activateAmm}</button>}
                <button className="btn btn-secondary btn-sm" disabled={busy || loading || !data.amm.active} onClick={harvestIndexHolderFees}>{c.harvestFees}</button>
              </div>
            )}
          </div>
          {organized && (
            <div className="index-broker-tool-stats">
              <div><span>{c.queuedRewards}</span><strong>{formatTokenAmount(data.queuedIndexRewards, data.indexToken.decimals)} {data.indexToken.symbol}</strong></div>
              <div><span>{c.indexWeight}</span><strong>{formatTokenAmount(data.totalActiveIndexWeight, data.miningToken.decimals)} {data.miningToken.symbol}</strong></div>
              <div><span>{c.nativeReserve}</span><strong>{formatTokenAmount(data.amm.nativeReserve, 18)} {network.nativeCurrency.symbol}</strong></div>
            </div>
          )}
          {organized ? (
            <div className="index-broker-tools-grid">
              <div className="index-broker-tool-panel">
                <div><strong>{c.injectRewards}</strong><small>{language === 'zh' ? '将指数代币注入奖励池，按活跃指数挖矿权重分配。' : 'Inject index tokens and distribute them by active index-mining weight.'}</small></div>
                {!isConnected ? (
                  <button className="btn btn-primary index-broker-full-action" disabled={connecting} onClick={connect}>{c.connectTrade}</button>
                ) : (
                  <div className="index-broker-reward-form">
                    <div>
                      <input className="input" type="number" min="0" step="any" value={indexRewardAmount} onChange={event => setIndexRewardAmount(event.target.value)} placeholder={c.rewardAmount} />
                      <small>{c.balance}: {formatTokenAmount(data.indexBalance, data.indexToken.decimals)} {data.indexToken.symbol}</small>
                    </div>
                    {indexApprovalNeeded ? (
                      <button className="btn btn-secondary" disabled={busy || parsedIndexRewardAmount > data.indexBalance} onClick={approveIndexToken}>{c.approveIndexToken}</button>
                    ) : (
                      <button className="btn btn-primary" disabled={busy || parsedIndexRewardAmount <= 0n || parsedIndexRewardAmount > data.indexBalance} onClick={injectIndexRewards}>{c.injectRewards}</button>
                    )}
                  </div>
                )}
              </div>
              <div className="index-broker-tool-panel">
                <div><strong>{c.buyback}</strong><small>{c.buybackHint} · Basket V{data.amm.basketVersion}</small></div>
                <div className="index-broker-buyback-summary">
                  <div>
                    <span>{language === 'zh' ? '可用回购资金' : 'Available buyback funds'}</span>
                    <strong>{formatTokenAmount(data.amm.nativeReserve, network.nativeCurrency.decimals)} {network.nativeCurrency.symbol}</strong>
                  </div>
                  <div>
                    <span>{language === 'zh' ? '预计回购指数代币' : 'Estimated index tokens'}</span>
                    <strong>
                      {buybackQuote.loading
                        ? (language === 'zh' ? '正在获取报价…' : 'Fetching quote…')
                        : buybackQuote.indexOut > 0n
                          ? `${formatTokenAmount(buybackQuote.indexOut, data.indexToken.decimals)} ${data.indexToken.symbol}`
                          : '—'}
                    </strong>
                  </div>
                </div>
                {buybackQuote.error && <small className="index-broker-buyback-error">{buybackQuote.error}</small>}
                {!isConnected ? (
                  <button className="btn btn-primary index-broker-full-action" disabled={connecting} onClick={connect}>{c.connectTrade}</button>
                ) : (
                  <button className="btn btn-primary btn-sm index-broker-full-action" disabled={busy || !data.amm.active || data.amm.nativeReserve <= 0n || buybackQuote.loading || buybackQuote.indexOut <= 0n} onClick={executeIndexBuyback}>{c.buyback}</button>
                )}
              </div>
            </div>
          ) : !isConnected ? (
            <button className="btn btn-primary" disabled={connecting} onClick={connect}>{c.connectTrade}</button>
          ) : (
            <div className="index-broker-tools-grid index-broker-tools-single">
              <div className="index-broker-tool-panel">
                <div><strong>{c.injectRewards}</strong><small>{language === 'zh' ? '将指数代币注入奖励池，按活跃指数挖矿权重分配。' : 'Inject index tokens and distribute them by active index-mining weight.'}</small></div>
                <div className="index-broker-reward-form">
                  <div>
                    <input className="input" type="number" min="0" step="any" value={indexRewardAmount} onChange={event => setIndexRewardAmount(event.target.value)} placeholder={c.rewardAmount} />
                    <small>{c.balance}: {formatTokenAmount(data.indexBalance, data.indexToken.decimals)} {data.indexToken.symbol}</small>
                  </div>
                  {indexApprovalNeeded ? (
                    <button className="btn btn-secondary" disabled={busy || parsedIndexRewardAmount > data.indexBalance} onClick={approveIndexToken}>{c.approveIndexToken}</button>
                  ) : (
                    <button className="btn btn-primary" disabled={busy || parsedIndexRewardAmount <= 0n || parsedIndexRewardAmount > data.indexBalance} onClick={injectIndexRewards}>{c.injectRewards}</button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {showAmm && (compactDetailLayout ? (
        <section className="index-broker-amm-trade glass-card">
          {ammTradeSide === 'buy' ? (
            <>
              <div className="index-broker-trade-tabs" role="tablist" aria-label={c.buyNftMode}>
                <button type="button" role="tab" aria-selected={ammTradeMode === 'swap'} className={ammTradeMode === 'swap' ? 'active swap' : ''} onClick={() => setAmmTradeMode('swap')}>
                  <strong>↝ {c.swapNext}</strong><span>({c.nextAvailable})</span>
                </button>
                <button type="button" role="tab" aria-selected={ammTradeMode === 'snipe'} className={ammTradeMode === 'snipe' ? 'active snipe' : ''} onClick={() => setAmmTradeMode('snipe')}>
                  <strong>⊕ {c.snipe}</strong><span>({c.chooseNft})</span>
                </button>
              </div>

              <div className="index-broker-trade-body">
                <div className="index-broker-trade-label"><strong>{c.youSend}</strong><span>{c.balance}: {isConnected ? formatTokenAmount(data.communityBalance, data.communityAsset.decimals) : '—'}</span></div>
                <div className="index-broker-trade-asset">
                  <div className="index-broker-token-mark">{data.communityAsset.symbol?.slice(0, 2) || 'CT'}</div>
                  <div><strong>{data.communityAsset.symbol}</strong><span>{c.totalPayment}</span></div>
                  <b>{formatTokenAmount(data.amm.tokensPerNFT, data.communityAsset.decimals)}</b>
                </div>
                <div className="index-broker-trade-divider">
                  <button type="button" onClick={() => setAmmTradeSide('sell')} aria-label={c.sellNftMode} title={c.sellNftMode}>↕</button>
                </div>
                <div className="index-broker-trade-label"><strong>{c.youReceive}</strong><span>{data.amm.inventoryCount.toString()} {c.inVault}</span></div>
                {ammTradeMode === 'swap' ? (
                  nextInventoryNft ? (
                    <div className="index-broker-trade-nft-receive">
                      <NftArtwork src={nextInventoryNft.image} alt={`${data.name} #${nextInventoryNft.tokenId}`} fallback={`NFT #${nextInventoryNft.tokenId.toString()}`} />
                      <div><strong>{data.name} #{nextInventoryNft.tokenId.toString()}</strong><span>{c.nextAvailable} · {data.amm.inventoryCount.toString()} {c.inVault}</span></div>
                      <b>1 NFT</b>
                    </div>
                  ) : <div className="index-broker-empty">{c.emptyInventory}</div>
                ) : (
                  <div className="index-broker-snipe-picker">
                    <div className="index-broker-snipe-prompt">⊕ {selectedInventoryNft ? `${data.name} #${selectedInventoryNft.tokenId.toString()}` : c.selectNft}</div>
                    {inventory.length === 0 ? <div className="index-broker-empty">{c.emptyInventory}</div> : (
                      <div className="index-broker-snipe-grid">
                        {inventory.map(nft => {
                          const tokenId = nft.tokenId.toString();
                          return <button type="button" className={selectedInventoryTokenId === tokenId ? 'selected' : ''} key={tokenId} onClick={() => setSelectedInventoryTokenId(tokenId)}><NftArtwork src={nft.image} alt={`${data.name} #${tokenId}`} fallback={`NFT #${tokenId}`} /><strong>#{tokenId}</strong></button>;
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="index-broker-trade-quote">
                <div><span>{c.rate}</span><strong>1 NFT = {formatTokenAmount(data.amm.tokensPerNFT, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
                <div><span>{c.ammFee} ({(tradeFeeBps / 100).toFixed(2)}%)</span><strong>{formatTokenAmount(tradeTokenFee, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
                <div><span>{c.maxNativeFee}</span><strong>{formatTokenAmount(withFeeBuffer(tradeNativeFee), 18)} {network.nativeCurrency.symbol}</strong></div>
                <div><span>{c.mode}</span><strong>{ammTradeMode === 'snipe' ? c.snipe : c.swapNext}</strong></div>
                <div className="index-broker-trade-total"><span>{c.totalPayment}</span><strong>{formatTokenAmount(data.amm.tokensPerNFT, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
              </div>

              {!isConnected ? (
                <button className="btn btn-primary index-broker-trade-action" disabled={connecting} onClick={connect}>{c.connectTrade}</button>
              ) : ammApprovalNeeded ? (
                <button className="btn btn-primary index-broker-trade-action" disabled={busy || !data.amm.active || !tradeNft} onClick={() => approveCommunityToken(data.ammAddress, 'approve-amm')}>{c.approveTrade}</button>
              ) : !hasTradeBalance ? (
                <button className="btn btn-primary index-broker-trade-action" disabled>{c.insufficientBalance}</button>
              ) : (
                <button className="btn btn-primary index-broker-trade-action" disabled={busy || !data.amm.active || !tradeNft} onClick={() => buyNft(ammTradeMode === 'snipe' ? tradeNft?.tokenId : null)}>{ammTradeMode === 'snipe' ? c.buySelected : c.buyNext}{tradeNft ? ` #${tradeNft.tokenId.toString()}` : ''}</button>
              )}
            </>
          ) : (
            <>
              <div className="index-broker-trade-body index-broker-sell-body">
                <div className="index-broker-trade-label"><strong>{c.youSend}</strong><span>{ownedNfts.length} {c.inWallet}</span></div>
                <div className="index-broker-snipe-prompt">{selectedOwnedNft ? `${data.name} #${selectedOwnedNft.tokenId.toString()}` : c.selectOwnedNft}</div>
                {!isConnected ? <div className="index-broker-empty">{c.connectTrade}</div> : ownedNfts.length === 0 ? <div className="index-broker-empty">{c.noNfts}</div> : (
                  <div className="index-broker-snipe-grid index-broker-owned-sell-grid">
                    {ownedNfts.map(nft => {
                      const tokenId = nft.tokenId.toString();
                      return <button type="button" className={selectedOwnedTokenId === tokenId ? 'selected' : ''} key={tokenId} onClick={() => setSelectedOwnedTokenId(tokenId)}><NftArtwork src={nft.image} alt={`${data.name} #${tokenId}`} fallback={`NFT #${tokenId}`} /><strong>#{tokenId}</strong></button>;
                    })}
                  </div>
                )}
                <div className="index-broker-trade-divider">
                  <button type="button" onClick={() => setAmmTradeSide('buy')} aria-label={c.buyNftMode} title={c.buyNftMode}>↕</button>
                </div>
                <div className="index-broker-trade-label"><strong>{c.youReceive}</strong><span>{c.estimatedPayout}</span></div>
                <div className="index-broker-trade-asset index-broker-trade-payout">
                  <div className="index-broker-token-mark">{data.communityAsset.symbol?.slice(0, 2) || 'CT'}</div>
                  <div><strong>{data.communityAsset.symbol}</strong><span>{c.estimatedPayout}</span></div>
                  <b>{formatTokenAmount(data.amm.tokensPerNFT, data.communityAsset.decimals)}</b>
                </div>
              </div>

              <div className="index-broker-trade-quote">
                <div><span>{c.rate}</span><strong>1 NFT = {formatTokenAmount(data.amm.tokensPerNFT, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
                <div><span>{c.ammFee} ({(normalTradeFeeBps / 100).toFixed(2)}%)</span><strong>{formatTokenAmount(normalTradeTokenFee, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
                <div><span>{c.maxNativeFee}</span><strong>{formatTokenAmount(withFeeBuffer(data.amm.normalFee), 18)} {network.nativeCurrency.symbol}</strong></div>
                <div className="index-broker-trade-total"><span>{c.estimatedPayout}</span><strong>{formatTokenAmount(data.amm.tokensPerNFT, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
              </div>

              {!isConnected ? (
                <button className="btn btn-primary index-broker-trade-action" disabled={connecting} onClick={connect}>{c.connectTrade}</button>
              ) : !selectedOwnedNft ? (
                <button className="btn btn-primary index-broker-trade-action" disabled>{c.selectOwnedNft}</button>
              ) : !selectedOwnedNftApproved ? (
                <button className="btn btn-primary index-broker-trade-action" disabled={busy || !data.amm.active} onClick={() => approveNftSale(selectedOwnedNft)}>{c.approveSell} #{selectedOwnedNft.tokenId.toString()}</button>
              ) : !hasSellReserve ? (
                <button className="btn btn-primary index-broker-trade-action" disabled>{c.insufficientReserve}</button>
              ) : (
                <button className="btn btn-primary index-broker-trade-action" disabled={busy || !data.amm.active} onClick={() => sellNft(selectedOwnedNft)}>{c.sellSelected} #{selectedOwnedNft.tokenId.toString()}</button>
              )}
            </>
          )}
          <div className="index-broker-warning">⚠ {data.miningMode === 'stake' ? c.stakeTransferWarning : c.transferWarning}</div>
        </section>
      ) : (
        <section className="index-broker-amm glass-card">
          <div className="index-broker-section-heading">
            <div><h2>{c.amm}</h2><p>{data.amm.active ? c.ammActive : c.ammWaiting}</p></div>
            {!data.amm.active && isConnected && <button className="btn btn-primary btn-sm" disabled={busy || loading || !data.ammAddress} onClick={() => execute('activate-amm', language === 'zh' ? '正在激活 AMM…' : 'Activating AMM…', language === 'zh' ? 'AMM 已激活' : 'AMM activated', writeSigner => new ethers.Contract(data.ammAddress, IndexBrokerNFTAMMABI, writeSigner).activate())}>{c.activateAmm}</button>}
          </div>
          <div className="index-broker-amm-stats">
            <div><span>{c.inventory}</span><strong>{data.amm.inventoryCount.toString()}</strong></div>
            <div><span>{c.reserve}</span><strong>{formatTokenAmount(data.amm.tokenReserve, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
            <div><span>{c.tradeAmount}</span><strong>{formatTokenAmount(data.amm.tokensPerNFT, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
            <div><span>{c.normalFee}</span><strong>{formatTokenAmount(data.amm.normalFee, 18)} {network.nativeCurrency.symbol}</strong></div>
            <div><span>{c.specificFee}</span><strong>{formatTokenAmount(data.amm.specificFee, 18)} {network.nativeCurrency.symbol}</strong></div>
            <div><span>{c.nativeReserve}</span><strong>{formatTokenAmount(data.amm.nativeReserve, 18)} {network.nativeCurrency.symbol}</strong></div>
          </div>
          <div className="index-broker-warning">⚠ {data.miningMode === 'stake' ? c.stakeTransferWarning : c.transferWarning}</div>
          {data.amm.active && data.amm.nativeReserve > 0n && (
            <div className="index-broker-buyback-form">
              <div><strong>{c.buyback}</strong><small>{c.buybackHint} · Basket V{data.amm.basketVersion}</small></div>
              <div className="index-broker-buyback-summary">
                <div>
                  <span>{language === 'zh' ? '可用回购资金' : 'Available buyback funds'}</span>
                  <strong>{formatTokenAmount(data.amm.nativeReserve, network.nativeCurrency.decimals)} {network.nativeCurrency.symbol}</strong>
                </div>
                <div>
                  <span>{language === 'zh' ? '预计回购指数代币' : 'Estimated index tokens'}</span>
                  <strong>{buybackQuote.loading ? (language === 'zh' ? '正在获取报价…' : 'Fetching quote…') : buybackQuote.indexOut > 0n ? `${formatTokenAmount(buybackQuote.indexOut, data.indexToken.decimals)} ${data.indexToken.symbol}` : '—'}</strong>
                </div>
              </div>
              {buybackQuote.error && <small className="index-broker-buyback-error">{buybackQuote.error}</small>}
              {!isConnected ? (
                <button className="btn btn-primary btn-sm index-broker-full-action" disabled={connecting} onClick={connect}>{c.connectTrade}</button>
              ) : (
                <button className="btn btn-primary btn-sm index-broker-full-action" disabled={busy || buybackQuote.loading || buybackQuote.indexOut <= 0n} onClick={executeIndexBuyback}>{c.buyback}</button>
              )}
            </div>
          )}
          {data.amm.active && isConnected && data.amm.inventoryCount > 0n && (
            ammApprovalNeeded
              ? <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => approveCommunityToken(data.ammAddress, 'approve-amm')}>{c.approveAmmToken}</button>
              : <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => buyNft(null)}>{c.buyNext} #{data.amm.oldestTokenId.toString()}</button>
          )}
          {inventory.length === 0 ? <div className="index-broker-empty">{c.emptyInventory}</div> : (
            <div className="index-broker-inventory-grid">
              {inventory.map(nft => (
                <article key={nft.tokenId.toString()}>
                  <NftArtwork src={nft.image} alt={`${data.name} #${nft.tokenId}`} fallback={`NFT #${nft.tokenId.toString()}`} />
                  <strong>#{nft.tokenId.toString()} · Lv.{Number(nft.info.level)}</strong>
                  {isConnected && data.amm.active && !ammApprovalNeeded && <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => buyNft(nft.tokenId)}>{c.buy}</button>}
                </article>
              ))}
            </div>
          )}
        </section>
      ))}

      {showAdmin && (
        <section className="index-broker-admin glass-card">
          <h2>{c.updateReceiver}</h2>
          <div><input className="input" value={newReceiver} onChange={event => setNewReceiver(event.target.value)} placeholder={c.receiver} /><button className="btn btn-secondary" disabled={busy || loading || !ethers.isAddress(newReceiver)} onClick={() => execute('receiver', language === 'zh' ? '正在更新收款地址…' : 'Updating receiver…', language === 'zh' ? '收款地址已更新' : 'Receiver updated', writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner).setFundsReceiver(newReceiver))}>{c.updateReceiver}</button></div>
        </section>
      )}

      {showReferral && (
        <section className="index-broker-referral glass-card">
          <div className="index-broker-section-heading">
            <div>
              <h2>{language === 'zh' ? '推荐规则与升级' : 'Referral rules and upgrades'}</h2>
              <p>
                {language === 'zh'
                  ? `公开 Mint 使用某枚 NFT 的推荐链接后，该 NFT 的推荐人数会增加，达到门槛后自动升级并提高社区挖矿权重。当前 BNB 返佣比例为 ${(data.referralBps / 100).toFixed(2)}%。`
                  : `When a public mint uses an NFT's referral link, that NFT's referral count increases. Reaching a threshold upgrades its level and Community Token mining weight. The current BNB commission rate is ${(data.referralBps / 100).toFixed(2)}%.`}
              </p>
            </div>
            <span className="index-broker-referral-rate">{(data.referralBps / 100).toFixed(2)}%</span>
          </div>
          <div className="index-broker-level-rules">
            {data.levelRules.map(rule => (
              <div key={rule.level}>
                <strong>Lv.{rule.level}</strong>
                <span>{rule.threshold.toString()} {language === 'zh' ? '人推荐' : 'referrals'}</span>
                <b>{language === 'zh' ? '挖矿权重' : 'Mining weight'} {rule.weight.toString()}</b>
              </div>
            ))}
          </div>
          {!isConnected ? (
            <div className="index-broker-owned-gate">
              <p>{language === 'zh' ? '连接钱包后查看你每枚 NFT 的推荐等级和社区挖矿信息。' : 'Connect your wallet to view each NFT’s referral level and community mining information.'}</p>
              <button className="btn btn-primary" disabled={connecting} onClick={connect}>{language === 'zh' ? '连接钱包' : 'Connect wallet'}</button>
            </div>
          ) : ownedNfts.length === 0 ? (
            <div className="index-broker-owned-gate">
              <p>{c.noNfts}</p>
              <button className="btn btn-primary" type="button" onClick={() => onSectionChange?.('mint-amm')}>Mint &amp; AMM {language === 'zh' ? '交易' : 'trading'}</button>
            </div>
          ) : (
            <>
              <div className="index-broker-community-claim">
                <div><span>{language === 'zh' ? '当前钱包的社区代币奖励' : 'Community Token rewards for this wallet'}</span><strong>{formatTokenAmount(data.pendingCommunityRewards, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong><small>{language === 'zh' ? '合约按钱包在该矿池的全部 NFT 统一结算，一次领取全部奖励。' : 'The contract settles all NFTs held by this wallet together; one claim collects all rewards.'}</small></div>
              </div>
              <div className="index-broker-referral-holdings">
                {ownedNfts.map(nft => (
                  <article key={nft.tokenId.toString()} className="index-broker-referral-nft">
                    <NftArtwork src={nft.image} alt={`${data.name} #${nft.tokenId}`} fallback={`NFT #${nft.tokenId.toString()}`} />
                    <div>
                      <div className="index-broker-nft-title"><strong>{data.name} #{nft.tokenId.toString()}</strong><span>Lv.{Number(nft.info.level)}</span></div>
                      <dl>
                        <div><dt>{language === 'zh' ? '等级' : 'Level'}</dt><dd>Lv.{Number(nft.info.level)}</dd></div>
                        <div><dt>{language === 'zh' ? '推荐人数' : 'Referrals'}</dt><dd>{nft.info.referralCount.toString()}</dd></div>
                        <div><dt>{language === 'zh' ? '社区挖矿权重' : 'Community mining weight'}</dt><dd>{nft.info.miningWeight.toString()}</dd></div>
                        <div><dt>{language === 'zh' ? '挖矿状态' : 'Mining status'}</dt><dd>{nft.info.miningActive ? c.active : c.inactive}</dd></div>
                      </dl>
                      <div className="index-broker-referral-actions">
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => copyReferralLink(nft.tokenId)}>{c.copyReferral}</button>
                        <button className="btn btn-success btn-sm" disabled={busy || data.pendingCommunityRewards <= 0n} onClick={claimCommunityRewards}>{language === 'zh' ? '领取钱包全部奖励' : 'Claim wallet rewards'}</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {showActivity && (
        <section className="index-broker-insights index-broker-insights-single">
          {showActivity && <div className="glass-card"><h2>{compactDetailLayout && section === 'mint-amm' ? (language === 'zh' ? '交易记录' : 'Transactions') : c.activity}</h2>{indexedLoading ? <span className="spinner" /> : recentEvents.length === 0 ? <p>{c.noIndexedData}</p> : recentEvents.map(event => <a className="index-broker-event-row" key={event.id} href={`${network.explorerUrl}/tx/${event.transactionHash || event.transaction_hash}`} target="_blank" rel="noreferrer"><div><strong>{eventLabel(event.eventType || event.event_type, language)}</strong><span>{event.tokenId || event.token_id ? `NFT #${event.tokenId || event.token_id}` : shortenAddress(event.account)}</span></div><small>{formatDate(event.blockTimestamp || event.block_timestamp)}</small></a>)}</div>}
        </section>
      )}

      {mintResult && (
        <div className="modal-overlay index-broker-mint-result-overlay" onClick={() => setMintResult(null)}>
          <section
            className="modal-content index-broker-mint-result-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="index-broker-mint-result-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="index-broker-mint-result-kicker">{language === 'zh' ? '铸造成功' : 'Mint successful'}</span>
                <h2 className="modal-title" id="index-broker-mint-result-title">
                  {data.name}{mintResult.tokenId > 0n ? ` #${mintResult.tokenId}` : ''}
                </h2>
              </div>
              <button className="modal-close" type="button" aria-label={language === 'zh' ? '关闭' : 'Close'} onClick={() => setMintResult(null)}>×</button>
            </div>

            <div className="index-broker-mint-result-artwork">
              {mintResult.loading ? (
                <div className="index-broker-mint-result-loading"><span className="spinner" /><span>{language === 'zh' ? '正在读取 NFT 图片…' : 'Loading NFT artwork…'}</span></div>
              ) : (
                <NftArtwork
                  src={mintResult.image}
                  alt={`${data.name} #${mintResult.tokenId}`}
                  fallback={mintResult.tokenId > 0n ? `NFT #${mintResult.tokenId}` : 'NFT'}
                />
              )}
            </div>

            {mintResult.error && <p className="index-broker-mint-result-error">{mintResult.error}</p>}

            {mintResultRevealState && (
              <div className={`index-broker-mint-result-reveal is-${mintResultRevealState.status}`} role="alert">
                <strong>{language === 'zh' ? '这枚 NFT 需要及时揭图' : 'This NFT must be revealed in time'}</strong>
                <span>{revealCountdownText(mintResultRevealState, language)}</span>
                <small>
                  {language === 'zh'
                    ? '错过 256 个区块的窗口后，图片可能无法继续揭示，重新提交还可能需要再次支付代币。'
                    : 'If the 256-block window is missed, the artwork may no longer be revealable and recommitting may require another token payment.'}
                </small>
              </div>
            )}

            <div className="index-broker-mint-result-actions">
              {mintResult.error && mintResult.tokenId > 0n && (
                <button className="btn btn-secondary" type="button" disabled={mintResult.loading} onClick={() => loadMintResult(mintResult.tokenId)}>
                  {language === 'zh' ? '重新加载图片' : 'Reload artwork'}
                </button>
              )}
              {mintResultRevealState && (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    setMintResult(null);
                    onSectionChange?.('holdings');
                  }}
                >
                  {mintResultRevealState.status === 'ready'
                    ? (language === 'zh' ? '立即去揭图' : 'Reveal now')
                    : (language === 'zh' ? '查看揭图进度' : 'View reveal progress')}
                </button>
              )}
              <button className={`btn ${mintResultRevealState ? 'btn-secondary' : 'btn-primary'}`} type="button" onClick={() => setMintResult(null)}>
                {language === 'zh' ? '完成' : 'Done'}
              </button>
            </div>
          </section>
        </div>
      )}

      {detail && loading && <div className="index-broker-loading">{c.loading}</div>}
    </>
  );
}
