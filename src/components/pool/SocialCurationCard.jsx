import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { CommunityABI, ERC20ABI } from '../../config/abis';
import { fetchSocialClaimHistory } from '../../config/subgraph';
import { formatTokenAmount, formatTokenValue, shortenAddress, formatDate, getBscScanUrl } from '../../utils/helpers';
import { useLanguage } from '../../contexts/LanguageContext';
import { PoolCardFooter, PoolCardHeader } from './PoolCardTemplate';
import './PoolCard.css';

const SocialCurationABI = [
  'function totalClaimed() view returns (uint256)',
];

const PAGE_SIZE = 20;

export default function SocialCurationCard({ pool, communityAddress, communityToken, rewardRate, feeRatio = 0 }) {
  const { readProvider, activeChainId, network } = useWeb3();
  const { language, t } = useLanguage();

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
      const result = await fetchSocialClaimHistory(communityAddress, page, PAGE_SIZE, activeChainId);
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
  }, [communityAddress, activeChainId]);

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
    if (perHour < 0.0001) return `<0.0001${t('socialPool.perHour')}`;
    return `${perHour.toFixed(4)}${t('socialPool.perHour')}`;
  })();

  return (
    <div className="pool-card glass-card" id={`pool-${pool.id}`}>
      <PoolCardHeader
        name={pool.name || t('socialPool.fallbackName')}
        typeLabel={t('socialPool.typeName')}
        typeClassName="badge badge-social"
        ratio={pool.ratio}
        status={pool.status}
      />

      {/* Stats */}
      <div className="pool-stats-grid">
        <div className="pool-stat">
          <div className="pool-stat-label">{t('socialPool.totalDistributed')}</div>
          <div className="pool-stat-value">
            {loading ? <span className="skeleton" style={{ width: 80, height: 20, display: 'inline-block' }} /> :
              `${formatTokenAmount(totalClaimed, decimals)} ${symbol}`}
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">{t('socialPool.totalAvailable')}</div>
          <div className="pool-stat-value" style={{ color: 'var(--color-green)' }}>
            {loading ? <span className="skeleton" style={{ width: 80, height: 20, display: 'inline-block' }} /> :
              `${formatTokenAmount(totalAvailable, decimals)} ${symbol}`}
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">{t('socialPool.rewardRate')}</div>
          <div className="pool-stat-value">
            {formattedRate}
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">{t('socialPool.howItWorks')}</div>
          <div className="pool-stat-value" style={{ fontSize: 'var(--font-size-xs)' }}>
            <a href={`https://tagai.fun/tag-detail/${symbol}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
              TagAI ↗
            </a>
          </div>
        </div>
        <div className="pool-stat">
          <div className="pool-stat-label">{t('socialPool.vesting')}</div>
          <div className="pool-stat-value" style={{ fontSize: 'var(--font-size-xs)' }}>
            {t('socialPool.vestingValue')}
          </div>
        </div>
      </div>

      {/* Claim History */}
      <div className="pool-user-section" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('socialPool.claimHistory')}</span>
          {historyTotal > 0 && <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6 }}>{t('socialPool.claimCount', { count: historyTotal })}</span>}
        </div>

        {history.length === 0 && !historyLoading ? (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 'var(--space-4)' }}>
            {t('socialPool.noClaims')}
          </div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 240 }}>
            <table style={{ width: '100%', fontSize: 'var(--font-size-xs)', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--color-text-tertiary)', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '6px 4px', fontWeight: 500 }}>{t('socialPool.user')}</th>
                  <th style={{ padding: '6px 4px', fontWeight: 500, textAlign: 'right' }}>{t('socialPool.amount')}</th>
                  <th style={{ padding: '6px 4px', fontWeight: 500, textAlign: 'right' }}>{t('socialPool.time')}</th>
                  <th style={{ padding: '6px 4px', fontWeight: 500, textAlign: 'right' }}>{t('socialPool.transaction')}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => {
                  const validTx = typeof c.txHash === 'string' && /^0x[a-fA-F0-9]{64}$/.test(c.txHash);
                  return (
                    <tr key={`${c.user}-${c.orderId}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '6px 4px' }}>
                        <a href={getBscScanUrl(c.user, 'address', network.explorerUrl)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>
                          {shortenAddress(c.user, 4)}
                        </a>
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600 }}>
                        {formatTokenValue(c.amount, 2)} {symbol}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                        {formatDate(c.timestamp, language === 'zh' ? 'zh-CN' : 'en-US')}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {validTx ? (
                          <a
                            href={getBscScanUrl(c.txHash, 'tx', network.explorerUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t('socialPool.viewTransaction', { network: network.shortName })}
                            style={{ color: 'var(--color-text-tertiary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </a>
                        ) : (
                          <span style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
                  {historyLoading ? t('common.loading') : t('socialPool.loadMore')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <PoolCardFooter address={pool.id} explorerUrl={network.explorerUrl} />
    </div>
  );
}
