# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nutbox Protocol frontend — a BSC (BNB Smart Chain, chainId 56) dApp for creating community staking economies. Users can create communities with custom ERC20 tokens, deploy staking/locking pools, and distribute rewards via linear calculators.

## Commands

```bash
npm run dev       # Start Vite dev server (with HMR)
npm run build     # Production build to dist/
npm run lint      # ESLint check
npm run preview   # Preview production build locally
```

No test framework is configured. No TypeScript — this is plain JSX.

## Architecture

### Web3 Stack (two-layer)

The app uses **wagmi + RainbowKit** for wallet connection but **ethers.js v6** for all contract interactions. `Web3Context` (`src/contexts/Web3Context.jsx`) bridges these: it converts wagmi's viem WalletClient into an ethers Signer via `walletClientToEthersSigner()`, and exposes a consistent `{ account, signer, readProvider, provider, connect, disconnect, switchToBSC }` interface. All components use `useWeb3()` — never wagmi hooks directly.

- `readProvider`: ethers JsonRpcProvider pointing at BSC RPC (always available, even without wallet)
- `signer`: ethers Signer (only when wallet connected + on correct chain)

### Data Sources

- **Backend API** (`src/config/subgraph.js`): Despite the filename, this talks to the Nutbox backend (not The Graph). Vite dev proxy forwards `/nutbox` → `https://bsc-api.tagai.fun`. Endpoints: `/stats`, `/communities`, `/communities/:address/history`.
- **On-chain reads**: Pool data (totalStaked, userStaked, pendingRewards, etc.) is read directly from contracts via ethers, not from the API.

### Contract Layer

`src/config/contracts.js` — all BSC mainnet addresses (Committee, CommunityFactory, ERC20StakingFactory, ERC20LockingFactory, calculators, etc.).

`src/config/abis.js` — human-readable ABI fragments for each contract. Only includes functions/events used by the frontend.

`src/hooks/useContract.js` — `useContract(address, abi)` returns ethers.Contract with signer if available, else readProvider. `useReadContract()` always uses readProvider. Pre-configured hooks: `useCommittee()`, `useCommunityFactory()`, `useCommunity(addr)`, `useERC20Staking(addr)`, `useERC20Locking(addr)`, `useLinearCalculator()`.

### Key Data Flow

1. **Home page**: fetches community list + stats from API, renders CommunityCards
2. **CommunityDetail**: fetches community from API, then reads token info + reward rate on-chain
3. **PoolCard**: reads all pool state on-chain (stakeToken info, totalStaked, userStaked, pendingRewards, allowance, lockDuration, redeemRequests). Auto-refreshes every 15 seconds.
4. **CreateCommunity**: encodes token metadata (`encodeMintableTokenMeta`) + distribution policy (`encodeDistributionPolicy`) into bytes, calls `CommunityFactory.createCommunity()` with BNB fee
5. **AddPoolModal**: encodes pool metadata (stakeToken address for staking, address+lockDuration for locking), calls `Community.adminAddPool()` with fee

### Encoding Conventions

- Token metadata (`encodeMintableTokenMeta`): `[uint8 nameLen][name][uint8 symbolLen][symbol][uint256 supply][address owner]`
- Distribution policy (`encodeDistributionPolicy`): `[uint8 erasLength][uint256 startCursor, uint256 stopCursor, uint256 amountPerBlock]...`
- Pool metadata: staking = just the stakeToken address (20 bytes); locking = `[address][uint256 lockDurationSeconds]`

### Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | Home | Community list + stats |
| `/community/:address` | CommunityDetail | Pools, admin controls, history |
| `/create` | CreateCommunity | 3-step wizard: token → rewards → confirm |

### Styling

Plain CSS files co-located with components. CSS custom properties for theming (see `src/index.css`). Uses `glass-card` class for card containers. No CSS modules, no Tailwind.

### Context Providers (app root order)

`BrowserRouter → Web3Provider → ToastProvider`

### Environment Variables

- `VITE_WALLETCONNECT_PROJECT_ID` — WalletConnect project ID (has a default fallback in `src/config/wagmi.js`)
