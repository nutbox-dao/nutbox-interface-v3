import { createContext, useContext, useMemo, useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient, useSwitchChain } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { ethers } from 'ethers';
import {
  DEFAULT_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  getNetworkConfig,
} from '../config/contracts';

const Web3Context = createContext(null);
const STORAGE_KEY = 'walnut_chain_id';

function initialChainId() {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return SUPPORTED_CHAIN_IDS.includes(stored) ? stored : DEFAULT_CHAIN_ID;
}

function walletClientToEthersSigner(walletClient) {
  if (!walletClient) return null;
  const { account, chain, transport } = walletClient;
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  };
  return new ethers.BrowserProvider(transport, network).getSigner(account.address);
}

export function Web3Provider({ children }) {
  const { address: account, isConnected, chainId: walletChainId } = useAccount();
  const { isPending: connecting, error: connectError } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [selectedChainId, setSelectedChainId] = useState(initialChainId);
  const [walletSigner, setWalletSigner] = useState(null);

  useEffect(() => {
    if (SUPPORTED_CHAIN_IDS.includes(walletChainId)) {
      setSelectedChainId(walletChainId);
      localStorage.setItem(STORAGE_KEY, String(walletChainId));
    }
  }, [walletChainId]);

  useEffect(() => {
    if (!walletClient) {
      setWalletSigner(null);
      return;
    }
    let cancelled = false;
    walletClientToEthersSigner(walletClient)
      .then((nextSigner) => { if (!cancelled) setWalletSigner(nextSigner); })
      .catch(() => { if (!cancelled) setWalletSigner(null); });
    return () => { cancelled = true; };
  }, [walletClient]);

  const network = getNetworkConfig(selectedChainId);
  const readProvider = useMemo(
    () => new ethers.JsonRpcProvider(network.rpcUrls[0], network.id),
    [network],
  );

  const provider = useMemo(() => {
    if (!walletClient) return null;
    const { chain, transport } = walletClient;
    return new ethers.BrowserProvider(transport, { chainId: chain.id, name: chain.name });
  }, [walletClient]);

  const isCorrectChain = walletChainId === selectedChainId;
  const signer = isCorrectChain ? walletSigner : null;

  const switchNetwork = async (nextChainId) => {
    const id = Number(nextChainId);
    if (!SUPPORTED_CHAIN_IDS.includes(id)) return;
    setSelectedChainId(id);
    localStorage.setItem(STORAGE_KEY, String(id));
    if (isConnected && walletChainId !== id) {
      try {
        await switchChainAsync({ chainId: id });
      } catch (err) {
        console.error('Failed to switch chain:', err);
      }
    }
  };

  const value = {
    account: account ?? null,
    provider,
    signer,
    chainId: walletChainId ?? null,
    activeChainId: selectedChainId,
    network,
    contracts: network.contracts,
    connecting,
    error: connectError?.message ?? null,
    isCorrectChain,
    isConnected: !!account && isConnected,
    readProvider,
    connect: () => openConnectModal?.(),
    disconnect: () => disconnectAsync(),
    switchNetwork,
    // Compatibility for existing callers: switch to the currently selected app network.
    switchToBSC: () => switchNetwork(selectedChainId),
  };

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}

export function useWeb3() {
  const context = useContext(Web3Context);
  if (!context) throw new Error('useWeb3 must be used within Web3Provider');
  return context;
}
