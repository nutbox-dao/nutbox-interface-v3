import { Link } from 'react-router-dom';
import { useWeb3 } from '../../contexts/Web3Context';
import { useLanguage } from '../../contexts/LanguageContext';
import { shortenAddress } from '../../utils/helpers';
import './Header.css';
import { NETWORKS } from '../../config/contracts';

export default function Header() {
  const { account, isConnected, connecting, connect, disconnect, isCorrectChain, switchToBSC, activeChainId, switchNetwork, network } = useWeb3();
  const { language, setLanguage, t } = useLanguage();

  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="header-logo">
          <img
            src="/logo_small.png"
            alt="Nutbox"
            className="logo-icon"
            width={28}
            height={28}
          />
          <span className="logo-text">Nutbox</span>
        </Link>

        <div className="header-actions">
          <select className="network-select" value={activeChainId} onChange={event => switchNetwork(Number(event.target.value))} aria-label="Network">
            {Object.values(NETWORKS).map(item => (
              <option key={item.id} value={item.id}>{item.shortName}</option>
            ))}
          </select>
          {isConnected ? (
            <>
              {!isCorrectChain && (
                <button className="btn btn-danger btn-sm" onClick={switchToBSC}>
                  {t('header.switchNetwork', { network: network.shortName })}
                </button>
              )}
              <div className="wallet-info" onClick={disconnect} title={t('header.disconnect')}>
                <div className="wallet-dot" />
                <span>{shortenAddress(account)}</span>
              </div>
            </>
          ) : (
            <button
              className="btn btn-primary"
              onClick={connect}
              disabled={connecting}
            >
              {connecting ? (
                <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {t('header.connecting')}</>
              ) : (
                t('header.connect')
              )}
            </button>
          )}

          {/* Language Toggle Button placed to the right of address/connect button */}
          <button 
            className="btn btn-ghost btn-sm lang-btn" 
            onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
            style={{ 
              marginLeft: 'var(--space-3)', 
              fontSize: 'var(--font-size-xs)', 
              padding: '6px 10px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '6px',
              color: 'var(--color-text-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              cursor: 'pointer'
            }}
          >
            {language === 'en' ? '🇨🇳 中文' : '🇬🇧 EN'}
          </button>
        </div>
      </div>
    </header>
  );
}
