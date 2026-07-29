import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import {
  CommunityABI,
  NFTMiningPoolFactoryABI,
  NFTMiningRendererABI,
} from '../../config/abis';
import { getPoolTypeLabel, getPoolTypeBadgeClass, shortenAddress } from '../../utils/helpers';
import { useLanguage } from '../../contexts/LanguageContext';

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

export default function AddPoolModal({ communityAddress, activePools, onClose, onSuccess }) {
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
    if (!signer || !poolName || (!isNFTMining && !stakeTokenAddress)) {
      toast.error(language === 'zh' ? '请填写所有字段' : 'Please fill in all fields');
      return;
    }

    if (!isNFTMining && !ethers.isAddress(stakeTokenAddress)) {
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
      const committeeContract = new ethers.Contract(contracts.Committee, [
        'function getCommunitySettingsFee() view returns (uint256)',
      ], readProvider);

      const fee = await committeeContract.getCommunitySettingsFee();

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
      toast.success(t('addPool.toastSuccess'));
      onSuccess?.();
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
      <div className="modal-content" onClick={e => e.stopPropagation()}>
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
              {Number(network.id) === 4663 && (
                <option value="nft-mining">{language === 'zh' ? 'NFT 挖矿' : 'NFT Mining'}</option>
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

          {poolType !== 'nft-mining' && (
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
                <span>{language === 'zh' ? '留空支付代币表示使用 ETH' : 'Leave payment token blank to use ETH'}</span>
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
                  <input className="input" placeholder={language === 'zh' ? '留空使用 ETH，或输入 0x...' : 'Blank for ETH, or 0x...'} value={paymentAsset} onChange={e => setPaymentAsset(e.target.value)} />
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
                    {poolType === 'staking' ? 'Staking' : poolType === 'locking' ? 'Locking' : 'NFT Mining'}
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
              || (poolType !== 'nft-mining' && !stakeTokenAddress)
              || (poolType === 'nft-mining' && (
                !nftSymbol || !fundsReceiver || !mintPrice || !batchSupply || !contracts.NFTMiningPoolFactory
                || paymentTokenPreview.loading || rendererPreview.loading
                || Boolean(paymentTokenPreview.error) || Boolean(rendererPreview.error)
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
