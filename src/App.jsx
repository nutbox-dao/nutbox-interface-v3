import { useEffect } from 'react';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from './config/wagmi';
import { Web3Provider } from './contexts/Web3Context';
import { ToastProvider } from './contexts/ToastContext';
import { LanguageProvider } from './contexts/LanguageContext';
import Header from './components/layout/Header';
import Home from './pages/Home';
import CommunityDetail from './pages/CommunityDetail';
import CreateCommunity from './pages/CreateCommunity';
import NFTMiningPoolDetail from './pages/NFTMiningPoolDetail';
import {
  SUPPORTED_CHAIN_IDS,
  getChainIdFromSlug,
  getChainPath,
} from './config/contracts';

import '@rainbow-me/rainbowkit/styles.css';
import { useWeb3 } from './contexts/Web3Context';

const queryClient = new QueryClient();

function ChainRouteGuard() {
  const { chainSlug } = useParams();
  const { activeChainId, switchNetwork } = useWeb3();
  const chainId = getChainIdFromSlug(chainSlug);

  useEffect(() => {
    if (chainId && activeChainId !== chainId) {
      switchNetwork(chainId);
    }
  }, [activeChainId, chainId, switchNetwork]);

  if (!chainId) {
    return <Navigate to={getChainPath(activeChainId)} replace />;
  }

  if (activeChainId !== chainId) {
    return (
      <main className="page container">
        <div className="empty-state">
          <span className="spinner" />
        </div>
      </main>
    );
  }

  return <Outlet />;
}

function LegacyRouteRedirect({ page }) {
  const params = useParams();
  const location = useLocation();
  const { activeChainId } = useWeb3();
  const searchParams = new URLSearchParams(location.search);
  const requestedChainId = Number(searchParams.get('chainId'));
  const chainId = SUPPORTED_CHAIN_IDS.includes(requestedChainId)
    ? requestedChainId
    : activeChainId;
  searchParams.delete('chainId');

  let suffix = '';
  if (page === 'create') suffix = '/create';
  if (page === 'community') suffix = `/community/${params.address}`;
  if (page === 'pool') suffix = `/community/${params.communityAddress}/pool/${params.poolAddress}`;

  const search = searchParams.toString();
  return <Navigate to={`${getChainPath(chainId, suffix)}${search ? `?${search}` : ''}`} replace />;
}

function Footer() {
  const { network, contracts } = useWeb3();
  return (
    <footer style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-6)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', borderTop: '1px solid var(--color-border)' }}>
      <p>Nutbox Protocol · Community Staking on {network.name}</p>
      <p style={{ marginTop: 'var(--space-2)' }}>
        <a href={`${network.explorerUrl}/address/${contracts.CommunityFactory}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-tertiary)' }}>Contracts ↗</a>
      </p>
    </footer>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider>
            <Web3Provider>
              <ToastProvider>
                <LanguageProvider>
                  <Header />
                  <Routes>
                    <Route path="/:chainSlug" element={<ChainRouteGuard />}>
                      <Route index element={<Home />} />
                      <Route path="community/:address" element={<CommunityDetail />} />
                      <Route path="community/:communityAddress/pool/:poolAddress" element={<NFTMiningPoolDetail />} />
                      <Route path="create" element={<CreateCommunity />} />
                    </Route>

                    <Route path="/" element={<LegacyRouteRedirect page="home" />} />
                    <Route path="/community/:address" element={<LegacyRouteRedirect page="community" />} />
                    <Route path="/community/:communityAddress/pool/:poolAddress" element={<LegacyRouteRedirect page="pool" />} />
                    <Route path="/create" element={<LegacyRouteRedirect page="create" />} />
                    <Route path="*" element={<LegacyRouteRedirect page="home" />} />
                  </Routes>
                  <Footer />
                </LanguageProvider>
              </ToastProvider>
            </Web3Provider>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </BrowserRouter>
  );
}
