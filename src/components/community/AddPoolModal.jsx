import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import {
  CommitteeABI,
  CommunityABI,
  ERC20ABI,
  IndexBrokerNFTFactoryABI,
  NFTMiningPoolFactoryABI,
  NFTMiningRendererABI,
  PancakeV4CLPoolManagerABI,
  PumpABI,
  PumpTokenABI,
} from '../../config/abis';
import { getPoolTypeLabel, getPoolTypeBadgeClass, shortenAddress } from '../../utils/helpers';
import { useLanguage } from '../../contexts/LanguageContext';
import { registerMiningPool } from '../../config/subgraph';
import useTimedActionLoading from '../../hooks/useTimedActionLoading';
import IndexBrokerNFTPoolFields from './IndexBrokerNFTPoolFields';
import {
  DEFAULT_INDEX_BROKER_CONFIG,
  encodeIndexBrokerNftPoolMeta,
  getIndexBrokerMintAccessMode,
  getIndexBrokerV4PoolId,
  INDEX_BROKER_MINT_ACCESS_MODES,
  INDEX_BROKER_MINING_MODES,
  INDEX_BROKER_SOURCE_TYPES,
  isIndexBrokerV4Source,
  parseIndexBrokerIntegerList,
  parseIndexBrokerWhitelist,
} from '../../utils/indexBrokerNft';
import { multicallRead } from '../../utils/multicall';
import { discoverPancakePricePools } from '../../utils/dexPoolDiscovery';
import {
  buildAddPoolDraft,
  getAddPoolDraftPoolKeys,
  getAddPoolDraftStorageKey,
  loadAddPoolDraft,
  removeAddPoolDraft,
  restoreAddPoolDraftRatios,
  saveAddPoolDraft,
} from '../../utils/addPoolDraft';
import './AddPoolModal.css';

const COMMITTEE_INTERFACE = new ethers.Interface(CommitteeABI);
const ERC20_INTERFACE = new ethers.Interface(ERC20ABI);
const INDEX_BROKER_FACTORY_INTERFACE = new ethers.Interface(IndexBrokerNFTFactoryABI);
const BASKET_REGISTRY_INTERFACE = new ethers.Interface([
  'function isBasket(address basket) view returns (bool)',
  'function basketVersion(address basket) view returns (uint32)',
]);
const BASKET_TOKEN_INTERFACE = new ethers.Interface([
  'function protocolVersion() view returns (uint32)',
  'function registry() view returns (address)',
  'function engine() view returns (address)',
  'function settlementToken() view returns (address)',
  'function wbnb() view returns (address)',
]);
const BASKET_SWAP_ROUTER_INTERFACE = new ethers.Interface([
  'function basketHook() view returns (address)',
  'function settlementToken() view returns (address)',
]);
const PANCAKE_V3_ROUTER_INTERFACE = new ethers.Interface([
  'function WETH9() view returns (address)',
  'function factory() view returns (address)',
]);
const PANCAKE_V3_FACTORY_INTERFACE = new ethers.Interface([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)',
]);
const NUTBOX_ROUTER_INTERFACE = new ethers.Interface([
  'function validateRoute(address tokenIn, address tokenOut) view',
  'function allowedV2Factory(address factory) view returns (bool)',
  'function allowedV3Factory(address factory) view returns (bool)',
]);
const PANCAKE_V2_PAIR_ABI = [
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)',
];
const PANCAKE_V2_FACTORY_ABI = [
  'function getPair(address tokenA,address tokenB) view returns (address)',
];
const PANCAKE_V3_POOL_ABI = [
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint32 feeProtocol,bool unlocked)',
];
const PANCAKE_V3_FACTORY_ABI = [
  'function getPool(address tokenA,address tokenB,uint24 fee) view returns (address)',
];
const PANCAKE_V4_CL_MANAGER_INTERFACE = new ethers.Interface(PancakeV4CLPoolManagerABI);
const PUMP_INTERFACE = new ethers.Interface(PumpABI);
const PUMP_TOKEN_INTERFACE = new ethers.Interface(PumpTokenABI);
const DEFAULT_NFT_PREVIEW_PARAMS = {
  tokenId: '1',
  referralCount: '0',
  level: '1',
  batchId: '1',
  paletteId: '1',
};

function parseIntegerList(value) {
  return value.split(',').map(item => item.trim()).filter(Boolean).map(item => BigInt(item));
}

function previewInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function previewWeightForLevel(weightsValue, levelValue) {
  try {
    const weights = parseIntegerList(weightsValue);
    if (weights.length === 0) return 10000n;
    const level = previewInteger(levelValue, 1, 1, 16);
    return weights[Math.min(level - 1, weights.length - 1)] || weights[0];
  } catch {
    return 10000n;
  }
}

function hasUnsupportedNftText(value) {
  return [...String(value)].some(character => (
    character.codePointAt(0) < 32 || '"&<>\\'.includes(character)
  ));
}

function effectiveAmmFee(value) {
  const configured = Number(value);
  if (!Number.isFinite(configured)) return '—';
  const total = (Math.round(configured * 100) + 50) / 100;
  return total.toFixed(2).replace(/\.?0+$/, '');
}

export default function AddPoolModal({
  communityAddress,
  communityTokenAddress,
  activePools,
  initialPoolType = '',
  draftScope = '',
  onClose,
  onSuccess,
}) {
  const { t, language } = useLanguage();
  const { account, getWriteSigner, readProvider, contracts, network } = useWeb3();
  const toast = useToast();

  const draftStorageKey = getAddPoolDraftStorageKey({
    chainId: network.id,
    communityAddress,
    account,
    scope: draftScope,
  });
  const legacyDraftStorageKey = getAddPoolDraftStorageKey({
    chainId: network.id,
    communityAddress,
    account,
  });
  // CommunityDetail keys this modal by chain, community and account, so this
  // synchronous lazy read cannot leak one wallet's draft into another scope.
  const [restoredDraft] = useState(() => {
    const scopedDraft = loadAddPoolDraft(draftStorageKey);
    if (!draftScope && !initialPoolType && scopedDraft?.poolType === 'index-broker-nft') {
      const nftDraftKey = getAddPoolDraftStorageKey({
        chainId: network.id,
        communityAddress,
        account,
        scope: 'create-nft',
      });
      if (saveAddPoolDraft(nftDraftKey, scopedDraft)) removeAddPoolDraft(draftStorageKey);
      return null;
    }
    if (scopedDraft || !draftScope || !initialPoolType) return scopedDraft;
    const legacyDraft = loadAddPoolDraft(legacyDraftStorageKey);
    if (legacyDraft?.poolType !== initialPoolType) return null;
    if (saveAddPoolDraft(draftStorageKey, legacyDraft)) removeAddPoolDraft(legacyDraftStorageKey);
    return legacyDraft;
  });
  const initialActivePoolKeys = getAddPoolDraftPoolKeys(activePools);

  const [poolType, setPoolType] = useState(initialPoolType || restoredDraft?.poolType || '');
  const [poolName, setPoolName] = useState(restoredDraft?.poolName || '');
  const [stakeTokenAddress, setStakeTokenAddress] = useState(restoredDraft?.stakeTokenAddress || '');
  const [lockDuration, setLockDuration] = useState(restoredDraft?.lockDuration || '');
  const [nftSymbol, setNftSymbol] = useState(restoredDraft?.nftSymbol || '');
  const [fundsReceiver, setFundsReceiver] = useState(restoredDraft?.fundsReceiver || account || '');
  const [renderer, setRenderer] = useState(restoredDraft?.renderer || '');
  const [levelThresholds, setLevelThresholds] = useState(restoredDraft?.levelThresholds || '0, 2, 4, 6');
  const [levelWeights, setLevelWeights] = useState(restoredDraft?.levelWeights || '10000, 12000, 15000, 20000');
  const [paymentAsset, setPaymentAsset] = useState(restoredDraft?.paymentAsset || '');
  const [mintPrice, setMintPrice] = useState(restoredDraft?.mintPrice || '');
  const [batchSupply, setBatchSupply] = useState(restoredDraft?.batchSupply || '');
  const [referralPercent, setReferralPercent] = useState(restoredDraft?.referralPercent || '10');
  const [basketNftMiningPool, setBasketNftMiningPool] = useState(restoredDraft?.basketNftMiningPool || '');
  const [basketNftRewardPercent, setBasketNftRewardPercent] = useState(restoredDraft?.basketNftRewardPercent || '10');
  const [basketLockDurationHours, setBasketLockDurationHours] = useState(restoredDraft?.basketLockDurationHours || '30');
  const [showBasketRewardInfo, setShowBasketRewardInfo] = useState(false);
  const [showBasketUnlockInfo, setShowBasketUnlockInfo] = useState(false);
  const [paymentTokenPreview, setPaymentTokenPreview] = useState({ loading: false, symbol: '', error: '' });
  const [rendererPreview, setRendererPreview] = useState({ loading: false, image: '', address: '', error: '' });
  const [previewSeed, setPreviewSeed] = useState(() => (
    restoredDraft?.previewSeed
      ? BigInt(restoredDraft.previewSeed)
      : BigInt(ethers.hexlify(ethers.randomBytes(32)))
  ));
  const [previewParams, setPreviewParams] = useState(() => ({
    ...DEFAULT_NFT_PREVIEW_PARAMS,
    ...(restoredDraft?.previewParams || {}),
  }));
  const [inputRatios, setInputRatios] = useState(() => restoreAddPoolDraftRatios(restoredDraft, activePools));
  const [loading, setLoading] = useTimedActionLoading(false);
  const [wizardStep, setWizardStep] = useState(() => (
    initialPoolType
      ? Math.max(1, restoredDraft?.poolType === initialPoolType ? (restoredDraft.wizardStep || 1) : 1)
      : (restoredDraft?.wizardStep || 0)
  ));
  const [stepError, setStepError] = useState('');
  const wizardBodyRef = useRef(null);
  const activePoolKeysRef = useRef(initialActivePoolKeys);
  const latestDraftRef = useRef(restoredDraft);
  const draftCompletedRef = useRef(false);
  const draftStorageWarningRef = useRef(false);
  const [settingsFee, setSettingsFee] = useState(null);
  const [indexBrokerConfig, setIndexBrokerConfig] = useState(() => ({
    ...DEFAULT_INDEX_BROKER_CONFIG,
    fundsReceiver: account || '',
    ...(restoredDraft?.indexBrokerConfig || {}),
  }));
  const [indexBrokerContext, setIndexBrokerContext] = useState({
    loading: false,
    symbol: '',
    decimals: 18,
    defaultRenderer: '',
    defaultIndexToken: '',
    basketRegistry: '',
    pumpListed: null,
    pumpPoolId: '',
    pumpPoolManager: '',
    burnTemplateSupported: false,
    stakeTemplateSupported: false,
    pumpSupported: false,
    platformFeeBps: 0,
    error: '',
  });
  const [indexBrokerSource, setIndexBrokerSource] = useState({
    loading: false,
    resolved: false,
    poolId: '',
    error: '',
    details: null,
  });
  const [indexBrokerPoolDiscovery, setIndexBrokerPoolDiscovery] = useState({
    loading: false,
    pools: [],
    error: '',
  });
  const [indexBrokerPoolDiscoveryNonce, setIndexBrokerPoolDiscoveryNonce] = useState(0);
  const [indexTokenValidation, setIndexTokenValidation] = useState({
    loading: false,
    valid: false,
    token: '',
    symbol: '',
    version: null,
    router: '',
    error: '',
  });
  const [stakeTokenValidation, setStakeTokenValidation] = useState({
    loading: false,
    valid: false,
    token: '',
    decimals: null,
    error: '',
  });
  const [indexBrokerRendererStatus, setIndexBrokerRendererStatus] = useState({
    loading: false,
    valid: false,
    address: '',
    error: '',
  });

  // Reconcile the position-based form controls before the browser can paint or
  // dispatch pagehide, while keeping the values bound to stable pool IDs.
  useLayoutEffect(() => {
    if (!activePools) return;
    const nextPoolKeys = getAddPoolDraftPoolKeys(activePools);
    const previousPoolKeys = activePoolKeysRef.current;
    if (nextPoolKeys.join('|') === previousPoolKeys.join('|')) return;

    setInputRatios(current => {
      const currentByPool = new Map(previousPoolKeys.map((key, index) => [key, current[index] || '']));
      const restoredByPool = restoredDraft?.ratiosByPool || {};
      const newPoolRatio = current[previousPoolKeys.length]
        ?? restoredDraft?.newPoolRatio
        ?? '';
      return [
        ...nextPoolKeys.map(key => currentByPool.get(key) ?? restoredByPool[key] ?? ''),
        newPoolRatio,
      ];
    });
    activePoolKeysRef.current = nextPoolKeys;
  }, [activePools, restoredDraft]);

  const draftPayload = useMemo(() => buildAddPoolDraft({
    poolType,
    poolName,
    stakeTokenAddress,
    lockDuration,
    nftSymbol,
    fundsReceiver,
    renderer,
    levelThresholds,
    levelWeights,
    paymentAsset,
    mintPrice,
    batchSupply,
    referralPercent,
    basketNftMiningPool,
    basketNftRewardPercent,
    basketLockDurationHours,
    previewSeed,
    previewParams,
    inputRatios,
    wizardStep,
    indexBrokerConfig,
  }, activePools, restoredDraft), [
    activePools,
    basketLockDurationHours,
    basketNftMiningPool,
    basketNftRewardPercent,
    batchSupply,
    fundsReceiver,
    indexBrokerConfig,
    inputRatios,
    levelThresholds,
    levelWeights,
    lockDuration,
    mintPrice,
    nftSymbol,
    paymentAsset,
    poolName,
    poolType,
    previewParams,
    previewSeed,
    referralPercent,
    renderer,
    restoredDraft,
    stakeTokenAddress,
    wizardStep,
  ]);

  useLayoutEffect(() => {
    latestDraftRef.current = draftPayload;
  }, [draftPayload]);

  useEffect(() => {
    if (draftCompletedRef.current || !draftStorageKey) return undefined;
    const timer = setTimeout(() => {
      if (draftCompletedRef.current) return;
      if (!saveAddPoolDraft(draftStorageKey, draftPayload) && !draftStorageWarningRef.current) {
        draftStorageWarningRef.current = true;
        toast.error(language === 'zh'
          ? '浏览器无法保存创建草稿，请不要刷新或关闭页面'
          : 'The browser could not save this draft. Keep this page open to avoid losing your inputs.');
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [draftPayload, draftStorageKey, language, toast]);

  useEffect(() => {
    const flushDraft = () => {
      if (draftCompletedRef.current || !draftStorageKey) return;
      saveAddPoolDraft(draftStorageKey, latestDraftRef.current);
    };
    window.addEventListener('pagehide', flushDraft);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      flushDraft();
    };
  }, [draftStorageKey]);

  // Load operation fee on mount
  useEffect(() => {
    if (!readProvider) return;
    const committeeContract = new ethers.Contract(contracts.Committee, [
      'function getCommunitySettingsFee() view returns (uint256)',
    ], readProvider);
    committeeContract.getCommunitySettingsFee().then(fee => setSettingsFee(fee)).catch(() => {});
  }, [readProvider, contracts]);

  useEffect(() => {
    if (!fundsReceiver && account) setFundsReceiver(account);
  }, [account, fundsReceiver]);

  useEffect(() => {
    if (poolType !== 'index-broker-nft' || !readProvider || !communityTokenAddress
      || !contracts.IndexBrokerNFTFactory || !contracts.Pump || !contracts.Multicall3) return undefined;
    let cancelled = false;
    setIndexBrokerContext(current => ({ ...current, loading: true, error: '' }));

    multicallRead(readProvider, contracts.Multicall3, [
      {
        key: 'symbol', target: communityTokenAddress, contractInterface: ERC20_INTERFACE,
        functionName: 'symbol', args: [],
      },
      {
        key: 'decimals', target: communityTokenAddress, contractInterface: ERC20_INTERFACE,
        functionName: 'decimals', args: [],
      },
      {
        key: 'officialToken', target: contracts.Pump, contractInterface: PUMP_INTERFACE,
        functionName: 'createdTokens', args: [communityTokenAddress],
      },
      {
        key: 'pumpPoolManager', target: contracts.Pump, contractInterface: PUMP_INTERFACE,
        functionName: 'getPoolManager', args: [],
      },
      {
        key: 'pumpListed', target: communityTokenAddress, contractInterface: PUMP_TOKEN_INTERFACE,
        functionName: 'listed', args: [], allowFailure: true,
      },
      {
        key: 'pumpPoolId', target: communityTokenAddress, contractInterface: PUMP_TOKEN_INTERFACE,
        functionName: 'v4PoolId', args: [], allowFailure: true,
      },
      {
        key: 'defaultIndexToken', target: contracts.IndexBrokerNFTFactory,
        contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
        functionName: 'defaultIndexToken', args: [],
      },
      {
        key: 'basketRegistry', target: contracts.IndexBrokerNFTFactory,
        contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
        functionName: 'basketRegistry', args: [],
      },
      {
        key: 'defaultRenderer', target: contracts.IndexBrokerNFTFactory,
        contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
        functionName: 'defaultRenderer', args: [],
      },
      {
        key: 'burnTemplateSupported', target: contracts.IndexBrokerNFTFactory,
        contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
        functionName: 'supportedNFTTemplate', args: [contracts.IndexBrokerNFTBurnTemplate],
      },
      {
        key: 'stakeTemplateSupported', target: contracts.IndexBrokerNFTFactory,
        contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
        functionName: 'supportedNFTTemplate', args: [contracts.IndexBrokerNFTStakeTemplate],
      },
      {
        key: 'pumpSupported', target: contracts.IndexBrokerNFTFactory,
        contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
        functionName: 'supportedPump', args: [contracts.Pump],
      },
      {
        key: 'platformFeeBps', target: contracts.IndexBrokerNFTFactory,
        contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
        functionName: 'platformFeeBps', args: [],
      },
    ]).then(({ symbol, decimals, officialToken, defaultIndexToken, basketRegistry, defaultRenderer, pumpListed, pumpPoolId, pumpPoolManager, burnTemplateSupported, stakeTemplateSupported, pumpSupported, platformFeeBps }) => {
      if (cancelled) return;
      setIndexBrokerContext({
        loading: false,
        symbol,
        decimals: Number(decimals),
        defaultRenderer,
        defaultIndexToken,
        basketRegistry,
        pumpListed: officialToken ? Boolean(pumpListed) : null,
        pumpPoolId: officialToken && pumpListed ? String(pumpPoolId || '') : '',
        pumpPoolManager: officialToken ? String(pumpPoolManager || '') : '',
        burnTemplateSupported: Boolean(burnTemplateSupported),
        stakeTemplateSupported: Boolean(stakeTemplateSupported),
        pumpSupported: Boolean(pumpSupported),
        platformFeeBps: Number(platformFeeBps),
        error: !burnTemplateSupported && !stakeTemplateSupported
          ? (language === 'zh' ? 'Factory 当前没有可用的 NFT 模板' : 'The Factory has no supported NFT template')
          : (officialToken && !pumpSupported
            ? (language === 'zh' ? '当前 Pump 未在 Factory 注册' : 'The current Pump is not registered in the Factory')
            : ''),
      });
      setIndexBrokerConfig(current => {
        const stakePreferred = current.miningMode === INDEX_BROKER_MINING_MODES.STAKE;
        const miningMode = stakePreferred && stakeTemplateSupported
          ? INDEX_BROKER_MINING_MODES.STAKE
          : (!stakePreferred && burnTemplateSupported
            ? INDEX_BROKER_MINING_MODES.BURN
            : (burnTemplateSupported ? INDEX_BROKER_MINING_MODES.BURN : INDEX_BROKER_MINING_MODES.STAKE));
        return {
          ...current,
          officialToken,
          fundsReceiver: current.fundsReceiver || account || '',
          pump: officialToken ? contracts.Pump : '',
          nftTemplate: miningMode === INDEX_BROKER_MINING_MODES.STAKE
            ? contracts.IndexBrokerNFTStakeTemplate
            : contracts.IndexBrokerNFTBurnTemplate,
          miningMode,
        };
      });
    }).catch(error => {
      if (cancelled) return;
      console.error('Failed to load Index Broker NFT creation context:', error);
      setIndexBrokerContext(current => ({
        ...current,
        loading: false,
        error: language === 'zh' ? '无法读取 Index Broker 创建配置' : 'Could not load Index Broker creation settings',
      }));
    });

    return () => { cancelled = true; };
  }, [
    account,
    communityTokenAddress,
    contracts.IndexBrokerNFTFactory,
    contracts.IndexBrokerNFTBurnTemplate,
    contracts.IndexBrokerNFTStakeTemplate,
    contracts.Multicall3,
    contracts.Pump,
    language,
    poolType,
    readProvider,
  ]);

  useEffect(() => {
    const stakeMode = indexBrokerConfig.miningMode === INDEX_BROKER_MINING_MODES.STAKE;
    const token = String(indexBrokerConfig.stakingToken || '').trim();
    if (poolType !== 'index-broker-nft' || !stakeMode) {
      setStakeTokenValidation({ loading: false, valid: false, token: '', decimals: null, error: '' });
      return undefined;
    }
    if (!token || !ethers.isAddress(token) || token === ethers.ZeroAddress) {
      setStakeTokenValidation({
        loading: false,
        valid: false,
        token,
        decimals: null,
        error: language === 'zh' ? '请填写有效的 ERC20 质押代币地址' : 'Enter a valid ERC20 staking-token address',
      });
      return undefined;
    }
    if (!readProvider) {
      setStakeTokenValidation({
        loading: false,
        valid: false,
        token,
        decimals: null,
        error: language === 'zh' ? '当前无法连接链上 RPC' : 'The chain RPC is unavailable',
      });
      return undefined;
    }

    let cancelled = false;
    const normalizedToken = ethers.getAddress(token);
    setStakeTokenValidation({ loading: true, valid: false, token: normalizedToken, decimals: null, error: '' });
    const timer = setTimeout(async () => {
      try {
        if (await readProvider.getCode(normalizedToken) === '0x') {
          throw new Error(language === 'zh' ? '质押代币地址不是合约' : 'The staking-token address is not a contract');
        }
        const tokenContract = new ethers.Contract(normalizedToken, ['function decimals() view returns (uint8)'], readProvider);
        const decimals = Number(await tokenContract.decimals());
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
          throw new Error(language === 'zh' ? '质押代币 decimals 必须在 0–77 之间' : 'Staking-token decimals must be between 0 and 77');
        }
        if (!cancelled) setStakeTokenValidation({ loading: false, valid: true, token: normalizedToken, decimals, error: '' });
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to validate Index Broker staking token:', error);
        setStakeTokenValidation({
          loading: false,
          valid: false,
          token: normalizedToken,
          decimals: null,
          error: error.message || (language === 'zh' ? '无法读取质押代币' : 'Could not read the staking token'),
        });
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [indexBrokerConfig.miningMode, indexBrokerConfig.stakingToken, language, poolType, readProvider]);

  useEffect(() => {
    const configuredToken = String(indexBrokerConfig.indexToken || '').trim();
    const token = configuredToken || String(indexBrokerContext.defaultIndexToken || '').trim();
    const registry = String(indexBrokerContext.basketRegistry || '').trim();

    if (poolType !== 'index-broker-nft') {
      setIndexTokenValidation({ loading: false, valid: false, token: '', symbol: '', version: null, router: '', error: '' });
      return undefined;
    }
    if (indexBrokerContext.loading) {
      setIndexTokenValidation({ loading: true, valid: false, token, symbol: '', version: null, router: '', error: '' });
      return undefined;
    }
    if (!token || !ethers.isAddress(token) || token === ethers.ZeroAddress) {
      setIndexTokenValidation({
        loading: false,
        valid: false,
        token,
        symbol: '',
        version: null,
        router: '',
        error: language === 'zh' ? '请填写有效的指数代币地址' : 'Enter a valid index-token address',
      });
      return undefined;
    }
    if (!readProvider || !contracts.Multicall3 || !contracts.IndexBrokerNFTFactory || !ethers.isAddress(registry)) {
      setIndexTokenValidation({
        loading: false,
        valid: false,
        token,
        symbol: '',
        version: null,
        router: '',
        error: language === 'zh' ? '无法读取 Basket Registry 配置' : 'Could not resolve the Basket Registry configuration',
      });
      return undefined;
    }

    let cancelled = false;
    const normalizedToken = ethers.getAddress(token);
    setIndexTokenValidation({ loading: true, valid: false, token: normalizedToken, symbol: '', version: null, router: '', error: '' });

    (async () => {
      try {
        const basket = await multicallRead(readProvider, contracts.Multicall3, [
          {
            key: 'supported', target: registry, contractInterface: BASKET_REGISTRY_INTERFACE,
            functionName: 'isBasket', args: [normalizedToken],
          },
          {
            key: 'version', target: registry, contractInterface: BASKET_REGISTRY_INTERFACE,
            functionName: 'basketVersion', args: [normalizedToken],
          },
          {
            key: 'symbol', target: normalizedToken, contractInterface: ERC20_INTERFACE,
            functionName: 'symbol', args: [], allowFailure: true,
          },
        ]);
        const version = Number(basket.version || 0);
        if (!basket.supported || version <= 0) {
          throw new Error(language === 'zh'
            ? '该代币不是 Basket Registry 支持的指数代币'
            : 'This token is not a supported index token in the Basket Registry');
        }

        const factoryConfig = await multicallRead(readProvider, contracts.Multicall3, [
          {
            key: 'router', target: contracts.IndexBrokerNFTFactory,
            contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
            functionName: 'basketSwapRouterForVersion', args: [version],
          },
          {
            key: 'indexV3Router', target: contracts.IndexBrokerNFTFactory,
            contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
            functionName: 'indexV3Router', args: [],
          },
          {
            key: 'indexV3Fee', target: contracts.IndexBrokerNFTFactory,
            contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
            functionName: 'indexV3Fee', args: [],
          },
        ]);
        const { router, indexV3Router, indexV3Fee } = factoryConfig;
        if (!router || router === ethers.ZeroAddress || !indexV3Router || indexV3Router === ethers.ZeroAddress) {
          throw new Error(language === 'zh'
            ? `Factory 的 Basket V${version} 回购路由配置不完整`
            : `The Factory buyback route for Basket V${version} is incomplete`);
        }

        const compatibility = await multicallRead(readProvider, contracts.Multicall3, [
          {
            key: 'protocolVersion', target: normalizedToken, contractInterface: BASKET_TOKEN_INTERFACE,
            functionName: 'protocolVersion', args: [],
          },
          {
            key: 'tokenRegistry', target: normalizedToken, contractInterface: BASKET_TOKEN_INTERFACE,
            functionName: 'registry', args: [],
          },
          {
            key: 'engine', target: normalizedToken, contractInterface: BASKET_TOKEN_INTERFACE,
            functionName: 'engine', args: [],
          },
          {
            key: 'tokenSettlement', target: normalizedToken, contractInterface: BASKET_TOKEN_INTERFACE,
            functionName: 'settlementToken', args: [],
          },
          {
            key: 'basketWbnb', target: normalizedToken, contractInterface: BASKET_TOKEN_INTERFACE,
            functionName: 'wbnb', args: [],
          },
          {
            key: 'basketHook', target: router, contractInterface: BASKET_SWAP_ROUTER_INTERFACE,
            functionName: 'basketHook', args: [],
          },
          {
            key: 'routerSettlement', target: router, contractInterface: BASKET_SWAP_ROUTER_INTERFACE,
            functionName: 'settlementToken', args: [],
          },
          {
            key: 'wrappedNative', target: indexV3Router, contractInterface: PANCAKE_V3_ROUTER_INTERFACE,
            functionName: 'WETH9', args: [],
          },
          {
            key: 'v3Factory', target: indexV3Router, contractInterface: PANCAKE_V3_ROUTER_INTERFACE,
            functionName: 'factory', args: [],
          },
        ]);
        const sameAddress = (left, right) => (
          ethers.isAddress(left) && ethers.isAddress(right) && left.toLowerCase() === right.toLowerCase()
        );
        if (
          Number(compatibility.protocolVersion) !== version
          || !sameAddress(compatibility.tokenRegistry, registry)
          || !sameAddress(compatibility.engine, compatibility.basketHook)
          || !sameAddress(compatibility.tokenSettlement, compatibility.routerSettlement)
          || !sameAddress(compatibility.basketWbnb, compatibility.wrappedNative)
        ) {
          throw new Error(language === 'zh'
            ? '指数代币与 Factory 的 Basket Router 配置不兼容'
            : 'The index token is incompatible with the Factory Basket Router configuration');
        }

        const { v3Pool } = await multicallRead(readProvider, contracts.Multicall3, [{
          key: 'v3Pool', target: compatibility.v3Factory,
          contractInterface: PANCAKE_V3_FACTORY_INTERFACE,
          functionName: 'getPool',
          args: [compatibility.wrappedNative, compatibility.routerSettlement, Number(indexV3Fee)],
        }]);
        const codeAddresses = [
          normalizedToken,
          router,
          indexV3Router,
          compatibility.basketHook,
          compatibility.routerSettlement,
          compatibility.wrappedNative,
          compatibility.v3Factory,
          v3Pool,
        ];
        if (codeAddresses.some(address => !ethers.isAddress(address) || address === ethers.ZeroAddress)) {
          throw new Error(language === 'zh' ? '指数代币回购路由缺少必要合约' : 'The index-token buyback route is missing a required contract');
        }
        const codes = await Promise.all(codeAddresses.map(address => readProvider.getCode(address)));
        if (codes.some(code => code === '0x')) {
          throw new Error(language === 'zh' ? '指数代币回购路由包含无效合约' : 'The index-token buyback route contains an invalid contract');
        }
        if (!cancelled) {
          setIndexTokenValidation({
            loading: false,
            valid: true,
            token: normalizedToken,
            symbol: String(basket.symbol || '').trim(),
            version,
            router: ethers.getAddress(router),
            error: '',
          });
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to validate Index Broker index token:', error);
        setIndexTokenValidation({
          loading: false,
          valid: false,
          token: normalizedToken,
          symbol: '',
          version: null,
          router: '',
          error: error.message || (language === 'zh' ? '无法验证指数代币' : 'Could not validate the index token'),
        });
      }
    })();

    return () => { cancelled = true; };
  }, [
    contracts.IndexBrokerNFTFactory,
    contracts.Multicall3,
    indexBrokerConfig.indexToken,
    indexBrokerContext.basketRegistry,
    indexBrokerContext.defaultIndexToken,
    indexBrokerContext.loading,
    language,
    poolType,
    readProvider,
  ]);

  useEffect(() => {
    if (poolType !== 'index-broker-nft' || indexBrokerConfig.officialToken !== false) return;
    const sourceType = Number(indexBrokerConfig.sourceType);
    const sourceFactory = sourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR
      ? contracts.PancakeV2Factory
      : sourceType === INDEX_BROKER_SOURCE_TYPES.V3_POOL
        ? contracts.PancakeV3Factory
        : '';
    setIndexBrokerConfig(current => (
      current.sourceFactory === (sourceFactory || '')
        ? current
        : { ...current, sourceFactory: sourceFactory || '' }
    ));
  }, [
    contracts.PancakeV2Factory,
    contracts.PancakeV3Factory,
    indexBrokerConfig.officialToken,
    indexBrokerConfig.sourceType,
    poolType,
  ]);

  useEffect(() => {
    if (poolType !== 'index-broker-nft' || indexBrokerConfig.officialToken !== false) {
      setIndexBrokerPoolDiscovery({ loading: false, pools: [], error: '' });
      return undefined;
    }
    if (!communityTokenAddress) {
      setIndexBrokerPoolDiscovery({
        loading: false,
        pools: [],
        error: language === 'zh' ? '缺少社区代币地址，无法查找价格池' : 'The Community Token address is missing',
      });
      return undefined;
    }

    const controller = new AbortController();
    setIndexBrokerPoolDiscovery(current => ({ ...current, loading: true, error: '' }));
    discoverPancakePricePools({
      networkSlug: network.slug,
      communityToken: communityTokenAddress,
      signal: controller.signal,
      force: indexBrokerPoolDiscoveryNonce > 0,
    }).then(result => {
      setIndexBrokerPoolDiscovery({ loading: false, pools: result.pools, error: '' });
    }).catch(error => {
      if (error.name === 'AbortError') return;
      console.error('Failed to discover Pancake price pools:', error);
      setIndexBrokerPoolDiscovery({
        loading: false,
        pools: [],
        error: error.message || (language === 'zh' ? '无法查找 Pancake 候选池' : 'Could not discover Pancake pools'),
      });
    });

    return () => controller.abort();
  }, [
    communityTokenAddress,
    indexBrokerConfig.officialToken,
    indexBrokerPoolDiscoveryNonce,
    language,
    network.slug,
    poolType,
  ]);

  useEffect(() => {
    const sourceType = Number(indexBrokerConfig.sourceType);
    const isV2 = sourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR;
    const isV3 = sourceType === INDEX_BROKER_SOURCE_TYPES.V3_POOL;
    if (!isV2 && !isV3) return undefined;
    if (poolType !== 'index-broker-nft' || indexBrokerConfig.officialToken !== false) {
      setIndexBrokerSource({ loading: false, resolved: false, poolId: '', error: '', details: null });
      return undefined;
    }

    const enteredPool = indexBrokerConfig.sourcePool.trim();
    const defaultFactory = isV2 ? contracts.PancakeV2Factory : contracts.PancakeV3Factory;
    const versionLabel = isV2 ? 'Pancake V2' : 'Pancake V3';
    if (!enteredPool) {
      setIndexBrokerSource({ loading: false, resolved: false, poolId: '', error: '', details: null });
      return undefined;
    }
    if (!ethers.isAddress(enteredPool) || enteredPool === ethers.ZeroAddress) {
      setIndexBrokerSource({
        loading: false,
        resolved: false,
        poolId: enteredPool,
        error: language === 'zh' ? '请输入有效的 Pancake 交易池地址' : 'Enter a valid Pancake pool address',
        details: null,
      });
      return undefined;
    }
    if (!defaultFactory || !ethers.isAddress(defaultFactory)) {
      setIndexBrokerSource({
        loading: false,
        resolved: false,
        poolId: enteredPool,
        error: language === 'zh' ? `平台当前未支持 ${versionLabel}` : `${versionLabel} is not currently supported by the platform`,
        details: null,
      });
      return undefined;
    }
    if (!readProvider || !contracts.NutboxRouter || !communityTokenAddress) {
      setIndexBrokerSource({
        loading: false,
        resolved: false,
        poolId: enteredPool,
        error: language === 'zh' ? '当前无法连接链上验证价格池' : 'The price pool cannot be verified on-chain right now',
        details: null,
      });
      return undefined;
    }

    let cancelled = false;
    const normalizedPool = ethers.getAddress(enteredPool);
    const normalizedFactory = ethers.getAddress(defaultFactory);
    setIndexBrokerSource({ loading: true, resolved: false, poolId: normalizedPool, error: '', details: null });
    const timer = setTimeout(async () => {
      try {
        const [poolCode, factoryCode] = await Promise.all([
          readProvider.getCode(normalizedPool),
          readProvider.getCode(normalizedFactory),
        ]);
        if (poolCode === '0x') throw new Error(language === 'zh' ? '该地址不是交易池合约' : 'This address is not a pool contract');
        if (factoryCode === '0x') throw new Error(language === 'zh' ? `${versionLabel} 默认 Factory 配置无效` : `The default ${versionLabel} Factory is invalid`);

        const router = new ethers.Contract(contracts.NutboxRouter, NUTBOX_ROUTER_INTERFACE, readProvider);
        const allowed = isV2
          ? await router.allowedV2Factory(normalizedFactory)
          : await router.allowedV3Factory(normalizedFactory);
        if (!allowed) {
          throw new Error(language === 'zh'
            ? `${versionLabel} Factory 尚未被 Nutbox Router 支持`
            : `The ${versionLabel} Factory is not supported by the Nutbox Router`);
        }

        let poolFactory;
        let token0;
        let token1;
        let fee = null;
        if (isV2) {
          const pair = new ethers.Contract(normalizedPool, PANCAKE_V2_PAIR_ABI, readProvider);
          const [reportedFactory, firstToken, secondToken, reserves] = await Promise.all([
            pair.factory(), pair.token0(), pair.token1(), pair.getReserves(),
          ]);
          poolFactory = ethers.getAddress(reportedFactory);
          token0 = ethers.getAddress(firstToken);
          token1 = ethers.getAddress(secondToken);
          if (BigInt(reserves.reserve0 ?? reserves[0] ?? 0) === 0n || BigInt(reserves.reserve1 ?? reserves[1] ?? 0) === 0n) {
            throw new Error(language === 'zh' ? '该 Pancake V2 池没有可用流动性' : 'This Pancake V2 pool has no usable liquidity');
          }
          const factory = new ethers.Contract(normalizedFactory, PANCAKE_V2_FACTORY_ABI, readProvider);
          const registeredPair = await factory.getPair(token0, token1);
          if (!ethers.isAddress(registeredPair) || registeredPair.toLowerCase() !== normalizedPool.toLowerCase()) {
            throw new Error(language === 'zh' ? '该交易池不属于平台默认的 Pancake V2 Factory' : 'This pool does not belong to the platform default Pancake V2 Factory');
          }
        } else {
          const pool = new ethers.Contract(normalizedPool, PANCAKE_V3_POOL_ABI, readProvider);
          const [reportedFactory, firstToken, secondToken, poolFee, liquidity, slot0] = await Promise.all([
            pool.factory(), pool.token0(), pool.token1(), pool.fee(), pool.liquidity(), pool.slot0(),
          ]);
          poolFactory = ethers.getAddress(reportedFactory);
          token0 = ethers.getAddress(firstToken);
          token1 = ethers.getAddress(secondToken);
          fee = Number(poolFee);
          if (BigInt(liquidity || 0) === 0n || BigInt(slot0.sqrtPriceX96 ?? slot0[0] ?? 0) === 0n) {
            throw new Error(language === 'zh' ? '该 Pancake V3 池尚未初始化或没有流动性' : 'This Pancake V3 pool is not initialized or has no liquidity');
          }
          const factory = new ethers.Contract(normalizedFactory, PANCAKE_V3_FACTORY_ABI, readProvider);
          const registeredPool = await factory.getPool(token0, token1, fee);
          if (!ethers.isAddress(registeredPool) || registeredPool.toLowerCase() !== normalizedPool.toLowerCase()) {
            throw new Error(language === 'zh' ? '该交易池不属于平台默认的 Pancake V3 Factory' : 'This pool does not belong to the platform default Pancake V3 Factory');
          }
        }

        if (poolFactory.toLowerCase() !== normalizedFactory.toLowerCase()) {
          throw new Error(language === 'zh'
            ? `该交易池报告的 Factory 不是平台默认的 ${versionLabel} Factory`
            : `The pool does not report the platform default ${versionLabel} Factory`);
        }
        const communityToken = communityTokenAddress.toLowerCase();
        const token0Lower = token0.toLowerCase();
        const token1Lower = token1.toLowerCase();
        if (token0Lower !== communityToken && token1Lower !== communityToken) {
          throw new Error(language === 'zh' ? '该交易池不包含当前社区代币' : 'This pool does not contain the current Community Token');
        }
        const quoteToken = token0Lower === communityToken ? token1 : token0;
        if (quoteToken !== ethers.ZeroAddress && quoteToken.toLowerCase() !== String(contracts.WBNB || '').toLowerCase()) {
          if (!contracts.WBNB) throw new Error(language === 'zh' ? '当前网络未配置 WBNB' : 'WBNB is not configured for this network');
          try {
            await router.validateRoute(quoteToken, contracts.WBNB);
          } catch {
            throw new Error(language === 'zh'
              ? `报价代币 ${shortenAddress(quoteToken)} 尚未配置到 WBNB 的 Nutbox Router 路由`
              : `The quote token ${shortenAddress(quoteToken)} has no Nutbox Router route to WBNB`);
          }
        }

        if (cancelled) return;
        setIndexBrokerSource({
          loading: false,
          resolved: true,
          poolId: normalizedPool,
          error: '',
          details: { versionLabel, factory: normalizedFactory, currency0: token0, currency1: token1, quoteToken, fee },
        });
      } catch (error) {
        if (cancelled) return;
        console.error(`Failed to validate ${versionLabel} price pool:`, error);
        setIndexBrokerSource({
          loading: false,
          resolved: false,
          poolId: normalizedPool,
          error: error.reason || error.shortMessage || error.message
            || (language === 'zh' ? '无法验证该 Pancake 交易池' : 'Could not validate this Pancake pool'),
          details: null,
        });
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    communityTokenAddress,
    contracts.NutboxRouter,
    contracts.PancakeV2Factory,
    contracts.PancakeV3Factory,
    contracts.WBNB,
    indexBrokerConfig.officialToken,
    indexBrokerConfig.sourcePool,
    indexBrokerConfig.sourceType,
    language,
    poolType,
    readProvider,
  ]);

  useEffect(() => {
    const sourceType = Number(indexBrokerConfig.sourceType);
    const poolId = indexBrokerConfig.sourcePoolId.trim();
    if (!isIndexBrokerV4Source(sourceType)) return undefined;
    if (poolType !== 'index-broker-nft' || indexBrokerConfig.officialToken !== false) {
      setIndexBrokerSource({ loading: false, resolved: false, poolId: '', error: '', details: null });
      return undefined;
    }
    if (!poolId) {
      setIndexBrokerSource({ loading: false, resolved: false, poolId: '', error: '', details: null });
      return undefined;
    }
    if (!ethers.isHexString(poolId, 32)) {
      setIndexBrokerSource({
        loading: false,
        resolved: false,
        poolId,
        error: language === 'zh' ? 'Pool ID 必须是 32 字节十六进制值' : 'Pool ID must be a 32-byte hex value',
        details: null,
      });
      return undefined;
    }
    if (sourceType === INDEX_BROKER_SOURCE_TYPES.UNISWAP_V4) {
      setIndexBrokerSource({
        loading: false,
        resolved: false,
        poolId,
        error: language === 'zh'
          ? '当前 Index Broker 部署未启用 Uniswap V4 价格源'
          : 'The current Index Broker deployment does not enable Uniswap V4 pricing',
        details: null,
      });
      return undefined;
    }
    if (!readProvider || !contracts.Multicall3 || !contracts.PancakeV4CLManager) {
      setIndexBrokerSource({
        loading: false,
        resolved: false,
        poolId,
        error: language === 'zh' ? '当前网络未配置 Pancake V4 CL Pool Manager' : 'Pancake V4 CL Pool Manager is not configured',
        details: null,
      });
      return undefined;
    }

    let cancelled = false;
    setIndexBrokerSource({ loading: true, resolved: false, poolId, error: '', details: null });
    const timer = setTimeout(async () => {
      try {
        const manager = ethers.getAddress(contracts.PancakeV4CLManager);
        const result = await multicallRead(readProvider, contracts.Multicall3, [
          {
            key: 'poolKey', target: manager, contractInterface: PANCAKE_V4_CL_MANAGER_INTERFACE,
            functionName: 'poolIdToPoolKey', args: [poolId],
          },
          {
            key: 'slot0', target: manager, contractInterface: PANCAKE_V4_CL_MANAGER_INTERFACE,
            functionName: 'getSlot0', args: [poolId],
          },
          {
            key: 'liquidity', target: manager, contractInterface: PANCAKE_V4_CL_MANAGER_INTERFACE,
            functionName: 'getLiquidity', args: [poolId],
          },
        ]);
        if (cancelled) return;

        const poolKey = result.poolKey;
        const details = {
          currency0: ethers.getAddress(poolKey.currency0),
          currency1: ethers.getAddress(poolKey.currency1),
          hooks: ethers.getAddress(poolKey.hooks),
          poolManager: ethers.getAddress(poolKey.poolManager),
          fee: Number(poolKey.fee),
          parameters: poolKey.parameters,
        };
        const resolvedSource = {
          sourcePoolManager: details.poolManager,
          sourceCurrency0: details.currency0,
          sourceCurrency1: details.currency1,
          sourceHooks: details.hooks,
          sourceFee: String(details.fee),
          sourceParameters: details.parameters,
        };
        if (getIndexBrokerV4PoolId({
          sourceType,
          sourcePoolId: poolId,
          ...resolvedSource,
        }).toLowerCase() !== poolId.toLowerCase()) {
          throw new Error(language === 'zh' ? 'Pool ID 与链上 PoolKey 不匹配' : 'Pool ID does not match the on-chain PoolKey');
        }
        if (details.poolManager.toLowerCase() !== manager.toLowerCase()) {
          throw new Error(language === 'zh' ? 'Pool Manager 与当前网络配置不匹配' : 'Pool Manager does not match this network');
        }

        const token = communityTokenAddress.toLowerCase();
        const currencies = [details.currency0.toLowerCase(), details.currency1.toLowerCase()];
        const tokenIndex = currencies.indexOf(token);
        if (tokenIndex < 0) {
          throw new Error(language === 'zh'
            ? '该交易池必须包含当前社区代币'
            : 'The pool must contain this Community Token');
        }
        if (BigInt(result.slot0.sqrtPriceX96 ?? result.slot0[0] ?? 0) === 0n || BigInt(result.liquidity || 0) === 0n) {
          throw new Error(language === 'zh' ? '该池尚未初始化或没有流动性' : 'The pool is not initialized or has no liquidity');
        }
        const quoteToken = tokenIndex === 0 ? details.currency1 : details.currency0;
        if (quoteToken !== ethers.ZeroAddress && quoteToken.toLowerCase() !== String(contracts.WBNB || '').toLowerCase()) {
          if (!contracts.NutboxRouter || !contracts.WBNB) {
            throw new Error(language === 'zh' ? '当前网络未配置 Nutbox Router 或 WBNB' : 'Nutbox Router or WBNB is not configured for this network');
          }
          const nutboxRouter = new ethers.Contract(contracts.NutboxRouter, NUTBOX_ROUTER_INTERFACE, readProvider);
          await nutboxRouter.validateRoute(quoteToken, contracts.WBNB);
        }

        setIndexBrokerConfig(current => (
          current.sourcePoolId.trim().toLowerCase() === poolId.toLowerCase()
            && Number(current.sourceType) === sourceType
            ? { ...current, ...resolvedSource }
            : current
        ));
        setIndexBrokerSource({ loading: false, resolved: true, poolId, error: '', details });
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to resolve V4 Pool ID:', error);
        setIndexBrokerSource({
          loading: false,
          resolved: false,
          poolId,
          error: error.shortMessage || error.reason || error.message
            || (language === 'zh' ? '无法读取该 Pool ID' : 'Could not resolve this Pool ID'),
          details: null,
        });
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    communityTokenAddress,
    contracts.Multicall3,
    contracts.NutboxRouter,
    contracts.PancakeV4CLManager,
    contracts.WBNB,
    indexBrokerConfig.officialToken,
    indexBrokerConfig.sourcePoolId,
    indexBrokerConfig.sourceType,
    language,
    poolType,
    readProvider,
  ]);

  useEffect(() => {
    if (poolType !== 'basket-tvl') return;
    const nftPools = activePools.filter(pool => pool.poolType === 'NFT_MINING');
    const selectedPool = String(basketNftMiningPool || '').toLowerCase();
    const selectedPoolIsActive = selectedPool && nftPools.some(pool => (
      String(pool.id || '').toLowerCase() === selectedPool
    ));
    if (!selectedPoolIsActive) setBasketNftMiningPool(nftPools[0]?.id || '');
  }, [activePools, basketNftMiningPool, poolType]);

  useEffect(() => {
    if (poolType !== 'nft-mining') return undefined;
    const address = paymentAsset.trim();
    if (!address) {
      setPaymentTokenPreview({ loading: false, symbol: network.nativeCurrency.symbol, error: '' });
      return undefined;
    }
    if (!ethers.isAddress(address)) {
      setPaymentTokenPreview({ loading: false, symbol: '', error: language === 'zh' ? '请输入有效的代币地址' : 'Enter a valid token address' });
      return undefined;
    }

    let cancelled = false;
    setPaymentTokenPreview({ loading: true, symbol: '', error: '' });
    const timer = setTimeout(async () => {
      try {
        const token = new ethers.Contract(address, ['function symbol() view returns (string)'], readProvider);
        const symbol = await token.symbol();
        if (!cancelled) setPaymentTokenPreview({ loading: false, symbol, error: '' });
      } catch {
        if (!cancelled) {
          setPaymentTokenPreview({
            loading: false,
            symbol: '',
            error: language === 'zh' ? '无法读取代币 Symbol，请检查合约地址' : 'Could not read token symbol; check the contract address',
          });
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [language, network.nativeCurrency.symbol, paymentAsset, poolType, readProvider]);

  useEffect(() => {
    if (poolType !== 'nft-mining' || !contracts.NFTMiningPoolFactory || !readProvider) return undefined;
    const customRenderer = renderer.trim();
    if (customRenderer && !ethers.isAddress(customRenderer)) {
      setRendererPreview({
        loading: false,
        image: '',
        address: '',
        error: language === 'zh' ? '请输入有效的 Renderer 地址' : 'Enter a valid renderer address',
      });
      return undefined;
    }

    let cancelled = false;
    setRendererPreview(previous => ({ ...previous, loading: true, error: '' }));
    const timer = setTimeout(async () => {
      try {
        let rendererAddress = customRenderer;
        if (!rendererAddress) {
          const factory = new ethers.Contract(
            contracts.NFTMiningPoolFactory,
            NFTMiningPoolFactoryABI,
            readProvider,
          );
          rendererAddress = await factory.defaultRenderer();
        }
        const code = await readProvider.getCode(rendererAddress);
        if (code === '0x') throw new Error('Renderer has no contract code');

        let previewMaxLevel = 16;
        try {
          previewMaxLevel = Math.max(1, Math.min(16, parseIntegerList(levelWeights).length));
        } catch {
          // Allow the preview to keep working while the level list is incomplete.
        }
        const previewLevel = previewInteger(previewParams.level, 1, 1, previewMaxLevel);
        const previewWeight = previewWeightForLevel(levelWeights, previewParams.level);
        const previewRenderer = new ethers.Contract(rendererAddress, NFTMiningRendererABI, readProvider);
        const svg = await previewRenderer.renderSVG({
          collectionName: poolName.trim() || 'NFT Mining Preview',
          tokenId: BigInt(previewInteger(previewParams.tokenId, 1, 1, Number.MAX_SAFE_INTEGER)),
          seed: previewSeed,
          referralCount: BigInt(previewInteger(previewParams.referralCount, 0, 0, Number.MAX_SAFE_INTEGER)),
          miningWeight: previewWeight,
          batchId: previewInteger(previewParams.batchId, 1, 1, 4294967295),
          level: previewLevel,
          paletteId: previewInteger(previewParams.paletteId, 1, 1, 6),
        });
        if (!cancelled) {
          setRendererPreview({
            loading: false,
            image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
            address: rendererAddress,
            error: '',
          });
        }
      } catch {
        if (!cancelled) {
          setRendererPreview({
            loading: false,
            image: '',
            address: customRenderer,
            error: language === 'zh'
              ? '无法调用该 Renderer 生成 SVG，请确认它实现了 renderSVG 接口'
              : 'Could not generate SVG; verify that this contract implements renderSVG',
          });
        }
      }
    }, 550);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    contracts.NFTMiningPoolFactory,
    language,
    levelWeights,
    poolName,
    poolType,
    previewParams,
    previewSeed,
    readProvider,
    renderer,
  ]);

  const zh = language === 'zh';
  const indexBrokerSteps = [
    { key: 'type', label: zh ? '类型' : 'Type', title: zh ? '选择矿池类型' : 'Choose a pool type', description: zh ? '先选择想为社区创建的挖矿方式，后续只显示该类型需要配置的参数。' : 'Choose the mining model to add. The next steps only show settings required by that pool type.' },
    { key: 'template', label: zh ? '模板' : 'Template', title: zh ? '选择指数挖矿模板' : 'Choose an index mining template', description: zh ? '选择 NFT 通过烧毁还是质押代币来获得指数挖矿权重。' : 'Choose whether NFTs gain index-mining weight by burning or staking tokens.' },
    { key: 'identity', label: 'NFT', title: zh ? '设置 NFT 基础信息' : 'Configure NFT basics', description: zh ? '设置合集名称、Symbol、每枚 NFT 的社区代币价格和最大供应量。' : 'Set the collection name, symbol, Community Token price per NFT, and maximum supply.' },
    { key: 'mint', label: zh ? '铸造' : 'Minting', title: zh ? '配置铸造准入方式' : 'Configure mint access', description: zh ? '选择公开、纯白名单或混用模式，并配置 BNB 价格与白名单额度。' : 'Choose open, whitelist-only, or mixed access, then configure the BNB price and whitelist allocations.' },
    { key: 'rewards', label: zh ? '推荐' : 'Referral', title: zh ? '设置推荐与挖矿等级' : 'Configure referrals and mining levels', description: zh ? '配置推荐返佣、公开铸造收款方式，以及各等级的社区挖矿权重。' : 'Configure referral commissions, the public-mint receiver, and community-mining weights.' },
    { key: 'renderer', label: 'Renderer', title: zh ? '配置 Renderer 与图片重生成' : 'Configure the Renderer and image rerolls', description: zh ? '使用平台默认或自定义 Renderer，设置是否允许付费重新生成图片，并通过模拟器预览效果。' : 'Use the default or a custom Renderer, configure paid image rerolls, and preview the result.' },
    { key: 'amm', label: 'AMM', title: zh ? '配置 AMM 与指数代币' : 'Configure the AMM and index token', description: zh ? '设置专属 AMM 手续费、指数代币，以及外部代币需要的 DEX 价格源。' : 'Set dedicated-AMM fees, the index token, and any DEX price source required for an external token.' },
    { key: 'ratios', label: zh ? '部署' : 'Deploy', title: zh ? '分配矿池奖励并确认部署' : 'Allocate rewards and confirm deployment', description: zh ? '调整所有矿池的奖励比例，核对配置后发起链上部署。' : 'Allocate rewards across all pools, review the configuration, and deploy on-chain.' },
  ];
  const nftMiningSteps = [
    indexBrokerSteps[0],
    { key: 'nft-issuance', label: zh ? '发行' : 'Issuance', title: zh ? '配置 NFT 发行' : 'Configure NFT issuance', description: zh ? '填写 NFT 名称、Symbol、首批供应量、支付币种和铸造价格。' : 'Set the NFT name, symbol, first-batch supply, payment asset, and mint price.' },
    { key: 'nft-referral', label: zh ? '推荐' : 'Referral', title: zh ? '配置推荐与权重' : 'Configure referrals and weights', description: zh ? '设置推荐佣金、收款地址、等级门槛和社区挖矿权重。' : 'Set referral commission, receiver, level thresholds, and community-mining weights.' },
    { key: 'nft-renderer', label: 'Renderer', title: zh ? '配置与预览 Renderer' : 'Configure and preview the Renderer', description: zh ? '使用默认链上 Renderer 或填写自定义合约，并预览 NFT 图片。' : 'Use the default on-chain Renderer or a custom contract and preview the NFT image.' },
    indexBrokerSteps[7],
  ];
  const standardSteps = [
    indexBrokerSteps[0],
    { key: 'config', label: zh ? '配置' : 'Setup', title: zh ? '配置矿池参数' : 'Configure pool settings', description: zh ? '填写矿池名称和该类型需要的基础参数。' : 'Enter the pool name and the basic settings required by this pool type.' },
    indexBrokerSteps[7],
  ];
  const wizardSteps = poolType === 'index-broker-nft'
    ? indexBrokerSteps
    : poolType === 'nft-mining'
      ? nftMiningSteps
      : standardSteps;
  const firstWizardStep = initialPoolType && poolType === initialPoolType ? 1 : 0;
  const visibleWizardSteps = wizardSteps.slice(firstWizardStep);
  const currentStepIndex = Math.max(firstWizardStep, Math.min(wizardStep, wizardSteps.length - 1));
  const currentStep = wizardSteps[currentStepIndex];
  const visibleWizardStepIndex = currentStepIndex - firstWizardStep;

  useEffect(() => {
    if (wizardStep < firstWizardStep) setWizardStep(firstWizardStep);
    else if (wizardStep >= wizardSteps.length) setWizardStep(wizardSteps.length - 1);
  }, [firstWizardStep, wizardStep, wizardSteps.length]);

  const goToWizardStep = nextStep => {
    setStepError('');
    setWizardStep(Math.max(firstWizardStep, Math.min(nextStep, wizardSteps.length - 1)));
    requestAnimationFrame(() => wizardBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const requirePoolName = (collection = false) => {
    const name = poolName.trim();
    if (!name) throw new Error(collection
      ? (zh ? '请填写 NFT 合集名称' : 'Enter an NFT collection name')
      : (zh ? '请填写矿池名称' : 'Enter a pool name'));
    if (collection && ethers.toUtf8Bytes(name).length > 64) {
      throw new Error(zh ? '名称不能超过 64 个 UTF-8 字节' : 'The name cannot exceed 64 UTF-8 bytes');
    }
    if (collection && hasUnsupportedNftText(name)) {
      throw new Error(zh ? '名称包含合约不支持的字符' : 'The name contains characters not supported by the contract');
    }
  };

  const validatePercentage = (value, label) => {
    const percentage = Number(value);
    const scaled = percentage * 100;
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new Error(`${label}${zh ? '必须在 0% 到 100% 之间' : ' must be between 0% and 100%'}`);
    }
    if (Math.abs(scaled - Math.round(scaled)) > 1e-8) {
      throw new Error(`${label}${zh ? '最多保留两位小数' : ' supports at most two decimal places'}`);
    }
    return Math.round(scaled);
  };

  const validateIntegerLevels = (thresholdValue, weightValue) => {
    let thresholds;
    let weights;
    try {
      thresholds = parseIndexBrokerIntegerList(thresholdValue, 'Level thresholds');
      weights = parseIndexBrokerIntegerList(weightValue, 'Level weights');
    } catch (error) {
      if (!zh) throw error;
      throw new Error('等级门槛和挖矿权重只能填写逗号分隔的非负整数', { cause: error });
    }
    if (
      thresholds.length !== weights.length || thresholds.length > 16 || thresholds[0] !== 0n
      || weights[0] <= 0n
      || thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1])
      || weights.some((value, index) => index > 0 && value <= weights[index - 1])
    ) {
      throw new Error(zh
        ? '门槛必须从 0 开始；门槛和权重数量相同、最多 16 级，并且都严格递增'
        : 'Thresholds must start at 0; thresholds and weights must have equal length, at most 16 levels, and strictly increase');
    }
  };

  const validateRatios = () => {
    let sum = 0;
    for (const value of inputRatios) {
      if (value === '') throw new Error(zh ? '请输入所有矿池的收益比例' : 'Enter a ratio for every pool');
      const percentage = Number(value);
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        throw new Error(zh ? '每个比例必须在 0% 到 100% 之间' : 'Each ratio must be between 0% and 100%');
      }
      if (Math.abs(percentage * 100 - Math.round(percentage * 100)) > 1e-8) {
        throw new Error(zh ? '收益比例最多保留两位小数' : 'Reward ratios support at most two decimal places');
      }
      sum += Math.round(percentage * 100);
    }
    if (sum !== 0 && sum !== 10_000) {
      throw new Error(zh ? `所有比例之和必须为 100% 或 0%（当前 ${(sum / 100).toFixed(2)}%）` : `Ratios must total 100% or 0% (currently ${(sum / 100).toFixed(2)}%)`);
    }
  };

  const validateWizardStep = stepKey => {
    if (stepKey === 'type') {
      if (!poolType) throw new Error(zh ? '请先选择一种矿池类型' : 'Choose a pool type first');
      return;
    }

    if (stepKey === 'config') {
      requirePoolName();
      if (poolType === 'staking' || poolType === 'locking') {
        if (!ethers.isAddress(stakeTokenAddress) || stakeTokenAddress === ethers.ZeroAddress) {
          throw new Error(zh ? '请填写有效的质押代币地址' : 'Enter a valid staking-token address');
        }
        if (poolType === 'locking' && (!/^\d+$/.test(lockDuration) || BigInt(lockDuration) <= 0n)) {
          throw new Error(zh ? '锁仓时长必须是大于 0 的整数天数' : 'Lock duration must be a positive whole number of days');
        }
      }
      if (poolType === 'basket-tvl') {
        if (!basketNftMiningPool) throw new Error(zh ? '请选择已激活的 NFT 矿池' : 'Select an active NFT mining pool');
        const hours = Number(basketLockDurationHours);
        validatePercentage(basketNftRewardPercent, zh ? '创建者奖励分成' : 'Creator reward share');
        if (!Number.isFinite(hours) || hours <= 0) throw new Error(zh ? '退出解锁周期必须大于 0 小时' : 'The unstake unlock period must be greater than zero');
      }
      return;
    }

    if (stepKey === 'nft-issuance') {
      requirePoolName(true);
      if (!nftSymbol.trim() || ethers.toUtf8Bytes(nftSymbol.trim()).length > 16) throw new Error(zh ? 'NFT Symbol 必须为 1–16 个 UTF-8 字节' : 'NFT Symbol must be 1–16 UTF-8 bytes');
      if (!/^\d+$/.test(batchSupply) || BigInt(batchSupply) <= 0n) throw new Error(zh ? '首批发行量必须是正整数' : 'First-batch supply must be a positive integer');
      if (!mintPrice || Number(mintPrice) <= 0) throw new Error(zh ? 'Mint 价格必须大于 0' : 'Mint price must be greater than zero');
      if (paymentAsset.trim() && !ethers.isAddress(paymentAsset.trim())) throw new Error(zh ? '支付代币地址无效' : 'Invalid payment-token address');
      if (paymentTokenPreview.loading) throw new Error(zh ? '正在读取支付代币，请稍候' : 'The payment token is still loading');
      if (paymentTokenPreview.error) throw new Error(paymentTokenPreview.error);
      return;
    }

    if (stepKey === 'nft-referral') {
      if (!ethers.isAddress(fundsReceiver) || fundsReceiver === ethers.ZeroAddress) throw new Error(zh ? '请填写有效的 Mint 收款地址' : 'Enter a valid mint receiver');
      const percentage = Number(referralPercent);
      validatePercentage(percentage, zh ? '推荐佣金' : 'Referral commission');
      validateIntegerLevels(levelThresholds, levelWeights);
      return;
    }

    if (stepKey === 'nft-renderer') {
      if (renderer.trim() && !ethers.isAddress(renderer.trim())) throw new Error(zh ? 'Renderer 地址无效' : 'Invalid Renderer address');
      if (renderer.trim() && rendererPreview.loading) throw new Error(zh ? '正在验证自定义 Renderer，请稍候' : 'The custom Renderer is still being verified');
      if (renderer.trim() && rendererPreview.error) throw new Error(rendererPreview.error);
      return;
    }

    if (stepKey === 'template') {
      if (indexBrokerContext.loading) throw new Error(zh ? '正在读取 Factory 模板，请稍候' : 'Factory templates are still loading');
      if (indexBrokerContext.error) throw new Error(indexBrokerContext.error);
      const stakeMode = indexBrokerConfig.miningMode === INDEX_BROKER_MINING_MODES.STAKE;
      if (!indexBrokerConfig.nftTemplate) throw new Error(zh ? '请选择可用的 NFT 模板' : 'Choose an available NFT template');
      if (stakeMode && (!ethers.isAddress(indexBrokerConfig.stakingToken) || indexBrokerConfig.stakingToken === ethers.ZeroAddress)) {
        throw new Error(zh ? '请填写有效的指数挖矿质押代币地址' : 'Enter a valid index-mining staking-token address');
      }
      if (stakeMode) {
        const validationMatches = stakeTokenValidation.token
          && stakeTokenValidation.token.toLowerCase() === indexBrokerConfig.stakingToken.trim().toLowerCase();
        if (stakeTokenValidation.loading || !validationMatches) throw new Error(zh ? '正在验证质押代币，请稍候' : 'The staking token is still being verified');
        if (!stakeTokenValidation.valid) throw new Error(stakeTokenValidation.error || (zh ? '该地址不是兼容的 ERC20 质押代币' : 'This address is not a compatible ERC20 staking token'));
      }
      if (!stakeMode && indexBrokerConfig.indexMiningActivationTokenAmount !== '' && Number(indexBrokerConfig.indexMiningActivationTokenAmount) < 0) {
        throw new Error(zh ? '重新激活成本不能为负数' : 'Reactivation cost cannot be negative');
      }
      if (!stakeMode && indexBrokerConfig.indexMiningActivationTokenAmount !== '') {
        try {
          ethers.parseUnits(indexBrokerConfig.indexMiningActivationTokenAmount, indexBrokerContext.decimals);
        } catch (error) {
          throw new Error(zh ? '重新激活成本的小数位超过社区代币精度' : 'The reactivation cost has more decimals than the Community Token supports', { cause: error });
        }
      }
      return;
    }

    if (stepKey === 'identity') {
      requirePoolName(true);
      const symbol = indexBrokerConfig.symbol.trim();
      if (!symbol || ethers.toUtf8Bytes(symbol).length > 16 || hasUnsupportedNftText(symbol)) {
        throw new Error(zh ? 'NFT Symbol 必须为 1–16 个 UTF-8 字节，且不能包含特殊控制字符' : 'NFT Symbol must be 1–16 UTF-8 bytes without unsupported characters');
      }
      if (!indexBrokerConfig.communityTokenPrice || Number(indexBrokerConfig.communityTokenPrice) <= 0) throw new Error(zh ? '每枚 NFT 的社区代币价格必须大于 0' : 'Community Token price per NFT must be greater than zero');
      try {
        ethers.parseUnits(indexBrokerConfig.communityTokenPrice, indexBrokerContext.decimals);
      } catch (error) {
        throw new Error(zh ? '每枚 NFT 的社区代币价格小数位超过代币精度' : 'The Community Token price per NFT has too many decimals', { cause: error });
      }
      if (!/^\d+$/.test(indexBrokerConfig.maxSupply) || BigInt(indexBrokerConfig.maxSupply) <= 0n) throw new Error(zh ? '最大供应量必须是正整数' : 'Maximum supply must be a positive integer');
      return;
    }

    if (stepKey === 'mint') {
      const mintAccessMode = getIndexBrokerMintAccessMode(indexBrokerConfig);
      const openMint = mintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.OPEN;
      const whitelistOnly = mintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.WHITELIST_ONLY;
      if (!whitelistOnly) {
        if (indexBrokerConfig.nativePrice !== '' && Number(indexBrokerConfig.nativePrice) < 0) throw new Error(zh ? '公开铸造 BNB 价格不能为负数' : 'Public-mint BNB price cannot be negative');
        let nativePrice;
        try {
          nativePrice = ethers.parseEther(String(indexBrokerConfig.nativePrice || '0'));
        } catch (error) {
          throw new Error(zh ? '公开铸造 BNB 价格格式无效或小数位超过 18 位' : 'The public-mint BNB price is invalid or has more than 18 decimals', { cause: error });
        }
        if (nativePrice === 0n) {
          throw new Error(zh ? '公开 Mint 和混用模式的 BNB 价格必须大于 0' : 'Open and mixed mint modes require a BNB price greater than zero');
        }
      }

      if (!openMint) {
        let whitelist;
        try {
          whitelist = parseIndexBrokerWhitelist(indexBrokerConfig.whitelist);
        } catch (error) {
          if (!zh) throw error;
          throw new Error('白名单格式无效；请按“地址,额度”每行填写一项，地址不能重复且不能为 0 地址', { cause: error });
        }
        const total = whitelist.allowances.reduce((sum, value) => sum + value, 0n);
        const maxSupply = BigInt(indexBrokerConfig.maxSupply || 0);
        if (total > maxSupply) throw new Error(zh ? '白名单额度总和不能超过最大供应量' : 'Whitelist allocations cannot exceed maximum supply');
        if (whitelistOnly && total !== maxSupply) {
          throw new Error(zh
            ? `纯白名单模式下，白名单额度总和必须等于最大供应量（当前 ${total} / ${maxSupply}）`
            : `Whitelist-only allocations must equal the maximum supply (currently ${total} / ${maxSupply})`);
        }
      }
      return;
    }

    if (stepKey === 'rewards') {
      const whitelistOnly = getIndexBrokerMintAccessMode(indexBrokerConfig) === INDEX_BROKER_MINT_ACCESS_MODES.WHITELIST_ONLY;
      const percentage = whitelistOnly ? 0 : Number(indexBrokerConfig.referralPercent);
      validatePercentage(percentage, zh ? '推荐返佣' : 'Referral commission');
      if (indexBrokerConfig.fundsReceiver.trim() && !ethers.isAddress(indexBrokerConfig.fundsReceiver.trim())) throw new Error(zh ? '公开铸造收款地址无效' : 'Invalid public-mint receiver');
      validateIntegerLevels(indexBrokerConfig.levelThresholds, indexBrokerConfig.levelWeights);
      return;
    }

    if (stepKey === 'renderer') {
      if (indexBrokerConfig.rerollEnabled && indexBrokerConfig.recommitPrice !== '' && Number(indexBrokerConfig.recommitPrice) < 0) throw new Error(zh ? '重新生成图片成本不能为负数' : 'Image reroll cost cannot be negative');
      if (indexBrokerConfig.rerollEnabled && indexBrokerConfig.recommitPrice !== '') {
        try {
          ethers.parseUnits(indexBrokerConfig.recommitPrice, indexBrokerContext.decimals);
        } catch (error) {
          throw new Error(zh ? '重新生成图片成本的小数位超过社区代币精度' : 'The image reroll cost has more decimals than the Community Token supports', { cause: error });
        }
      }
      const customRenderer = indexBrokerConfig.renderer.trim();
      if (customRenderer && !ethers.isAddress(customRenderer)) throw new Error(zh ? 'Renderer 地址无效' : 'Invalid Renderer address');
      if (customRenderer) {
        const previewMatches = indexBrokerRendererStatus.address
          && indexBrokerRendererStatus.address.toLowerCase() === customRenderer.toLowerCase();
        if (indexBrokerRendererStatus.loading || !previewMatches) throw new Error(zh ? '正在验证自定义 Renderer，请稍候' : 'The custom Renderer is still being verified');
        if (indexBrokerRendererStatus.error || !indexBrokerRendererStatus.valid) {
          throw new Error(indexBrokerRendererStatus.error || (zh ? '自定义 Renderer 接口不完整' : 'The custom Renderer interface is incomplete'));
        }
      }
      return;
    }

    if (stepKey === 'amm') {
      if (indexBrokerContext.loading || indexBrokerConfig.officialToken === null) throw new Error(zh ? '仍在读取社区代币类型，请稍候' : 'The Community Token type is still loading');
      if (indexBrokerContext.error) throw new Error(indexBrokerContext.error);
      for (const [value, label] of [[indexBrokerConfig.normalFeePercent, zh ? '普通买卖手续费' : 'Normal trading fee'], [indexBrokerConfig.specificFeePercent, zh ? '指定 NFT 手续费' : 'Specific NFT fee']]) {
        validatePercentage(value, label);
      }
      const selectedIndexToken = String(indexBrokerConfig.indexToken || indexBrokerContext.defaultIndexToken || '').trim();
      if (!ethers.isAddress(selectedIndexToken) || selectedIndexToken === ethers.ZeroAddress) throw new Error(zh ? '指数代币地址无效' : 'Invalid index-token address');
      const validationMatches = indexTokenValidation.token
        && indexTokenValidation.token.toLowerCase() === selectedIndexToken.toLowerCase();
      if (indexTokenValidation.loading || !validationMatches) throw new Error(zh ? '正在验证指数代币，请稍候' : 'The index token is still being verified');
      if (!indexTokenValidation.valid) throw new Error(indexTokenValidation.error || (zh ? '该指数代币无法用于当前 Factory' : 'This index token cannot be used by the current Factory'));
      if (indexBrokerConfig.officialToken === false) {
        const sourceValue = isIndexBrokerV4Source(indexBrokerConfig.sourceType)
          ? indexBrokerConfig.sourcePoolId.trim()
          : indexBrokerConfig.sourcePool.trim();
        if (indexBrokerSource.loading) throw new Error(zh ? '正在验证 DEX 价格源，请稍候' : 'The DEX price source is still being verified');
        if (indexBrokerPoolDiscovery.loading) throw new Error(zh ? '正在查找候选价格池，请稍候' : 'Candidate price pools are still loading');
        if (!sourceValue) throw new Error(zh ? '请选择一个通过支持检查的价格源池' : 'Select a supported price-source pool');
        if (!indexBrokerSource.resolved || indexBrokerSource.poolId.toLowerCase() !== sourceValue.toLowerCase()) {
          throw new Error(indexBrokerSource.error || (zh ? '该 DEX 价格池未通过验证' : 'This DEX price pool could not be verified'));
        }
      }
      try {
        encodeIndexBrokerNftPoolMeta(indexBrokerConfig, indexBrokerContext.decimals);
      } catch (error) {
        if (!zh) throw error;
        throw new Error(`配置校验失败：${error.message}`, { cause: error });
      }
      return;
    }

    if (stepKey === 'ratios') validateRatios();
  };

  const handleNextStep = () => {
    try {
      validateWizardStep(currentStep.key);
      goToWizardStep(wizardStep + 1);
    } catch (error) {
      setStepError(error.message);
      wizardBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleRatioChange = (idx, valStr) => {
    setInputRatios(prev => {
      const next = [...prev];
      next[idx] = valStr;
      return next;
    });
  };

  const getSumPercent = () => {
    return inputRatios.reduce((sum, val) => {
      const num = parseFloat(val);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  };

  const handleCreate = async () => {
    const isNFTMining = poolType === 'nft-mining';
    const isBasketTVL = poolType === 'basket-tvl';
    const isIndexBroker = poolType === 'index-broker-nft';
    if (!poolName || (!isNFTMining && !isBasketTVL && !isIndexBroker && !stakeTokenAddress)) {
      toast.error(language === 'zh' ? '请填写所有字段' : 'Please fill in all fields');
      return;
    }

    if (!isNFTMining && !isBasketTVL && !isIndexBroker && !ethers.isAddress(stakeTokenAddress)) {
      toast.error(language === 'zh' ? '代币地址无效' : 'Invalid token address');
      return;
    }

    // Convert and validate ratios
    const ratioArr = [];
    let sumVal = 0;
    for (let i = 0; i < inputRatios.length; i++) {
      const valStr = inputRatios[i];
      if (valStr === '') {
        toast.error(language === 'zh' ? '请输入所有矿池的收益比例' : 'Please enter a ratio for all pools');
        return;
      }
      const pct = parseFloat(valStr);
      if (isNaN(pct) || pct < 0) {
        toast.error(language === 'zh' ? '每个比例必须是非负数' : 'Each ratio must be a non-negative number');
        return;
      }
      // Convert percent back to uint16 PPM (0 ~ 10000)
      const ratioPPM = Math.round(pct * 100);
      ratioArr.push(ratioPPM);
      sumVal += ratioPPM;
    }

    if (sumVal !== 10000 && sumVal !== 0) {
      toast.error(language === 'zh' ? `所有比例之和必须为 100% 或 0%（当前和：${(sumVal/100).toFixed(2)}%）` : `Ratios must sum to 100% or 0% (current sum: ${(sumVal/100).toFixed(2)}%)`);
      return;
    }

    setLoading(true);
    try {
      const writeSigner = await getWriteSigner();
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, writeSigner);
      let fee = isIndexBroker ? null : await new ethers.Contract(
        contracts.Committee,
        CommitteeABI,
        readProvider,
      ).getCommunitySettingsFee();

      let factoryAddress;
      let meta;

      if (poolType === 'staking') {
        factoryAddress = contracts.ERC20StakingFactory;
        // meta: just the stake token address (20 bytes)
        meta = stakeTokenAddress.toLowerCase();
      } else if (poolType === 'locking') {
        factoryAddress = contracts.ERC20LockingFactory;
        // meta: [address stakeToken (20 bytes)][uint256 lockDuration (32 bytes)]
        if (!lockDuration || parseInt(lockDuration) <= 0) {
          toast.error(language === 'zh' ? '锁仓时长必须为正数' : 'Lock duration must be positive');
          setLoading(false);
          return;
        }
        const durationSeconds = parseInt(lockDuration) * 86400; // Convert days to seconds
        meta = stakeTokenAddress.toLowerCase() + ethers.toBeHex(durationSeconds, 32).replace('0x', '');
      } else if (poolType === 'basket-tvl') {
        factoryAddress = contracts.BasketTVLMiningPoolFactory;
        if (!factoryAddress) {
          throw new Error(language === 'zh' ? '当前网络未配置 Basket TVL 矿池工厂' : 'Basket TVL mining factory is not configured');
        }
        const selectedNftPool = activePools.find(
          pool => pool.id.toLowerCase() === basketNftMiningPool.toLowerCase()
            && pool.poolType === 'NFT_MINING'
        );
        if (!selectedNftPool) {
          throw new Error(language === 'zh' ? '请选择当前社区中已激活的 NFT 矿池' : 'Select an active NFT mining pool from this community');
        }
        const nftRewardBps = Math.round(Number(basketNftRewardPercent) * 100);
        const durationHours = Number(basketLockDurationHours);
        if (!Number.isInteger(nftRewardBps) || nftRewardBps < 0 || nftRewardBps > 10000) {
          throw new Error(language === 'zh' ? '创建者奖励分成必须在 0% 到 100% 之间' : 'Creator reward share must be between 0% and 100%');
        }
        if (!Number.isFinite(durationHours) || durationHours <= 0) {
          throw new Error(language === 'zh' ? '解锁周期必须大于 0 小时' : 'Unlock period must be greater than zero hours');
        }
        meta = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint16', 'uint256'],
          [selectedNftPool.id, nftRewardBps, Math.round(durationHours * 3600)]
        );
      } else if (poolType === 'index-broker-nft') {
        factoryAddress = contracts.IndexBrokerNFTFactory;
        if (!factoryAddress || Number(network.id) !== 56) {
          throw new Error(language === 'zh' ? '当前网络不支持 Index Broker NFT' : 'Index Broker NFT is not supported on this network');
        }
        if (indexBrokerContext.loading || indexBrokerConfig.officialToken === null) {
          throw new Error(language === 'zh' ? '正在读取创建配置，请稍后重试' : 'Creation settings are still loading');
        }
        if (ethers.toUtf8Bytes(poolName.trim()).length > 64) {
          throw new Error(language === 'zh' ? '矿池名称不能超过 64 个 UTF-8 字节' : 'Pool name cannot exceed 64 UTF-8 bytes');
        }
        if (!contracts.Multicall3) {
          throw new Error(language === 'zh' ? '当前网络未配置 Multicall3' : 'Multicall3 is not configured');
        }
        const checks = await multicallRead(readProvider, contracts.Multicall3, [
          {
            key: 'fee', target: contracts.Committee, contractInterface: COMMITTEE_INTERFACE,
            functionName: 'getCommunitySettingsFee', args: [],
          },
          {
            key: 'reserved', target: factoryAddress,
            contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
            functionName: 'reservedCollectionNameHash',
            args: [ethers.keccak256(ethers.toUtf8Bytes(poolName.trim()))],
          },
        ]);
        fee = checks.fee;
        const reserved = checks.reserved;
        if (reserved) {
          throw new Error(language === 'zh' ? '该集合名称为 Factory 保留名称' : 'This collection name is reserved by the Factory');
        }
        meta = encodeIndexBrokerNftPoolMeta(indexBrokerConfig, indexBrokerContext.decimals);
      } else {
        factoryAddress = contracts.NFTMiningPoolFactory;
        if (!factoryAddress) {
          throw new Error(language === 'zh' ? '当前网络未配置 NFT 矿池工厂' : 'NFT mining factory is not configured');
        }
        if (!nftSymbol.trim() || !ethers.isAddress(fundsReceiver)) {
          throw new Error(language === 'zh' ? '请填写 NFT Symbol 和有效收款地址' : 'Enter an NFT symbol and valid funds receiver');
        }
        if (renderer && !ethers.isAddress(renderer)) {
          throw new Error(language === 'zh' ? 'Renderer 地址无效' : 'Invalid renderer address');
        }
        const thresholds = parseIntegerList(levelThresholds);
        const weights = parseIntegerList(levelWeights);
        if (
          thresholds.length === 0 || thresholds.length !== weights.length || thresholds[0] !== 0n
          || weights[0] <= 0n || thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1])
          || weights.some((value, index) => index > 0 && value <= weights[index - 1])
        ) {
          throw new Error(language === 'zh'
            ? '等级阈值必须从 0 开始，且阈值和权重数量相同并严格递增'
            : 'Thresholds must start at 0; thresholds and weights must have equal length and strictly increase');
        }
        if (!mintPrice || Number(mintPrice) <= 0 || !batchSupply || BigInt(batchSupply) <= 0n) {
          throw new Error(language === 'zh' ? 'Mint 价格和发行量必须大于 0' : 'Mint price and supply must be greater than zero');
        }
        const referralBps = Math.round(Number(referralPercent) * 100);
        if (!Number.isInteger(referralBps) || referralBps < 0 || referralBps > 10000) {
          throw new Error(language === 'zh' ? '推荐比例必须在 0% 到 100% 之间' : 'Referral rate must be between 0% and 100%');
        }

        const paymentAddress = paymentAsset.trim() || ethers.ZeroAddress;
        if (paymentAddress !== ethers.ZeroAddress && !ethers.isAddress(paymentAddress)) {
          throw new Error(language === 'zh' ? '支付代币地址无效' : 'Invalid payment token address');
        }
        let paymentDecimals = 18;
        if (paymentAddress !== ethers.ZeroAddress) {
          const paymentToken = new ethers.Contract(paymentAddress, ['function decimals() view returns (uint8)'], readProvider);
          paymentDecimals = Number(await paymentToken.decimals());
        }
        const price = ethers.parseUnits(mintPrice, paymentDecimals);
        meta = ethers.AbiCoder.defaultAbiCoder().encode(
          ['tuple(string,address,address,uint256[],uint256[],address,uint256,uint256,uint16)'],
          [[
            nftSymbol.trim(),
            fundsReceiver,
            renderer || ethers.ZeroAddress,
            thresholds,
            weights,
            paymentAddress,
            price,
            BigInt(batchSupply),
            referralBps,
          ]]
        );
      }

      const tx = await communityContract.adminAddPool(
        poolName,
        ratioArr,
        factoryAddress,
        meta,
        { value: fee }
      );

      toast.info(t('addPool.toastCreating'));
      await tx.wait();
      draftCompletedRef.current = true;
      removeAddPoolDraft(draftStorageKey);

      // 链上已成功。注册失败只提示等索引，不能当成创建失败。
      let registration = null;
      try {
        registration = await registerMiningPool(tx.hash, network.id);
      } catch (registrationError) {
        console.error('Register mining pool failed:', registrationError);
        toast.info(t('addPool.toastWaitingIndex'));
      }

      toast.success(t('addPool.toastSuccess'));
      onSuccess?.(registration);
    } catch (err) {
      console.error('Create pool failed:', err);
      toast.error(err.reason || err.message || (language === 'zh' ? '添加矿池失败' : 'Failed to create pool'));
    } finally {
      setLoading(false);
    }
  };

  const sumPercent = getSumPercent();
  const ratioSumPpm = inputRatios.reduce((sum, value) => sum + (value === '' ? 0 : Math.round(Number(value) * 100)), 0);
  const isValidRatios = inputRatios.length === activePools.length + 1
    && inputRatios.every(value => (
      value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100
      && Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) <= 1e-8
    ))
    && (ratioSumPpm === 10_000 || ratioSumPpm === 0);
  let previewLevelCount;
  try {
    previewLevelCount = Math.max(1, Math.min(16, parseIntegerList(levelWeights).length));
  } catch {
    previewLevelCount = 16;
  }
  const previewCalculatedWeight = previewWeightForLevel(levelWeights, previewParams.level);
  const poolTypeOptions = [
    {
      value: 'staking', title: t('addPool.fieldTypeNameStaking'),
      description: zh ? '质押 ERC20 代币，并按矿池比例获得社区奖励。' : 'Stake an ERC20 token and earn community rewards according to the pool allocation.',
      enabled: Boolean(contracts.ERC20StakingFactory),
    },
    {
      value: 'locking', title: t('addPool.fieldTypeNameLocking'),
      description: zh ? '锁定 ERC20 一段时间，在锁定期间参与奖励分配。' : 'Lock an ERC20 for a configured period and participate in reward distribution.',
      enabled: Boolean(contracts.ERC20LockingFactory),
    },
    {
      value: 'index-broker-nft', title: 'Index Broker NFT',
      description: zh ? 'NFT 同时参与社区与指数挖矿，并通过专属 AMM 管理指数回购。' : 'NFTs mine community and index rewards, with a dedicated AMM for index buybacks.',
      enabled: Number(network.id) === 56 && Boolean(contracts.IndexBrokerNFTFactory),
      badge: zh ? '新版' : 'New',
    },
    {
      value: 'nft-mining', title: zh ? 'NFT 挖矿' : 'NFT Mining',
      description: zh ? '铸造 NFT，通过推荐等级和社区挖矿权重获得奖励。' : 'Mint NFTs and use referral levels and mining weight to earn community rewards.',
      enabled: Number(network.id) === 4663 || (Number(network.id) === 56 && Boolean(contracts.NFTMiningPoolFactory)),
    },
    {
      value: 'basket-tvl', title: zh ? 'Basket TVL 挖矿' : 'Basket TVL Mining',
      description: zh ? '按 Basket 持有的社区代币余额计算权重，并创建质押子池。' : 'Mine by Community Token balance held in each Basket, with an independent child staking pool.',
      enabled: Boolean(contracts.BasketTVLMiningPoolFactory),
    },
  ];
  const selectedType = poolTypeOptions.find(option => option.value === poolType);
  const selectablePoolTypes = initialPoolType
    ? poolTypeOptions
    : poolTypeOptions.filter(option => option.value !== 'index-broker-nft');
  const indexBrokerMintAccessMode = getIndexBrokerMintAccessMode(indexBrokerConfig);

  const deployFromWizard = () => {
    try {
      validateWizardStep('ratios');
      setStepError('');
      handleCreate();
    } catch (error) {
      setStepError(error.message);
      wizardBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const closeModal = () => {
    if (loading) return;
    if (draftStorageKey && !saveAddPoolDraft(draftStorageKey, draftPayload) && !draftStorageWarningRef.current) {
      draftStorageWarningRef.current = true;
      toast.error(zh
        ? '浏览器无法保存创建草稿，本次填写可能无法恢复'
        : 'The browser could not save this draft, so these inputs may not be restored.');
    }
    onClose();
  };

  return (
    <div className="modal-overlay add-pool-modal-overlay" onClick={closeModal}>
      <div className="modal-content add-pool-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="add-pool-wizard-title">
            <h2 className="modal-title">{initialPoolType === 'index-broker-nft' ? (zh ? '创建 NFT' : 'Create NFT') : (zh ? '创建矿池' : 'Create a Pool')}</h2>
            <small>{selectedType?.title || (zh ? '为社区添加新的奖励矿池' : 'Add a new reward pool to this community')}</small>
          </div>
          <button className="modal-close" type="button" onClick={closeModal} disabled={loading} aria-label={zh ? '关闭' : 'Close'}>×</button>
        </div>

        <div className="add-pool-wizard-stepper" style={{ '--wizard-step-count': visibleWizardSteps.length }}>
          {visibleWizardSteps.map((step, index) => {
            const actualIndex = index + firstWizardStep;
            return (
              <button
                type="button"
                key={step.key}
                className={`add-pool-wizard-step ${actualIndex < wizardStep ? 'is-complete' : ''} ${actualIndex === wizardStep ? 'is-current' : ''}`}
                aria-current={actualIndex === wizardStep ? 'step' : undefined}
                disabled={actualIndex >= wizardStep || loading}
                onClick={() => goToWizardStep(actualIndex)}
              >
                <span className="wizard-step-marker">{actualIndex < wizardStep ? '✓' : index + 1}</span>
                <span className="wizard-step-label">{step.label}</span>
              </button>
            );
          })}
        </div>
        <div className="add-pool-wizard-mobile-progress" style={{ '--wizard-progress': `${((visibleWizardStepIndex + 1) / visibleWizardSteps.length) * 100}%` }}>
          <div className="wizard-mobile-progress-copy">
            <strong>{currentStep.title}</strong>
            <span>{zh ? `第 ${visibleWizardStepIndex + 1}/${visibleWizardSteps.length} 步` : `Step ${visibleWizardStepIndex + 1} of ${visibleWizardSteps.length}`}</span>
          </div>
          <div className="wizard-mobile-progress-bar"><span /></div>
        </div>

        <div className="add-pool-wizard-body" ref={wizardBodyRef}>
          <div className="add-pool-wizard-panel" key={`${poolType || 'none'}-${currentStep.key}`}>
            <div className="wizard-step-intro">
              <span className="wizard-step-eyebrow">{zh ? `第 ${visibleWizardStepIndex + 1} 步，共 ${visibleWizardSteps.length} 步` : `Step ${visibleWizardStepIndex + 1} of ${visibleWizardSteps.length}`}</span>
              <h3>{currentStep.title}</h3>
              <p>{currentStep.description}</p>
            </div>
            {stepError && (
              <div className="wizard-callout is-danger" role="alert">
                <span className="wizard-callout-icon">!</span>
                <div><strong>{zh ? '请检查当前步骤' : 'Check this step'}</strong><span>{stepError}</span></div>
              </div>
            )}
            {currentStep.key === 'type' && (
              <div className="wizard-choice-grid wizard-pool-type-grid">
                {selectablePoolTypes.map(option => (
                  <button
                    type="button"
                    key={option.value}
                    className={`wizard-choice-card ${poolType === option.value ? 'is-selected' : ''}`}
                    aria-pressed={poolType === option.value}
                    disabled={!option.enabled}
                    onClick={() => {
                      setPoolType(option.value);
                      setStepError('');
                    }}
                  >
                    <strong className="wizard-choice-title">{option.title}</strong>
                    <span className="wizard-choice-description">{option.description}</span>
                    <span className="wizard-choice-badge">{option.enabled ? (option.badge || (zh ? '可创建' : 'Available')) : (zh ? '当前网络不可用' : 'Unavailable on this network')}</span>
                    <span className="wizard-choice-check">✓</span>
                  </button>
                ))}
              </div>
            )}

            {currentStep.key === 'config' && poolType !== 'basket-tvl' && (
              <div className="nft-pool-config">
                <div className="nft-pool-config-heading">
                  <strong>{selectedType?.title}</strong>
                  <span>{zh ? '这些参数会在创建后写入链上。' : 'These settings are written on-chain when the pool is created.'}</span>
                </div>
                <div className="nft-pool-form-grid">
                  <div className="input-group nft-pool-form-wide">
                    <label>{t('addPool.fieldName')}</label>
                    <input className="input" placeholder={zh ? '例如：质押 USDT 获得奖励' : 'e.g. Stake USDT for rewards'} value={poolName} onChange={e => setPoolName(e.target.value)} />
                  </div>
                  <div className="input-group nft-pool-form-wide">
                    <label>{t('addPool.fieldStakeToken')}</label>
                    <input className="input" placeholder="0x..." value={stakeTokenAddress} onChange={e => setStakeTokenAddress(e.target.value)} />
                    <div className="contract-field-feedback">{zh ? '填写用户需要质押或锁定的 ERC20 合约地址。' : 'Enter the ERC20 contract users will stake or lock.'}</div>
                  </div>
                  {poolType === 'locking' && (
                    <div className="input-group">
                      <label>{t('addPool.fieldLockDuration')}</label>
                      <input type="number" className="input" placeholder="30" value={lockDuration} onChange={e => setLockDuration(e.target.value)} min="1" step="1" />
                    </div>
                  )}
                </div>
              </div>
            )}

          {poolType === 'nft-mining' && ['nft-issuance', 'nft-referral', 'nft-renderer'].includes(currentStep.key) && (
            <div className={`nft-pool-config ${currentStep.key === 'nft-renderer' ? 'wizard-renderer-step' : ''}`}>
              <div className="nft-pool-config-heading">
                <strong>{currentStep.key === 'nft-issuance'
                  ? (zh ? 'NFT 发行配置' : 'NFT issuance')
                  : currentStep.key === 'nft-referral'
                    ? (zh ? '推荐与社区挖矿' : 'Referral and community mining')
                    : (zh ? 'Renderer 与图片模拟' : 'Renderer and image simulator')}</strong>
                <span>
                  {currentStep.key === 'nft-issuance'
                    ? (zh ? `留空支付代币表示使用 ${network.nativeCurrency.symbol}` : `Leave payment token blank to use ${network.nativeCurrency.symbol}`)
                    : currentStep.key === 'nft-referral'
                      ? (zh ? '门槛与权重必须一一对应并严格递增。' : 'Thresholds and weights must match and strictly increase.')
                      : (zh ? '模拟参数只影响预览，不会写入部署配置。' : 'Simulation parameters only affect the preview and are not deployed.')}
                </span>
              </div>
              <div className="nft-pool-form-grid">
                {currentStep.key === 'nft-issuance' && (
                  <>
                <div className="input-group nft-pool-form-wide">
                  <label>{zh ? 'NFT 合集名称' : 'NFT collection name'}</label>
                  <input className="input" placeholder={zh ? '例如：社区 NFT 矿工' : 'e.g. Community NFT Miners'} value={poolName} onChange={e => setPoolName(e.target.value)} />
                  <div className="contract-field-feedback">{zh ? '同时作为矿池展示名称，最多 64 个 UTF-8 字节。' : 'Also used as the pool display name, up to 64 UTF-8 bytes.'}</div>
                </div>
                <div className="input-group">
                  <label>NFT Symbol</label>
                  <input className="input" placeholder="e.g. NBXNFT" value={nftSymbol} onChange={e => setNftSymbol(e.target.value)} maxLength={16} />
                </div>
                <div className="input-group">
                  <label>{language === 'zh' ? '首批发行量' : 'First batch supply'}</label>
                  <input type="number" className="input" placeholder="1000" min="1" step="1" value={batchSupply} onChange={e => setBatchSupply(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>{language === 'zh' ? '支付代币（可选）' : 'Payment token (optional)'}</label>
                  <input
                    className="input"
                    placeholder={language === 'zh'
                      ? `留空使用 ${network.nativeCurrency.symbol}，或输入 0x...`
                      : `Blank for ${network.nativeCurrency.symbol}, or 0x...`}
                    value={paymentAsset}
                    onChange={e => setPaymentAsset(e.target.value)}
                  />
                  <div className={`contract-field-feedback ${paymentTokenPreview.error ? 'is-error' : 'is-success'}`}>
                    {paymentTokenPreview.loading
                      ? (language === 'zh' ? '正在读取代币...' : 'Reading token...')
                      : paymentTokenPreview.error || (
                        paymentTokenPreview.symbol
                          ? `${language === 'zh' ? '支付币种' : 'Payment symbol'}: ${paymentTokenPreview.symbol}`
                          : ''
                      )}
                  </div>
                </div>
                <div className="input-group">
                  <label>{language === 'zh' ? '单个 Mint 价格' : 'Mint price'}</label>
                  <input type="number" className="input" placeholder="0.01" min="0" step="any" value={mintPrice} onChange={e => setMintPrice(e.target.value)} />
                </div>
                  </>
                )}
                {currentStep.key === 'nft-referral' && (
                  <>
                <div className="input-group">
                  <label>{language === 'zh' ? '推荐佣金比例' : 'Referral commission'}</label>
                  <div className="input-with-suffix">
                    <input type="number" className="input" min="0" max="100" step="0.01" value={referralPercent} onChange={e => setReferralPercent(e.target.value)} />
                    <span>%</span>
                  </div>
                </div>
                <div className="input-group">
                  <label>{language === 'zh' ? 'Mint 收款地址' : 'Funds receiver'}</label>
                  <input className="input" placeholder="0x..." value={fundsReceiver} onChange={e => setFundsReceiver(e.target.value)} />
                </div>
                <div className="input-group nft-pool-form-wide">
                  <label>{language === 'zh' ? '等级推荐阈值（逗号分隔）' : 'Level thresholds (comma-separated)'}</label>
                  <input className="input" value={levelThresholds} onChange={e => setLevelThresholds(e.target.value)} />
                </div>
                <div className="input-group nft-pool-form-wide">
                  <label>{language === 'zh' ? '对应挖矿权重（逗号分隔）' : 'Mining weights (comma-separated)'}</label>
                  <input className="input" value={levelWeights} onChange={e => setLevelWeights(e.target.value)} />
                </div>
                  </>
                )}
                {currentStep.key === 'nft-renderer' && (
                  <>
                <div className="input-group nft-pool-form-wide">
                  <label>Renderer ({language === 'zh' ? '可选' : 'optional'})</label>
                  <input className="input" placeholder={language === 'zh' ? '留空使用默认链上 SVG Renderer' : 'Blank for the default on-chain SVG renderer'} value={renderer} onChange={e => setRenderer(e.target.value)} />
                </div>
                <div className="renderer-preview nft-pool-form-wide">
                  <div className="renderer-preview-copy">
                    <div>
                      <strong>{language === 'zh' ? 'Renderer 图片预览' : 'Renderer image preview'}</strong>
                      <span>
                        {rendererPreview.address
                          ? `${renderer.trim() ? (language === 'zh' ? '自定义' : 'Custom') : (language === 'zh' ? '平台默认' : 'Platform default')} · ${shortenAddress(rendererPreview.address)}`
                          : (language === 'zh' ? '正在解析 Renderer' : 'Resolving renderer')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setPreviewSeed(BigInt(ethers.hexlify(ethers.randomBytes(32))))}
                      disabled={rendererPreview.loading}
                    >
                      {language === 'zh' ? '换一个随机样例' : 'New random sample'}
                    </button>
                  </div>
                  <div className="renderer-preview-parameters">
                    <div className="input-group">
                      <label>{language === 'zh' ? 'NFT 等级' : 'NFT level'}</label>
                      <input
                        type="number"
                        className="input"
                        min="1"
                        max={previewLevelCount}
                        step="1"
                        value={previewParams.level}
                        onChange={event => setPreviewParams(value => ({ ...value, level: event.target.value }))}
                      />
                    </div>
                    <div className="input-group">
                      <label>{language === 'zh' ? '推荐数量' : 'Referral count'}</label>
                      <input
                        type="number"
                        className="input"
                        min="0"
                        step="1"
                        value={previewParams.referralCount}
                        onChange={event => setPreviewParams(value => ({ ...value, referralCount: event.target.value }))}
                      />
                    </div>
                    <div className="input-group">
                      <label>{language === 'zh' ? '批次 ID' : 'Batch ID'}</label>
                      <input
                        type="number"
                        className="input"
                        min="1"
                        step="1"
                        value={previewParams.batchId}
                        onChange={event => setPreviewParams(value => ({ ...value, batchId: event.target.value }))}
                      />
                    </div>
                    <div className="input-group">
                      <label>{language === 'zh' ? '配色' : 'Palette'}</label>
                      <select
                        className="input"
                        value={previewParams.paletteId}
                        onChange={event => setPreviewParams(value => ({ ...value, paletteId: event.target.value }))}
                      >
                        {[1, 2, 3, 4, 5, 6].map(palette => (
                          <option key={palette} value={palette}>Palette {palette}</option>
                        ))}
                      </select>
                    </div>
                    <div className="input-group">
                      <label>Token ID</label>
                      <input
                        type="number"
                        className="input"
                        min="1"
                        step="1"
                        value={previewParams.tokenId}
                        onChange={event => setPreviewParams(value => ({ ...value, tokenId: event.target.value }))}
                      />
                    </div>
                    <div className="renderer-preview-weight">
                      <span>{language === 'zh' ? '对应挖矿权重' : 'Mining weight'}</span>
                      <strong>{previewCalculatedWeight.toString()}</strong>
                    </div>
                  </div>
                  <div className="renderer-preview-stage">
                    {rendererPreview.loading ? (
                      <div className="renderer-preview-status">
                        <span className="spinner" />
                        {language === 'zh' ? '正在从链上生成图片...' : 'Generating image on-chain...'}
                      </div>
                    ) : rendererPreview.error ? (
                      <div className="renderer-preview-status is-error">{rendererPreview.error}</div>
                    ) : rendererPreview.image ? (
                      <img src={rendererPreview.image} alt={language === 'zh' ? 'Renderer 随机 NFT 预览' : 'Random NFT renderer preview'} />
                    ) : null}
                  </div>
                </div>
                  </>
                )}
              </div>
            </div>
          )}

          {poolType === 'basket-tvl' && currentStep.key === 'config' && (
            <div className="nft-pool-config">
              <div className="nft-pool-config-heading">
                <strong>{language === 'zh' ? 'Basket TVL 挖矿配置' : 'Basket TVL mining configuration'}</strong>
                <span>
                  {language === 'zh'
                    ? 'Basket 按合约持有的社区代币余额获得挖矿权重；每个 Basket 会创建独立质押子池'
                    : 'Baskets mine by the Community Token balance held by each Basket contract; each Basket gets an independent staking pool'}
                </span>
              </div>
              <div className="nft-pool-form-grid">
                <div className="input-group nft-pool-form-wide">
                  <label>{t('addPool.fieldName')}</label>
                  <input className="input" placeholder={zh ? '例如：Basket TVL 奖励' : 'e.g. Basket TVL Rewards'} value={poolName} onChange={event => setPoolName(event.target.value)} />
                </div>
                <div className="input-group nft-pool-form-wide">
                  <label>{language === 'zh' ? '绑定 NFT 矿池' : 'Linked NFT mining pool'}</label>
                  <select
                    className="input"
                    value={basketNftMiningPool}
                    onChange={event => setBasketNftMiningPool(event.target.value)}
                  >
                    <option value="">{language === 'zh' ? '请选择已激活的 NFT 矿池' : 'Select an active NFT mining pool'}</option>
                    {activePools.filter(item => item.poolType === 'NFT_MINING').map(item => (
                      <option key={item.id} value={item.id}>{item.name || shortenAddress(item.id)}</option>
                    ))}
                  </select>
                  {activePools.every(item => item.poolType !== 'NFT_MINING') && (
                    <div className="contract-field-feedback is-error">
                      {language === 'zh'
                        ? '请先在本社区创建并激活 NFT 挖矿矿池'
                        : 'Create and activate an NFT mining pool in this community first'}
                    </div>
                  )}
                </div>
                <div className="input-group">
                  <div className="basket-reward-label">
                    {language === 'zh' ? '创建者奖励分成' : 'Creator reward share'}
                    <button
                      type="button"
                      className="basket-reward-info-trigger"
                      onClick={() => setShowBasketRewardInfo(value => !value)}
                      aria-label={language === 'zh' ? '查看创建者奖励分成说明' : 'View creator reward share explanation'}
                      aria-expanded={showBasketRewardInfo}
                    >
                      ⓘ
                    </button>
                    {showBasketRewardInfo && (
                      <span className="basket-reward-info-popover" role="tooltip">
                        <button
                          type="button"
                          className="basket-reward-info-close"
                          onClick={() => setShowBasketRewardInfo(false)}
                          aria-label={language === 'zh' ? '关闭说明' : 'Close explanation'}
                        >
                          ×
                        </button>
                        <strong>{language === 'zh' ? '创建者奖励分成说明' : 'Creator reward share'}</strong>
                        <span>
                          {language === 'zh'
                            ? '该比例表示从矿池挖矿奖励中分配给 Basket 创建者激励的份额，其余奖励分配给 Basket Token 质押者。该份额的领取权由创建子池时绑定的 NFT 承载，实际归属以该 NFT 的当前持有人为准，并随 NFT 转让而转移，并非永久归属于最初的 Basket 创建者。'
                            : 'This percentage is the portion of mining rewards allocated as the Basket creator incentive; the remainder goes to Basket Token stakers. Entitlement to this share is represented by the NFT linked when the child pool is created. It belongs to the NFT’s current holder and transfers with the NFT, rather than remaining permanently assigned to the original Basket creator.'}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="input-with-suffix">
                    <input
                      type="number"
                      className="input"
                      min="0"
                      max="100"
                      step="0.01"
                      value={basketNftRewardPercent}
                      onChange={event => setBasketNftRewardPercent(event.target.value)}
                    />
                    <span>%</span>
                  </div>
                </div>
                <div className="input-group">
                  <div className="basket-reward-label">
                    {language === 'zh' ? '退出解锁周期（小时）' : 'Unstake unlock period (hours)'}
                    <button
                      type="button"
                      className="basket-reward-info-trigger"
                      onClick={() => setShowBasketUnlockInfo(value => !value)}
                      aria-label={language === 'zh' ? '查看退出解锁周期说明' : 'View unstake unlock period explanation'}
                      aria-expanded={showBasketUnlockInfo}
                    >
                      ⓘ
                    </button>
                    {showBasketUnlockInfo && (
                      <span className="basket-reward-info-popover basket-reward-info-popover-right" role="tooltip">
                        <button
                          type="button"
                          className="basket-reward-info-close"
                          onClick={() => setShowBasketUnlockInfo(false)}
                          aria-label={language === 'zh' ? '关闭说明' : 'Close explanation'}
                        >
                          ×
                        </button>
                        <strong>{language === 'zh' ? '退出解锁周期说明' : 'Unstake unlock period'}</strong>
                        <span>
                          {language === 'zh'
                            ? '退出质押后，Basket Token 会在设定的小时周期内线性解锁；已解锁部分可随时赎回。'
                            : 'After unstaking, Basket Tokens unlock linearly over the configured number of hours; the unlocked portion can be redeemed at any time.'}
                        </span>
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    className="input"
                    min="1"
                    step="1"
                    value={basketLockDurationHours}
                    onChange={event => setBasketLockDurationHours(event.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {poolType === 'index-broker-nft' && ['template', 'identity', 'mint', 'rewards', 'renderer', 'amm'].includes(currentStep.key) && (
            <>
              <IndexBrokerNFTPoolFields
                section={currentStep.key}
                config={indexBrokerConfig}
                onChange={updater => {
                  setIndexBrokerConfig(updater);
                  setStepError('');
                }}
                language={language}
                tokenInfo={indexBrokerContext}
                loadingContext={indexBrokerContext.loading}
                sourceResolution={indexBrokerSource}
                poolDiscovery={indexBrokerPoolDiscovery}
                onRetryPoolDiscovery={() => setIndexBrokerPoolDiscoveryNonce(value => value + 1)}
                sourceCapabilities={{
                  pancakeV2: Boolean(contracts.PancakeV2Factory),
                  pancakeV3: Boolean(contracts.PancakeV3Factory),
                  uniswapV4: Boolean(contracts.UniswapV4Manager),
                  pancakeV4Cl: Boolean(contracts.PancakeV4CLManager),
                }}
                sourceFactories={{
                  pancakeV2: contracts.PancakeV2Factory,
                  pancakeV3: contracts.PancakeV3Factory,
                }}
                poolName={poolName}
                onPoolNameChange={setPoolName}
                readProvider={readProvider}
                multicallAddress={contracts.Multicall3}
                templateAddresses={{
                  burn: contracts.IndexBrokerNFTBurnTemplate,
                  stake: contracts.IndexBrokerNFTStakeTemplate,
                }}
                defaultPreviewExpanded={currentStep.key === 'renderer'}
                onRendererStatusChange={setIndexBrokerRendererStatus}
                indexTokenValidation={indexTokenValidation}
                stakeTokenValidation={stakeTokenValidation}
              />
              {indexBrokerContext.error && (
                <div className="contract-field-feedback is-error">{indexBrokerContext.error}</div>
              )}
            </>
          )}

          {currentStep.key === 'ratios' && (
            <div className="wizard-confirm-grid">
          <div className="pool-ratio-panel">
            <div className="pool-ratio-heading">
              <h3>{t('addPool.ratioSectionTitle')}</h3>
              <p>{t('addPool.ratioSectionDesc')}</p>
            </div>
            
            <div className="pool-ratio-list">
              {/* Existing Pools Inputs */}
              {activePools.map((pool, idx) => (
                <div key={pool.id || idx} className="pool-ratio-row">
                  <div className="pool-ratio-info">
                    <span className="pool-ratio-name">
                      {pool.name || `Pool #${idx + 1}`}
                    </span>
                    <div className="pool-ratio-meta">
                      <span className={getPoolTypeBadgeClass(pool.poolType)} style={{ fontSize: '10px', padding: '1px 6px', height: 'auto', lineHeight: 'normal' }}>
                        {getPoolTypeLabel(pool.poolType)}
                      </span>
                      <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.8, color: 'var(--color-primary)', fontWeight: 500 }}>
                        {t('addPool.ratioCurrentLabel')}: {((pool.ratio || 0) / 100).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <div className="pool-ratio-control">
                    <input
                      type="number"
                      className="input"
                      value={inputRatios[idx] !== undefined ? inputRatios[idx] : ''}
                      onChange={e => handleRatioChange(idx, e.target.value)}
                      style={{ textAlign: 'right', paddingRight: 'var(--space-2)' }}
                      placeholder="0"
                      min="0"
                      max="100"
                      step="0.01"
                      disabled={loading}
                    />
                    <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>%</span>
                  </div>
                </div>
              ))}

              {/* New Pool Input */}
              <div className="pool-ratio-row is-new">
                <div className="pool-ratio-info">
                  <span className="pool-ratio-name">
                    ✨ {poolName || t('addPool.ratioNewPoolLabel')}
                  </span>
                  <span className="badge badge-active" style={{ fontSize: '10px', padding: '1px 6px', height: 'auto', lineHeight: 'normal', background: 'var(--color-success)', color: '#fff' }}>
                    {poolType === 'staking'
                      ? 'Staking'
                      : poolType === 'locking'
                        ? 'Locking'
                        : poolType === 'nft-mining'
                          ? 'NFT Mining'
                          : poolType === 'basket-tvl'
                            ? 'Basket TVL Mining'
                            : 'Index Broker NFT'}
                  </span>
                </div>
                <div className="pool-ratio-control">
                  <input
                    type="number"
                    className="input"
                    value={inputRatios[activePools.length] !== undefined ? inputRatios[activePools.length] : ''}
                    onChange={e => handleRatioChange(activePools.length, e.target.value)}
                    style={{ textAlign: 'right', paddingRight: 'var(--space-2)', border: '1px solid rgba(16, 185, 129, 0.3)' }}
                    placeholder="0"
                    min="0"
                    max="100"
                    step="0.01"
                    disabled={loading}
                  />
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>%</span>
                </div>
              </div>
            </div>

            <div className={`pool-ratio-total ${isValidRatios ? 'is-valid' : 'is-invalid'}`}>
              <span>{t('addPool.ratioTotalSumLabel')}</span>
              <strong>{sumPercent.toFixed(2)}%</strong>
            </div>
          </div>

              <div className="wizard-summary-card">
                <div className="wizard-summary-heading">
                  <h3>{zh ? '部署摘要' : 'Deployment summary'}</h3>
                  <p>{zh ? '请在钱包确认前再次核对关键配置。' : 'Review the key settings before confirming in your wallet.'}</p>
                </div>
                <div className="wizard-summary-list">
                  <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '矿池类型' : 'Pool type'}</span><span className="wizard-summary-value">{selectedType?.title}</span></div>
                  <div className="wizard-summary-row"><span className="wizard-summary-label">{poolType === 'index-broker-nft' ? (zh ? 'NFT 合集' : 'NFT collection') : (zh ? '矿池名称' : 'Pool name')}</span><span className="wizard-summary-value">{poolName || '—'}</span></div>
                  {poolType === 'index-broker-nft' && (
                    <>
                      <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '指数挖矿模板' : 'Index template'}</span><span className="wizard-summary-value">{indexBrokerConfig.miningMode === INDEX_BROKER_MINING_MODES.STAKE ? 'Stake' : 'Burn'}</span></div>
                      <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '最大供应量' : 'Maximum supply'}</span><span className="wizard-summary-value">{indexBrokerConfig.maxSupply || '—'}</span></div>
                      <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '每枚 NFT 的社区代币价格' : 'Community Token price per NFT'}</span><span className="wizard-summary-value">{indexBrokerConfig.communityTokenPrice || '—'} {indexBrokerContext.symbol}</span></div>
                      <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '公开铸造价格' : 'Public mint price'}</span><span className="wizard-summary-value">{indexBrokerMintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.WHITELIST_ONLY ? '0' : (indexBrokerConfig.nativePrice || '0')} BNB</span></div>
                      <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '铸造准入' : 'Mint access'}</span><span className="wizard-summary-value">{indexBrokerMintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.OPEN ? (zh ? '公开 Mint（无需白名单）' : 'Open mint (no whitelist)') : indexBrokerMintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.WHITELIST_ONLY ? (zh ? '纯白名单 Mint' : 'Whitelist-only mint') : (zh ? '公开 + 白名单混用' : 'Public + whitelist')}</span></div>
                      {indexBrokerMintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.MIXED && (
                        <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '白名单供应' : 'Whitelist supply'}</span><span className="wizard-summary-value">{indexBrokerConfig.lockWhitelistSlots ? (zh ? '保留额度' : 'Reserved') : (zh ? '不保留额度' : 'Not reserved')}</span></div>
                      )}
                      <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '推荐返佣' : 'Referral commission'}</span><span className="wizard-summary-value">{indexBrokerMintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.WHITELIST_ONLY ? '0' : (indexBrokerConfig.referralPercent || '0')}%</span></div>
                      <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '公开铸造收款' : 'Public mint receiver'}</span><span className="wizard-summary-value">{!indexBrokerConfig.fundsReceiver.trim() || indexBrokerConfig.fundsReceiver.toLowerCase() === ethers.ZeroAddress.toLowerCase() ? (zh ? '专属 AMM 回购池' : 'Dedicated AMM buyback pool') : shortenAddress(indexBrokerConfig.fundsReceiver)}</span></div>
                      <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '图片重生成' : 'Image rerolls'}</span><span className="wizard-summary-value">{indexBrokerConfig.rerollEnabled ? `${zh ? '启用' : 'Enabled'} · ${Number(indexBrokerConfig.recommitPrice || 0) === 0 ? indexBrokerConfig.communityTokenPrice : indexBrokerConfig.recommitPrice} ${indexBrokerContext.symbol}` : (zh ? '关闭' : 'Disabled')}</span></div>
                      <div className="wizard-summary-row"><span className="wizard-summary-label">AMM</span><span className="wizard-summary-value">{zh ? '普通' : 'Normal'} {effectiveAmmFee(indexBrokerConfig.normalFeePercent)}% · {zh ? '指定' : 'Specific'} {effectiveAmmFee(indexBrokerConfig.specificFeePercent)}%</span></div>
                      {indexBrokerConfig.officialToken === false && (
                        <div className="wizard-summary-row">
                          <span className="wizard-summary-label">{zh ? '价格源池' : 'Price-source pool'}</span>
                          <span className="wizard-summary-value">
                            {Number(indexBrokerConfig.sourceType) === INDEX_BROKER_SOURCE_TYPES.V2_PAIR
                              ? 'Pancake V2'
                              : Number(indexBrokerConfig.sourceType) === INDEX_BROKER_SOURCE_TYPES.V3_POOL
                                ? 'Pancake V3'
                                : 'Pancake V4 CL'} · {shortenAddress(isIndexBrokerV4Source(indexBrokerConfig.sourceType) ? indexBrokerConfig.sourcePoolId : indexBrokerConfig.sourcePool)}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {poolType === 'nft-mining' && (
                    <>
                      <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '首批发行量' : 'First batch supply'}</span><span className="wizard-summary-value">{batchSupply || '—'}</span></div>
                      <div className="wizard-summary-row"><span className="wizard-summary-label">{zh ? '铸造价格' : 'Mint price'}</span><span className="wizard-summary-value">{mintPrice || '—'} {paymentTokenPreview.symbol || network.nativeCurrency.symbol}</span></div>
                    </>
                  )}
                </div>
                {settingsFee !== null && settingsFee > 0n && (
                  <div className="wizard-operation-fee">{t('addPool.operationFee', { fee: ethers.formatEther(settingsFee), symbol: network.nativeCurrency.symbol })}</div>
                )}
              </div>
            </div>
          )}
          </div>
        </div>

        <div className="add-pool-wizard-actions">
          <div className="wizard-action-copy">
            <strong>{currentStep.title}</strong>
            <span>{zh ? `第 ${visibleWizardStepIndex + 1} 步，共 ${visibleWizardSteps.length} 步` : `Step ${visibleWizardStepIndex + 1} of ${visibleWizardSteps.length}`}</span>
          </div>
          <div className="wizard-action-buttons">
            <button type="button" className="btn btn-ghost" onClick={() => goToWizardStep(wizardStep - 1)} disabled={wizardStep === firstWizardStep || loading}>
              {zh ? '上一步' : 'Back'}
            </button>
            {wizardStep === wizardSteps.length - 1 ? (
              <button type="button" className={`btn ${isValidRatios ? 'btn-primary' : 'btn-secondary'}`} onClick={deployFromWizard} disabled={loading || !isValidRatios}>
                {loading ? <><span className="spinner" /> {zh ? '创建中…' : 'Creating…'}</> : (zh ? '确认并部署' : 'Confirm & Deploy')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={handleNextStep} disabled={loading}>
                {zh ? '下一步' : 'Next'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
