import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchWalnutStats, fetchCommunities } from '../config/subgraph';
import { copyToClipboard, shortenAddress } from '../utils/helpers';
import { useLanguage } from '../contexts/LanguageContext';
import { useWeb3 } from '../contexts/Web3Context';
import { useToast } from '../contexts/ToastContext';
import { getChainPath } from '../config/contracts';
import './Home.css';

const COMMUNITY_PAGE_SIZE = 100;

function mergeCommunities(current, incoming) {
  const byId = new Map(current.map(community => [community.id.toLowerCase(), community]));
  incoming.forEach(community => {
    byId.set(community.id.toLowerCase(), community);
  });
  return [...byId.values()];
}

export default function Home() {
  const [stats, setStats] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [searchCommunities, setSearchCommunities] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchTotal, setSearchTotal] = useState(null);
  const sentinelRef = useRef(null);
  // 翻页锁放在 ref 里，避免哨兵连续进入视口时把同一页请求两次。
  const pagingRef = useRef({ page: 0, hasMore: false, loading: false, chainId: null });
  const searchPagingRef = useRef({ page: 0, hasMore: false, loading: false, chainId: null, query: '' });
  const { t } = useLanguage();
  const { activeChainId, network } = useWeb3();

  useEffect(() => {
    let cancelled = false;
    pagingRef.current = { page: 0, hasMore: false, loading: true, chainId: activeChainId };
    setLoading(true);
    setLoadingMore(false);
    setHasMore(false);
    setCommunities([]);
    setStats(null);
    setSearchQuery('');

    fetchWalnutStats(activeChainId).then(nextStats => {
      if (!cancelled) setStats(nextStats);
    });

    fetchCommunities(COMMUNITY_PAGE_SIZE, 0, activeChainId)
      .then(result => {
        if (cancelled) return;
        setCommunities(result.communities);
        setHasMore(result.hasMore);
        pagingRef.current = {
          page: 1,
          hasMore: result.hasMore,
          loading: false,
          chainId: activeChainId,
        };
      })
      .catch(err => {
        console.error('Failed to load data:', err);
        if (!cancelled) pagingRef.current.loading = false;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeChainId]);

  useEffect(() => {
    const query = searchQuery.trim().replace(/^\$/, '');
    if (!query) {
      setActiveQuery('');
      return undefined;
    }
    const handle = setTimeout(() => setActiveQuery(query), 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    if (!activeQuery) {
      setSearchCommunities([]);
      setSearchHasMore(false);
      setSearchTotal(null);
      setSearchLoading(false);
      searchPagingRef.current = { page: 0, hasMore: false, loading: false, chainId: activeChainId, query: '' };
      return undefined;
    }

    let cancelled = false;
    setSearchLoading(true);
    setSearchCommunities([]);
    setSearchHasMore(false);
    setSearchTotal(null);
    searchPagingRef.current = { page: 0, hasMore: false, loading: true, chainId: activeChainId, query: activeQuery };

    fetchCommunities(COMMUNITY_PAGE_SIZE, 0, activeChainId, activeQuery)
      .then(result => {
        if (cancelled) return;
        setSearchCommunities(result.communities);
        setSearchHasMore(result.hasMore);
        setSearchTotal(result.total);
        searchPagingRef.current = {
          page: 1,
          hasMore: result.hasMore,
          loading: false,
          chainId: activeChainId,
          query: activeQuery,
        };
      })
      .catch(err => {
        console.error('Failed to search communities:', err);
        if (!cancelled) searchPagingRef.current.loading = false;
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeQuery, activeChainId]);

  const loadMore = useCallback(async () => {
    const searching = Boolean(activeQuery);
    const paging = searching ? searchPagingRef.current : pagingRef.current;
    if (paging.loading || !paging.hasMore || paging.chainId !== activeChainId) return;
    if (searching && paging.query !== activeQuery) return;

    const page = paging.page;
    paging.loading = true;
    setLoadingMore(true);
    try {
      const result = await fetchCommunities(
        COMMUNITY_PAGE_SIZE,
        page * COMMUNITY_PAGE_SIZE,
        activeChainId,
        searching ? activeQuery : '',
      );
      const currentPaging = searching ? searchPagingRef.current : pagingRef.current;
      if (currentPaging.chainId !== activeChainId) return;
      if (searching && currentPaging.query !== activeQuery) return;

      const append = current => mergeCommunities(current, result.communities);
      if (searching) {
        setSearchCommunities(append);
        setSearchHasMore(result.hasMore);
        if (result.total != null) setSearchTotal(result.total);
      } else {
        setCommunities(append);
        setHasMore(result.hasMore);
      }
      const nextPaging = {
        page: page + 1,
        hasMore: result.hasMore,
        loading: false,
        chainId: activeChainId,
        query: searching ? activeQuery : '',
      };
      if (searching) searchPagingRef.current = nextPaging;
      else pagingRef.current = nextPaging;
    } catch (err) {
      console.error('Failed to load more communities:', err);
      const currentPaging = searching ? searchPagingRef.current : pagingRef.current;
      if (currentPaging.chainId === activeChainId) currentPaging.loading = false;
    } finally {
      const currentPaging = searching ? searchPagingRef.current : pagingRef.current;
      if (currentPaging.chainId === activeChainId) setLoadingMore(false);
    }
  }, [activeChainId, activeQuery]);

  const visibleCommunities = activeQuery ? searchCommunities : communities;
  const visibleLoading = activeQuery ? searchLoading && searchCommunities.length === 0 : loading;
  const visibleHasMore = activeQuery ? searchHasMore : hasMore;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || visibleLoading || !visibleHasMore) return undefined;

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { rootMargin: '240px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visibleLoading, visibleHasMore, loadMore, communities.length, searchCommunities.length]);

  return (
    <div className="page">
      {/* ── Hero Section ── */}
      <section className="hero">
        <div className="container">
          <div className="hero-content">
            <div className="hero-badge">{t('home.heroBadge', { network: network.shortName })}</div>
            <h1 className="hero-title">
              {t('home.heroTitle1')}<span className="gradient-text">{t('home.heroTitle2')}</span>
            </h1>
            <p className="hero-subtitle">
              {t('home.heroSubtitle', { network: network.name })}
            </p>
            <div className="hero-actions">
              <Link to={getChainPath(activeChainId, 'create')} className="btn btn-primary btn-lg">
                {t('home.createBtn')}
              </Link>
            </div>
          </div>

          {/* ── Stats Row ── */}
          <div className="stats-row">
            <div className="stat-card glass-card">
              <div className="stat-value count-up">
                {stats === null ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (stats.totalCommunities || 0)}
              </div>
              <div className="stat-label">{t('home.statsCommunities')}</div>
            </div>
            <div className="stat-card glass-card">
              <div className="stat-value count-up">
                {stats === null ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (stats.totalPools || 0)}
              </div>
              <div className="stat-label">{t('home.statsPools')}</div>
            </div>
            <div className="stat-card glass-card">
              <div className="stat-value count-up">
                {stats === null ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (stats.totalUsers || 0)}
              </div>
              <div className="stat-label">{t('home.statsUsers')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Communities List ── */}
      <section className="container" style={{ marginTop: 'var(--space-12)' }}>
        <div className="section-header">
          <h2 className="section-title">{t('home.sectionTitle')}</h2>
          <Link to={getChainPath(activeChainId, 'create')} className="btn btn-ghost">{t('home.createNew')}</Link>
        </div>

        {((!loading && communities.length > 0) || searchQuery) && (
          <div className="community-search-row">
            <label className="community-search">
              <span className="community-search-icon" aria-hidden="true">⌕</span>
              <input
                type="search"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder={t('home.searchPlaceholder')}
                aria-label={t('home.searchLabel')}
                autoComplete="off"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="community-search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label={t('home.searchClear')}
                >
                  ×
                </button>
              )}
            </label>
            {activeQuery && !searchLoading && (
              <span className="community-search-count">
                {t('home.searchCount', { count: searchTotal ?? searchCommunities.length })}
              </span>
            )}
          </div>
        )}

        {visibleLoading ? (
          <div className="grid-communities">
            {[1, 2, 3].map(i => (
              <div key={i} className="community-card glass-card">
                <div className="skeleton" style={{ width: '60%', height: 24, marginBottom: 12 }} />
                <div className="skeleton" style={{ width: '100%', height: 16, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: '80%', height: 16 }} />
              </div>
            ))}
          </div>
        ) : activeQuery && visibleCommunities.length === 0 ? (
          <div className="empty-state community-search-empty">
            <div className="empty-state-icon">⌕</div>
            <div className="empty-state-title">{t('home.searchNoResults')}</div>
            <div className="empty-state-desc">{t('home.searchNoResultsDesc')}</div>
            <button type="button" className="btn btn-ghost" onClick={() => setSearchQuery('')}>
              {t('home.searchClear')}
            </button>
          </div>
        ) : communities.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🌰</div>
            <div className="empty-state-title">{t('home.noCommunitiesTitle')}</div>
            <div className="empty-state-desc">{t('home.noCommunitiesDesc')}</div>
            <Link to={getChainPath(activeChainId, 'create')} className="btn btn-primary">{t('home.createBtn')}</Link>
          </div>
        ) : (
          <div className="grid-communities">
            {visibleCommunities.map(community => (
              <CommunityCard key={community.id} community={community} />
            ))}
          </div>
        )}

        {!visibleLoading && visibleHasMore && (
          <div
            ref={sentinelRef}
            className={`community-load-more${loadingMore ? ' is-loading' : ''}`}
            aria-live="polite"
          >
            {loadingMore ? t('home.loadingMore') : ''}
          </div>
        )}
      </section>
    </div>
  );
}

function CommunityCard({ community }) {
  const activePools = community.pools?.filter(p => p.status === 'OPENED') || [];
  const tags = Array.isArray(community.tags) ? community.tags : [];
  const previewBadges = [
    ...tags.map((tag, index) => ({
      key: `tag-${tag}-${index}`,
      label: `#${tag}`,
      className: 'badge-staking',
    })),
    ...activePools.map(pool => ({
      key: `pool-${pool.id}`,
      label: pool.name || pool.poolType,
      className: pool.poolType?.includes('LOCKING') ? 'badge-locking' : 'badge-staking',
    })),
  ];
  const displayName = community.name
    || community.tokenName
    || community.tokenSymbol
    || shortenAddress(community.cToken);
  const { t, language } = useLanguage();
  const { activeChainId } = useWeb3();
  const toast = useToast();

  const handleCopyCommunityAddress = async event => {
    event.preventDefault();
    event.stopPropagation();
    const copied = await copyToClipboard(community.id);
    if (copied) {
      toast.info(t('common.copySuccess'));
    } else {
      toast.error(language === 'zh' ? '复制地址失败' : 'Failed to copy address');
    }
  };

  return (
    <Link to={getChainPath(activeChainId, `community/${community.id}`)} className="community-card glass-card" id={`community-${community.id}`}>
      <div className="community-card-header">
        <div className="community-avatar">
          {community.tick?.slice(0, 2)
            || community.tokenSymbol?.slice(0, 2)
            || community.cToken?.slice(2, 4).toUpperCase()
            || 'N'}
          {community.logo && (
            <img
              src={community.logo}
              alt={displayName}
              className="community-avatar-img"
              onError={({ currentTarget }) => { currentTarget.style.display = 'none'; }}
            />
          )}
        </div>
        <div className="community-meta">
          <div className="community-name">
            {displayName}
            {community.tick && <span className="community-tick">${community.tick}</span>}
          </div>
          <div className="community-address" title={community.id}>
            <span>{shortenAddress(community.id)}</span>
            <button
              type="button"
              className="community-address-copy"
              onClick={handleCopyCommunityAddress}
              title={language === 'zh' ? '复制社区合约地址' : 'Copy community contract address'}
              aria-label={language === 'zh' ? '复制社区合约地址' : 'Copy community contract address'}
            >
              📋
            </button>
          </div>
        </div>
      </div>

      <div className="community-description">
        {community.description || '\u00a0'}
      </div>

      <div className="community-stats-row">
        <div className="community-stat">
          <span className="community-stat-value">{activePools.length}</span>
          <span className="community-stat-label">{t('home.cardActivePools')}</span>
        </div>
        <div className="community-stat">
          <span className="community-stat-value">{community.usersCount || 0}</span>
          <span className="community-stat-label">{t('home.cardUsers')}</span>
        </div>
        <div className="community-stat">
          <span className="community-stat-value">{community.poolsCount || 0}</span>
          <span className="community-stat-label">{t('home.cardTotalPools')}</span>
        </div>
      </div>

      <div className="community-badges-preview" aria-hidden={previewBadges.length === 0}>
        {previewBadges.slice(0, 3).map(badge => (
          <span key={badge.key} className={`badge ${badge.className}`}>
            {badge.label}
          </span>
        ))}
        {previewBadges.length > 3 && (
          <span className="badge community-preview-more">
            +{previewBadges.length - 3}
          </span>
        )}
      </div>

      <div className="community-card-footer">
        <span className="community-ctoken" title={community.cToken}>
          CToken: {shortenAddress(community.cToken)}
        </span>
        <span className="community-fee">
          {t('home.cardFee')}: {((community.feeRatio || 0) / 100).toFixed(1)}%
        </span>
      </div>
    </Link>
  );
}
