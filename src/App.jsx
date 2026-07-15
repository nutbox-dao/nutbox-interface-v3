import { BrowserRouter, Routes, Route } from 'react-router-dom';
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

import '@rainbow-me/rainbowkit/styles.css';
import { useWeb3 } from './contexts/Web3Context';

const queryClient = new QueryClient();

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
                    <Route path="/" element={<Home />} />
                    <Route path="/community/:address" element={<CommunityDetail />} />
                    <Route path="/create" element={<CreateCommunity />} />
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
