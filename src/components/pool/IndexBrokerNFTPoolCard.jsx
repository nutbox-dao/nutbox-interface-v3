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
import { fetchIndexBrokerNftInsights } from '../../config/subgraph';
import {
  formatDate,
  formatTokenAmount,
  getPoolTypeBadgeClass,
  shortenAddress,
} from '../../utils/helpers';
import { multicallRead } from '../../utils/multicall';
import { PoolCardFooter, PoolCardHeader } from './PoolCardTemplate';
import './IndexBrokerNFTPoolCard.css';

const COPY = {
  en: {
    type: 'Index Broker NFT', totalSupply: 'NFT supply', totalWeight: 'Community mining weight',
    indexWeight: 'Active index weight', mintCost: 'Mint cost',
    nativeCost: 'Public mint price', whitelistFree: 'Whitelist BNB fee', remainingPublic: 'Public mints left',
    myWeight: 'My community weight', communityRewards: 'Community rewards', claimCommunity: 'Claim community rewards',
    approveMint: 'Approve mint token', mint: 'Mint NFT', referrer: 'Referrer NFT ID (optional)',
    whitelistMint: 'Your next mint uses a whitelist slot and pays no BNB.',
    publicMint: 'Public mint pays the exact BNB price plus the Community Token cost.',
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
    buyback: 'Execute index buyback', buybackHint: 'Invest the AMM BNB reserve and receive a 1% execution reward. Minimum outputs protect against slippage.',
    nativeReserve: 'BNB buyback reserve', minSettlement: 'Minimum settlement token out', minIndex: 'Minimum index token out', hookData: 'Basket hook data (hex)',
    loading: 'Loading live contract state…', txFailed: 'Transaction failed',
  },
  zh: {
    type: 'Index Broker NFT', totalSupply: 'NFT 供应量', totalWeight: '社区挖矿总权重',
    indexWeight: '有效指数挖矿权重', mintCost: '每枚铸造成本',
    nativeCost: '公开铸造价格', whitelistFree: '白名单 BNB 费用', remainingPublic: '剩余公开额度',
    myWeight: '我的社区挖矿权重', communityRewards: '社区奖励', claimCommunity: '领取社区奖励',
    approveMint: '授权铸造代币', mint: '铸造 NFT', referrer: '推荐 NFT ID（可选）',
    whitelistMint: '你下一次铸造使用白名单额度，无需支付 BNB。',
    publicMint: '公开铸造需精确支付 BNB 价格，并同时支付社区代币。',
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
    buyback: '执行指数回购', buybackHint: '将 AMM 的 BNB 储备投入指数代币，并获得 1% 执行奖励；最小输出用于滑点保护。',
    nativeReserve: 'BNB 回购储备', minSettlement: '最少收到结算代币', minIndex: '最少收到指数代币', hookData: 'Basket Hook 数据（Hex）',
    loading: '正在读取链上实时状态…', txFailed: '操作失败',
  },
};

const EVENT_LABELS = {
  INDEX_BROKER_NFT_MINTED: 'NFT Minted',
  INDEX_BROKER_NFT_LEVEL_UP: 'NFT Level Up',
  INDEX_BROKER_NFT_REFERRAL_RECORDED: 'Referral Recorded',
  INDEX_BROKER_INDEX_MINING_ACTIVATED: 'Index Mining Activated',
  INDEX_BROKER_INDEX_MINING_WEIGHT_UPGRADED: 'Index Weight Upgraded',
  INDEX_BROKER_INDEX_MINING_STAKED: 'Index Mining Staked',
  INDEX_BROKER_INDEX_MINING_UNSTAKED: 'Index Mining Unstaked',
  INDEX_BROKER_INDEX_REWARDS_CLAIMED: 'Index Rewards Claimed',
  INDEX_BROKER_NFT_REVEALED: 'NFT Revealed',
  INDEX_BROKER_NFT_SOLD: 'NFT Sold to AMM',
  INDEX_BROKER_NFT_BOUGHT: 'NFT Bought from AMM',
  INDEX_BROKER_INDEX_TOKEN_PURCHASED: 'Index Buyback Executed',
};

const POOL_INTERFACE = new ethers.Interface(IndexBrokerNFTABI);
const AMM_INTERFACE = new ethers.Interface(IndexBrokerNFTAMMABI);
const COMMUNITY_INTERFACE = new ethers.Interface(CommunityABI);
const COMMITTEE_INTERFACE = new ethers.Interface(CommitteeABI);
const ERC20_INTERFACE = new ethers.Interface(ERC20ABI);
const MULTICALL_INTERFACE = new ethers.Interface(Multicall3ABI);
const READ_CALL_BATCH_SIZE = 250;
const NFT_DETAIL_BATCH_SIZE = 12;

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

function NftArtwork({ src, alt, fallback }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return <div className="index-broker-image-placeholder">{fallback}</div>;
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

function withFeeBuffer(value) {
  return value > 0n ? value + ((value + 99n) / 100n) : 0n;
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

export default function IndexBrokerNFTPoolCard({
  pool,
  communityAddress,
  communityToken,
  isOwner,
  onRefresh,
  detail = false,
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
  const [actionLoading, setActionLoading] = useState('');
  const [referrerTokenId, setReferrerTokenId] = useState('');
  const [upgradeAmounts, setUpgradeAmounts] = useState({});
  const [indexRewardAmount, setIndexRewardAmount] = useState('');
  const [buybackConfig, setBuybackConfig] = useState({ minSettlement: '', minIndex: '', hookData: '0x' });
  const [newReceiver, setNewReceiver] = useState('');
  const [ownedNfts, setOwnedNfts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [topAccounts, setTopAccounts] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [indexedLoading, setIndexedLoading] = useState(detail);
  const [data, setData] = useState({
    name: pool.name || c.type,
    symbol: 'INDEX',
    fundsReceiver: '',
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
  }, [account, pool.id]);

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
      setTopAccounts(insights.topAccounts || []);
      setRecentEvents(insights.recentEvents || []);
      return insights;
    }).catch((error) => {
      console.error('Failed to load Index Broker indexed insights:', error);
      const empty = { topAccounts: [], recentEvents: [], inventoryTokenIds: [], pool: null };
      if (indexedInsightsRef.current?.key === key) {
        // Do not cache transport/indexer failures as a real empty result. The
        // regular 15-second refresh should be able to recover automatically.
        indexedInsightsRef.current = null;
        setTopAccounts([]);
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
      const totalSupply = toBigInt(primary.totalSupply);

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
      const nativeReserve = await readProvider.getBalance(ammAddress);
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
        mintAllowance: 0n,
        ammAllowance: 0n,
        indexBalance: 0n,
        indexAllowance: 0n,
        miningBalance: 0n,
        miningAllowance: 0n,
      };

      if (requestId !== requestRef.current) return;
      setData({
        name, symbol, fundsReceiver, ammAddress, indexToken, communityAsset, miningToken, miningMode, settlementToken,
        communityTokenPrice: toBigInt(primary.communityTokenPrice),
        activationPrice: toBigInt(primary.activationPrice),
        recommitPrice: toBigInt(primary.recommitPrice),
        minimumIndexMiningWeight: toBigInt(primary.minimumIndexMiningWeight),
        nativePrice: toBigInt(primary.nativePrice),
        maxSupply: toBigInt(primary.maxSupply),
        referralBps: Number(primary.referralBps),
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

  const execute = async (key, pending, success, transaction) => {
    setActionLoading(key);
    try {
      const writeSigner = await getWriteSigner();
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

  const handleMint = () => execute(
    'mint',
    language === 'zh' ? '正在铸造 Index Broker NFT…' : 'Minting Index Broker NFT…',
    language === 'zh' ? 'NFT 铸造成功' : 'NFT minted',
    writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner).mint(
      data.whitelistRemaining > 0n ? 0n : toBigInt(referrerTokenId),
      { value: data.whitelistRemaining > 0n ? 0n : data.nativePrice },
    ),
  );

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
    return tokenAction(
      unstake ? 'unstake' : 'upgrade', nft.tokenId, functionName,
      unstake
        ? (language === 'zh' ? '正在赎回质押代币…' : 'Unstaking index mining tokens…')
        : (language === 'zh' ? '正在增加指数挖矿权重…' : 'Increasing index mining weight…'),
      unstake
        ? (language === 'zh' ? '质押代币已赎回' : 'Staking tokens withdrawn')
        : (language === 'zh' ? '指数挖矿权重已增加' : 'Index mining weight increased'),
      [amount],
    );
  };

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
    const minSettlementOut = parseUnitsSafe(buybackConfig.minSettlement, data.settlementToken.decimals);
    const minIndexOut = parseUnitsSafe(buybackConfig.minIndex, data.indexToken.decimals);
    const hookData = buybackConfig.hookData.trim() || '0x';
    if (minSettlementOut <= 0n || minIndexOut <= 0n || !ethers.isHexString(hookData)) {
      return toast.error(language === 'zh' ? '请填写有效的最小输出和 Hook 数据' : 'Enter valid minimum outputs and hook data');
    }
    return execute(
      'index-buyback',
      language === 'zh' ? '正在执行指数回购…' : 'Executing index buyback…',
      language === 'zh' ? '指数回购完成，奖励已注入矿池' : 'Index buyback completed and rewards injected',
      writeSigner => new ethers.Contract(data.ammAddress, IndexBrokerNFTAMMABI, writeSigner)
        .buyIndexWithNativeReserve(minSettlementOut, minIndexOut, hookData),
    );
  };

  const approveNftSale = nft => execute(
    `approve-sale-${nft.tokenId}`,
    language === 'zh' ? '正在授权 AMM 接收 NFT…' : 'Approving NFT for AMM…',
    language === 'zh' ? 'NFT 出售授权成功' : 'NFT sale approved',
    writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner).approve(data.ammAddress, nft.tokenId),
  );

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
  const recommitApprovalNeeded = data.recommitPrice > 0n && data.mintAllowance < data.recommitPrice;
  const ammApprovalNeeded = data.ammAllowance < data.amm.tokensPerNFT;
  const parsedIndexRewardAmount = parseUnitsSafe(indexRewardAmount, data.indexToken.decimals);
  const indexApprovalNeeded = parsedIndexRewardAmount > 0n && data.indexAllowance < parsedIndexRewardAmount;

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
      <div className={`pool-card index-broker-card ${detail ? 'index-broker-detail' : 'index-broker-summary'} glass-card`} id={`pool-${pool.id}`}>
        <PoolCardHeader
          name={data.name}
          subtitle={detail ? data.symbol : ''}
          typeLabel={c.type}
          typeClassName={getPoolTypeBadgeClass(pool.poolType)}
          ratio={pool.ratio}
          status={pool.status}
        />

        <div className="index-broker-stats">
          <div><span>{c.totalSupply}</span><strong>{loading ? '…' : `${data.totalSupply} / ${data.maxSupply}`}</strong></div>
          <div><span>{c.totalWeight}</span><strong>{loading ? '…' : data.totalWeight.toString()}</strong></div>
          <div><span>{c.indexWeight}</span><strong>{loading ? '…' : formatTokenAmount(data.totalActiveIndexWeight, data.miningToken.decimals)}</strong></div>
        </div>

        <div className="index-broker-economics">
          <div><span>{c.mintCost}</span><strong>{formatTokenAmount(data.communityTokenPrice, data.communityAsset.decimals)} {data.communityAsset.symbol}</strong></div>
          <div><span>{c.nativeCost}</span><strong>{formatTokenAmount(data.nativePrice, 18)} {network.nativeCurrency.symbol}</strong></div>
          <div><span>{c.stakingToken}</span><strong>{data.miningToken.symbol || '…'} · {data.miningMode === 'stake' ? c.stakeMode : c.burnMode}</strong></div>
          <div><span>{c.remainingPublic}</span><strong>{data.remainingPaidMints.toString()}</strong></div>
          <div><span>{c.queuedRewards}</span><strong>{formatTokenAmount(data.queuedIndexRewards, data.indexToken.decimals)} {data.indexToken.symbol}</strong></div>
        </div>

        {isConnected && (
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

        {detail && (
          <section className="index-broker-mint-panel">
            <div>
              <h3>{c.mint}</h3>
              <p>{mintUsesWhitelist ? c.whitelistMint : c.publicMint}</p>
            </div>
            {!isConnected ? (
              <button className="btn btn-primary" disabled={connecting} onClick={connect}>{c.connect}</button>
            ) : (
              <>
                {!mintUsesWhitelist && (
                  <input className="input" type="number" min="0" step="1" value={referrerTokenId} onChange={event => setReferrerTokenId(event.target.value)} placeholder={c.referrer} />
                )}
                {mintApprovalNeeded ? (
                  <button className="btn btn-primary" disabled={busy} onClick={() => approveCommunityToken(pool.id, 'approve-mint')}>{c.approveMint}</button>
                ) : (
                  <button className="btn btn-primary" disabled={busy || !canMint} onClick={handleMint}>{c.mint}</button>
                )}
              </>
            )}
          </section>
        )}
      </div>

      {detail && (
        <section className="index-broker-nft-section glass-card">
          <div className="index-broker-section-heading"><div><h2>{c.myNfts}</h2><p>{data.ownedNftCount > BigInt(ownedNfts.length) ? interpolate(c.nftCountLimited, { shown: ownedNfts.length, total: data.ownedNftCount.toString() }) : interpolate(c.nftCount, { count: ownedNfts.length })}</p></div></div>
          {!isConnected ? <div className="index-broker-empty">{c.connect}</div> : ownedNfts.length === 0 ? <div className="index-broker-empty">{c.noNfts}</div> : (
            <div className="index-broker-nft-grid">
              {ownedNfts.map(nft => {
                const id = nft.tokenId.toString();
                const info = nft.info;
                const revealReady = info.revealPending && data.currentBlock > info.revealBlock && data.currentBlock <= info.revealBlock + 256n;
                const revealExpired = info.revealPending && data.currentBlock > info.revealBlock + 256n;
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
                        {!info.revealPending && data.rerollEnabled && (
                          recommitApprovalNeeded
                            ? <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => approveCommunityToken(pool.id, 'approve-reroll')}>{c.approveRecommit}</button>
                            : <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => tokenAction('reroll', nft.tokenId, 'commitReveal', language === 'zh' ? '正在提交重新生成…' : 'Committing reroll…', language === 'zh' ? '重新生成已提交' : 'Reroll committed')}>{c.reroll}</button>
                        )}
                      </div>
                      {info.revealPending && <small className="index-broker-reveal-status">{revealExpired ? c.revealExpired : interpolate(c.revealWaiting, { block: info.revealBlock.toString() })}</small>}
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

      {detail && (
        <section className="index-broker-rewards glass-card">
          <div className="index-broker-section-heading">
            <div><h2>{c.rewardTools}</h2><p>{c.rewardToolsHint}</p></div>
            {isConnected && <button className="btn btn-secondary btn-sm" disabled={busy || loading || !data.amm.active} onClick={harvestIndexHolderFees}>{c.harvestFees}</button>}
          </div>
          {!isConnected ? (
            <button className="btn btn-primary" disabled={connecting} onClick={connect}>{c.connect}</button>
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
        </section>
      )}

      {detail && (
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
          {isConnected && data.amm.active && data.amm.nativeReserve > 0n && (
            <div className="index-broker-buyback-form">
              <div>
                <strong>{c.buyback}</strong>
                <small>{c.buybackHint} · Basket V{data.amm.basketVersion}</small>
              </div>
              <input className="input" type="number" min="0" step="any" value={buybackConfig.minSettlement} onChange={event => setBuybackConfig(current => ({ ...current, minSettlement: event.target.value }))} placeholder={`${c.minSettlement} (${data.settlementToken.symbol})`} />
              <input className="input" type="number" min="0" step="any" value={buybackConfig.minIndex} onChange={event => setBuybackConfig(current => ({ ...current, minIndex: event.target.value }))} placeholder={`${c.minIndex} (${data.indexToken.symbol})`} />
              <input className="input" value={buybackConfig.hookData} onChange={event => setBuybackConfig(current => ({ ...current, hookData: event.target.value }))} placeholder={c.hookData} spellCheck="false" />
              <button className="btn btn-primary btn-sm" disabled={busy || !buybackConfig.minSettlement || !buybackConfig.minIndex || !ethers.isHexString(buybackConfig.hookData.trim() || '0x')} onClick={executeIndexBuyback}>{c.buyback}</button>
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
      )}

      {detail && isOwner && (
        <section className="index-broker-admin glass-card">
          <h2>{c.updateReceiver}</h2>
          <div><input className="input" value={newReceiver} onChange={event => setNewReceiver(event.target.value)} placeholder={c.receiver} /><button className="btn btn-secondary" disabled={busy || loading || !ethers.isAddress(newReceiver)} onClick={() => execute('receiver', language === 'zh' ? '正在更新收款地址…' : 'Updating receiver…', language === 'zh' ? '收款地址已更新' : 'Receiver updated', writeSigner => new ethers.Contract(pool.id, IndexBrokerNFTABI, writeSigner).setFundsReceiver(newReceiver))}>{c.updateReceiver}</button></div>
        </section>
      )}

      {detail && (
        <section className="index-broker-insights">
          <div className="glass-card"><h2>{c.rankings}</h2>{indexedLoading ? <span className="spinner" /> : topAccounts.length === 0 ? <p>{c.noIndexedData}</p> : topAccounts.map((item, index) => <div className="index-broker-insight-row" key={item.account}><span>#{index + 1}</span><a href={`${network.explorerUrl}/address/${item.account}`} target="_blank" rel="noreferrer">{shortenAddress(item.account)}</a><strong>{item.communityMiningWeight ?? item.community_mining_weight ?? '0'}</strong></div>)}</div>
          <div className="glass-card"><h2>{c.activity}</h2>{indexedLoading ? <span className="spinner" /> : recentEvents.length === 0 ? <p>{c.noIndexedData}</p> : recentEvents.map(event => <a className="index-broker-event-row" key={event.id} href={`${network.explorerUrl}/tx/${event.transactionHash || event.transaction_hash}`} target="_blank" rel="noreferrer"><div><strong>{EVENT_LABELS[event.eventType || event.event_type] || event.eventType || event.event_type}</strong><span>{event.tokenId || event.token_id ? `NFT #${event.tokenId || event.token_id}` : shortenAddress(event.account)}</span></div><small>{formatDate(event.blockTimestamp || event.block_timestamp)}</small></a>)}</div>
        </section>
      )}

      {detail && loading && <div className="index-broker-loading">{c.loading}</div>}
    </>
  );
}
