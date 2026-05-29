/**
 * Web3Context — Compatibility bridge over wagmi + RainbowKit.
 *
 * Exposes the same { account, provider, signer, chainId, connecting,
 * error, isConnected, isCorrectChain, readProvider, connect, disconnect,
 * switchToBSC } interface that the rest of the app relies on, so no other
 * files need to change after migrating to RainbowKit.
 */
import { createContext, useContext, useMemo, useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient, useSwitchChain } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { ethers } from 'ethers';
import { bsc } from 'wagmi/chains';
import { BSC_CONFIG, CHAIN_ID } from '../config/contracts';

const Web3Context = createContext(null);

/**
 * Convert a wagmi WalletClient (viem) into an ethers.js v6 Signer.
 * This lets existing ethers.Contract code continue to work unchanged.
 */
function walletClientToEthersSigner(walletClient) {
  if (!walletClient) return null;
  const { account, chain, transport } = walletClient;
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  };
  const provider = new ethers.BrowserProvider(transport, network);
  return provider.getSigner(account.address);
}

export function Web3Provider({ children }) {
  const { address: account, isConnected, chainId } = useAccount();
  const { isPending: connecting, error: connectError } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();

  const [signer, setSigner] = useState(null);

  // Build ethers Signer whenever walletClient changes
  useEffect(() => {
    if (!walletClient) {
      setSigner(null);
      return;
    }
    let cancelled = false;
    walletClientToEthersSigner(walletClient).then((s) => {
      if (!cancelled) setSigner(s);
    }).catch(() => {
      if (!cancelled) setSigner(null);
    });
    return () => { cancelled = true; };
  }, [walletClient]);

  // Build a read-only ethers Provider backed by the wagmi publicClient
  const readProvider = useMemo(() => {
    return new ethers.JsonRpcProvider(BSC_CONFIG.rpcUrls[0], CHAIN_ID);
  }, []);

  // Build an ethers BrowserProvider (write-capable) from walletClient transport
  const provider = useMemo(() => {
    if (!walletClient) return null;
    const { chain, transport } = walletClient;
    const network = { chainId: chain.id, name: chain.name };
    return new ethers.BrowserProvider(transport, network);
  }, [walletClient]);

  const isCorrectChain = chainId === CHAIN_ID;

  const connect = () => {
    openConnectModal?.();
  };

  const disconnect = async () => {
    await disconnectAsync();
  };

  const switchToBSC = async () => {
    try {
      await switchChainAsync({ chainId: bsc.id });
    } catch (err) {
      console.error('Failed to switch chain:', err);
    }
  };

  const value = {
    account: account ?? null,
    provider,
    signer,
    chainId: chainId ?? null,
    connecting,
    error: connectError?.message ?? null,
    isCorrectChain,
    isConnected: !!account && isConnected,
    readProvider,
    connect,
    disconnect,
    switchToBSC,
  };

  return (
    <Web3Context.Provider value={value}>
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3() {
  const context = useContext(Web3Context);
  if (!context) throw new Error('useWeb3 must be used within Web3Provider');
  return context;
}
