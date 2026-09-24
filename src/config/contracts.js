export const BSC_CHAIN_ID = 56;
export const RH_CHAIN_ID = 4663;
export const DEFAULT_CHAIN_ID = BSC_CHAIN_ID;

export const BSC_CONTRACTS = {
  Multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  Committee: '0xe10F967DD356504EDB731612789D0D0f0ba2929f',
  MintableERC20Factory: '0x9979989709cE98715f2cA831C4FDb73b22d0408c',
  CommunityFactory: '0x5597e814399906095ecaA5769A40394F58E5E0Cf',
  ERC20StakingFactory: '0xDc3f940ac6Da516d5C9cc59c8AFE0F85A576E2A4',
  ERC20LockingFactory: '0x8189a03Cfa3d8919a2eb8f08E4f88c21Cf78cA01',
  ERC1155StakingFactory: '0x398eA6Db014595F23d0C9Cb1390a10472cdD43BA',
  SPStakingFactory: '0x47738e3420Be8ceD8a9476cf4dAf84c549835D44',
  SocialCurationFactory: '0xc4674D3fBbD201Ea401a8B7e7285F956178593D8',
  TradeCurationFactory: '0x774A48Ba391a1013Ae43289eBdf871618822CD67',
  NFTMiningPoolFactory: '0x21155400f915A239ca2228243cFE3761caF60128',
  BasketTVLMiningPoolFactory: '0x6B1B18336E774164dF01EfDC0901559909f2d074',
  IndexBrokerNFTFactory: '0x835E047D4BE6548E95F2Cbb9Ac02d62EFa2508A0',
  IndexBrokerNFTFactories: [
    '0x835E047D4BE6548E95F2Cbb9Ac02d62EFa2508A0',
    '0xB1708D2F3A504846a47cdB2e4Dfb48b3ea1c9b5F',
  ],
  IndexBrokerNFTBurnTemplate: '0x05433A916171458621e34bC7C96EF07a8D107514',
  IndexBrokerNFTStakeTemplate: '0x428086B7ec2FDa6bA208b37d9a4A44C5490353b3',
  IndexBrokerNFTAMMTemplate: '0x2a1b1c08642ad98A691167Efec7b4E43d2a1133B',
  NutboxRouter: '0x72dc4F38A7E4159e97d826a6ab594748C6b68f17',
  // TagAI deployment name: ImportedTokenSwapWrapper. It routes imported-token
  // trades through their selected Pancake pool and NutboxRouter.
  NutboxSwapWrapper: '0xdeE655Bc5b312f566248e4321F28523Cef72083C',
  DefaultIndexToken: '0xcF99DeC9439630ccf7Efe392F0fc2aF98EF99a61',
  IndexBrokerNFTRenderer: '0xd4B6120f566CDecD88b7Be6f994a6c7493F8a068',
  PancakeV2Factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  PancakeV2Router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  PancakeV3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
  PancakeV3SmartRouter: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
  PancakeV3Quoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
  PancakeV4CLManager: '0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b',
  PancakeV4Quoter: '0xd0737C9762912dD34c3271197E362Aa736Df0926',
  UniswapV4Manager: null,
  UniswapV4PositionManager: null,
  UniswapV4StateView: null,
  Permit2: '0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768',
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  BasketRegistry: '0x5B45ad2c3A2B8b8989579162C4faE2D64598Cefe',
  Pump: '0x2c2f4e8D85c02a065f109c74d9b27186AE65Adfa',
  WETH: null,
  LinearCalculator: '0x5114966657Bd6209B47aa16eaa4EAfbbC9595ec0',
  LinearTimeCalculator: '0xc76e00e150e13EC95514E9a52Ab0314c7faE8207',
  HourlyTickCalculator: '0x6cCEC02E7D371FED954D7D16eCb7F2f57cccF54d',
};

// Source: TagAI-contract-V2/deployments/4663/addresses.json
export const RH_CONTRACTS = {
  Multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  Committee: '0x7B0ddC305C32AAEbabc0FE372a4460e9903e95D0',
  MintableERC20Factory: '0xd52624320654FBEA5F1f988d5F4E55B74C56e67D',
  CommunityFactory: '0x24328DccA1bA54EeE82e2993F021802e64290486',
  ERC20StakingFactory: '0x7Df32F7A177BcFe437A040579E3beA89dc99c023',
  ERC20LockingFactory: '0x4cA57c64DFe1cF1be977093C75f9d9cdd1DD2E10',
  ERC1155StakingFactory: null,
  SPStakingFactory: null,
  SocialCurationFactory: '0xddbAba530728b5B8939d7fdDC334432490916e90',
  NFTMiningPoolFactory: '0xb3A547F535bDc1b20Eb6fd97b9524F893A75708C',
  BasketTVLMiningPoolFactory: '0xB3EBB2f53ECaAd85bbA502A557f7f838aeff88E0',
  IndexBrokerNFTFactory: '0x678871773b07322aA927FE5057870D1356F09676',
  IndexBrokerNFTFactories: ['0x678871773b07322aA927FE5057870D1356F09676'],
  IndexBrokerNFTBurnTemplate: '0x1fCB38D03231cCC7D62C45A5Ee5184A2486778d0',
  IndexBrokerNFTStakeTemplate: '0x0971018D38523021333B94088E69fCF1726606b1',
  IndexBrokerNFTAMMTemplate: '0x70978301e27fb2Aa931035EFB5d78542a0AAB898',
  NutboxRouter: '0x200115D733106ecA3954EAA5d1fCbc6D0EfB78AE',
  NutboxSwapWrapper: '0x53e65DE68A0eB7f3662579F44Eb9849Ae5cA44ab',
  DefaultIndexToken: '0x90d2cCA000Dc36fA8401632C67faFDa7D7860C07',
  IndexBrokerNFTRenderer: '0x3cAf852BF1F5A3781f7D809376D82e7ba0037C81',
  // Existing consumers use the Pancake-prefixed keys as generic V2/V3 slots.
  PancakeV2Factory: '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f',
  PancakeV2Router: '0x89e5DB8B5aA49aA85AC63f691524311AEB649eba',
  PancakeV3Factory: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
  PancakeV3SmartRouter: '0xCaf681a66D020601342297493863E78C959E5cb2',
  PancakeV3Quoter: '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',
  PancakeV4CLManager: null,
  PancakeV4Quoter: null,
  UniswapV4Manager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  UniswapV4PositionManager: '0x58daec3116aae6D93017bAAea7749052E8a04fA7',
  UniswapV4StateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  Permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  // WBNB is the legacy generic wrapped-native key used by routing code.
  WBNB: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  BasketRegistry: '0x1f997dEb6C8Ac7Bb4134Bc7c6bF23F623Cda25C6',
  Pump: '0x7686CbaF2dFc7000eb9b0D6DE81E48c1211d2655',
  WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  LinearCalculator: null,
  LinearTimeCalculator: '0xf5D8d9402A4603bD67400500E62880eee91cF12C',
  HourlyTickCalculator: '0x3DC52C69C3C8be568372E16d50E9F3FEc796610c',
  USDG: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  BasketVersion: 3,
  BasketRouteRegistry: '0x1aE3E64F51CCDC87Ff05E8E8242890e7964FF297',
  BasketSwapRouter: '0x9b5e6b7CC3661737e6A118e0D4f0F89fB1034653',
  BasketRebalanceExecutor: '0x1bca8A39021f6C65b62bbe79A59e41215cF19264',
  BasketHook: '0x7103AA53a7de0Af737d1dC1A257838f6f488aA88',
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
    readRpcUrl: import.meta.env.DEV ? '/rh-rpc' : 'https://rpc.mainnet.chain.robinhood.com/',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://robinhoodchain.blockscout.com',
    apiBase: import.meta.env.VITE_RH_NUTBOX_API_BASE
      || (import.meta.env.DEV ? '/nutbox' : 'https://bsc-api.tagai.fun/nutbox'),
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
export const isIndexBrokerNFTFactory = (address, contracts) => Boolean(address)
  && (contracts.IndexBrokerNFTFactories || [contracts.IndexBrokerNFTFactory])
    .some(factory => factory?.toLowerCase() === address.toLowerCase());
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
