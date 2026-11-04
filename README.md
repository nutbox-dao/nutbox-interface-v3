# Nutbox Interface V3

Nutbox 社区和矿池前端，基于 React 19、Vite、wagmi/RainbowKit 和 ethers v6。当前支持 BNB Smart Chain（chainId `56`）和 Robinhood Chain（chainId `4663`）；新增的 Binance Handle 受限 NFT 模板仅配置在 BSC。

## 开发

```bash
npm ci
npm run dev
npm run lint
npm run build
npm run preview
```

项目使用 JSX 和普通 CSS，当前没有配置独立测试框架。本地开发时 `/nutbox` 代理到 `https://bsc-api.tagai.fun`。

### 可选环境变量

- `VITE_WALLETCONNECT_PROJECT_ID`
- `VITE_BSC_NUTBOX_API_BASE` 或兼容配置 `VITE_NUTBOX_API_BASE`
- `VITE_RH_NUTBOX_API_BASE`
- `VITE_TAGAI_API_BASE`

## 数据来源约定

`src/config/subgraph.js` 实际访问 Nutbox REST API，不是前端直连 The Graph。

矿池的当前状态保持直接从链上读取，包括：

- `totalAmount` / 矿池总权重
- 用户权重、待领奖励、余额和 allowance
- NFT 所有权、挖矿状态、揭图状态
- AMM 库存摘要、储备金、实时报价和手续费

Index Broker NFT 不展示 `stakersCount`，因此不会按 NFT 总量扫描 `ownerOf`。后端索引用于静态初始化配置、历史事件、排行、AMM 库存 tokenId 顺序和复杂关联查询。社区接口会在对应矿池中附带 `indexBroker` 配置；详情页通过一个聚合接口读取其他索引数据：

- `GET /mining/index-broker-nft-pools/:pool/insights`

前端只有在索引库存摘要与链上实时摘要一致时才使用后端返回的库存 tokenId；索引滞后时自动回退链上遍历。如果聚合 API 尚未上线，前端会显示“专属索引数据尚未开放”，不会影响链上实时数据和交易功能。

## 矿池类型

- ERC20 Staking / Locking
- Social Curation
- NFT Mining（仅保留历史矿池展示，已隐藏创建）
- Basket TVL Mining
- Index Broker NFT

Index Broker NFT 使用新版动态模板架构：Burn 模板通过销毁社区代币增加指数权重，Stake 模板通过质押指定 ERC20 增减权重。前端支持白名单/公开铸造、揭图/重抽、指数奖励、holder-fee harvest、NFT AMM 交易，以及通过 AMM BNB 储备执行指数回购。

从社区管理员区的“创建 NFT”进入，先选择“所有钱包”或“仅 Binance Agent Wallet”，再选择对应的 Burn / Stake 模板。后者使用新增的 Handle 模板：合约要求公开与白名单铸造地址均已注册 Binance Handle；此限制不覆盖 NFT 转让及已有 NFT 的后续挖矿。Handle 模板目前仅配置在 BSC。

打开创建窗口时，模板注册状态和创建配置通过固定区块的 Multicall3 查询。未注册或被停用的模板无法选择；创建前再次批量检查模板注册、名称与费用。Factory 多签注册完成后重新打开创建窗口即可读取最新状态，前端不会自动注册模板或切换到不受限模板。

## 当前 BSC 创建合约

| Contract | Address |
| --- | --- |
| IndexBrokerNFTFactory | `0x835E047D4BE6548E95F2Cbb9Ac02d62EFa2508A0` |
| IndexBrokerNFTBurnTemplate（所有钱包） | `0x05433A916171458621e34bC7C96EF07a8D107514` |
| IndexBrokerNFTStakeTemplate（所有钱包） | `0x428086B7ec2FDa6bA208b37d9a4A44C5490353b3` |
| IndexBrokerNFTHandleBurnTemplate | `0x1cceCdED84c825e413F1849FdF55423D07Dc9ab6` |
| IndexBrokerNFTHandleStakeTemplate | `0x156C2A877069b0e50dC5A74C7d1612d70144B4C6` |
| IndexBrokerNFTAMMTemplate | `0x2a1b1c08642ad98A691167Efec7b4E43d2a1133B` |
| NutboxRouter | `0x72dc4F38A7E4159e97d826a6ab594748C6b68f17` |
| StonkBrokerRenderer | `0xd4B6120f566CDecD88b7Be6f994a6c7493F8a068` |
| Pump | `0x2c2f4e8D85c02a065f109c74d9b27186AE65Adfa` |

完整网络配置见 `src/config/contracts.js`，前端仅保留实际使用的 ABI 片段，见 `src/config/abis.js`。
