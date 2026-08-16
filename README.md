# Nutbox Interface V3

Nutbox 社区和矿池前端，基于 React 19、Vite、wagmi/RainbowKit 和 ethers v6。当前支持 BNB Smart Chain（chainId `56`）和 Robinhood Chain（chainId `4663`）；Index Broker NFT 仅在 BSC V11 开放。

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
- NFT Mining
- Basket TVL Mining
- Index Broker NFT（BSC V11）

Index Broker NFT 支持创建参数编码、白名单/公开铸造、社区挖矿、指数挖矿激活与升级、揭图/重抽、指数奖励注入与领取、holder-fee harvest，以及专属 NFT AMM 的激活、买入和卖出。

## BSC V11 合约

| Contract | Address |
| --- | --- |
| IndexBrokerNFTFactory | `0xFa26Bf8d0830EC78ff7B2D959a1724f5E178392E` |
| IndexBrokerNFTPriceOracle | `0x85060fd888a936C77555F6D7899e46e102a697e3` |
| StonkBrokerRenderer | `0xd4B6120f566CDecD88b7Be6f994a6c7493F8a068` |
| Pump | `0x8fEF5b4c0f761a0cc447800e3019B089ac306F28` |

完整网络配置见 `src/config/contracts.js`，前端仅保留实际使用的 ABI 片段，见 `src/config/abis.js`。
