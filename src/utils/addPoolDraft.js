const ADD_POOL_DRAFT_VERSION = 1;
const ADD_POOL_DRAFT_PREFIX = `nutbox:add-pool-draft:v${ADD_POOL_DRAFT_VERSION}`;

const POOL_TYPES = new Set([
  'staking',
  'locking',
  'nft-mining',
  'basket-tvl',
  'index-broker-nft',
]);

const STRING_FIELDS = [
  'poolName',
  'stakeTokenAddress',
  'lockDuration',
  'nftSymbol',
  'fundsReceiver',
  'renderer',
  'levelThresholds',
  'levelWeights',
  'paymentAsset',
  'mintPrice',
  'batchSupply',
  'referralPercent',
  'basketNftMiningPool',
  'basketNftRewardPercent',
  'basketLockDurationHours',
];

const PREVIEW_PARAM_FIELDS = [
  'tokenId',
  'referralCount',
  'level',
  'batchId',
  'paletteId',
];

const INDEX_BROKER_STRING_FIELDS = [
  'symbol',
  'fundsReceiver',
  'renderer',
  'miningMode',
  'stakingToken',
  'levelThresholds',
  'levelWeights',
  'communityTokenPrice',
  'indexMiningActivationTokenAmount',
  'recommitPrice',
  'nativePrice',
  'maxSupply',
  'referralPercent',
  'normalFeePercent',
  'specificFeePercent',
  'indexToken',
  'mintAccessMode',
  'whitelist',
  'sourceType',
  'sourcePool',
  'sourcePoolId',
];

const INDEX_BROKER_BOOLEAN_FIELDS = [
  'useBuybackPool',
  'lockWhitelistSlots',
  'rerollEnabled',
];

function getStorage(storage) {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeScopePart(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
}

function copyStringFields(source, fields) {
  const result = {};
  for (const field of fields) {
    if (typeof source?.[field] === 'string') result[field] = source[field];
  }
  return result;
}

function sanitizeDraft(value) {
  if (!value || typeof value !== 'object' || value.version !== ADD_POOL_DRAFT_VERSION) return null;
  if (!POOL_TYPES.has(value.poolType)) return null;

  const previewParams = copyStringFields(value.previewParams, PREVIEW_PARAM_FIELDS);
  const indexBrokerConfig = {
    ...copyStringFields(value.indexBrokerConfig, INDEX_BROKER_STRING_FIELDS),
  };
  for (const field of INDEX_BROKER_BOOLEAN_FIELDS) {
    if (typeof value.indexBrokerConfig?.[field] === 'boolean') {
      indexBrokerConfig[field] = value.indexBrokerConfig[field];
    }
  }

  const ratiosByPool = {};
  if (value.ratiosByPool && typeof value.ratiosByPool === 'object' && !Array.isArray(value.ratiosByPool)) {
    for (const [key, ratio] of Object.entries(value.ratiosByPool)) {
      if (typeof ratio === 'string') ratiosByPool[String(key).toLowerCase()] = ratio;
    }
  }

  return {
    version: ADD_POOL_DRAFT_VERSION,
    poolType: value.poolType,
    ...copyStringFields(value, STRING_FIELDS),
    wizardStep: Number.isInteger(value.wizardStep) && value.wizardStep >= 0 ? value.wizardStep : 0,
    previewSeed: typeof value.previewSeed === 'string' && /^\d+$/.test(value.previewSeed)
      ? value.previewSeed
      : '',
    previewParams,
    indexBrokerConfig,
    ratiosByPool,
    newPoolRatio: typeof value.newPoolRatio === 'string' ? value.newPoolRatio : '',
  };
}

export function getAddPoolDraftStorageKey({ chainId, communityAddress, account, scope = '' }) {
  if (!String(chainId || '').trim() || !String(communityAddress || '').trim() || !String(account || '').trim()) {
    return '';
  }
  const parts = [
    ADD_POOL_DRAFT_PREFIX,
    normalizeScopePart(chainId, 'unknown-chain'),
    normalizeScopePart(communityAddress, 'unknown-community'),
    normalizeScopePart(account, 'anonymous'),
  ];
  if (String(scope || '').trim()) parts.push(normalizeScopePart(scope, 'default'));
  return parts.join(':');
}

export function getAddPoolDraftPoolKeys(activePools = []) {
  return activePools.map((pool, index) => normalizeScopePart(
    pool?.id || pool?.address || `${pool?.poolType || 'pool'}:${pool?.name || index}`,
    `pool-${index}`,
  ));
}

export function loadAddPoolDraft(storageKey, storage) {
  const target = getStorage(storage);
  if (!target || !storageKey) return null;
  try {
    const serialized = target.getItem(storageKey);
    return serialized ? sanitizeDraft(JSON.parse(serialized)) : null;
  } catch {
    return null;
  }
}

export function restoreAddPoolDraftRatios(draft, activePools = []) {
  const poolKeys = getAddPoolDraftPoolKeys(activePools);
  return [
    ...poolKeys.map(key => draft?.ratiosByPool?.[key] || ''),
    draft?.newPoolRatio || '',
  ];
}

export function buildAddPoolDraft(state, activePools = [], previousDraft = null) {
  const poolKeys = getAddPoolDraftPoolKeys(activePools);
  const ratiosByPool = { ...(previousDraft?.ratiosByPool || {}) };
  poolKeys.forEach((key, index) => {
    ratiosByPool[key] = typeof state.inputRatios?.[index] === 'string' ? state.inputRatios[index] : '';
  });

  const draft = sanitizeDraft({
    version: ADD_POOL_DRAFT_VERSION,
    poolType: state.poolType,
    ...copyStringFields(state, STRING_FIELDS),
    wizardStep: state.wizardStep,
    previewSeed: String(state.previewSeed || ''),
    previewParams: state.previewParams,
    indexBrokerConfig: state.indexBrokerConfig,
    ratiosByPool,
    newPoolRatio: typeof state.inputRatios?.[poolKeys.length] === 'string'
      ? state.inputRatios[poolKeys.length]
      : (previousDraft?.newPoolRatio || ''),
  });
  return draft;
}

export function saveAddPoolDraft(storageKey, draft, storage) {
  const target = getStorage(storage);
  if (!target || !storageKey) return false;
  try {
    if (!draft?.poolType) {
      target.removeItem(storageKey);
      return true;
    }
    target.setItem(storageKey, JSON.stringify({ ...draft, updatedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function removeAddPoolDraft(storageKey, storage) {
  const target = getStorage(storage);
  if (!target || !storageKey) return false;
  try {
    target.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}
