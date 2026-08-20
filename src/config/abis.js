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
  'function ownerOf(uint256) view returns (address)',
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

export const IndexBrokerNFTFactoryABI = [
  'function defaultRenderer() view returns (address)',
  'function defaultIndexToken() view returns (address)',
  'function basketRegistry() view returns (address)',
  'function basketSwapRouterForVersion(uint32 version) view returns (address)',
  'function indexV3Router() view returns (address)',
  'function indexV3Fee() view returns (uint24)',
  'function platformFeeBps() view returns (uint16)',
  'function reservedCollectionNameHash(bytes32) view returns (bool)',
  'function nftTemplateCount() view returns (uint256)',
  'function nftTemplateAt(uint256 index) view returns (address)',
  'function supportedNFTTemplate(address template) view returns (bool)',
  'function supportedPump(address pump) view returns (bool)',
  'event IndexBrokerNFTCreated(address indexed pool, address indexed community, address indexed admin, address nftTemplate, address communityToken, address renderer, string name, string symbol, address fundsReceiver, uint256 communityTokenPrice, uint256 indexMiningActivationTokenAmount, uint256 recommitPrice, uint256 nativePrice, uint256 maxSupply, uint16 referralBps, bool lockWhitelistSlots, bool rerollEnabled, uint256 totalWhitelistAllocation)',
  'event IndexBrokerNFTAMMCreated(address indexed pool, address indexed ammVault, address indexed pump, address nutboxRouter, uint8 priceSourceType, address priceQuoteToken, bool active, uint16 normalFeeBps, uint16 specificFeeBps, address indexToken)',
  'event IndexBasketRouterSelected(address indexed pool, address indexed indexToken, uint32 indexed version, address basketSwapRouter)',
];

export const IndexBrokerNFTRendererABI = [
  'function renderSVG((string collectionName,uint256 tokenId,uint256 seed,uint256 referralCount,uint256 referrerTokenId,uint256 miningWeight,uint256 indexMiningWeight,uint256 indexMiningTokenUnit,uint32 level,bool miningActive,bool indexMiningActive) params) view returns (string)',
  'function renderTokenURI((string collectionName,uint256 tokenId,uint256 seed,uint256 referralCount,uint256 referrerTokenId,uint256 miningWeight,uint256 indexMiningWeight,uint256 indexMiningTokenUnit,uint32 level,bool miningActive,bool indexMiningActive) params) view returns (string)',
  'function renderContractURI(string collectionName) view returns (string)',
];

export const IndexBrokerNFTABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function owner() view returns (address)',
  'function factory() view returns (address)',
  'function community() view returns (address)',
  'function communityToken() view returns (address)',
  'function fundsReceiver() view returns (address)',
  'function renderer() view returns (address)',
  'function ammVault() view returns (address)',
  'function indexToken() view returns (address)',
  'function indexMiningToken() view returns (address)',
  'function communityTokenPrice() view returns (uint256)',
  'function indexMiningActivationTokenAmount() view returns (uint256)',
  'function recommitPrice() view returns (uint256)',
  'function minimumIndexMiningWeight() view returns (uint256)',
  'function nativePrice() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function referralBps() view returns (uint16)',
  'function lockWhitelistSlots() view returns (bool)',
  'function rerollEnabled() view returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenByIndex(uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function getApproved(uint256) view returns (address)',
  'function approve(address to, uint256 tokenId)',
  'function levelCount() view returns (uint256)',
  'function levelThresholds(uint256) view returns (uint256)',
  'function levelWeights(uint256) view returns (uint256)',
  'function getUserStakedAmount(address user) view returns (uint256)',
  'function getTotalStakedAmount() view returns (uint256)',
  'function getNFTInfo(uint256 tokenId) view returns (tuple(address owner, uint32 level, uint256 referrerTokenId, uint256 referralCount, uint256 miningWeight, bool miningActive, bool indexMiningActive, uint256 indexMiningWeight, uint256 pendingIndexRewards, uint256 seed, uint256 revealBlock, uint256 revealRound, bool revealPending) info)',
  'function tokensOfOwner(address account, uint256 offset, uint256 limit) view returns (uint256[])',
  'function tokenSVG(uint256 tokenId) view returns (string)',
  'function remainingWhitelistMints(address account) view returns (uint256)',
  'function remainingPaidMints() view returns (uint256)',
  'function totalActiveIndexMiningWeight() view returns (uint256)',
  'function queuedIndexRewards() view returns (uint256)',
  'function mint(uint256 referrerTokenId) payable returns (uint256)',
  'function reveal(uint256 tokenId) returns (uint256)',
  'function commitReveal(uint256 tokenId)',
  'function activateIndexMining(uint256 tokenId)',
  'function upgradeIndexMining(uint256 tokenId, uint256 tokenAmount)',
  'function stakingToken() view returns (address)',
  'function stakeIndexMining(uint256 tokenId, uint256 tokenAmount)',
  'function unstakeIndexMining(uint256 tokenId, uint256 tokenAmount)',
  'function injectIndexRewards(uint256 amount)',
  'function claimIndexRewards(uint256 tokenId) returns (uint256)',
  'function harvestIndexHolderFees() returns (uint256)',
  'function setFundsReceiver(address newReceiver)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

export const IndexBrokerNFTAMMABI = [
  'function active() view returns (bool)',
  'function collection() view returns (address)',
  'function communityToken() view returns (address)',
  'function indexToken() view returns (address)',
  'function pump() view returns (address)',
  'function nutboxRouter() view returns (address)',
  'function basketSwapRouter() view returns (address)',
  'function indexBasketVersion() view returns (uint32)',
  'function indexSettlementToken() view returns (address)',
  'function priceQuoteToken() view returns (address)',
  'function tokensPerNFT() view returns (uint256)',
  'function normalFeeBps() view returns (uint16)',
  'function specificFeeBps() view returns (uint16)',
  'function inventoryCount() view returns (uint256)',
  'function oldestTokenId() view returns (uint256)',
  'function newestTokenId() view returns (uint256)',
  'function inInventory(uint256 tokenId) view returns (bool)',
  'function nextInventoryToken(uint256 tokenId) view returns (uint256)',
  'function quoteNativeValue() view returns (uint256)',
  'function quoteNormalNativeFee() view returns (uint256)',
  'function quoteSpecificNativeFee() view returns (uint256)',
  'function quotePlatformNativeFee() view returns (uint256)',
  'function activate()',
  'function sellNFT(uint256 tokenId) payable',
  'function buyNextNFT() payable returns (uint256)',
  'function buySpecificNFT(uint256 tokenId) payable',
  'function buyIndexWithNativeReserve(uint256 minSettlementOut, uint256 minIndexOut, bytes hookData) returns (uint256 callerReward, uint256 settlementOut, uint256 indexOut)',
];

export const PumpABI = [
  'function createdTokens(address token) view returns (bool)',
  'function getPoolManager() view returns (address)',
];

export const PumpTokenABI = [
  'function listed() view returns (bool)',
  'function v4PoolId() view returns (bytes32)',
];

export const PancakeV4CLPoolManagerABI = [
  'function poolIdToPoolKey(bytes32 id) view returns (tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters))',
  'function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)',
  'function getLiquidity(bytes32 id) view returns (uint128)',
];

export const NutboxSwapWrapperABI = [
  'function getImportedMarket(address token) view returns (bool registered,address community,address deployer)',
  'function quoteBuy(address token,uint8 sourceType,bytes sourceData,uint256 nativeAmountIn) returns (uint256 tokenAmountOut)',
  'function quoteSell(address token,uint8 sourceType,bytes sourceData,uint256 tokenAmountIn) returns (uint256 nativeAmountOut)',
  'function buyToken(address token,uint8 sourceType,bytes sourceData,uint256 minimumTokenOut,address recipient,uint256 deadline,address sellsman) payable returns (uint256 tokenOut)',
  'function sellToken(address token,uint8 sourceType,bytes sourceData,uint256 amountIn,uint256 minimumNativeOut,address recipient,uint256 deadline,address sellsman) returns (uint256 nativeOut)',
];

export const BasketTVLMiningPoolABI = [
  'function name() view returns (string)',
  'function factory() view returns (address)',
  'function community() view returns (address)',
  'function basketRegistry() view returns (address)',
  'function nftMiningPool() view returns (address)',
  'function lockDuration() view returns (uint256)',
  'function nftRewardBps() view returns (uint16)',
  'function getTotalStakedAmount() view returns (uint256)',
  'function getUserStakedAmount(address user) view returns (uint256)',
  'function getBasketStake(address basket) view returns (tuple(address basketCreator, address childPool, uint256 nftTokenId, uint256 miningAmount, uint256 updatedAt, bool exists))',
  'function basketCommunityTokenBalance(address basket) view returns (uint256)',
  'function nftBasketPoolCount(uint256 nftTokenId) view returns (uint256)',
  'function createBasketStake(address basket, uint256 nftTokenId) returns (address childPool)',
  'function updateBasketStake(address basket) payable',
  'event BasketStakeCreated(address indexed basket, address indexed basketCreator, uint256 indexed nftTokenId, uint256 miningAmount, uint256 updatedAt)',
  'event BasketChildPoolCreated(address indexed basket, address indexed childPool, address indexed basketCreator, uint256 nftTokenId, uint16 nftRewardBps, uint256 lockDuration)',
  'event BasketStakeUpdated(address indexed basket, address indexed basketCreator, uint256 previousMiningAmount, uint256 newMiningAmount, uint256 updatedAt)',
];

export const BasketStakePoolABI = [
  'function parentMiningPool() view returns (address)',
  'function community() view returns (address)',
  'function stakeToken() view returns (address)',
  'function rewardToken() view returns (address)',
  'function holderFeeToken() view returns (address)',
  'function nftMiningPool() view returns (address)',
  'function nftTokenId() view returns (uint256)',
  'function nftRewardBps() view returns (uint16)',
  'function lockDuration() view returns (uint256)',
  'function totalStakedAmount() view returns (uint256)',
  'function getUserStakedAmount(address user) view returns (uint256)',
  'function pendingRewards(address account) view returns (uint256)',
  'function pendingHolderFees(address account) view returns (uint256)',
  'function pendingNftRewards() view returns (uint256)',
  'function redeemRequests(address user) view returns (tuple(uint256 tokenAmount, uint256 claimed, uint256 startTime, uint256 endTime)[])',
  'function claimableAmount(address user) view returns (uint256)',
  'function deposit(uint256 amount) payable',
  'function withdraw(uint256 amount) payable',
  'function redeem()',
  'function claimRewards() payable returns (uint256 communityAmount, uint256 holderFeeAmount)',
  'function claimNftRewards() payable returns (uint256 amount)',
  'event Deposited(address indexed user, uint256 amount)',
  'event WithdrawRequested(address indexed user, uint256 amount, uint256 startTime, uint256 endTime)',
  'event Redeemed(address indexed user, uint256 amount)',
  'event RewardsClaimed(address indexed user, uint256 communityAmount, uint256 holderFeeAmount)',
  'event NftRewardsClaimed(uint256 indexed nftTokenId, address indexed recipient, uint256 amount)',
];

export const Multicall3ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
  'function getBlockNumber() view returns (uint256)',
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
