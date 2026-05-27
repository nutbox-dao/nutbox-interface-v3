import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { fetchCommunity } from '../config/subgraph';
import { useWeb3 } from '../contexts/Web3Context';
import { useToast } from '../contexts/ToastContext';
import {
  useCommunity,
  useCommunityRead,
  useCommittee,
  useLinearCalculator,
  useLinearTimeCalculator,
  useHourlyTickCalculator,
  useERC20Read
} from '../hooks/useContract';
import { CONTRACTS, BLOCKS_PER_YEAR } from '../config/contracts';
import { ERC20StakingABI, ERC20LockingABI, ERC20ABI } from '../config/abis';
import { formatTokenAmount, shortenAddress, formatDate, formatDuration, getPoolTypeLabel, getPoolTypeBadgeClass, getBscScanUrl, copyToClipboard } from '../utils/helpers';
import PoolCard from '../components/pool/PoolCard';
import AddPoolModal from '../components/community/AddPoolModal';
import AdjustRatiosModal from '../components/community/AdjustRatiosModal';
import CommunitySettingsModal from '../components/community/CommunitySettingsModal';
import DistributionDisplay from '../components/community/DistributionDisplay';
import './CommunityDetail.css';

export default function CommunityDetail() {
  const { address } = useParams();
  const { account, isConnected, readProvider, signer } = useWeb3();
  const toast = useToast();

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

  const communityContract = useCommunityRead(address);
  const linearCalc = useLinearCalculator();
  const linearTimeCalc = useLinearTimeCalculator();
  const hourlyCalc = useHourlyTickCalculator();

  // Load community data from subgraph
  const loadCommunity = useCallback(async () => {
    try {
      const data = await fetchCommunity(address);
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

      // Load retained revenue from storage slot 5 on-chain
      if (readProvider && address) {
        try {
          const rawVal = await readProvider.getStorage(address, 5);
          setRetainedRevenue(rawVal ? BigInt(rawVal) : 0n);
        } catch (err) {
          console.error('Failed to read retainedRevenue from storage:', err);
          setRetainedRevenue(0n);
        }
      }
    } catch (err) {
      console.error('Failed to load community:', err);
      toast.error('Failed to load community data');
    } finally {
      setLoading(false);
    }
  }, [address, readProvider, communityContract, linearCalc, linearTimeCalc, hourlyCalc]);

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
      toast.info('Withdrawing revenue...');
      await tx.wait();
      toast.success('Revenue withdrawn!');
      loadCommunity();
    } catch (err) {
      toast.error(err.reason || err.message || 'Failed to withdraw revenue');
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
          <div className="empty-state-title">Community not found</div>
          <div className="empty-state-desc">This community address doesn&apos;t exist on chain.</div>
          <Link to="/" className="btn btn-primary">Back to Home</Link>
        </div>
      </div>
    );
  }

  const activePools = community.pools?.filter(p => p.status === 'OPENED') || [];
  const displayPools = activePools;
  const erc20Pools = displayPools.filter(p =>
    p.poolType === 'ERC20_STAKING' || p.poolType === 'ERC20_LOCKING'
  );
  const otherPools = displayPools.filter(p =>
    p.poolType !== 'ERC20_STAKING' && p.poolType !== 'ERC20_LOCKING'
  );
  const displayFeeRatio = onChainFeeRatio !== null ? onChainFeeRatio : (community?.feeRatio || 0);

  return (
    <div className="page container">
      {/* ── Breadcrumb ── */}
      <nav className="breadcrumb">
        <Link to="/">Home</Link>
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
              {isOwner && <span className="badge badge-active" style={{ marginLeft: 8 }}>Owner</span>}
            </h1>
            <div className="community-header-address" onClick={() => { copyToClipboard(address); toast.info('Address copied!'); }}>
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
            <span className="info-label">Token Address</span>
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
                onClick={(e) => { e.stopPropagation(); copyToClipboard(community.cToken); toast.info('Token address copied!'); }}
                title="Copy token address"
              >
                📋
              </button>
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">Owner</span>
            <span className="info-value" style={{ fontFamily: 'monospace' }}>{shortenAddress(community.owner?.id)}</span>
          </div>
          <div className="info-item" style={{ position: 'relative' }}>
            <span className="info-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              DAO Fund Ratio
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
                title="Click for details"
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
                  <span>DAO Fund Ratio (DAO基金比例)</span>
                  <button 
                    onClick={() => setShowFeeRatioPopover(false)}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '14px', padding: 0 }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ textTransform: 'none', letterSpacing: 'normal', fontWeight: 'normal' }}>
                  分发资金将以一定比例进入到DAO基金地址中
                </div>
              </div>
            )}
          </div>
          <div className="info-item">
            <span className="info-label">Reward Rate</span>
            <span className="info-value">
              {rewardRate !== null ? `${formatTokenAmount(rewardRate, tokenInfo?.decimals || 18, 4)}${rewardRateUnit}` : '...'}
            </span>
          </div>
        </div>

        {/* Owner admin panel */}
        {isOwner && (
          <div className="admin-panel">
            <div className="admin-panel-header">
              <span>⚙️ Admin Controls</span>
            </div>
            <div className="admin-actions">
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddPool(true)}>
                + Add Pool
              </button>
              <button className="btn btn-warning btn-sm" onClick={() => setShowAdjustRatios(true)}>
                📐 Adjust Pool Ratios
              </button>
              <button className="btn btn-info btn-sm" onClick={() => setShowSettings(true)}>
                ⚙️ Community Settings
              </button>
              <button className="btn btn-success btn-sm" onClick={handleWithdrawRevenue}>
                Withdraw Revenue
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
            Active Pools ({activePools.length})
          </button>
          <button className={`tab ${activeTab === 'devfund' ? 'active' : ''}`} onClick={() => setActiveTab('devfund')}>
            DAO Fund
          </button>
          <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            History
          </button>
        </div>

        {activeTab === 'history' ? (
          <HistoryTab operations={community.operationHistory} />
        ) : activeTab === 'devfund' ? (
          <div className="devfund-panel glass-card" style={{ padding: 'var(--space-6)', marginTop: 'var(--space-4)' }}>
            <h4 style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
              🏛️ DAO Fund Info
            </h4>
            <div className="devfund-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
              <div className="devfund-item glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.02)' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6, display: 'block', marginBottom: 'var(--space-1)' }}>DAO Fund Address</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 'var(--font-size-sm)', wordBreak: 'break-all' }}>
                  {community.daoFund ? (
                    <a href={getBscScanUrl(community.daoFund)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>
                      {community.daoFund}
                    </a>
                  ) : (
                    'Not Set'
                  )}
                </span>
              </div>
              <div className="devfund-item glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.02)' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6, display: 'block', marginBottom: 'var(--space-1)' }}>DAO Fund Ratio</span>
                <span style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)' }}>
                  {((displayFeeRatio || 0) / 100).toFixed(1)}%
                </span>
              </div>
              <div className="devfund-item glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(255,255,255,0.02)' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6, display: 'block', marginBottom: 'var(--space-1)' }}>Pending Rewards</span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-1)', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)', color: 'var(--color-success)' }}>
                    {retainedRevenue !== null ? `${formatTokenAmount(retainedRevenue, tokenInfo?.decimals || 18, 4)} ${tokenInfo?.symbol || 'tokens'}` : '...'}
                  </span>
                  {retainedRevenue > 0n && (
                    <button className="btn btn-success btn-xs" onClick={handleWithdrawRevenue} style={{ padding: '2px 8px', fontSize: 11 }}>
                      Claim Revenue
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : erc20Pools.length === 0 && otherPools.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div className="empty-state-title">No active pools</div>
            <div className="empty-state-desc">
              {isOwner ? 'Create your first staking pool!' : 'No pools to display.'}
            </div>
            {isOwner && (
              <button className="btn btn-primary" onClick={() => setShowAddPool(true)}>+ Add Pool</button>
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
                isOwner={isOwner}
                onRefresh={loadCommunity}
              />
            ))}
            {otherPools.map(pool => (
              <div key={pool.id} className="glass-card" style={{ padding: 'var(--space-6)', opacity: 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{pool.name || 'Pool'}</span>
                  <span className={getPoolTypeBadgeClass(pool.poolType)}>{getPoolTypeLabel(pool.poolType)}</span>
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}>
                  This pool type is not yet supported in the frontend.
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
          community={{ ...community, feeRatio: displayFeeRatio }}
          onClose={() => setShowSettings(false)}
          onSuccess={() => { setShowSettings(false); loadCommunity(); }}
        />
      )}
    </div>
  );
}

function HistoryTab({ operations }) {
  if (!operations || operations.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📜</div>
        <div className="empty-state-title">No history yet</div>
      </div>
    );
  }

  return (
    <div className="history-list">
      {operations.map(op => (
        <div key={op.id} className="history-item glass-card">
          <div className="history-type">
            <span className="badge badge-staking">{op.type}</span>
          </div>
          <div className="history-details">
            <span className="history-account">{shortenAddress(op.account?.id)}</span>
            {op.amount && op.amount !== '0' && (
              <span className="history-amount">{formatTokenAmount(op.amount)} tokens</span>
            )}
          </div>
          <div className="history-meta">
            <span>{formatDate(op.timestamp)}</span>
            <a href={getBscScanUrl(op.tx, 'tx')} target="_blank" rel="noopener noreferrer" className="history-tx">
              {shortenAddress(op.tx, 6)} ↗
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
