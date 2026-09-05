import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchWalnutStats, fetchCommunities } from '../config/subgraph';
import { copyToClipboard, shortenAddress } from '../utils/helpers';
import { useLanguage } from '../contexts/LanguageContext';
import { useWeb3 } from '../contexts/Web3Context';
import { useToast } from '../contexts/ToastContext';
import { getChainPath } from '../config/contracts';
import './Home.css';

const COMMUNITY_PAGE_SIZE = 100;
const MAX_COMMUNITY_PAGES = 100;

async function fetchAllCommunities(chainId) {
  const allCommunities = [];

  for (let page = 0; page < MAX_COMMUNITY_PAGES; page += 1) {
    const communityPage = await fetchCommunities(
      COMMUNITY_PAGE_SIZE,
      page * COMMUNITY_PAGE_SIZE,
      chainId,
    );
    allCommunities.push(...communityPage);
    if (communityPage.length < COMMUNITY_PAGE_SIZE) break;
  }

  return [...new Map(allCommunities.map(community => [community.id.toLowerCase(), community])).values()];
}

export default function Home() {
  const [stats, setStats] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const { t } = useLanguage();
  const { activeChainId, network } = useWeb3();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setSearchQuery('');
      try {
        const [walnutStats, communityList] = await Promise.all([
          fetchWalnutStats(activeChainId),
          fetchAllCommunities(activeChainId),
        ]);
        if (!cancelled) {
          setStats(walnutStats);
          setCommunities(communityList);
        }
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [activeChainId]);

  const normalizedSearch = searchQuery.trim().toLowerCase().replace(/^\$/, '');
  const filteredCommunities = useMemo(() => {
    if (!normalizedSearch) return communities;

    return communities.filter(community => {
      const searchableValues = [
        community.name,
        community.tick,
        community.tokenName,
        community.tokenSymbol,
        community.id,
        community.cToken,
        community.owner?.id,
        ...(Array.isArray(community.tags) ? community.tags : []),
      ];
      return searchableValues.some(value => String(value || '').toLowerCase().includes(normalizedSearch));
    });
  }, [communities, normalizedSearch]);

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
                {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (stats?.totalCommunities || 0)}
              </div>
              <div className="stat-label">{t('home.statsCommunities')}</div>
            </div>
            <div className="stat-card glass-card">
              <div className="stat-value count-up">
                {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (stats?.totalPools || 0)}
              </div>
              <div className="stat-label">{t('home.statsPools')}</div>
            </div>
            <div className="stat-card glass-card">
              <div className="stat-value count-up">
                {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (stats?.totalUsers || 0)}
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

        {!loading && communities.length > 0 && (
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
            {normalizedSearch && (
              <span className="community-search-count">
                {t('home.searchCount', { count: filteredCommunities.length })}
              </span>
            )}
          </div>
        )}

        {loading ? (
          <div className="grid-communities">
            {[1, 2, 3].map(i => (
              <div key={i} className="community-card glass-card">
                <div className="skeleton" style={{ width: '60%', height: 24, marginBottom: 12 }} />
                <div className="skeleton" style={{ width: '100%', height: 16, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: '80%', height: 16 }} />
              </div>
            ))}
          </div>
        ) : communities.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🌰</div>
            <div className="empty-state-title">{t('home.noCommunitiesTitle')}</div>
            <div className="empty-state-desc">{t('home.noCommunitiesDesc')}</div>
            <Link to={getChainPath(activeChainId, 'create')} className="btn btn-primary">{t('home.createBtn')}</Link>
          </div>
        ) : filteredCommunities.length === 0 ? (
          <div className="empty-state community-search-empty">
            <div className="empty-state-icon">⌕</div>
            <div className="empty-state-title">{t('home.searchNoResults')}</div>
            <div className="empty-state-desc">{t('home.searchNoResultsDesc')}</div>
            <button type="button" className="btn btn-ghost" onClick={() => setSearchQuery('')}>
              {t('home.searchClear')}
            </button>
          </div>
        ) : (
          <div className="grid-communities">
            {filteredCommunities.map(community => (
              <CommunityCard key={community.id} community={community} />
            ))}
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
