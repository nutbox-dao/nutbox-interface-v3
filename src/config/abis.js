// Minimal ABIs for Nutbox V2 contracts — only includes functions used by the frontend

export const CommitteeABI = [
  'function getCreateCommunityFee() view returns (uint256)',
  'function getCommunitySettingsFee() view returns (uint256)',
  'function getPoolOperationFee() view returns (uint256)',
  'function getFeeRecipient() view returns (address)',
  'function getFeeFree(address) view returns (bool)',
  'function verifyContract(address) view returns (bool)',
];

export const CommunityFactoryABI = [
  'function createCommunity(bool isMintable, address communityToken, address communityTokenFactory, bytes tokenMeta, address rewardCalculator, bytes distributionPolicy) payable returns (address)',
  'function createdCommunity(address) view returns (bool)',
  'event CommunityCreated(address indexed creator, address indexed community, address communityToken)',
];

export const CommunityABI = [
  'function owner() view returns (address)',
  'function committee() view returns (address)',
  'function communityToken() view returns (address)',
  'function isMintableCommunityToken() view returns (bool)',
  'function rewardCalculator() view returns (address)',
  'function feeRatio() view returns (uint16)',
  'function activedPools(uint256) view returns (address)',
  'function createdPools(uint256) view returns (address)',
  'function poolActived(address) view returns (bool)',
  'function getShareAcc(address) view returns (uint256)',
  'function getLastRewardCursor() view returns (uint256)',
  'function getPoolPendingRewards(address pool, address user) view returns (uint256)',
  'function getTotalPendingRewards(address user) view returns (uint256)',
  'function getUserDebt(address pool, address user) view returns (uint256)',
  'function adminAddPool(string poolName, uint16[] ratios, address poolFactory, bytes meta) payable',
  'function adminClosePool(uint256 poolIndex, uint16[] ratios) payable',
  'function adminSetPoolRatios(uint16[] ratios) payable',
  'function adminSetFeeRatio(uint16 ratio) payable',
  'function adminSetDev(address dev)',
  'function adminWithdrawRevenue()',
  'function withdrawPoolsRewards(address[] poolAddresses) payable',
  'event AdminSetFeeRatio(uint16 ratio)',
  'event AdminClosePool(address indexed pool)',
  'event AdminSetPoolRatio(address[] pools, uint16[] ratios)',
  'event WithdrawRewards(address[] pool, address indexed who, uint256 amount)',
  'event PoolUpdated(address indexed who, uint256 amount)',
  'event DevChanged(address indexed oldDev, address indexed newDev)',
  'event RevenueWithdrawn(address indexed devFund, uint256 amount)',
];

export const ERC20StakingABI = [
  'function name() view returns (string)',
  'function stakeToken() view returns (address)',
  'function community() view returns (address)',
  'function factory() view returns (address)',
  'function totalStakedAmount() view returns (uint256)',
  'function getUserStakedAmount(address) view returns (uint256)',
  'function getUserDepositInfo(address) view returns (tuple(bool hasDeposited, uint256 amount))',
  'function deposit(uint256 amount) payable',
  'function withdraw(uint256 amount) payable',
  'event Deposited(address indexed community, address indexed who, uint256 amount)',
  'event Withdrawn(address indexed community, address indexed who, uint256 amount)',
];

export const ERC20LockingABI = [
  'function name() view returns (string)',
  'function stakeToken() view returns (address)',
  'function community() view returns (address)',
  'function factory() view returns (address)',
  'function totalStakedAmount() view returns (uint256)',
  'function lockDuration() view returns (uint256)',
  'function getUserStakedAmount(address) view returns (uint256)',
  'function getUserDepositInfo(address) view returns (tuple(bool hasDeposited, uint256 amount))',
  'function redeemRequestCount(address) view returns (uint256)',
  'function redeemRequests(address) view returns (tuple(uint256 erc20Amount, uint256 claimed, uint256 startTime, uint256 endTime)[])',
  'function claimableAmount(address) view returns (uint256)',
  'function deposit(uint256 amount) payable',
  'function withdraw(uint256 amount) payable',
  'function redeem()',
  'event Locked(address indexed who, uint256 amount)',
  'event Unlocked(address indexed who, uint256 amount)',
  'event Redeemed(address indexed who, uint256 amount)',
];

export const NFTMiningPoolABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function owner() view returns (address)',
  'function factory() view returns (address)',
  'function community() view returns (address)',
  'function fundsReceiver() view returns (address)',
  'function currentBatchId() view returns (uint256)',
  'function batchCount() view returns (uint256)',
  'function nextTokenId() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function levelCount() view returns (uint256)',
  'function levelThresholds(uint256) view returns (uint256)',
  'function levelWeights(uint256) view returns (uint256)',
  'function batches(uint256) view returns (address paymentAsset, uint16 referralBps, uint8 paletteId, bool active, bool paused, uint256 mintPrice, uint256 maxSupply, uint256 minted)',
  'function getUserStakedAmount(address) view returns (uint256)',
  'function getTotalStakedAmount() view returns (uint256)',
  'function getNFTInfo(uint256) view returns (tuple(address owner, uint32 level, uint32 batchId, uint256 referrerTokenId, uint256 referralCount, uint256 miningWeight, uint256 seed))',
  'function tokensOfOwner(address account, uint256 offset, uint256 limit) view returns (uint256[])',
  'function tokenSVG(uint256 tokenId) view returns (string)',
  'function mint(uint256 referrerTokenId) payable returns (uint256)',
  'function createBatch(uint256 maxSupply, address paymentAsset, uint256 mintPrice, uint16 referralBps) returns (uint256)',
  'function setCurrentBatchPaused(bool paused)',
  'function closeCurrentBatch()',
  'function setFundsReceiver(address newReceiver)',
  'event NFTMinted(address indexed buyer, uint256 indexed tokenId, uint256 indexed batchId, uint256 referrerTokenId, address paymentAsset, uint256 mintPrice)',
  'event MiningWeightMoved(uint256 indexed tokenId, address indexed from, address indexed to, uint256 weight)',
];

export const NFTMiningPoolFactoryABI = [
  'function defaultRenderer() view returns (address)',
  'event NFTMiningPoolCreated(address indexed pool, address indexed community, address indexed admin, address renderer, string name, string symbol, address paymentAsset, uint256 mintPrice, uint256 firstBatchSupply, uint16 referralBps, uint8 paletteId)',
];

export const NFTMiningRendererABI = [
  'function renderSVG((string collectionName, uint256 tokenId, uint256 seed, uint256 referralCount, uint256 miningWeight, uint32 batchId, uint32 level, uint8 paletteId) params) view returns (string)',
];

export const LinearCalculatorABI = [
  'function rewardHead() view returns (uint256)',
  'function getCurrentRewardRate(address community) view returns (uint256)',
  'function getStartCursor(address community) view returns (uint256)',
  'function getCurrentDistributionEra(address community) view returns (tuple(uint256 amount, uint256 startCursor, uint256 stopCursor))',
  'function calculateReward(address community, uint256 lastCursor, uint256 head) view returns (uint256)',
  'function distributionCountMap(address) view returns (uint8)',
  'function distributionErasMap(address, uint256) view returns (uint256 amount, uint256 startCursor, uint256 stopCursor)',
];

export const HourlyTickCalculatorABI = [
  'function rewardHead() view returns (uint256)',
  'function getCurrentRewardRate(address community) view returns (uint256)',
  'function getStartCursor(address community) view returns (uint256)',
  'function getHourlyRewards(address community, uint256 startTimestamp, uint256 numHours) view returns (uint256[])',
  'function totalInjected(address) view returns (uint256)',
  'function registered(address) view returns (bool)',
  'function inject(address community, uint256 amount)',
];

export const MintableERC20FactoryABI = [
  'function createCommunityToken(bytes meta) returns (address)',
];

export const ERC20ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
];
