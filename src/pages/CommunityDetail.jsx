import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { fetchCommunity } from '../config/subgraph';
import { useWeb3 } from '../contexts/Web3Context';
import { useToast } from '../contexts/ToastContext';
import { useLanguage } from '../contexts/LanguageContext';
import {
  useCommunityRead,
  useLinearCalculator,
  useLinearTimeCalculator,
  useHourlyTickCalculator,
} from '../hooks/useContract';
import { CONTRACTS } from '../config/contracts';
import { ERC20ABI } from '../config/abis';
import { formatTokenAmount, shortenAddress, formatDate, getPoolTypeLabel, getPoolTypeBadgeClass, getBscScanUrl, copyToClipboard } from '../utils/helpers';
import PoolCard from '../components/pool/PoolCard';
import SocialCurationCard from '../components/pool/SocialCurationCard';
import AddPoolModal from '../components/community/AddPoolModal';
import AdjustRatiosModal from '../components/community/AdjustRatiosModal';
import CommunitySettingsModal from '../components/community/CommunitySettingsModal';
import DistributionDisplay from '../components/community/DistributionDisplay';
import './CommunityDetail.css';

export default function CommunityDetail() {
  const { address } = useParams();
  const { account, isConnected, readProvider, signer } = useWeb3();
  const toast = useToast();
  const { t, language } = useLanguage();

  const [community, setCommunity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tokenInfo, setTokenInfo] = useState(null);
  const [rewardRate, setRewardRate] = useState(null);
  const [rewardRateUnit, setRewardRateUnit] = useState('/block');
  const [showAddPool, setShowAddPool] = useState(false);
  const [showAdjustRatios, setShowAdjustRatios] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState('pools');
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
      const data = await fetchCommunity(address);

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
          data.pools = updatedPools;
        } catch (err) {
          console.error('Failed to load on-chain ratios via slot 10:', err);
        }
      }

      setCommunity(data);

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
          
          if (calcAddrLower === CONTRACTS.LinearCalculator.toLowerCase()) {
            if (linearCalc) {
              rate = await linearCalc.getCurrentRewardRate(address);
            }
            unit = '/block';
          } else if (calcAddrLower === CONTRACTS.LinearTimeCalculator.toLowerCase()) {
            if (linearTimeCalc) {
              rate = await linearTimeCalc.getCurrentRewardRate(address);
            }
            unit = '/sec';
          } else if (calcAddrLower === CONTRACTS.HourlyTickCalculator.toLowerCase()) {
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
  }, [address, readProvider, communityContract, linearCalc, linearTimeCalc, hourlyCalc, toast]);

  useEffect(() => {
    loadCommunity();
  }, [loadCommunity]);

  const isOwner = isConnected && account && community?.owner?.id?.toLowerCase() === account.toLowerCase();

  // Admin actions
  const handleWithdrawRevenue = async () => {
    if (!signer) return;
    try {
      const contract = new ethers.Contract(address, [
        'function adminWithdrawRevenue()',
      ], signer);
      const tx = await contract.adminWithdrawRevenue();
      toast.info(t('detail.revenueWithdrawing'));
      await tx.wait();
      toast.success(t('detail.revenueWithdrawn'));
      loadCommunity();
    } catch (err) {
      toast.error(err.reason || err.message || t('detail.revenueWithdrawFailed'));
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
          <Link to="/" className="btn btn-primary">{language === 'zh' ? '返回首页' : 'Back to Home'}</Link>
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
  const otherPools = displayPools.filter(p =>
    p.poolType !== 'ERC20_STAKING' && p.poolType !== 'ERC20_LOCKING' && p.poolType !== 'SOCIAL_CURATION'
  );
  const displayFeeRatio = onChainFeeRatio !== null ? onChainFeeRatio : (community?.feeRatio || 0);
  const displayDaoFund = daoFundAddress || community.daoFund;

  return (
    <div className="page container">
      {/* ── Breadcrumb ── */}
      <nav className="breadcrumb">
        <Link to="/">{t('detail.breadcrumbHome')}</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{community.name || `Community #${community.index?.toString()}`}</span>
      </nav>

      {/* ── Community Header ── */}
      <div className="community-header glass-card">
        <div className="community-header-top">
          {community.logo ? (
            <img src={community.logo} alt={community.name} className="community-header-avatar-img" />
          ) : (
            <div className="community-header-avatar">
              {community.tick?.slice(0, 2) || tokenInfo?.symbol?.slice(0, 2) || 'N'}
            </div>
          )}
          <div className="community-header-info">
            <h1 className="community-header-title">
              {community.name || `Community #${community.index?.toString()}`}
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
            <a href={getBscScanUrl(address)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
              BscScan ↗
            </a>
          </div>
        </div>

        <div className="community-info-grid">
          <div className="info-item">
            <span className="info-label">{t('detail.tokenAddress')}</span>
            <span className="info-value ctoken-address">
              <a
                href={getBscScanUrl(community.cToken)}
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
            <span className="info-value" style={{ fontFamily: 'monospace' }}>{shortenAddress(community.owner?.id)}</span>
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
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddPool(true)}>
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

      {/* ── Distribution Display (inline) ── */}
      <DistributionDisplay
        communityAddress={address}
        tokenInfo={tokenInfo}
        community={community}
      />

      {/* ── Pools Section ── */}
      <div style={{ marginTop: 'var(--space-8)' }}>
        <div className="tabs">
          <button className={`tab ${activeTab === 'pools' ? 'active' : ''}`} onClick={() => setActiveTab('pools')}>
            {t('detail.tabActivePools')} ({activePools.length})
          </button>
          <button className={`tab ${activeTab === 'devfund' ? 'active' : ''}`} onClick={() => setActiveTab('devfund')}>
            {t('detail.tabDaoFund')}
          </button>
          <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            {t('detail.tabHistory')}
          </button>
        </div>

        {activeTab === 'history' ? (
          <HistoryTab operations={community.operationHistory} pools={community.pools} />
        ) : activeTab === 'devfund' ? (
          <div className="devfund-panel glass-card" style={{ padding: 'var(--space-6)', marginTop: 'var(--space-4)' }}>
            <h4 style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('detail.daoFundInfoTitle')}
            </h4>
            <div className="devfund-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
              <div className="devfund-item glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.02)' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6, display: 'block', marginBottom: 'var(--space-1)' }}>{t('detail.daoFundAddressLabel')}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 'var(--font-size-sm)', wordBreak: 'break-all' }}>
                  {displayDaoFund ? (
                    <a href={getBscScanUrl(displayDaoFund)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>
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
                    <button className="btn btn-success btn-xs" onClick={handleWithdrawRevenue} style={{ padding: '2px 8px', fontSize: 11 }}>
                      {t('detail.claimRevenueBtn')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : erc20Pools.length === 0 && socialCurationPools.length === 0 && otherPools.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div className="empty-state-title">{t('detail.noPoolsTitle')}</div>
            <div className="empty-state-desc">
              {isOwner ? t('detail.noPoolsDesc') : t('detail.noPoolsDescUser')}
            </div>
            {isOwner && (
              <button className="btn btn-primary" onClick={() => setShowAddPool(true)}>{t('detail.addPoolBtn')}</button>
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
            {otherPools.map(pool => (
              <div key={pool.id} className="glass-card" style={{ padding: 'var(--space-6)', opacity: 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{pool.name || 'Pool'}</span>
                  <span className={getPoolTypeBadgeClass(pool.poolType)}>{getPoolTypeLabel(pool.poolType)}</span>
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}>
                  {t('detail.unsupportedPool')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add Pool Modal ── */}
      {showAddPool && (
        <AddPoolModal
          communityAddress={address}
          activePools={activePools}
          onClose={() => setShowAddPool(false)}
          onSuccess={() => { setShowAddPool(false); loadCommunity(); }}
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

function guessPoolType(factoryAddress) {
  if (!factoryAddress) return '';
  const addr = factoryAddress.toLowerCase();
  const map = {
    '0xdc3f940ac6da516d5c9cc59c8afe0f85a576e2a4': 'ERC20_STAKING',
    '0x8189a03cfa3d8919a2eb8f08e4f88c21cf78ca01': 'ERC20_LOCKING',
    '0x398ea6db014595f23d0c9cb1390a10472cdd43ba': 'ERC1155_STAKING',
    '0x47738e3420be8ced8a9476cf4daf84c549835d44': 'SP_STAKING',
    '0xc4674d3fbbd201ea401a8b7e7285f956178593d8': 'SOCIAL_CURATION',
  };
  return map[addr] || '';
}

function HistoryTab({ operations, pools = [] }) {
  const { t } = useLanguage();
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
                  {(parseFloat(op.amount) * 1e16).toFixed(1)}%
                </span>
              )}
              
              {/* Case 2: Change Fund Address */}
              {opInfo.label === 'detail.historyTitleChangeAddr' && op.asset && (
                <span className="history-amount" style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'monospace', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  ➡️ {t('detail.historyNewAddr')}: <a href={getBscScanUrl(op.asset)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-accent)', textDecoration: 'underline' }}>{shortenAddress(op.asset, 6)}</a>
                </span>
              )}
              
              {/* Case 3: Add Pool */}
              {opInfo.label === 'detail.historyTitleAddPool' && (() => {
                const poolInfo = pools.find(p => p.id?.toLowerCase() === op.pool?.id?.toLowerCase());
                const typeLabel = poolInfo ? getPoolTypeLabel(poolInfo.poolType) : (op.poolFactory ? getPoolTypeLabel(guessPoolType(op.poolFactory)) : '');
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
              <a href={getBscScanUrl(op.tx, 'tx')} target="_blank" rel="noopener noreferrer" className="history-tx">
                {shortenAddress(op.tx, 6)} ↗
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
