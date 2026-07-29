import { useLanguage } from '../../contexts/LanguageContext';
import { getBscScanUrl, shortenAddress } from '../../utils/helpers';

export function PoolCardHeader({
  name,
  typeLabel,
  typeClassName = 'badge',
  ratio = 0,
  status,
  subtitle,
}) {
  const { t } = useLanguage();
  const isActive = status === 'OPENED';

  return (
    <div className="pool-card-header">
      <div className="pool-card-title-row">
        <div className="pool-card-title">
          <h3 className="pool-card-name">{name}</h3>
          {subtitle && <span className="pool-card-subtitle">{subtitle}</span>}
        </div>
        <span className={typeClassName}>{typeLabel}</span>
      </div>
      <div className="pool-card-header-meta">
        <div className="pool-ratio-highlight">
          <span className="pool-ratio-value">{(Number(ratio || 0) / 100).toFixed(1)}%</span>
        </div>
        <span className={`badge ${isActive ? 'badge-active' : 'badge-closed'}`}>
          {isActive ? t('common.active') : t('common.closed')}
        </span>
      </div>
    </div>
  );
}

export function PoolCardFooter({ address, explorerUrl, children }) {
  return (
    <div className="pool-card-footer">
      <a
        className="pool-contract-link"
        href={getBscScanUrl(address, 'address', explorerUrl)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {shortenAddress(address)} ↗
      </a>
      {children && <div className="pool-card-footer-actions">{children}</div>}
    </div>
  );
}
