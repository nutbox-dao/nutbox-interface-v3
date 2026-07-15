import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';
import { bsc } from 'wagmi/chains';
import { NETWORKS, RH_CHAIN_ID } from './contracts';

const rhNetwork = NETWORKS[RH_CHAIN_ID];

export const robinhood = defineChain({
  id: RH_CHAIN_ID,
  name: rhNetwork.name,
  nativeCurrency: rhNetwork.nativeCurrency,
  rpcUrls: {
    default: { http: rhNetwork.rpcUrls },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: rhNetwork.explorerUrl },
  },
});

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'b7f8b5543ead3e8e46cf3c57b1b49d8a';

export const wagmiConfig = getDefaultConfig({
  appName: 'Nutbox Protocol',
  projectId,
  chains: [bsc, robinhood],
  ssr: false,
});
