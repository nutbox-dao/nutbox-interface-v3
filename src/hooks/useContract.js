import { useMemo } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../contexts/Web3Context';
import {
  CommitteeABI,
  CommunityFactoryABI,
  CommunityABI,
  ERC20StakingABI,
  ERC20LockingABI,
  LinearCalculatorABI,
  HourlyTickCalculatorABI,
  ERC20ABI,
} from '../config/abis';

/**
 * Get a contract instance. If signer is available, uses signer (write-capable).
 * Falls back to readProvider (read-only).
 */
export function useContract(address, abi) {
  const { signer, readProvider } = useWeb3();
  return useMemo(() => {
    if (!address || !abi) return null;
    try {
      const signerOrProvider = signer || readProvider;
      return new ethers.Contract(address, abi, signerOrProvider);
    } catch {
      return null;
    }
  }, [address, abi, signer, readProvider]);
}

/** Read-only contract (always uses readProvider) */
export function useReadContract(address, abi) {
  const { readProvider } = useWeb3();
  return useMemo(() => {
    if (!address || !abi) return null;
    try {
      return new ethers.Contract(address, abi, readProvider);
    } catch {
      return null;
    }
  }, [address, abi, readProvider]);
}

// ──── Pre-configured contract hooks ────

export function useCommittee() {
  const { contracts } = useWeb3();
  return useReadContract(contracts.Committee, CommitteeABI);
}

export function useCommunityFactory() {
  const { contracts } = useWeb3();
  return useContract(contracts.CommunityFactory, CommunityFactoryABI);
}

export function useCommunity(address) {
  return useContract(address, CommunityABI);
}

export function useCommunityRead(address) {
  return useReadContract(address, CommunityABI);
}

export function useERC20Staking(address) {
  return useContract(address, ERC20StakingABI);
}

export function useERC20Locking(address) {
  return useContract(address, ERC20LockingABI);
}

export function useLinearCalculator() {
  const { contracts } = useWeb3();
  return useReadContract(contracts.LinearCalculator, LinearCalculatorABI);
}

export function useLinearTimeCalculator() {
  const { contracts } = useWeb3();
  return useReadContract(contracts.LinearTimeCalculator, LinearCalculatorABI);
}

export function useHourlyTickCalculator() {
  const { contracts } = useWeb3();
  return useReadContract(contracts.HourlyTickCalculator, HourlyTickCalculatorABI);
}

export function useERC20(address) {
  return useContract(address, ERC20ABI);
}

export function useERC20Read(address) {
  return useReadContract(address, ERC20ABI);
}
