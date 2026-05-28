import { Link } from 'react-router-dom';
import { useWeb3 } from '../../contexts/Web3Context';
import { shortenAddress } from '../../utils/helpers';
import './Header.css';

export default function Header() {
  const { account, isConnected, connecting, connect, disconnect, isCorrectChain, switchToBSC } = useWeb3();

  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="header-logo">
          <div className="logo-icon">
            <svg width="28" height="28" viewBox="0 0 64 64" fill="none">
              <defs>
                <linearGradient id="logoGrad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#7c3aed"/>
                  <stop offset="50%" stopColor="#3b82f6"/>
                  <stop offset="100%" stopColor="#06b6d4"/>
                </linearGradient>
              </defs>
              <rect width="64" height="64" rx="14" fill="url(#logoGrad)"/>
              <text x="32" y="44" textAnchor="middle" fontFamily="Inter,sans-serif" fontWeight="800" fontSize="32" fill="white">N</text>
            </svg>
          </div>
          <span className="logo-text">Nutbox</span>
        </Link>

        <div className="header-actions">
          {isConnected ? (
            <>
              {!isCorrectChain && (
                <button className="btn btn-danger btn-sm" onClick={switchToBSC}>
                  Switch to BSC
                </button>
              )}
              <div className="wallet-info" onClick={disconnect} title="Click to disconnect">
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
                <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Connecting...</>
              ) : (
                'Connect Wallet'
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
