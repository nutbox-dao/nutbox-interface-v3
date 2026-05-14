import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { bsc } from 'wagmi/chains';

// Get your WalletConnect Project ID at https://cloud.walletconnect.com
// Set VITE_WALLETCONNECT_PROJECT_ID in your .env file
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'b7f8b5543ead3e8e46cf3c57b1b49d8a';

export const wagmiConfig = getDefaultConfig({
  appName: 'Nutbox Protocol',
  projectId,
  chains: [bsc],
  ssr: false,
});
