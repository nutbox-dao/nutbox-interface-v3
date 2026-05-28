import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchWalnutStats, fetchCommunities } from '../config/subgraph';
import { formatTokenAmount, shortenAddress, formatCompact } from '../utils/helpers';
import './Home.css';

export default function Home() {
  const [stats, setStats] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);

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
            <div className="hero-badge">🌰 Community Staking Protocol on BSC</div>
            <h1 className="hero-title">
              Build Your <span className="gradient-text">Staking Economy</span>
            </h1>
            <p className="hero-subtitle">
              Create communities, deploy staking pools, and distribute rewards — all powered by smart contracts on BNB Smart Chain.
            </p>
            <div className="hero-actions">
              <Link to="/create" className="btn btn-primary btn-lg">
                Create Community
              </Link>
            </div>
          </div>

          {/* ── Stats Row ── */}
          <div className="stats-row">
            <div className="stat-card glass-card">
              <div className="stat-value count-up">
                {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (stats?.totalCommunities || 0)}
              </div>
              <div className="stat-label">Communities</div>
            </div>
            <div className="stat-card glass-card">
              <div className="stat-value count-up">
                {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (stats?.totalPools || 0)}
              </div>
              <div className="stat-label">Pools</div>
            </div>
            <div className="stat-card glass-card">
              <div className="stat-value count-up">
                {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (stats?.totalUsers || 0)}
              </div>
              <div className="stat-label">Users</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Communities List ── */}
      <section className="container" style={{ marginTop: 'var(--space-12)' }}>
        <div className="section-header">
          <h2 className="section-title">Communities</h2>
          <Link to="/create" className="btn btn-ghost">+ Create New</Link>
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
            <div className="empty-state-title">No communities yet</div>
            <div className="empty-state-desc">Be the first to create a community staking economy!</div>
            <Link to="/create" className="btn btn-primary">Create Community</Link>
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
          <span className="community-stat-label">Active Pools</span>
        </div>
        <div className="community-stat">
          <span className="community-stat-value">{community.usersCount || 0}</span>
          <span className="community-stat-label">Users</span>
        </div>
        <div className="community-stat">
          <span className="community-stat-value">{community.poolsCount || 0}</span>
          <span className="community-stat-label">Total Pools</span>
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
          Fee: {((community.feeRatio || 0) / 100).toFixed(1)}%
        </span>
      </div>
    </Link>
  );
}
