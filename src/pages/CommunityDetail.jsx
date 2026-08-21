import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { fetchCommunity, fetchCommunityHistory } from '../config/subgraph';
import { useWeb3 } from '../contexts/Web3Context';
import { useToast } from '../contexts/ToastContext';
import { useLanguage } from '../contexts/LanguageContext';
import {
  useCommunityRead,
  useLinearCalculator,
  useLinearTimeCalculator,
  useHourlyTickCalculator,
} from '../hooks/useContract';
import { ERC20ABI } from '../config/abis';
import { getChainPath } from '../config/contracts';
import { formatTokenAmount, shortenAddress, formatDate, getPoolTypeLabel, getPoolTypeBadgeClass, getBscScanUrl, copyToClipboard } from '../utils/helpers';
import PoolCard from '../components/pool/PoolCard';
import SocialCurationCard from '../components/pool/SocialCurationCard';
import NFTMiningPoolCard from '../components/pool/NFTMiningPoolCard';
import BasketTVLMiningPoolCard from '../components/pool/BasketTVLMiningPoolCard';
import IndexBrokerNFTPoolCard from '../components/pool/IndexBrokerNFTPoolCard';
import { PoolCardFooter, PoolCardHeader } from '../components/pool/PoolCardTemplate';
import AddPoolModal from '../components/community/AddPoolModal';
import AdjustRatiosModal from '../components/community/AdjustRatiosModal';
import CommunitySettingsModal from '../components/community/CommunitySettingsModal';
import CommunityTokenTradeCard from '../components/community/CommunityTokenTradeCard';
import DistributionDisplay from '../components/community/DistributionDisplay';
import IndexBrokerNFTWorkspace from '../components/community/IndexBrokerNFTWorkspace';
import useTimedActionLoading from '../hooks/useTimedActionLoading';
import './CommunityDetail.css';

export default function CommunityDetail() {
  const { address } = useParams();
  const { account, isConnected, readProvider, getWriteSigner, contracts, activeChainId, network } = useWeb3();
  const toast = useToast();
  const { t, language } = useLanguage();

  const [community, setCommunity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revenueLoading, setRevenueLoading] = useTimedActionLoading(false);
  const [tokenInfo, setTokenInfo] = useState(null);
  const [rewardRate, setRewardRate] = useState(null);
  const [rewardRateUnit, setRewardRateUnit] = useState('/block');
  const [addPoolMode, setAddPoolMode] = useState(null);
  const [showAdjustRatios, setShowAdjustRatios] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState(null);
  const [retainedRevenue, setRetainedRevenue] = useState(null);
  const [showFeeRatioPopover, setShowFeeRatioPopover] = useState(false);
  const [onChainFeeRatio, setOnChainFeeRatio] = useState(null);
  const [daoFundAddress, setDaoFundAddress] = useState(null);

  const communityContract = useCommunityRead(address);
  const linearCalc = useLinearCalculator();
  const linearTimeCalc = useLinearTimeCalculator();
  const hourlyCalc = useHourlyTickCalculator();

  // Load community data from subgraph
  const loadCommunity = useCallback(async () => {
    try {
      const data = await fetchCommunity(
        address,
        activeChainId,
        { includeHistory: false },
      );
      setCommunity(data);
      setLoading(false);

      fetchCommunityHistory(address, activeChainId).then(operationHistory => {
        setCommunity(current => current ? ({ ...current, operationHistory }) : current);
      });

      // Load real-time pool ratios and active statuses on-chain using slot 10 direct query to override indexer lag/bugs
      if (communityContract && data && data.pools) {
        try {
          const updatedPools = await Promise.all(data.pools.map(async (p) => {
            const poolAddr = p.id;
            
            // Check if active on-chain using public view function poolActived
            const isActive = await communityContract.poolActived(poolAddr);
            
            let ratio = 0;
            if (isActive) {
              // Read ratio directly from Storage Slot 10
              const paddedAddress = ethers.zeroPadValue(poolAddr, 32);
              const paddedSlot = ethers.zeroPadValue(ethers.toBeHex(10), 32);
              const storageKey = ethers.keccak256(ethers.concat([paddedAddress, paddedSlot]));
              const rawVal = await readProvider.getStorage(address, storageKey);
              ratio = Number(BigInt(rawVal));
            }
            
            return {
              ...p,
              ratio,
              status: isActive ? 'OPENED' : 'CLOSED'
            };
          }));
          setCommunity(current => current ? ({ ...current, pools: updatedPools }) : current);
        } catch (err) {
          console.error('Failed to load on-chain ratios via slot 10:', err);
        }
      }

      // Load token info
      if (data?.cToken) {
        const tokenContract = new ethers.Contract(data.cToken, ERC20ABI, readProvider);
        const [name, symbol, decimals] = await Promise.all([
          tokenContract.name(),
          tokenContract.symbol(),
          tokenContract.decimals(),
        ]);
        setTokenInfo({ name, symbol, decimals: Number(decimals), address: data.cToken });
      }

      // Load reward rate and fee ratio by detecting calculator type on-chain
      if (communityContract) {
        try {
          const [calcAddr, ratio] = await Promise.all([
            communityContract.rewardCalculator(),
            communityContract.feeRatio()
          ]);
          setOnChainFeeRatio(Number(ratio));
          const calcAddrLower = calcAddr.toLowerCase();
          
          let rate = 0n;
          let unit = '/block';
          
          if (contracts.LinearCalculator && calcAddrLower === contracts.LinearCalculator.toLowerCase()) {
            if (linearCalc) {
              rate = await linearCalc.getCurrentRewardRate(address);
            }
            unit = '/block';
          } else if (calcAddrLower === contracts.LinearTimeCalculator.toLowerCase()) {
            if (linearTimeCalc) {
              rate = await linearTimeCalc.getCurrentRewardRate(address);
            }
            unit = '/sec';
          } else if (calcAddrLower === contracts.HourlyTickCalculator.toLowerCase()) {
            if (hourlyCalc) {
              rate = await hourlyCalc.getCurrentRewardRate(address);
            }
            unit = '/hour';
          } else {
            // Default fallback
            if (linearCalc) {
              rate = await linearCalc.getCurrentRewardRate(address);
            }
          }
          
          setRewardRate(rate);
          setRewardRateUnit(unit);
        } catch (err) {
          console.error('Failed to load reward rate from calculator:', err);
          setRewardRate(0n);
          setRewardRateUnit('/block');
        }
      }

      // Load devFund (daoFund) and retainedRevenue from storage slot on-chain
      if (readProvider && address) {
        try {
          const [rawDev, rawRevenue] = await Promise.all([
            readProvider.getStorage(address, 3), // slot 3: devFund
            readProvider.getStorage(address, 4)  // slot 4: retainedRevenue
          ]);

          if (rawDev && rawDev !== '0x' + '0'.repeat(64)) {
            setDaoFundAddress(ethers.getAddress('0x' + rawDev.slice(-40)));
          }
          setRetainedRevenue(rawRevenue ? BigInt(rawRevenue) : 0n);
        } catch (err) {
          console.error('Failed to read storage fields:', err);
          setRetainedRevenue(0n);
        }
      }
    } catch (err) {
      console.error('Failed to load community:', err);
      toast.error('Failed to load community data');
    } finally {
      setLoading(false);
    }
  }, [address, activeChainId, readProvider, communityContract, linearCalc, linearTimeCalc, hourlyCalc, contracts, toast]);

  useEffect(() => {
    loadCommunity();
  }, [loadCommunity]);

  const isOwner = isConnected && account && community?.owner?.id?.toLowerCase() === account.toLowerCase();

  // Admin actions
  const handleWithdrawRevenue = async () => {
    setRevenueLoading(true);
    try {
      const writeSigner = await getWriteSigner();
      const contract = new ethers.Contract(address, [
        'function adminWithdrawRevenue()',
      ], writeSigner);
      const tx = await contract.adminWithdrawRevenue();
      toast.info(t('detail.revenueWithdrawing'));
      await tx.wait();
      toast.success(t('detail.revenueWithdrawn'));
      loadCommunity();
    } catch (err) {
      toast.error(err.reason || err.message || t('detail.revenueWithdrawFailed'));
    } finally {
      setRevenueLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page container">
        <div className="community-detail-skeleton">
          <div className="skeleton" style={{ width: '40%', height: 36, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: '100%', height: 120, marginBottom: 24 }} />
          <div className="skeleton" style={{ width: '100%', height: 200 }} />
        </div>
      </div>
    );
  }

  if (!community) {
    return (
      <div className="page container">
        <div className="empty-state">
          <div className="empty-state-icon">❌</div>
          <div className="empty-state-title">{language === 'zh' ? '未找到社区' : 'Community not found'}</div>
          <div className="empty-state-desc">{language === 'zh' ? '此社区合约地址在链上不存在。' : 'This community address doesn\'t exist on chain.'}</div>
          <Link to={getChainPath(activeChainId)} className="btn btn-primary">{language === 'zh' ? '返回首页' : 'Back to Home'}</Link>
        </div>
      </div>
    );
  }

  const activePools = community.pools?.filter(p => p.status === 'OPENED') || [];
  const displayPools = activePools;
  const erc20Pools = displayPools.filter(p =>
    p.poolType === 'ERC20_STAKING' || p.poolType === 'ERC20_LOCKING'
  );
  const socialCurationPools = displayPools.filter(p =>
    p.poolType === 'SOCIAL_CURATION'
  );
  const nftMiningPools = displayPools.filter(p =>
    p.poolType === 'NFT_MINING'
  );
  const basketTVLMiningPools = displayPools.filter(p =>
    p.poolType === 'BASKET_TVL_MINING'
  );
  const indexBrokerNftPools = displayPools.filter(p =>
    p.poolType === 'INDEX_BROKER_NFT'
      && p.poolFactory?.toLowerCase() === contracts.IndexBrokerNFTFactory?.toLowerCase()
  );
  const otherPools = displayPools.filter(p =>
    p.poolType !== 'ERC20_STAKING' && p.poolType !== 'ERC20_LOCKING'
    && p.poolType !== 'SOCIAL_CURATION' && p.poolType !== 'NFT_MINING'
    && p.poolType !== 'BASKET_TVL_MINING'
    && !(p.poolType === 'INDEX_BROKER_NFT'
      && p.poolFactory?.toLowerCase() === contracts.IndexBrokerNFTFactory?.toLowerCase())
  );
  const primaryIndexBrokerNftPool = indexBrokerNftPools.reduce((selected, pool) => {
    if (!selected) return pool;
    return Number(pool.ratio || 0) > Number(selected.ratio || 0) ? pool : selected;
  }, null);
  const displayFeeRatio = onChainFeeRatio !== null ? onChainFeeRatio : (community?.feeRatio || 0);
  const displayDaoFund = daoFundAddress || community.daoFund;
  const selectedTab = activeTab === 'nft' && indexBrokerNftPools.length === 0
    ? 'pools'
    : (activeTab || (indexBrokerNftPools.length > 0 ? 'nft' : 'pools'));
  const communityDisplayName = community.name
    || tokenInfo?.name
    || tokenInfo?.symbol
    || shortenAddress(community.cToken);

  return (
    <div className="page container">
      {/* ── Breadcrumb ── */}
      <nav className="breadcrumb">
        <Link to={getChainPath(activeChainId)}>{t('detail.breadcrumbHome')}</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{communityDisplayName}</span>
      </nav>

      {/* ── Community Header ── */}
      <div className="community-header glass-card">
        <div className="community-header-top">
          <div className="community-header-avatar">
            {community.tick?.slice(0, 2) || tokenInfo?.symbol?.slice(0, 2) || 'N'}
            {community.logo && (
              <img
                src={community.logo}
                alt={community.name}
                className="community-header-avatar-img"
                onError={({ currentTarget }) => { currentTarget.style.display = 'none'; }}
              />
            )}
          </div>
          <div className="community-header-info">
            <h1 className="community-header-title">
              {communityDisplayName}
              {community.tick && <span className="community-detail-tick">${community.tick}</span>}
              {isOwner && <span className="badge badge-active" style={{ marginLeft: 8 }}>{t('detail.ownerBadge')}</span>}
            </h1>
            <div className="community-header-address" onClick={() => { copyToClipboard(address); toast.info(t('common.copySuccess')); }}>
              {shortenAddress(address, 8)}
              <span style={{ fontSize: 12, opacity: 0.5, marginLeft: 4 }}>📋</span>
            </div>
            {community.description && (
              <div className="community-header-desc">{community.description}</div>
            )}
          </div>
          <div className="community-header-actions">
            {community.twitter && (
              <a href={`https://x.com/${community.twitter}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">𝕏</a>
            )}
            {community.telegram && (
              <a href={`https://t.me/${community.telegram}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">TG</a>
            )}
            <a href={getBscScanUrl(address, 'address', network.explorerUrl)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
              {network.shortName} Explorer ↗
            </a>
          </div>
        </div>

        <div className="community-info-grid">
          <div className="info-item">
            <span className="info-label">{t('detail.tokenAddress')}</span>
            <span className="info-value ctoken-address">
              <a
                href={getBscScanUrl(community.cToken, 'address', network.explorerUrl)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}
              >
                {shortenAddress(community.cToken, 6)}
              </a>
              <button
                className="copy-btn"
                onClick={(e) => { e.stopPropagation(); copyToClipboard(community.cToken); toast.info(t('common.copySuccess')); }}
                title={language === 'zh' ? '复制代币地址' : 'Copy token address'}
              >
                📋
              </button>
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">{t('detail.ownerAddress')}</span>
            <span className="info-value ctoken-address">
              <a
                href={getBscScanUrl(community.owner?.id, 'address', network.explorerUrl)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}
              >
                {shortenAddress(community.owner?.id, 6)}
              </a>
              <button
                className="copy-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  copyToClipboard(community.owner?.id);
                  toast.info(t('common.copySuccess'));
                }}
                title={language === 'zh' ? '复制创建者地址' : 'Copy creator address'}
              >
                📋
              </button>
            </span>
          </div>
          <div className="info-item" style={{ position: 'relative' }}>
            <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {t('detail.daoFundRatio')}
              <span
                onClick={() => setShowFeeRatioPopover(!showFeeRatioPopover)}
                style={{
                  cursor: 'pointer',
                  fontSize: '12px',
                  opacity: 0.8,
                  userSelect: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255, 255, 255, 0.1)',
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  lineHeight: 1
                }}
                title={language === 'zh' ? '点击查看详情' : 'Click for details'}
              >
                ⓘ
              </span>
            </span>
            <span className="info-value">{((displayFeeRatio || 0) / 100).toFixed(1)}%</span>

            {showFeeRatioPopover && (
              <div 
                className="glass-card" 
                style={{ 
                  position: 'absolute', 
                  top: '100%', 
                  left: 0, 
                  marginTop: '8px', 
                  padding: '12px', 
                  borderRadius: '8px', 
                  zIndex: 100, 
                  width: '240px',
                  fontSize: '12px',
                  lineHeight: '1.4',
                  background: 'rgba(15, 15, 25, 0.95)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                  backdropFilter: 'blur(12px)',
                  color: 'rgba(230, 230, 250, 0.9)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontWeight: 600, color: 'var(--color-text-accent)' }}>
                  <span>{t('detail.daoFundRatioTitle')}</span>
                  <button 
                    onClick={() => setShowFeeRatioPopover(false)}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '14px', padding: 0 }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ textTransform: 'none', letterSpacing: 'normal', fontWeight: 'normal' }}>
                  {t('detail.daoFundRatioDesc')}
                </div>
              </div>
            )}
          </div>
          <div className="info-item">
            <span className="info-label">{t('detail.rewardRate')}</span>
            <span className="info-value">
              {rewardRate !== null ? `${formatTokenAmount(rewardRate, tokenInfo?.decimals || 18, 4)}${language === 'zh' && rewardRateUnit === '/block' ? '/区块' : (language === 'zh' && rewardRateUnit === '/sec' ? '/秒' : rewardRateUnit)}` : '...'}
            </span>
          </div>
        </div>

        {/* Owner admin panel */}
        {isOwner && (
          <div className="admin-panel">
            <div className="admin-panel-header">
              <span>{t('detail.adminPanelTitle')}</span>
            </div>
            <div className="admin-actions">
              {contracts.IndexBrokerNFTFactory && (
                <button className="btn btn-primary btn-sm" onClick={() => setAddPoolMode('nft')}>
                  {t('detail.createNftBtn')}
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setAddPoolMode('pool')}>
                {t('detail.addPoolBtn')}
              </button>
              <button className="btn btn-warning btn-sm" onClick={() => setShowAdjustRatios(true)}>
                {t('detail.adjustRatiosBtn')}
              </button>
              <button className="btn btn-info btn-sm" onClick={() => setShowSettings(true)}>
                {t('detail.fundSettingsBtn')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Reward schedule + Community Token trade ── */}
      <div className={`community-market-row ${indexBrokerNftPools.length > 0 ? 'has-token-trade' : ''}`}>
        <DistributionDisplay
          communityAddress={address}
          tokenInfo={tokenInfo}
          community={community}
        />
        {indexBrokerNftPools.length > 0 && (
          <CommunityTokenTradeCard community={community} tokenInfo={tokenInfo} />
        )}
      </div>

      {/* ── Pools Section ── */}
      <div style={{ marginTop: 'var(--space-8)' }}>
        <div className="tabs">
          {indexBrokerNftPools.length > 0 && (
            <button className={`tab ${selectedTab === 'nft' ? 'active' : ''}`} onClick={() => setActiveTab('nft')}>
              NFT
            </button>
          )}
          <button className={`tab ${selectedTab === 'pools' ? 'active' : ''}`} onClick={() => setActiveTab('pools')}>
            {t('detail.tabActivePools')} ({activePools.length})
          </button>
          <button className={`tab ${selectedTab === 'devfund' ? 'active' : ''}`} onClick={() => setActiveTab('devfund')}>
            {t('detail.tabDaoFund')}
          </button>
          <button className={`tab ${selectedTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            {t('detail.tabHistory')}
          </button>
        </div>

        {selectedTab === 'nft' ? (
          <IndexBrokerNFTWorkspace
            pool={primaryIndexBrokerNftPool}
            communityAddress={address}
            communityToken={tokenInfo}
            isOwner={isOwner}
            onRefresh={loadCommunity}
          />
        ) : selectedTab === 'history' ? (
          <HistoryTab operations={community.operationHistory} pools={community.pools} />
        ) : selectedTab === 'devfund' ? (
          <div className="devfund-panel glass-card" style={{ padding: 'var(--space-6)', marginTop: 'var(--space-4)' }}>
            <h4 style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('detail.daoFundInfoTitle')}
            </h4>
            <div className="devfund-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
              <div className="devfund-item glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.02)' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6, display: 'block', marginBottom: 'var(--space-1)' }}>{t('detail.daoFundAddressLabel')}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 'var(--font-size-sm)', wordBreak: 'break-all' }}>
                  {displayDaoFund ? (
                    <a href={getBscScanUrl(displayDaoFund, 'address', network.explorerUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>
                      {displayDaoFund}
                    </a>
                  ) : (
                    t('detail.notSet')
                  )}
                </span>
              </div>
              <div className="devfund-item glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.02)' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6, display: 'block', marginBottom: 'var(--space-1)' }}>{t('detail.daoFundRatioLabel')}</span>
                <span style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)' }}>
                  {((displayFeeRatio || 0) / 100).toFixed(1)}%
                </span>
              </div>
              <div className="devfund-item glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.02)' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6, display: 'block', marginBottom: 'var(--space-1)' }}>{t('detail.pendingRewardsLabel')}</span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-1)', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)', color: 'var(--color-success)' }}>
                    {retainedRevenue !== null ? `${formatTokenAmount(retainedRevenue, tokenInfo?.decimals || 18, 4)} ${tokenInfo?.symbol || t('detail.historyTokens')}` : '...'}
                  </span>
                  {retainedRevenue > 0n && (
                    <button className="btn btn-success btn-xs" disabled={revenueLoading} onClick={handleWithdrawRevenue} style={{ padding: '2px 8px', fontSize: 11 }}>
                      {t('detail.claimRevenueBtn')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : erc20Pools.length === 0 && socialCurationPools.length === 0 && nftMiningPools.length === 0 && basketTVLMiningPools.length === 0 && indexBrokerNftPools.length === 0 && otherPools.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div className="empty-state-title">{t('detail.noPoolsTitle')}</div>
            <div className="empty-state-desc">
              {isOwner ? t('detail.noPoolsDesc') : t('detail.noPoolsDescUser')}
            </div>
            {isOwner && (
              <button className="btn btn-primary" onClick={() => setAddPoolMode('pool')}>{t('detail.addPoolBtn')}</button>
            )}
          </div>
        ) : (
          <div className="grid-pools">
            {erc20Pools.map(pool => (
              <PoolCard
                key={pool.id}
                pool={pool}
                communityAddress={address}
                communityToken={tokenInfo}
                rewardRate={rewardRate}
                rewardRateUnit={rewardRateUnit}
                feeRatio={displayFeeRatio}
                isOwner={isOwner}
                onRefresh={loadCommunity}
              />
            ))}
            {socialCurationPools.map(pool => (
              <SocialCurationCard
                key={pool.id}
                pool={pool}
                communityAddress={address}
                communityToken={tokenInfo}
                rewardRate={rewardRate}
                feeRatio={displayFeeRatio}
              />
            ))}
            {nftMiningPools.map(pool => (
              <NFTMiningPoolCard
                key={pool.id}
                pool={pool}
                communityAddress={address}
                communityToken={tokenInfo}
                isOwner={isOwner}
                onRefresh={loadCommunity}
              />
            ))}
            {basketTVLMiningPools.map(pool => (
              <BasketTVLMiningPoolCard
                key={pool.id}
                pool={pool}
                communityAddress={address}
                communityToken={tokenInfo}
                onRefresh={loadCommunity}
              />
            ))}
            {indexBrokerNftPools.map(pool => (
              <IndexBrokerNFTPoolCard
                key={pool.id}
                pool={pool}
                communityAddress={address}
                communityToken={tokenInfo}
                isOwner={isOwner}
                onRefresh={loadCommunity}
              />
            ))}
            {otherPools.map(pool => (
              <div key={pool.id} className="pool-card glass-card" style={{ opacity: 0.6 }}>
                <PoolCardHeader
                  name={pool.name || t('poolCard.fallbackName')}
                  typeLabel={getPoolTypeLabel(pool.poolType)}
                  typeClassName={getPoolTypeBadgeClass(pool.poolType)}
                  ratio={pool.ratio}
                  status={pool.status}
                />
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}>
                  {t('detail.unsupportedPool')}
                </div>
                <PoolCardFooter address={pool.id} explorerUrl={network.explorerUrl} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add Pool Modal ── */}
      {addPoolMode && (
        <AddPoolModal
          key={`${activeChainId}:${address.toLowerCase()}:${account?.toLowerCase() || 'anonymous'}:${addPoolMode}`}
          communityAddress={address}
          communityTokenAddress={community.cToken}
          activePools={activePools}
          initialPoolType={addPoolMode === 'nft' ? 'index-broker-nft' : ''}
          draftScope={addPoolMode === 'nft' ? 'create-nft' : ''}
          onClose={() => setAddPoolMode(null)}
          onSuccess={(registration) => {
            setAddPoolMode(null);
            if (!registration?.pool) {
              loadCommunity();
              return;
            }
            setCommunity(current => {
              if (!current) return current;
              const poolId = registration.pool.id.toLowerCase();
              const existingPools = current.pools || [];
              const alreadyPresent = existingPools.some(pool => pool.id.toLowerCase() === poolId);
              const ratios = new Map((registration.ratios || []).map(item => [
                item.pool.toLowerCase(),
                Number(item.ratio),
              ]));
              const reconciledPools = existingPools.map(pool => ({
                ...pool,
                ratio: ratios.has(pool.id.toLowerCase())
                  ? ratios.get(pool.id.toLowerCase())
                  : pool.ratio,
              }));
              return {
                ...current,
                pools: alreadyPresent
                  ? reconciledPools.map(pool => pool.id.toLowerCase() === poolId ? registration.pool : pool)
                  : [...reconciledPools, registration.pool],
              };
            });
          }}
        />
      )}

      {/* ── Adjust Pool Ratios Modal ── */}
      {showAdjustRatios && (
        <AdjustRatiosModal
          communityAddress={address}
          activePools={activePools}
          onClose={() => setShowAdjustRatios(false)}
          onSuccess={() => { setShowAdjustRatios(false); loadCommunity(); }}
        />
      )}

      {/* ── Community Settings Modal ── */}
      {showSettings && (
        <CommunitySettingsModal
          communityAddress={address}
          community={{ ...community, feeRatio: displayFeeRatio, daoFund: displayDaoFund }}
          retainedRevenue={retainedRevenue}
          communityToken={tokenInfo}
          onClose={() => setShowSettings(false)}
          onSuccess={() => { setShowSettings(false); loadCommunity(); }}
        />
      )}
    </div>
  );
}

function getOperationDisplay(type) {
  const t = (type || '').trim().toUpperCase().replace(/_/g, '');
  
  // Admin Operations
  if (t.includes('SETDEV') || t.includes('SETDAOFUND') || t === 'DEVCHANGED') {
    return { label: 'detail.historyTitleChangeAddr', isKey: true, isAdmin: true };
  }
  if (t.includes('SETFEERATIO') || t.includes('SETFEE')) {
    return { label: 'detail.historyTitleChangeRatio', isKey: true, isAdmin: true };
  }
  if (t.includes('ADDPOOL')) {
    return { label: 'detail.historyTitleAddPool', isKey: true, isAdmin: true };
  }
  if (t.includes('CLOSEPOOL')) {
    return { label: 'Close Pool', isKey: false, isAdmin: true };
  }
  if (t.includes('SETRATIO')) {
    return { label: 'detail.historyTitleAdjustRatios', isKey: true, isAdmin: true };
  }
  if (t.includes('WITHDRAWREVENUE') || t.includes('REVENUEWITHDRAWN') || (t.includes('WITHDRAW') && t.includes('REVENUE'))) {
    return { label: 'detail.historyTitleClaimRevenue', isKey: true, isAdmin: true };
  }
  
  // User/Normal Operations
  if (t === 'DEPOSIT' || t === 'STAKE' || t === 'LOCKED' || t === 'LOCK') {
    return { label: 'detail.historyTitleStake', isKey: true, isAdmin: false };
  }
  if (t === 'WITHDRAW' || t === 'UNSTAKE' || t === 'UNLOCKED' || t === 'UNLOCK') {
    return { label: 'detail.historyTitleWithdraw', isKey: true, isAdmin: false };
  }
  if (t === 'REDEEM' || t === 'REDEEMED') {
    return { label: 'detail.historyTitleRedeem', isKey: true, isAdmin: false };
  }
  if (t === 'WITHDRAWREWARDS' || t === 'CLAIM' || t === 'HARVEST' || t === 'CLAIMREWARDS') {
    return { label: 'detail.historyTitleClaimRewards', isKey: true, isAdmin: false };
  }
  if (t === 'SOCIALCLAIMED' || t === 'CLAIMED') {
    return { label: 'detail.historyTitleSocialClaim', isKey: true, isAdmin: false };
  }
  
  // Fallback: If type contains 'ADMIN', it is admin operation
  const isFallbackAdmin = t.includes('ADMIN');
  const formattedLabel = (type || '')
    .trim()
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return { label: formattedLabel, isKey: false, isAdmin: isFallbackAdmin };
}

function guessPoolType(factoryAddress, contracts) {
  if (!factoryAddress) return '';
  const addr = factoryAddress.toLowerCase();
  const map = Object.fromEntries([
    [contracts.ERC20StakingFactory, 'ERC20_STAKING'],
    [contracts.ERC20LockingFactory, 'ERC20_LOCKING'],
    [contracts.ERC1155StakingFactory, 'ERC1155_STAKING'],
    [contracts.SPStakingFactory, 'SP_STAKING'],
    [contracts.SocialCurationFactory, 'SOCIAL_CURATION'],
    [contracts.NFTMiningPoolFactory, 'NFT_MINING'],
    [contracts.BasketTVLMiningPoolFactory, 'BASKET_TVL_MINING'],
    [contracts.IndexBrokerNFTFactory, 'INDEX_BROKER_NFT'],
  ].filter(([address]) => address).map(([address, type]) => [address.toLowerCase(), type]));
  return map[addr] || '';
}

function HistoryTab({ operations, pools = [] }) {
  const { t } = useLanguage();
  const { network, contracts } = useWeb3();
  if (!operations || operations.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📜</div>
        <div className="empty-state-title">{t('detail.historyNoData')}</div>
      </div>
    );
  }

  return (
    <div className="history-list">
      {operations.map(op => {
        const opInfo = getOperationDisplay(op.type);
        return (
          <div key={op.id} className="history-item glass-card">
            <div className="history-type">
              <span className={`badge ${opInfo.isAdmin ? 'badge-admin' : 'badge-staking'}`}>
                {opInfo.isKey ? t(opInfo.label) : opInfo.label}
                {opInfo.isAdmin && <span style={{ marginLeft: 4, fontSize: 10 }}>👑</span>}
              </span>
            </div>
            <div className="history-details">
              <span className="history-account">{shortenAddress(op.account?.id)}</span>
              
              {/* Case 1: Change Fund Ratio */}
              {opInfo.label === 'detail.historyTitleChangeRatio' && op.amount !== undefined && (
                <span className="history-amount" style={{ color: 'var(--color-text-accent)' }}>
                  {op.ratioBps !== undefined
                    ? `${(Number(op.ratioBps) / 100).toFixed(1)}%`
                    : `${(parseFloat(op.amount) * 1e16).toFixed(1)}%`}
                </span>
              )}
              
              {/* Case 2: Change Fund Address */}
              {opInfo.label === 'detail.historyTitleChangeAddr' && op.asset && (
                <span className="history-amount" style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'monospace', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  ➡️ {t('detail.historyNewAddr')}: <a href={getBscScanUrl(op.asset, 'address', network.explorerUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-accent)', textDecoration: 'underline' }}>{shortenAddress(op.asset, 6)}</a>
                </span>
              )}
              
              {/* Case 3: Add Pool */}
              {opInfo.label === 'detail.historyTitleAddPool' && (() => {
                const poolInfo = pools.find(p => p.id?.toLowerCase() === op.pool?.id?.toLowerCase());
                const typeLabel = poolInfo ? getPoolTypeLabel(poolInfo.poolType) : (op.poolFactory ? getPoolTypeLabel(guessPoolType(op.poolFactory, contracts)) : '');
                const ratioLabel = poolInfo ? `${((poolInfo.ratio || 0) / 100).toFixed(1)}%` : (op.amount && op.amount !== '0' ? `${(parseFloat(op.amount) * 1e16).toFixed(1)}%` : '');
                return (
                  <span className="history-amount" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', display: 'inline-flex', gap: 8 }}>
                    {typeLabel && <span>{t('detail.historyType')}: <strong style={{ color: 'var(--color-text-primary)' }}>{typeLabel}</strong></span>}
                    {ratioLabel && <span>{t('detail.historyRatio')}: <strong style={{ color: 'var(--color-text-primary)' }}>{ratioLabel}</strong></span>}
                  </span>
                );
              })()}

              {/* Case 4: Adjust Pool Ratios */}
              {opInfo.label === 'detail.historyTitleAdjustRatios' && (() => {
                const poolInfo = pools.find(p => p.id?.toLowerCase() === op.pool?.id?.toLowerCase());
                const ratioLabel = poolInfo ? `${((poolInfo.ratio || 0) / 100).toFixed(1)}%` : (op.amount && op.amount !== '0' ? `${(parseFloat(op.amount) * 1e16).toFixed(1)}%` : '');
                return ratioLabel ? (
                  <span className="history-amount" style={{ color: 'var(--color-text-accent)' }}>
                    {t('detail.historyRatio')}: {ratioLabel}
                  </span>
                ) : null;
              })()}
              
              {/* Case 5: Standard token amount operations (Stake, Withdraw, Claim Rewards, etc.) */}
              {opInfo.label !== 'detail.historyTitleChangeRatio' && opInfo.label !== 'detail.historyTitleChangeAddr' && opInfo.label !== 'detail.historyTitleAddPool' && opInfo.label !== 'detail.historyTitleAdjustRatios' && op.amount && op.amount !== '0' && (
                <span className="history-amount">
                  {(() => {
                    const num = parseFloat(op.amount);
                    if (isNaN(num)) return '0';
                    if (num === 0) return '0';
                    if (num < 0.0001) return '<0.0001';
                    return num.toLocaleString('en-US', {
                      maximumFractionDigits: 4,
                      minimumFractionDigits: 0
                    });
                  })()} {t('detail.historyTokens')}
                </span>
              )}
            </div>
            <div className="history-meta">
              <span>{formatDate(op.timestamp)}</span>
              <a href={getBscScanUrl(op.tx, 'tx', network.explorerUrl)} target="_blank" rel="noopener noreferrer" className="history-tx">
                {shortenAddress(op.tx, 6)} ↗
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
