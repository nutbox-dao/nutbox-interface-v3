import { ethers } from 'ethers';

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

export const INDEX_BROKER_SOURCE_TYPES = {
  V2_PAIR: 0,
  V3_POOL: 1,
  UNISWAP_V4: 2,
  PANCAKE_V4_CL: 3,
};

export const INDEX_BROKER_MINING_MODES = {
  BURN: 'burn',
  STAKE: 'stake',
};

export const INDEX_BROKER_MINT_ACCESS_MODES = {
  OPEN: 'open',
  WHITELIST_ONLY: 'whitelist-only',
  MIXED: 'mixed',
};

export const INDEX_BROKER_OPEN_MINT_PLACEHOLDER = '0x000000000000000000000000000000000000dEaD';

export const DEFAULT_INDEX_BROKER_CONFIG = {
  symbol: '',
  fundsReceiver: '',
  useBuybackPool: true,
  renderer: '',
  miningMode: INDEX_BROKER_MINING_MODES.BURN,
  nftTemplate: '',
  stakingToken: '',
  pump: '',
  levelThresholds: '0, 2, 4, 6',
  levelWeights: '10000, 12000, 15000, 20000',
  communityTokenPrice: '',
  indexMiningActivationTokenAmount: '',
  recommitPrice: '',
  nativePrice: '',
  maxSupply: '',
  referralPercent: '10',
  normalFeePercent: '1',
  specificFeePercent: '3',
  indexToken: '',
  mintAccessMode: INDEX_BROKER_MINT_ACCESS_MODES.OPEN,
  lockWhitelistSlots: true,
  rerollEnabled: false,
  whitelist: '',
  officialToken: null,
  sourceType: String(INDEX_BROKER_SOURCE_TYPES.V2_PAIR),
  sourceFactory: '',
  sourcePool: '',
  sourcePoolId: '',
  sourcePoolManager: '',
  sourceCurrency0: '',
  sourceCurrency1: '',
  sourceHooks: '',
  sourceFee: '',
  sourceTickSpacing: '',
  sourceParameters: '',
};

export function parseIndexBrokerIntegerList(value, label) {
  const result = String(value || '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(item => {
      if (!/^\d+$/.test(item)) throw new Error(`${label} must contain positive integers only`);
      return BigInt(item);
    });
  if (result.length === 0) throw new Error(`${label} cannot be empty`);
  return result;
}

export function parseIndexBrokerWhitelist(value) {
  const rows = String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  if (rows.length === 0) throw new Error('At least one whitelist account is required');

  const accounts = [];
  const allowances = [];
  const seen = new Set();
  for (const row of rows) {
    const [rawAddress, rawAllowance, ...rest] = row.split(/[\s,;:]+/).filter(Boolean);
    if (rest.length > 0 || !ethers.isAddress(rawAddress) || !/^\d+$/.test(rawAllowance || '')) {
      throw new Error(`Invalid whitelist row: ${row}`);
    }
    const address = ethers.getAddress(rawAddress);
    const key = address.toLowerCase();
    const allowance = BigInt(rawAllowance);
    if (address === ethers.ZeroAddress || seen.has(key) || allowance <= 0n) {
      throw new Error(`Invalid whitelist row: ${row}`);
    }
    seen.add(key);
    accounts.push(address);
    allowances.push(allowance);
  }
  return { accounts, allowances };
}

export function getIndexBrokerMintAccessMode(config) {
  const mode = config?.mintAccessMode || INDEX_BROKER_MINT_ACCESS_MODES.OPEN;
  if (Object.values(INDEX_BROKER_MINT_ACCESS_MODES).includes(mode)) return mode;
  throw new Error('Unsupported mint access mode');
}

function percentToBps(value, label) {
  const number = Number(value);
  const bps = Math.round(number * 100);
  if (!Number.isFinite(number) || bps < 0 || bps > 10_000) {
    throw new Error(`${label} must be between 0% and 100%`);
  }
  return bps;
}

function requireAddress(value, label, allowZero = false) {
  const address = String(value || '').trim();
  if (!address && allowZero) return ethers.ZeroAddress;
  if (!ethers.isAddress(address) || (!allowZero && address === ethers.ZeroAddress)) {
    throw new Error(`${label} is not a valid address`);
  }
  return ethers.getAddress(address);
}

export function isIndexBrokerV4Source(sourceType) {
  const normalized = Number(sourceType);
  return normalized === INDEX_BROKER_SOURCE_TYPES.UNISWAP_V4
    || normalized === INDEX_BROKER_SOURCE_TYPES.PANCAKE_V4_CL;
}

export function getIndexBrokerV4PoolId(config) {
  const sourceType = Number(config.sourceType);
  if (sourceType === INDEX_BROKER_SOURCE_TYPES.UNISWAP_V4) {
    return ethers.keccak256(abiCoder.encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [
        requireAddress(config.sourceCurrency0, 'Currency 0', true),
        requireAddress(config.sourceCurrency1, 'Currency 1', true),
        Number(config.sourceFee),
        Number(config.sourceTickSpacing),
        requireAddress(config.sourceHooks, 'Hooks', true),
      ],
    ));
  }
  if (sourceType === INDEX_BROKER_SOURCE_TYPES.PANCAKE_V4_CL) {
    return ethers.keccak256(abiCoder.encode(
      ['address', 'address', 'address', 'address', 'uint24', 'bytes32'],
      [
        requireAddress(config.sourceCurrency0, 'Currency 0', true),
        requireAddress(config.sourceCurrency1, 'Currency 1', true),
        requireAddress(config.sourceHooks, 'Hooks', true),
        requireAddress(config.sourcePoolManager, 'Pool manager'),
        Number(config.sourceFee),
        config.sourceParameters,
      ],
    ));
  }
  throw new Error('The selected source is not a V4 pool');
}

function encodeExternalPriceSource(config) {
  const sourceType = Number(config.sourceType);
  if (sourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR || sourceType === INDEX_BROKER_SOURCE_TYPES.V3_POOL) {
    return abiCoder.encode(
      ['address', 'address'],
      [
        requireAddress(config.sourceFactory, 'DEX factory'),
        requireAddress(config.sourcePool, 'DEX pool'),
      ],
    );
  }

  const currency0 = requireAddress(config.sourceCurrency0, 'Currency 0', true);
  const currency1 = requireAddress(config.sourceCurrency1, 'Currency 1', true);
  const hooks = requireAddress(config.sourceHooks, 'Hooks', true);
  const poolManager = requireAddress(config.sourcePoolManager, 'Pool manager');
  const fee = Number(config.sourceFee);
  if (!Number.isInteger(fee) || fee < 0 || fee > 16_777_215) throw new Error('DEX fee is invalid');

  if (sourceType === INDEX_BROKER_SOURCE_TYPES.UNISWAP_V4) {
    const tickSpacing = Number(config.sourceTickSpacing);
    if (!Number.isInteger(tickSpacing) || tickSpacing < -8_388_608 || tickSpacing > 8_388_607) {
      throw new Error('Tick spacing is invalid');
    }
    const encoded = abiCoder.encode(
      ['tuple(address poolManager,address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)'],
      [[poolManager, currency0, currency1, fee, tickSpacing, hooks]],
    );
    const enteredPoolId = String(config.sourcePoolId || '').trim();
    if (enteredPoolId && getIndexBrokerV4PoolId(config).toLowerCase() !== enteredPoolId.toLowerCase()) {
      throw new Error('Uniswap V4 Pool ID does not match the resolved PoolKey');
    }
    return encoded;
  }

  if (sourceType === INDEX_BROKER_SOURCE_TYPES.PANCAKE_V4_CL) {
    const parameters = String(config.sourceParameters || '').trim();
    if (!ethers.isHexString(parameters, 32)) throw new Error('Pancake V4 parameters must be bytes32');
    const encoded = abiCoder.encode(
      ['tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters)'],
      [[currency0, currency1, hooks, poolManager, fee, parameters]],
    );
    const enteredPoolId = String(config.sourcePoolId || '').trim();
    if (enteredPoolId && getIndexBrokerV4PoolId(config).toLowerCase() !== enteredPoolId.toLowerCase()) {
      throw new Error('Pancake V4 CL Pool ID does not match the resolved PoolKey');
    }
    return encoded;
  }

  throw new Error('Unsupported DEX price source');
}

export function encodeIndexBrokerNftPoolMeta(config, communityTokenDecimals = 18) {
  const thresholds = parseIndexBrokerIntegerList(config.levelThresholds, 'Level thresholds');
  const weights = parseIndexBrokerIntegerList(config.levelWeights, 'Level weights');
  if (
    thresholds.length !== weights.length || thresholds.length > 16 || thresholds[0] !== 0n
    || weights[0] <= 0n
    || thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1])
    || weights.some((value, index) => index > 0 && value <= weights[index - 1])
  ) {
    throw new Error('Thresholds must start at 0; thresholds and weights must strictly increase');
  }

  const symbol = String(config.symbol || '').trim();
  if (!symbol || ethers.toUtf8Bytes(symbol).length > 16) throw new Error('NFT symbol must be 1-16 UTF-8 bytes');
  const enteredFundsReceiver = String(config.fundsReceiver || '').trim();
  const useBuybackPool = typeof config.useBuybackPool === 'boolean'
    ? config.useBuybackPool
    : (!enteredFundsReceiver || enteredFundsReceiver.toLowerCase() === ethers.ZeroAddress.toLowerCase());
  const fundsReceiver = useBuybackPool
    ? ethers.ZeroAddress
    : requireAddress(enteredFundsReceiver, 'Funds receiver');
  const renderer = requireAddress(config.renderer, 'Renderer', true);
  const nftTemplate = requireAddress(config.nftTemplate, 'NFT template');
  const indexToken = requireAddress(config.indexToken, 'Index token', true);
  const maxSupply = BigInt(config.maxSupply || 0);
  if (maxSupply <= 0n) throw new Error('Max supply must be greater than zero');

  const communityTokenPrice = ethers.parseUnits(String(config.communityTokenPrice || '0'), communityTokenDecimals);
  const stakeMode = config.miningMode === INDEX_BROKER_MINING_MODES.STAKE;
  const activationPrice = stakeMode ? 0n : ethers.parseUnits(
    String(config.indexMiningActivationTokenAmount || '0'), communityTokenDecimals,
  );
  const requestedRecommitPrice = config.rerollEnabled
    ? ethers.parseUnits(String(config.recommitPrice || '0'), communityTokenDecimals)
    : 0n;
  const recommitPrice = config.rerollEnabled
    ? (requestedRecommitPrice === 0n ? communityTokenPrice : requestedRecommitPrice)
    : 0n;
  const mintAccessMode = getIndexBrokerMintAccessMode(config);
  const whitelistOnly = mintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.WHITELIST_ONLY;
  const openMint = mintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.OPEN;
  const nativePrice = whitelistOnly
    ? 0n
    : ethers.parseEther(String(config.nativePrice || '0'));
  if (communityTokenPrice <= 0n) {
    throw new Error('Community Token mint cost must be greater than zero');
  }

  const nftTemplateConfig = stakeMode
    ? abiCoder.encode(['address'], [requireAddress(config.stakingToken, 'Staking token')])
    : '0x';

  const referralBps = whitelistOnly
    ? 0
    : percentToBps(config.referralPercent, 'Referral rate');
  const normalFeeBps = percentToBps(config.normalFeePercent, 'Normal AMM fee');
  const specificFeeBps = percentToBps(config.specificFeePercent, 'Specific NFT AMM fee');
  const whitelist = openMint
    ? { accounts: [INDEX_BROKER_OPEN_MINT_PLACEHOLDER], allowances: [1n] }
    : parseIndexBrokerWhitelist(config.whitelist);
  const whitelistTotal = whitelist.allowances.reduce((total, value) => total + value, 0n);
  if (!whitelistOnly && nativePrice === 0n) {
    throw new Error('Paid public mint modes require a native-coin price greater than zero');
  }
  if (!openMint && (whitelistTotal > maxSupply || (whitelistOnly && whitelistTotal !== maxSupply))) {
    throw new Error('Whitelist allocation is incompatible with max supply');
  }

  const sourceType = config.officialToken
    ? INDEX_BROKER_SOURCE_TYPES.PANCAKE_V4_CL
    : Number(config.sourceType);
  const sourceData = config.officialToken ? '0x' : encodeExternalPriceSource(config);
  const pump = config.officialToken
    ? requireAddress(config.pump, 'Pump', true)
    : ethers.ZeroAddress;
  const ammConfig = abiCoder.encode(
    ['tuple(uint16 normalFeeBps,uint16 specificFeeBps,uint8 priceSourceType,bytes priceSourceData,address indexToken,address pump)'],
    [[normalFeeBps, specificFeeBps, sourceType, sourceData, indexToken, pump]],
  );

  return abiCoder.encode(
    ['tuple(string symbol,address fundsReceiver,address renderer,address nftTemplate,uint256[] levelThresholds,uint256[] levelWeights,uint256 communityTokenPrice,uint256 indexMiningActivationTokenAmount,uint256 recommitPrice,uint256 nativePrice,uint256 maxSupply,uint16 referralBps,bytes ammConfig,bytes nftTemplateConfig,bool lockWhitelistSlots,bool rerollEnabled,address[] whitelistAccounts,uint256[] whitelistAllowances)'],
    [[
      symbol,
      fundsReceiver,
      renderer,
      nftTemplate,
      thresholds,
      weights,
      communityTokenPrice,
      activationPrice,
      recommitPrice,
      nativePrice,
      maxSupply,
      referralBps,
      ammConfig,
      nftTemplateConfig,
      whitelistOnly || (mintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.MIXED && Boolean(config.lockWhitelistSlots)),
      Boolean(config.rerollEnabled),
      whitelist.accounts,
      whitelist.allowances,
    ]],
  );
}
