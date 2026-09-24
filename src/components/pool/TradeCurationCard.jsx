import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useLanguage } from '../../contexts/LanguageContext';
import { CommunityABI, ERC20ABI } from '../../config/abis';
import { fetchTradeClaimHistory } from '../../config/subgraph';
import { formatTokenAmount, shortenAddress, formatDate, getBscScanUrl } from '../../utils/helpers';
import { TradeCurationABI, tradePoolRewardRate } from '../../utils/tradeCuration';
import { PoolCardFooter, PoolCardHeader } from './PoolCardTemplate';
import './PoolCard.css';
import './TradeCurationCard.css';

const PAGE_SIZE = 20;

export default function TradeCurationCard({ pool, communityAddress, communityToken, tick, rewardRate, rewardRateUnit, feeRatio = 0 }) {
  const { readProvider, activeChainId, network } = useWeb3();
  const { t, language } = useLanguage();
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(false);
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(false);
  const decimals = communityToken?.decimals ?? 18;
  const symbol = communityToken?.symbol || '';
  const tokenAddress = communityToken?.address;

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    setStats(null);
    const load = async () => {
      if (!tokenAddress || busy) return;
      busy = true;
      try {
        const curation = new ethers.Contract(pool.id, TradeCurationABI, readProvider);
        const community = new ethers.Contract(communityAddress, CommunityABI, readProvider);
        const token = new ethers.Contract(tokenAddress, ERC20ABI, readProvider);
        const [claimed, pending, balance] = await Promise.all([
          curation.totalClaimed(), community.getPoolPendingRewards(pool.id, pool.id), token.balanceOf(pool.id),
        ]);
        if (!cancelled) { setStats({ claimed, available: pending + balance }); setStatsError(false); }
      } catch {
        if (!cancelled) setStatsError(true);
      } finally { busy = false; }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pool.id, communityAddress, tokenAddress, readProvider]);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    setHistory(null);
    setHistoryError(false);
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await fetchTradeClaimHistory(communityAddress, pool.id, page, PAGE_SIZE, activeChainId);
        if (!cancelled) { setHistory(result); setHistoryError(false); }
      } catch {
        if (!cancelled) setHistoryError(true);
      } finally { busy = false; }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [communityAddress, pool.id, activeChainId, page]);

  const rate = tradePoolRewardRate(rewardRate, feeRatio, pool.ratio);
  const unit = language === 'zh'
    ? ({ '/block': '/区块', '/sec': '/秒', '/hour': '/小时' }[rewardRateUnit] || rewardRateUnit || '')
    : rewardRateUnit || '';
  const amount = value => `${formatTokenAmount(value, decimals)} ${symbol}`;

  return (
    <div className="pool-card glass-card trade-curation-card" id={`pool-${pool.id}`}>
      <PoolCardHeader name={pool.name || t('tradePool.typeName')} typeLabel={t('tradePool.typeName')}
        typeClassName="badge badge-social" ratio={pool.ratio} status={pool.status} />
      <div className="pool-stats-grid">
        <div className="pool-stat"><div className="pool-stat-label">{t('socialPool.totalDistributed')}</div><div className="pool-stat-value">{statsError ? '—' : stats ? amount(stats.claimed) : '…'}</div></div>
        <div className="pool-stat"><div className="pool-stat-label">{t('socialPool.totalAvailable')}</div><div className="pool-stat-value">{statsError ? '—' : stats ? amount(stats.available) : '…'}</div></div>
        <div className="pool-stat"><div className="pool-stat-label">{t('socialPool.rewardRate')}</div><div className="pool-stat-value">{rate === null ? '—' : `${amount(rate)}${unit}`}</div></div>
        <div className="pool-stat"><div className="pool-stat-label">{t('socialPool.vesting')}</div><div className="pool-stat-value">{t('socialPool.vestingValue')}</div></div>
      </div>
      {statsError && <p role="status">{t('tradePool.loadError')}</p>}
      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{t('tradePool.description')}</p>
      <p style={{ fontSize: 'var(--font-size-xs)' }}>{t('tradePool.availableHint')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tick && <a className="btn btn-secondary btn-sm" href={`https://tagai.fun/bsc/tag-detail/${encodeURIComponent(tick)}`} target="_blank" rel="noopener noreferrer">{t('tradePool.participate')} ↗</a>}
        <a className="btn btn-primary btn-sm" href="https://tagai.fun/bsc/profile" target="_blank" rel="noopener noreferrer">{t('tradePool.claim')} ↗</a>
      </div>
      <div className="pool-user-section" style={{ flex: 1 }}>
        <strong>{t('socialPool.claimHistory')}</strong>
        {historyError ? <p role="status">{t('tradePool.historyError')}</p>
          : !history ? <p>{t('common.loading')}</p>
          : history.claims.length === 0 ? <p>{t('socialPool.noClaims')}</p>
          : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', fontSize: 'var(--font-size-xs)' }}>
            <thead><tr><th>{t('socialPool.user')}</th><th>{t('socialPool.amount')}</th><th>{t('socialPool.time')}</th><th>{t('socialPool.transaction')}</th></tr></thead>
            <tbody>{history.claims.map(claim => <tr key={claim.id}>
              <td><a href={getBscScanUrl(claim.user, 'address', network.explorerUrl)} target="_blank" rel="noopener noreferrer">{shortenAddress(claim.user, 4)}</a></td>
              <td>{amount(claim.amountRaw)}</td>
              <td>{formatDate(claim.timestamp, language === 'zh' ? 'zh-CN' : 'en-US')}</td>
              <td><a aria-label={t('socialPool.viewTransaction', { network: network.shortName })} href={getBscScanUrl(claim.txHash, 'tx', network.explorerUrl)} target="_blank" rel="noopener noreferrer">↗</a></td>
            </tr>)}</tbody>
          </table></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <button className="btn btn-ghost btn-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t('tradePool.previous')}</button>
          <span>{page + 1}</span>
          <button className="btn btn-ghost btn-xs" disabled={historyError || !history || (page + 1) * PAGE_SIZE >= history.total} onClick={() => setPage(p => p + 1)}>{t('tradePool.next')}</button>
        </div>
      </div>
      <PoolCardFooter address={pool.id} explorerUrl={network.explorerUrl} />
    </div>
  );
}
