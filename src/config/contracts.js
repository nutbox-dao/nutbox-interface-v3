export const BSC_CHAIN_ID = 56;
export const RH_CHAIN_ID = 4663;
export const DEFAULT_CHAIN_ID = BSC_CHAIN_ID;

export const BSC_CONTRACTS = {
  Committee: '0xe10F967DD356504EDB731612789D0D0f0ba2929f',
  MintableERC20Factory: '0x9979989709cE98715f2cA831C4FDb73b22d0408c',
  CommunityFactory: '0x5597e814399906095ecaA5769A40394F58E5E0Cf',
  ERC20StakingFactory: '0xDc3f940ac6Da516d5C9cc59c8AFE0F85A576E2A4',
  ERC20LockingFactory: '0x8189a03Cfa3d8919a2eb8f08E4f88c21Cf78cA01',
  ERC1155StakingFactory: '0x398eA6Db014595F23d0C9Cb1390a10472cdD43BA',
  SPStakingFactory: '0x47738e3420Be8ceD8a9476cf4dAf84c549835D44',
  SocialCurationFactory: '0xc4674D3fBbD201Ea401a8B7e7285F956178593D8',
  NFTMiningPoolFactory: null,
  LinearCalculator: '0x5114966657Bd6209B47aa16eaa4EAfbbC9595ec0',
  LinearTimeCalculator: '0xc76e00e150e13EC95514E9a52Ab0314c7faE8207',
  HourlyTickCalculator: '0x6cCEC02E7D371FED954D7D16eCb7F2f57cccF54d',
};

// Source: TagAI-contract-V2/deployments/4663/addresses.json
export const RH_CONTRACTS = {
  Committee: '0x7B0ddC305C32AAEbabc0FE372a4460e9903e95D0',
  MintableERC20Factory: '0xd52624320654FBEA5F1f988d5F4E55B74C56e67D',
  CommunityFactory: '0x24328DccA1bA54EeE82e2993F021802e64290486',
  ERC20StakingFactory: '0x7Df32F7A177BcFe437A040579E3beA89dc99c023',
  ERC20LockingFactory: '0x4cA57c64DFe1cF1be977093C75f9d9cdd1DD2E10',
  ERC1155StakingFactory: null,
  SPStakingFactory: null,
  SocialCurationFactory: '0xddbAba530728b5B8939d7fdDC334432490916e90',
  NFTMiningPoolFactory: '0xb3A547F535bDc1b20Eb6fd97b9524F893A75708C',
  LinearCalculator: null,
  LinearTimeCalculator: '0xf5D8d9402A4603bD67400500E62880eee91cF12C',
  HourlyTickCalculator: '0x3DC52C69C3C8be568372E16d50E9F3FEc796610c',
};

export const NETWORKS = {
  [BSC_CHAIN_ID]: {
    id: BSC_CHAIN_ID,
    slug: 'bsc',
    name: 'BNB Smart Chain',
    shortName: 'BSC',
    rpcUrls: ['https://bsc-dataseed.binance.org/', 'https://bsc-dataseed1.defibit.io/'],
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    explorerUrl: 'https://bscscan.com',
    apiBase: import.meta.env.VITE_BSC_NUTBOX_API_BASE
      || import.meta.env.VITE_NUTBOX_API_BASE
      || (import.meta.env.DEV ? '/nutbox' : 'https://bsc-api.tagai.fun/nutbox'),
    contracts: BSC_CONTRACTS,
    blocksPerYear: 10_512_000,
    blockTimeSeconds: 3,
  },
  [RH_CHAIN_ID]: {
    id: RH_CHAIN_ID,
    slug: 'rh',
    name: 'Robinhood Chain',
    shortName: 'RH',
    rpcUrls: ['https://rpc.mainnet.chain.robinhood.com/'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://robinhoodchain.blockscout.com',
    apiBase: import.meta.env.VITE_RH_NUTBOX_API_BASE || null,
    communityMetadataApiBase: import.meta.env.VITE_TAGAI_API_BASE || 'https://bsc-api.tagai.fun',
    contracts: RH_CONTRACTS,
    // RH does not deploy the block-based calculator; retained for display helpers.
    blocksPerYear: 126_144_000,
    blockTimeSeconds: 0.25,
    deploymentBlock: 6_819_336,
  },
};

export const SUPPORTED_CHAIN_IDS = Object.keys(NETWORKS).map(Number);
export const getNetworkConfig = (chainId = DEFAULT_CHAIN_ID) => NETWORKS[Number(chainId)] || NETWORKS[DEFAULT_CHAIN_ID];
export const getContracts = (chainId = DEFAULT_CHAIN_ID) => getNetworkConfig(chainId).contracts;
export const getChainSlug = (chainId = DEFAULT_CHAIN_ID) => getNetworkConfig(chainId).slug;
export const getChainIdFromSlug = (slug) => {
  const normalized = String(slug || '').toLowerCase();
  const network = Object.values(NETWORKS).find(item => item.slug === normalized);
  return network?.id ?? null;
};
export const getChainPath = (chainId, path = '') => {
  const suffix = path && path !== '/' ? `/${String(path).replace(/^\/+/, '')}` : '';
  return `/${getChainSlug(chainId)}${suffix}`;
};

// Backward-compatible BSC exports. New code should use Web3Context.network/contracts.
export const CHAIN_ID = DEFAULT_CHAIN_ID;
export const CONTRACTS = BSC_CONTRACTS;
export const BSC_CONFIG = {
  chainId: `0x${BSC_CHAIN_ID.toString(16)}`,
  chainName: NETWORKS[BSC_CHAIN_ID].name,
  rpcUrls: NETWORKS[BSC_CHAIN_ID].rpcUrls,
  nativeCurrency: NETWORKS[BSC_CHAIN_ID].nativeCurrency,
  blockExplorerUrls: [NETWORKS[BSC_CHAIN_ID].explorerUrl],
};

export const BLOCKS_PER_YEAR = NETWORKS[DEFAULT_CHAIN_ID].blocksPerYear;
export const BLOCK_TIME_SECONDS = NETWORKS[DEFAULT_CHAIN_ID].blockTimeSeconds;
export const SECONDS_PER_YEAR = 31_536_000;
export const SUBGRAPH_URL = 'https://api.studio.thegraph.com/query/90467/tagai-bsc/version/latest';
