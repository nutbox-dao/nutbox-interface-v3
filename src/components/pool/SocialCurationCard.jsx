import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { CommunityABI, ERC20ABI } from '../../config/abis';
import { fetchSocialClaimHistory } from '../../config/subgraph';
import { formatTokenAmount, shortenAddress, formatDate, getBscScanUrl } from '../../utils/helpers';
import './PoolCard.css';

const SocialCurationABI = [
  'function totalClaimed() view returns (uint256)',
];

const PAGE_SIZE = 20;

export default function SocialCurationCard({ pool, communityAddress, communityToken, rewardRate, feeRatio = 0 }) {
  const { readProvider } = useWeb3();

  const [loading, setLoading] = useState(true);
  const [totalClaimed, setTotalClaimed] = useState(0n);
  const [pendingInCommunity, setPendingInCommunity] = useState(0n);
  const [poolBalance, setPoolBalance] = useState(0n);

  // Claim history
  const [history, setHistory] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);

  const decimals = communityToken?.decimals || 18;
  const symbol = communityToken?.symbol || '';

  const loadPoolData = useCallback(async () => {
    try {
      const poolContract = new ethers.Contract(pool.id, SocialCurationABI, readProvider);
      const communityContract = new ethers.Contract(communityAddress, CommunityABI, readProvider);
      const tokenAddr = communityToken?.address;

      const promises = [poolContract.totalClaimed()];
      promises.push(communityContract.getPoolPendingRewards(pool.id, pool.id));
      if (tokenAddr) {
        const tokenContract = new ethers.Contract(tokenAddr, ERC20ABI, readProvider);
        promises.push(tokenContract.balanceOf(pool.id));
      }

      const results = await Promise.all(promises);
      setTotalClaimed(results[0]);
      setPendingInCommunity(results[1]);
      if (tokenAddr) setPoolBalance(results[2]);
    } catch (err) {
      console.error('Failed to load SocialCuration data:', err);
    } finally {
      setLoading(false);
    }
  }, [pool.id, communityAddress, readProvider, communityToken]);

  useEffect(() => {
    loadPoolData();
    const interval = setInterval(loadPoolData, 15000);
    return () => clearInterval(interval);
  }, [loadPoolData]);

  // Load claim history
  const loadHistory = useCallback(async (page) => {
    setHistoryLoading(true);
    try {
      const result = await fetchSocialClaimHistory(communityAddress, page, PAGE_SIZE);
      if (page === 0) {
        setHistory(result.claims);
      } else {
        setHistory(prev => [...prev, ...result.claims]);
      }
      setHistoryTotal(result.total);
      setHistoryPage(page);
    } catch (err) {
      console.error('Failed to load claim history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [communityAddress]);

  useEffect(() => {
    loadHistory(0);
  }, [loadHistory]);

  const hasMore = history.length < historyTotal;

  const totalAvailable = pendingInCommunity + poolBalance;

  const formattedRate = (() => {
    if (!rewardRate || rewardRate === 0n) return '—';
    const stakerRatio = 10000n - BigInt(feeRatio);
    const poolRatio = BigInt(pool.ratio || 10000);
    const actualRate = rewardRate * stakerRatio / 10000n * poolRatio / 10000n;
    const perHour = Number(ethers.formatUnits(actualRate, decimals));
    if (perHour < 0.0001) return '<0.0001/hr';
    return `${perHour.toFixed(4)}/hr`;
  })();

  return (
    <div className="pool-card glass-card" id={`pool-${pool.id}`}>
      {/* Header */}
      <div className="pool-card-header">
        <div className="pool-card-title-row">
          <h3 className="pool-card-name">{pool.name || 'Social Curation'}</h3>
          <span className="badge" style={{ background: 'rgba(139, 92, 246, 0.12)', color: '#a78bfa', fontSize: 11, padding: '2px 8px', borderRadius: 999 }}>
            Social Curation
          </span>
        </div>
        {pool.status === 'OPENED' ? (
          <span className="badge badge-active">Active</span>
        ) : (
          <span className="badge badge-closed">Closed</span>
        )}
      </div>

      {/* Stats */}
      <div className="pool-stats-grid">
        <div className="pool-stat">
          <div className="pool-stat-label">Total Distributed</div>
          <div className="pool-stat-value">
            {loading ? <span className="skeleton" style={{ width: 80, height: 20, display: 'inline-block' }} /> :
              `${formatTokenAmount(totalClaimed, decimals)} ${symbol}`}
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">Total Available</div>
          <div className="pool-stat-value" style={{ color: 'var(--color-green)' }}>
            {loading ? <span className="skeleton" style={{ width: 80, height: 20, display: 'inline-block' }} /> :
              `${formatTokenAmount(totalAvailable, decimals)} ${symbol}`}
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">Reward Rate</div>
          <div className="pool-stat-value">
            {formattedRate}
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">Pool Ratio</div>
          <div className="pool-stat-value">{((pool.ratio || 0) / 100).toFixed(1)}%</div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">How It Works</div>
          <div className="pool-stat-value" style={{ fontSize: 'var(--font-size-xs)' }}>
            <a href={`https://tagai.fun/tag-detail/${symbol}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
              TagAI ↗
            </a>
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">Vesting</div>
          <div className="pool-stat-value" style={{ fontSize: 'var(--font-size-xs)' }}>
            1+2 Day
          </div>
        </div>
      </div>

      {/* Claim History */}
      <div className="pool-user-section" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Claim History</span>
          {historyTotal > 0 && <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6 }}>{historyTotal} claims</span>}
        </div>

        {history.length === 0 && !historyLoading ? (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 'var(--space-4)' }}>
            No claims yet
          </div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 240 }}>
            <table style={{ width: '100%', fontSize: 'var(--font-size-xs)', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--color-text-tertiary)', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '6px 4px', fontWeight: 500 }}>User</th>
                  <th style={{ padding: '6px 4px', fontWeight: 500, textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '6px 4px', fontWeight: 500, textAlign: 'right' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => (
                  <tr key={`${c.user}-${c.orderId}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '6px 4px' }}>
                      <a href={getBscScanUrl(c.user)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>
                        {shortenAddress(c.user, 4)}
                      </a>
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600 }}>
                      {formatTokenAmount(BigInt(c.amount || 0), decimals, 2)} {symbol}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                      {formatDate(c.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && (
              <div style={{ textAlign: 'center', padding: 'var(--space-2)' }}>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => loadHistory(historyPage + 1)}
                  disabled={historyLoading}
                  style={{ fontSize: 11 }}
                >
                  {historyLoading ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pool address footer */}
      <div className="pool-card-footer" style={{ marginTop: 'auto' }}>
        <a href={getBscScanUrl(pool.id)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'monospace', color: 'var(--color-text-tertiary)' }}>
          {shortenAddress(pool.id)} ↗
        </a>
      </div>
    </div>
  );
}
