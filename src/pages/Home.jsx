import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchWalnutStats, fetchCommunities } from '../config/subgraph';
import { formatTokenAmount, shortenAddress, formatCompact } from '../utils/helpers';
import { useLanguage } from '../contexts/LanguageContext';
import './Home.css';

export default function Home() {
  const [stats, setStats] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    async function load() {
      try {
        const [walnutStats, communityList] = await Promise.all([
          fetchWalnutStats(),
          fetchCommunities(50),
        ]);
        setStats(walnutStats);
        setCommunities(communityList);
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="page">
      {/* ── Hero Section ── */}
      <section className="hero">
        <div className="container">
          <div className="hero-content">
            <div className="hero-badge">{t('home.heroBadge')}</div>
            <h1 className="hero-title">
              {t('home.heroTitle1')}<span className="gradient-text">{t('home.heroTitle2')}</span>
            </h1>
            <p className="hero-subtitle">
              {t('home.heroSubtitle')}
            </p>
            <div className="hero-actions">
              <Link to="/create" className="btn btn-primary btn-lg">
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
          <Link to="/create" className="btn btn-ghost">{t('home.createNew')}</Link>
        </div>

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
            <Link to="/create" className="btn btn-primary">{t('home.createBtn')}</Link>
          </div>
        ) : (
          <div className="grid-communities">
            {communities.map(community => (
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
  const displayName = community.name || `Community #${community.index?.toString() || '?'}`;
  const { t } = useLanguage();

  return (
    <Link to={`/community/${community.id}`} className="community-card glass-card" id={`community-${community.id}`}>
      <div className="community-card-header">
        {community.logo ? (
          <img src={community.logo} alt={displayName} className="community-avatar-img" />
        ) : (
          <div className="community-avatar">
            {community.tick?.slice(0, 2) || community.cToken?.slice(2, 4).toUpperCase() || 'N'}
          </div>
        )}
        <div className="community-meta">
          <div className="community-name">
            {displayName}
            {community.tick && <span className="community-tick">${community.tick}</span>}
          </div>
          <div className="community-owner">
            by {shortenAddress(community.owner?.id)}
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

      {community.tags?.length > 0 && (
        <div className="community-pools-preview">
          {community.tags.map(tag => (
            <span key={tag} className="badge badge-staking">#{tag}</span>
          ))}
        </div>
      )}

      <div className="community-pools-preview">
        {activePools.slice(0, 3).map(pool => (
          <span key={pool.id} className={`badge ${pool.poolType?.includes('LOCKING') ? 'badge-locking' : 'badge-staking'}`}>
            {pool.name || pool.poolType}
          </span>
        ))}
        {activePools.length > 3 && (
          <span className="badge" style={{ background: 'var(--color-bg-glass)', color: 'var(--color-text-tertiary)' }}>
            +{activePools.length - 3}
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
