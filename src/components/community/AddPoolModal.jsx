import { useState, useEffect } from 'react';
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
import { registerBasketMiningPool } from '../../config/subgraph';
import IndexBrokerNFTPoolFields from './IndexBrokerNFTPoolFields';
import {
  DEFAULT_INDEX_BROKER_CONFIG,
  encodeIndexBrokerNftPoolMeta,
  getIndexBrokerV4PoolId,
  INDEX_BROKER_SOURCE_TYPES,
  isIndexBrokerV4Source,
} from '../../utils/indexBrokerNft';
import { multicallRead } from '../../utils/multicall';

const COMMITTEE_INTERFACE = new ethers.Interface(CommitteeABI);
const ERC20_INTERFACE = new ethers.Interface(ERC20ABI);
const INDEX_BROKER_FACTORY_INTERFACE = new ethers.Interface(IndexBrokerNFTFactoryABI);
const PANCAKE_V4_CL_MANAGER_INTERFACE = new ethers.Interface(PancakeV4CLPoolManagerABI);
const PUMP_INTERFACE = new ethers.Interface(PumpABI);
const PUMP_TOKEN_INTERFACE = new ethers.Interface(PumpTokenABI);

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

export default function AddPoolModal({ communityAddress, communityTokenAddress, activePools, onClose, onSuccess }) {
  const { t, language } = useLanguage();
  const { account, signer, readProvider, contracts, network } = useWeb3();
  const toast = useToast();

  const [poolType, setPoolType] = useState('staking');
  const [poolName, setPoolName] = useState('');
  const [stakeTokenAddress, setStakeTokenAddress] = useState('');
  const [lockDuration, setLockDuration] = useState('');
  const [nftSymbol, setNftSymbol] = useState('');
  const [fundsReceiver, setFundsReceiver] = useState(account || '');
  const [renderer, setRenderer] = useState('');
  const [levelThresholds, setLevelThresholds] = useState('0, 2, 4, 6');
  const [levelWeights, setLevelWeights] = useState('10000, 12000, 15000, 20000');
  const [paymentAsset, setPaymentAsset] = useState('');
  const [mintPrice, setMintPrice] = useState('');
  const [batchSupply, setBatchSupply] = useState('');
  const [referralPercent, setReferralPercent] = useState('10');
  const [basketNftMiningPool, setBasketNftMiningPool] = useState('');
  const [basketNftRewardPercent, setBasketNftRewardPercent] = useState('10');
  const [basketLockDurationHours, setBasketLockDurationHours] = useState('30');
  const [showBasketRewardInfo, setShowBasketRewardInfo] = useState(false);
  const [showBasketUnlockInfo, setShowBasketUnlockInfo] = useState(false);
  const [paymentTokenPreview, setPaymentTokenPreview] = useState({ loading: false, symbol: '', error: '' });
  const [rendererPreview, setRendererPreview] = useState({ loading: false, image: '', address: '', error: '' });
  const [previewSeed, setPreviewSeed] = useState(() => BigInt(ethers.hexlify(ethers.randomBytes(32))));
  const [previewParams, setPreviewParams] = useState({
    tokenId: '1',
    referralCount: '0',
    level: '1',
    batchId: '1',
    paletteId: '1',
  });
  const [inputRatios, setInputRatios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [settingsFee, setSettingsFee] = useState(null);
  const [indexBrokerConfig, setIndexBrokerConfig] = useState(() => ({
    ...DEFAULT_INDEX_BROKER_CONFIG,
    fundsReceiver: account || '',
  }));
  const [indexBrokerContext, setIndexBrokerContext] = useState({
    loading: false,
    symbol: '',
    decimals: 18,
    defaultRenderer: '',
    pumpListed: null,
    pumpPoolId: '',
    pumpPoolManager: '',
    error: '',
  });
  const [indexBrokerSource, setIndexBrokerSource] = useState({
    loading: false,
    resolved: false,
    poolId: '',
    error: '',
    details: null,
  });

  // Load operation fee on mount
  useEffect(() => {
    if (!readProvider) return;
    const committeeContract = new ethers.Contract(contracts.Committee, [
      'function getCommunitySettingsFee() view returns (uint256)',
    ], readProvider);
    committeeContract.getCommunitySettingsFee().then(fee => setSettingsFee(fee)).catch(() => {});
  }, [readProvider, contracts]);

  // Initialize pool ratios to empty strings when activePools changes
  useEffect(() => {
    if (!activePools) return;
    const numPools = activePools.length + 1;
    setInputRatios(Array(numPools).fill(''));
  }, [activePools]);

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
        key: 'defaultRenderer', target: contracts.IndexBrokerNFTFactory,
        contractInterface: INDEX_BROKER_FACTORY_INTERFACE,
        functionName: 'defaultRenderer', args: [],
      },
    ]).then(({ symbol, decimals, officialToken, defaultIndexToken, defaultRenderer, pumpListed, pumpPoolId, pumpPoolManager }) => {
      if (cancelled) return;
      setIndexBrokerContext({
        loading: false,
        symbol,
        decimals: Number(decimals),
        defaultRenderer,
        pumpListed: officialToken ? Boolean(pumpListed) : null,
        pumpPoolId: officialToken && pumpListed ? String(pumpPoolId || '') : '',
        pumpPoolManager: officialToken ? String(pumpPoolManager || '') : '',
        error: '',
      });
      setIndexBrokerConfig(current => ({
        ...current,
        officialToken,
        fundsReceiver: current.fundsReceiver || account || '',
        indexToken: current.indexToken || defaultIndexToken,
      }));
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
    contracts.Multicall3,
    contracts.Pump,
    language,
    poolType,
    readProvider,
  ]);

  useEffect(() => {
    const sourceType = Number(indexBrokerConfig.sourceType);
    const poolId = indexBrokerConfig.sourcePoolId.trim();
    if (
      poolType !== 'index-broker-nft'
      || indexBrokerConfig.officialToken !== false
      || !isIndexBrokerV4Source(sourceType)
    ) {
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
        const quoteCurrencies = new Set([
          ethers.ZeroAddress.toLowerCase(),
          ...(contracts.WBNB ? [contracts.WBNB.toLowerCase()] : []),
        ]);
        const tokenIndex = currencies.indexOf(token);
        if (tokenIndex < 0 || !quoteCurrencies.has(currencies[tokenIndex === 0 ? 1 : 0])) {
          throw new Error(language === 'zh'
            ? '该池必须是当前社区代币与 BNB/WBNB 的交易池'
            : 'The pool must pair this Community Token with BNB/WBNB');
        }
        if (BigInt(result.slot0.sqrtPriceX96 ?? result.slot0[0] ?? 0) === 0n || BigInt(result.liquidity || 0) === 0n) {
          throw new Error(language === 'zh' ? '该池尚未初始化或没有流动性' : 'The pool is not initialized or has no liquidity');
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
    if (poolType !== 'basket-tvl' || basketNftMiningPool) return;
    const nftPool = activePools.find(pool => pool.poolType === 'NFT_MINING');
    if (nftPool) setBasketNftMiningPool(nftPool.id);
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
    if (!signer || !poolName || (!isNFTMining && !isBasketTVL && !isIndexBroker && !stakeTokenAddress)) {
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
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, signer);
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
      const receipt = await tx.wait();

      let registration = null;
      if (poolType === 'basket-tvl') {
        try {
          registration = await registerBasketMiningPool(tx.hash, network.id);
        } catch (registrationError) {
          console.error('Register Basket TVL pool failed:', registrationError);
          toast.info(language === 'zh'
            ? '矿池已在链上创建，后台索引完成后会自动显示'
            : 'The pool was created on-chain and will appear after indexing');
        }
      } else if (poolType === 'index-broker-nft') {
        const factoryInterface = new ethers.Interface(IndexBrokerNFTFactoryABI);
        const created = receipt.logs
          .filter(log => log.address.toLowerCase() === contracts.IndexBrokerNFTFactory.toLowerCase())
          .map(log => {
            try { return factoryInterface.parseLog(log); } catch { return null; }
          })
          .find(parsed => parsed?.name === 'IndexBrokerNFTCreated');
        if (created) {
          const createdPool = created.args.pool;
          registration = {
            source: 'transaction-receipt',
            pool: {
              id: createdPool,
              index: null,
              poolIndex: null,
              name: created.args.name || poolName,
              status: 'OPENED',
              poolType: 'INDEX_BROKER_NFT',
              totalAmount: '0',
              asset: communityTokenAddress,
              ratio: ratioArr[ratioArr.length - 1],
              stakersCount: 0,
              lockDuration: null,
              poolFactory: contracts.IndexBrokerNFTFactory,
              createdAt: null,
            },
            ratios: [
              ...activePools.map((pool, index) => ({ pool: pool.id, ratio: ratioArr[index] })),
              { pool: createdPool, ratio: ratioArr[ratioArr.length - 1] },
            ],
          };
        }
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
  const isValidRatios = Math.abs(sumPercent - 100) < 0.001 || sumPercent === 0;
  let previewLevelCount;
  try {
    previewLevelCount = Math.max(1, Math.min(16, parseIntegerList(levelWeights).length));
  } catch {
    previewLevelCount = 16;
  }
  const previewCalculatedWeight = previewWeightForLevel(levelWeights, previewParams.level);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content add-pool-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{t('addPool.title')}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Pool Type */}
          <div className="input-group">
            <label>{t('addPool.fieldType')}</label>
            <select className="input" value={poolType} onChange={e => setPoolType(e.target.value)}>
              <option value="staking">{t('addPool.fieldTypeNameStaking')}</option>
              <option value="locking">{t('addPool.fieldTypeNameLocking')}</option>
              {(Number(network.id) === 4663
                || (Number(network.id) === 56 && contracts.NFTMiningPoolFactory)) && (
                <option value="nft-mining">{language === 'zh' ? 'NFT 挖矿' : 'NFT Mining'}</option>
              )}
              {contracts.BasketTVLMiningPoolFactory && (
                <option value="basket-tvl">{language === 'zh' ? 'Basket TVL 挖矿' : 'Basket TVL Mining'}</option>
              )}
              {Number(network.id) === 56 && contracts.IndexBrokerNFTFactory && (
                <option value="index-broker-nft">Index Broker NFT</option>
              )}
            </select>
          </div>

          {/* Pool Name */}
          <div className="input-group">
            <label>{t('addPool.fieldName')}</label>
            <input
              className="input"
              placeholder="e.g. Stake USDT for rewards"
              value={poolName}
              onChange={e => setPoolName(e.target.value)}
            />
          </div>

          {poolType !== 'nft-mining' && poolType !== 'basket-tvl' && poolType !== 'index-broker-nft' && (
            <div className="input-group">
              <label>{t('addPool.fieldStakeToken')}</label>
              <input
                className="input"
                placeholder="0x..."
                value={stakeTokenAddress}
                onChange={e => setStakeTokenAddress(e.target.value)}
              />
            </div>
          )}

          {/* Lock Duration (only for locking) */}
          {poolType === 'locking' && (
            <div className="input-group">
              <label>{t('addPool.fieldLockDuration')}</label>
              <input
                type="number"
                className="input"
                placeholder="e.g. 30"
                value={lockDuration}
                onChange={e => setLockDuration(e.target.value)}
                min="1"
              />
            </div>
          )}

          {poolType === 'nft-mining' && (
            <div className="nft-pool-config">
              <div className="nft-pool-config-heading">
                <strong>{language === 'zh' ? 'NFT 发行配置' : 'NFT issuance'}</strong>
                <span>
                  {language === 'zh'
                    ? `留空支付代币表示使用 ${network.nativeCurrency.symbol}`
                    : `Leave payment token blank to use ${network.nativeCurrency.symbol}`}
                </span>
              </div>
              <div className="nft-pool-form-grid">
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
                <div className="input-group">
                  <label>{language === 'zh' ? '推荐佣金比例' : 'Referral commission'}</label>
                  <div className="input-with-suffix">
                    <input type="number" className="input" min="0" max="100" step="0.1" value={referralPercent} onChange={e => setReferralPercent(e.target.value)} />
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
              </div>
            </div>
          )}

          {poolType === 'basket-tvl' && (
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
                      step="0.1"
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

          {poolType === 'index-broker-nft' && (
            <>
              <IndexBrokerNFTPoolFields
                config={indexBrokerConfig}
                onChange={setIndexBrokerConfig}
                language={language}
                tokenInfo={indexBrokerContext}
                loadingContext={indexBrokerContext.loading}
                sourceResolution={indexBrokerSource}
                sourceCapabilities={{
                  uniswapV4: Boolean(contracts.UniswapV4Manager),
                  pancakeV4Cl: Boolean(contracts.PancakeV4CLManager),
                }}
                poolName={poolName}
                readProvider={readProvider}
              />
              {indexBrokerContext.error && (
                <div className="contract-field-feedback is-error">{indexBrokerContext.error}</div>
              )}
            </>
          )}

          {/* Pool Ratios Section */}
          <div className="glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
              {t('addPool.ratioSectionTitle')}
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6, marginBottom: 'var(--space-4)', lineHeight: 1.4 }}>
              {t('addPool.ratioSectionDesc')}
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Existing Pools Inputs */}
              {activePools.map((pool, idx) => (
                <div key={pool.id || idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {pool.name || `Pool #${idx + 1}`}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: '2px' }}>
                      <span className={getPoolTypeBadgeClass(pool.poolType)} style={{ fontSize: '10px', padding: '1px 6px', height: 'auto', lineHeight: 'normal' }}>
                        {getPoolTypeLabel(pool.poolType)}
                      </span>
                      <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.8, color: 'var(--color-primary)', fontWeight: 500 }}>
                        {t('addPool.ratioCurrentLabel')}: {((pool.ratio || 0) / 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', width: 120 }}>
                    <input
                      type="number"
                      className="input"
                      value={inputRatios[idx] !== undefined ? inputRatios[idx] : ''}
                      onChange={e => handleRatioChange(idx, e.target.value)}
                      style={{ textAlign: 'right', paddingRight: 'var(--space-2)' }}
                      placeholder="0"
                      min="0"
                      max="100"
                      step="0.1"
                      disabled={loading}
                    />
                    <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>%</span>
                  </div>
                </div>
              ))}

              {/* New Pool Input */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-3)', background: 'rgba(16, 185, 129, 0.03)', border: '1px solid rgba(16, 185, 129, 0.1)', borderRadius: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, display: 'block', color: 'var(--color-success)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', width: 120 }}>
                  <input
                    type="number"
                    className="input"
                    value={inputRatios[activePools.length] !== undefined ? inputRatios[activePools.length] : ''}
                    onChange={e => handleRatioChange(activePools.length, e.target.value)}
                    style={{ textAlign: 'right', paddingRight: 'var(--space-2)', border: '1px solid rgba(16, 185, 129, 0.3)' }}
                    placeholder="0"
                    min="0"
                    max="100"
                    step="0.1"
                    disabled={loading}
                  />
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>%</span>
                </div>
              </div>
            </div>

            {/* Total Sum Indicator */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3)',
              borderRadius: 'var(--border-radius-md)',
              background: isValidRatios ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: `1px solid ${isValidRatios ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
              marginTop: 'var(--space-4)'
            }}>
              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{t('addPool.ratioTotalSumLabel')}</span>
              <span style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 700,
                color: isValidRatios ? 'var(--color-success)' : 'var(--color-danger)'
              }}>
                {sumPercent.toFixed(1)}%
              </span>
            </div>
          </div>

          {settingsFee !== null && settingsFee > 0n && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', padding: 'var(--space-3)', background: 'var(--color-bg-glass)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
              {t('addPool.operationFee', { fee: ethers.formatEther(settingsFee), symbol: network.nativeCurrency.symbol })}
            </div>
          )}

          <button
            className={`btn ${isValidRatios ? 'btn-primary' : 'btn-ghost'} btn-lg`}
            onClick={handleCreate}
            disabled={
              loading || !poolName || !isValidRatios
              || (poolType !== 'nft-mining' && poolType !== 'basket-tvl' && poolType !== 'index-broker-nft' && !stakeTokenAddress)
              || (poolType === 'nft-mining' && (
                !nftSymbol || !fundsReceiver || !mintPrice || !batchSupply || !contracts.NFTMiningPoolFactory
                || paymentTokenPreview.loading || rendererPreview.loading
                || Boolean(paymentTokenPreview.error) || Boolean(rendererPreview.error)
              ))
              || (poolType === 'basket-tvl' && (
                !basketNftMiningPool || !basketLockDurationHours || !contracts.BasketTVLMiningPoolFactory
              ))
              || (poolType === 'index-broker-nft' && (
                indexBrokerContext.loading || Boolean(indexBrokerContext.error)
                || indexBrokerConfig.officialToken === null
                || !indexBrokerConfig.symbol || !indexBrokerConfig.fundsReceiver
                || !indexBrokerConfig.communityTokenPrice
                || !indexBrokerConfig.indexMiningActivationTokenAmount
                || !indexBrokerConfig.maxSupply || !indexBrokerConfig.whitelist
                || !contracts.IndexBrokerNFTFactory
                || (
                  indexBrokerConfig.officialToken === false
                  && isIndexBrokerV4Source(indexBrokerConfig.sourceType)
                  && (
                    indexBrokerSource.loading || !indexBrokerSource.resolved
                    || indexBrokerSource.poolId.toLowerCase() !== indexBrokerConfig.sourcePoolId.trim().toLowerCase()
                  )
                )
              ))
            }
            style={{ width: '100%' }}
          >
            {loading ? (
              <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {language === 'zh' ? '创建中...' : 'Creating...'}</>
            ) : (
              t('addPool.btnCreate')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
