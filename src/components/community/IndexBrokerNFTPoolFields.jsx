import { useState } from 'react';
import {
  INDEX_BROKER_MINT_ACCESS_MODES,
  INDEX_BROKER_MINING_MODES,
  INDEX_BROKER_SOURCE_TYPES,
  parseIndexBrokerWhitelist,
} from '../../utils/indexBrokerNft';
import IndexBrokerRendererPreview from './IndexBrokerRendererPreview';

const RENDERER_INTERFACE_EXAMPLE = `interface IIndexBrokerNFTRenderer {
    struct RenderParams {
        string collectionName;
        uint256 tokenId;
        uint256 seed;
        uint256 referralCount;
        uint256 referrerTokenId;
        uint256 miningWeight;
        uint256 indexMiningWeight;
        uint256 indexMiningTokenUnit;
        uint32 level;
        bool miningActive;
        bool indexMiningActive;
    }

    function renderSVG(RenderParams calldata params)
        external view returns (string memory);
    function renderTokenURI(RenderParams calldata params)
        external view returns (string memory);
    function renderContractURI(string calldata collectionName)
        external view returns (string memory);
}`;

const SEED_SVG_RENDERER_EXAMPLE = `contract SeedSvgRenderer is IIndexBrokerNFTRenderer {
    using Strings for uint256;

    function renderSVG(RenderParams calldata p)
        external pure returns (string memory)
    {
        return _svg(p);
    }

    function renderTokenURI(RenderParams calldata p)
        external pure returns (string memory)
    {
        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(_svg(p)))
        );
        string memory json = string.concat(
            '{"name":"', p.collectionName, " #", p.tokenId.toString(),
            '","image":"', image, '"}'
        );
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        );
    }

    function renderContractURI(string calldata name)
        external pure returns (string memory)
    {
        string memory json = string.concat(
            '{"name":"', name,
            '","description":"Generated fully on-chain"}'
        );
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        );
    }

    function _svg(RenderParams calldata p)
        private pure returns (string memory)
    {
        if (p.seed == 0) {
            return '<svg xmlns="http://www.w3.org/2000/svg" '
                'viewBox="0 0 320 320"><rect width="320" height="320" '
                'fill="#111827"/><text x="160" y="165" fill="white" '
                'text-anchor="middle">UNREVEALED</text></svg>';
        }

        uint256 x = 50 + uint256(
            keccak256(abi.encode(p.seed, p.tokenId))
        ) % 220;
        string memory color = p.seed % 2 == 0 ? "#7c3aed" : "#06b6d4";
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">',
            '<rect width="320" height="320" fill="#080b1f"/>',
            '<circle cx="', x.toString(), '" cy="160" r="72" fill="',
            color, '"/></svg>'
        );
    }
}`;

const IPFS_RENDERER_EXAMPLE = `contract SeedIpfsRenderer is IIndexBrokerNFTRenderer {
    using Strings for uint256;

    uint256 constant IMAGE_COUNT = 1000;
    string constant IPFS_BASE = "ipfs://bafy.../";
    string constant HTTPS_GATEWAY =
        "https://cloudflare-ipfs.com/ipfs/bafy.../";

    function _file(RenderParams calldata p)
        private pure returns (string memory)
    {
        if (p.seed == 0) return "unrevealed.png";
        uint256 id = uint256(
            keccak256(abi.encode(p.seed, p.tokenId))
        ) % IMAGE_COUNT + 1;
        return string.concat(id.toString(), ".png");
    }

    function renderSVG(RenderParams calldata p)
        external pure returns (string memory)
    {
        // SVG preview uses HTTPS because many browsers do not load ipfs://
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">',
            '<image width="1000" height="1000" href="',
            HTTPS_GATEWAY, _file(p), '"/></svg>'
        );
    }

    function renderTokenURI(RenderParams calldata p)
        external pure returns (string memory)
    {
        // Metadata keeps the canonical ipfs:// image URI.
        string memory json = string.concat(
            '{"name":"', p.collectionName, " #", p.tokenId.toString(),
            '","image":"', IPFS_BASE, _file(p), '"}'
        );
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        );
    }

    function renderContractURI(string calldata name)
        external pure returns (string memory)
    {
        string memory json = string.concat(
            '{"name":"', name, '","image":"',
            IPFS_BASE, 'collection.png"}'
        );
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        );
    }
}`;

function Field({ label, children, wide = false, hint }) {
  return (
    <div className={`input-group ${wide ? 'nft-pool-form-wide' : ''}`}>
      <label>{label}</label>
      {children}
      {hint && <div className="contract-field-feedback">{hint}</div>}
    </div>
  );
}

function SectionHeading({ title, description }) {
  return (
    <div className="nft-pool-config-heading">
      <strong>{title}</strong>
      {description && <span>{description}</span>}
    </div>
  );
}

function RendererGuide({ expanded, onToggle, zh }) {
  return (
    <div className="renderer-guide-shell nft-pool-form-wide">
      <button
        type="button"
        className="renderer-guide-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls="index-broker-renderer-guide"
      >
        <span className="renderer-guide-toggle-icon" aria-hidden="true">{'</>'}</span>
        <span>
          <strong>How to make Renderer</strong>
          <small>{zh ? '自定义 NFT 图片与元数据合约开发指南' : 'Build a custom NFT image and metadata contract'}</small>
        </span>
        <span className={`renderer-guide-chevron ${expanded ? 'is-expanded' : ''}`} aria-hidden="true">⌄</span>
      </button>

      {expanded && (
        <div id="index-broker-renderer-guide" className="renderer-guide" role="region">
          <div className="renderer-guide-intro">
            <strong>{zh ? '先部署 Renderer，再填写合约地址' : 'Deploy the Renderer first, then enter its contract address'}</strong>
            <p>
              {zh
                ? 'Renderer 是一个只读合约，负责根据 NFT 状态生成图片和元数据。创建矿池后 Renderer 地址不能修改，因此请先在 BSC 部署并完整测试。留空则使用平台默认 Renderer。'
                : 'A Renderer is a read-only contract that generates NFT images and metadata from NFT state. Its address cannot be changed after pool creation, so deploy and fully test it on BSC first. Leave the field blank to use the platform default.'}
            </p>
          </div>

          <section className="renderer-guide-section">
            <div className="renderer-guide-section-heading">
              <span>1</span>
              <div>
                <strong>{zh ? '必须实现的合约接口' : 'Required contract interface'}</strong>
                <p>{zh ? '三个函数缺少任何一个，或在合法参数下执行失败，创建页面都会判定为不兼容。无需实现 ERC165。' : 'All three functions are required and must not revert for valid parameters. ERC165 support is not required.'}</p>
              </div>
            </div>
            <pre className="renderer-guide-code"><code>{RENDERER_INTERFACE_EXAMPLE}</code></pre>
          </section>

          <section className="renderer-guide-section">
            <div className="renderer-guide-section-heading">
              <span>2</span>
              <div>
                <strong>{zh ? '返回值与参数规则' : 'Return-value and parameter rules'}</strong>
                <p>{zh ? '合约会在铸造、揭图、升级与展示时读取这些函数。' : 'The NFT contract reads these functions during minting, reveal, upgrades, and display.'}</p>
              </div>
            </div>
            <div className="renderer-guide-rules">
              <div><code>renderSVG</code><span>{zh ? '返回原始 <svg> 字符串，不要返回 data URI。' : 'Return a raw <svg> string, not a data URI.'}</span></div>
              <div><code>renderTokenURI</code><span>{zh ? '返回完整 NFT 元数据 URI；推荐 data:application/json;base64 或有效的 ipfs:// URI。' : 'Return a complete NFT metadata URI; use a Base64 JSON data URI or a valid ipfs:// URI.'}</span></div>
              <div><code>renderContractURI</code><span>{zh ? '返回合集级元数据 URI，例如合集名称、描述和封面。' : 'Return collection-level metadata such as name, description, and cover image.'}</span></div>
              <div><code>seed</code><span>{zh ? '揭图前为 0；揭图后为非零随机种子。使用 seed 的 Renderer 应在 seed=0 时返回未揭图占位图。' : 'It is 0 before reveal and non-zero afterward. Seed-based renderers should return an unrevealed placeholder when seed=0.'}</span></div>
            </div>
            <details className="renderer-guide-params">
              <summary>{zh ? '查看全部 RenderParams 参数说明' : 'View all RenderParams fields'}</summary>
              <div className="renderer-guide-param-grid">
                <div><code>collectionName</code><span>{zh ? 'NFT 合集名称' : 'NFT collection name'}</span></div>
                <div><code>tokenId</code><span>{zh ? '当前 NFT 编号' : 'Current NFT identifier'}</span></div>
                <div><code>referralCount</code><span>{zh ? '该 NFT 的有效推荐人数' : 'Valid referrals credited to this NFT'}</span></div>
                <div><code>referrerTokenId</code><span>{zh ? '铸造时登记的推荐 NFT' : 'Referrer NFT recorded at mint'}</span></div>
                <div><code>miningWeight</code><span>{zh ? '社区挖矿权重' : 'Community mining weight'}</span></div>
                <div><code>indexMiningWeight</code><span>{zh ? '指数挖矿原始权重' : 'Raw index-mining weight'}</span></div>
                <div><code>indexMiningTokenUnit</code><span>{zh ? '指数挖矿代币显示单位' : 'Display unit for index-mining tokens'}</span></div>
                <div><code>level</code><span>{zh ? '当前推荐等级' : 'Current referral level'}</span></div>
                <div><code>miningActive</code><span>{zh ? '社区挖矿是否激活' : 'Whether community mining is active'}</span></div>
                <div><code>indexMiningActive</code><span>{zh ? '指数挖矿是否激活' : 'Whether index mining is active'}</span></div>
              </div>
            </details>
          </section>

          <div className="renderer-guide-example-grid">
            <section className="renderer-guide-section">
              <div className="renderer-guide-section-heading">
                <span>3A</span>
                <div>
                  <strong>{zh ? '案例：使用 seed 生成链上 SVG' : 'Example: generate on-chain SVG from seed'}</strong>
                  <p>{zh ? '相同的 seed 与 tokenId 必须始终得到相同结果。示例省略 import，请使用 OpenZeppelin Base64 与 Strings。' : 'The same seed and tokenId must always produce the same result. Imports are omitted; use OpenZeppelin Base64 and Strings.'}</p>
                </div>
              </div>
              <pre className="renderer-guide-code"><code>{SEED_SVG_RENDERER_EXAMPLE}</code></pre>
            </section>

            <section className="renderer-guide-section">
              <div className="renderer-guide-section-heading">
                <span>3B</span>
                <div>
                  <strong>{zh ? '案例：使用 seed 选择 IPFS 图片' : 'Example: select an IPFS image from seed'}</strong>
                  <p>{zh ? '元数据中保留标准 ipfs:// 地址；仅在 SVG 预览的 <image> 中使用 HTTPS Gateway，以兼容浏览器。' : 'Keep canonical ipfs:// URLs in metadata. Use an HTTPS gateway only inside the SVG <image> element for browser compatibility.'}</p>
                </div>
              </div>
              <pre className="renderer-guide-code"><code>{IPFS_RENDERER_EXAMPLE}</code></pre>
            </section>
          </div>

          <section className="renderer-guide-checklist">
            <strong>{zh ? '部署前检查' : 'Pre-deployment checklist'}</strong>
            <ul>
              <li>{zh ? '地址是 BSC 上已部署的合约，不是钱包地址。' : 'The address is a deployed BSC contract, not a wallet address.'}</li>
              <li>{zh ? '分别使用 seed=0 和非零 seed 调用三个接口，确认都不会回滚。' : 'Call all three functions with seed=0 and a non-zero seed; none may revert.'}</li>
              <li>{zh ? 'SVG、JSON 和特殊字符都已正确转义，tokenURI 可被钱包和市场解析。' : 'SVG, JSON, and special characters are escaped correctly, and wallets/markets can parse tokenURI.'}</li>
              <li>{zh ? '如果 Renderer 完全不使用 seed，请联系平台把地址加入“无需揭图”列表，否则铸造后仍会提示用户揭图。' : 'If the Renderer never uses seed, ask the platform to add it to the no-reveal list; otherwise users will still be prompted to reveal after minting.'}</li>
            </ul>
          </section>
          <button type="button" className="renderer-guide-collapse" onClick={onToggle}>
            <span aria-hidden="true">↑</span>
            {zh ? '收起 How to make Renderer' : 'Collapse How to make Renderer'}
          </button>
        </div>
      )}
    </div>
  );
}

function TemplateCard({ selected, disabled, icon, title, description, status, onClick }) {
  return (
    <button
      type="button"
      className={`wizard-choice-card wizard-template-card ${selected ? 'is-selected' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className="wizard-choice-icon" aria-hidden="true">{icon}</span>
      <span className="wizard-choice-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className={disabled ? 'wizard-choice-unavailable' : 'wizard-choice-state'}>
        {disabled ? status : (selected ? '✓' : '→')}
      </span>
    </button>
  );
}

function shortValue(value) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : '';
}

function effectiveFee(value) {
  const configured = Number(value);
  if (!Number.isFinite(configured)) return '—';
  const total = (Math.round(configured * 100) + 50) / 100;
  return `${total.toFixed(2).replace(/\.?0+$/, '')}%`;
}

function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: amount >= 1_000 ? 'compact' : 'standard',
    maximumFractionDigits: amount >= 1_000 ? 2 : 0,
  }).format(amount);
}

function formatCompact(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '0';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

export default function IndexBrokerNFTPoolFields({
  section,
  config,
  onChange,
  language,
  tokenInfo,
  loadingContext,
  sourceResolution,
  poolDiscovery = { loading: false, pools: [], error: '' },
  onRetryPoolDiscovery,
  sourceCapabilities = {},
  sourceFactories = {},
  poolName,
  onPoolNameChange,
  readProvider,
  multicallAddress,
  templateAddresses,
  defaultPreviewExpanded = false,
  onRendererStatusChange,
  indexTokenValidation,
  stakeTokenValidation,
}) {
  const zh = language === 'zh';
  const [rendererGuideExpanded, setRendererGuideExpanded] = useState(false);
  const update = (key, value) => onChange(current => ({ ...current, [key]: value }));
  const sourceType = Number(config.sourceType);
  const currentSourceInput = sourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR
    || sourceType === INDEX_BROKER_SOURCE_TYPES.V3_POOL
    ? config.sourcePool.trim()
    : config.sourcePoolId.trim();
  const sourceResolutionMatches = Boolean(
    currentSourceInput
    && sourceResolution.poolId
    && sourceResolution.poolId.toLowerCase() === currentSourceInput.toLowerCase()
  );
  const mintAccessMode = config.mintAccessMode || INDEX_BROKER_MINT_ACCESS_MODES.OPEN;
  const openMint = mintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.OPEN;
  const whitelistOnly = mintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.WHITELIST_ONLY;
  const mixedMint = mintAccessMode === INDEX_BROKER_MINT_ACCESS_MODES.MIXED;
  const usesWhitelist = whitelistOnly || mixedMint;
  let whitelistAllocationTotal = null;
  if (usesWhitelist && config.whitelist.trim()) {
    try {
      whitelistAllocationTotal = parseIndexBrokerWhitelist(config.whitelist)
        .allowances.reduce((sum, value) => sum + value, 0n);
    } catch {
      whitelistAllocationTotal = null;
    }
  }
  const stakeMode = config.miningMode === INDEX_BROKER_MINING_MODES.STAKE;
  const receiverUsesBuyback = config.useBuybackPool !== false;
  const updateMiningMode = miningMode => onChange(current => ({
    ...current,
    miningMode,
    nftTemplate: miningMode === INDEX_BROKER_MINING_MODES.STAKE
      ? templateAddresses.stake
      : templateAddresses.burn,
    indexMiningActivationTokenAmount: miningMode === INDEX_BROKER_MINING_MODES.STAKE
      ? ''
      : current.indexMiningActivationTokenAmount,
  }));

  const updateMintAccessMode = mode => onChange(current => ({
    ...current,
    mintAccessMode: mode,
  }));

  const selectPricePool = candidate => {
    const nextSourceType = Number(candidate.sourceType);
    const sourceFactory = nextSourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR
      ? sourceFactories.pancakeV2
      : nextSourceType === INDEX_BROKER_SOURCE_TYPES.V3_POOL
        ? sourceFactories.pancakeV3
        : '';
    onChange(current => ({
      ...current,
      sourceType: String(nextSourceType),
      sourceFactory: sourceFactory || '',
      sourcePool: nextSourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR
        || nextSourceType === INDEX_BROKER_SOURCE_TYPES.V3_POOL
        ? candidate.address
        : '',
      sourcePoolId: nextSourceType === INDEX_BROKER_SOURCE_TYPES.PANCAKE_V4_CL
        ? candidate.address
        : '',
      sourcePoolManager: '',
      sourceCurrency0: '',
      sourceCurrency1: '',
      sourceHooks: '',
      sourceFee: '',
      sourceTickSpacing: '',
      sourceParameters: '',
    }));
  };

  const sourceIsSupported = candidate => {
    const candidateType = Number(candidate.sourceType);
    if (candidateType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR) return Boolean(sourceCapabilities.pancakeV2);
    if (candidateType === INDEX_BROKER_SOURCE_TYPES.V3_POOL) return Boolean(sourceCapabilities.pancakeV3);
    if (candidateType === INDEX_BROKER_SOURCE_TYPES.PANCAKE_V4_CL) return Boolean(sourceCapabilities.pancakeV4Cl);
    return false;
  };

  if (section === 'template') {
    return (
      <div className="nft-pool-config index-broker-create-config">
        <SectionHeading
          title={zh ? '指数挖矿模板' : 'Index mining template'}
          description={zh
            ? '模板决定 NFT 如何获得指数挖矿权重，创建后不能更换。'
            : 'The template determines how an NFT gains index-mining weight and cannot be changed later.'}
        />
        <div className="wizard-choice-grid wizard-template-grid">
          <TemplateCard
            selected={!stakeMode}
            disabled={!tokenInfo.burnTemplateSupported}
            icon="🔥"
            title={zh ? '烧毁模板' : 'Burn template'}
            description={zh
              ? '销毁社区代币为 NFT 增加指数挖矿权重。NFT 转移后需重新激活，已销毁代币无法取回。'
              : 'Burn Community Tokens to add index-mining weight. A transferred NFT must be reactivated; burned tokens cannot be recovered.'}
            status={zh ? '当前不可用' : 'Unavailable'}
            onClick={() => updateMiningMode(INDEX_BROKER_MINING_MODES.BURN)}
          />
          <TemplateCard
            selected={stakeMode}
            disabled={!tokenInfo.stakeTemplateSupported}
            icon="◆"
            title={zh ? '质押模板' : 'Stake template'}
            description={zh
              ? '质押指定 ERC20 获得权重；本金、权重和奖励权益会随 NFT 一起转移。'
              : 'Stake an ERC20 for weight; principal, weight, and reward rights follow the NFT on transfer.'}
            status={zh ? '当前不可用' : 'Unavailable'}
            onClick={() => updateMiningMode(INDEX_BROKER_MINING_MODES.STAKE)}
          />
        </div>
        <div className="nft-pool-form-grid wizard-template-fields">
          {stakeMode ? (
            <Field
              wide
              label={zh ? '指数挖矿质押代币' : 'Index mining staking token'}
              hint={zh ? '创建后不可修改；请填写有效的 ERC20 合约地址。' : 'Immutable after creation; enter a valid ERC20 contract address.'}
            >
              <input className="input" value={config.stakingToken} onChange={event => update('stakingToken', event.target.value)} placeholder="0x..." />
              {stakeTokenValidation?.loading && <div className="contract-field-feedback">{zh ? '正在读取合约代码与 decimals…' : 'Reading contract code and decimals…'}</div>}
              {stakeTokenValidation?.error && <div className="contract-field-feedback is-error">{stakeTokenValidation.error}</div>}
              {stakeTokenValidation?.valid && <div className="contract-field-feedback is-success">{zh ? `ERC20 已验证 · ${stakeTokenValidation.decimals} 位精度` : `ERC20 verified · ${stakeTokenValidation.decimals} decimals`}</div>}
            </Field>
          ) : (
            <Field
              wide
              label={zh ? '指数挖矿重新激活成本' : 'Index mining reactivation cost'}
              hint={zh
                ? `Burn 模板专用；填 0 表示免费重新激活 · ${tokenInfo.symbol || '社区代币'}`
                : `Burn template only; 0 allows free reactivation · ${tokenInfo.symbol || 'Community Token'}`}
            >
              <input type="number" min="0" step="any" className="input" value={config.indexMiningActivationTokenAmount} onChange={event => update('indexMiningActivationTokenAmount', event.target.value)} placeholder="100" />
            </Field>
          )}
        </div>
      </div>
    );
  }

  if (section === 'identity') {
    return (
      <div className="nft-pool-config index-broker-create-config">
        <SectionHeading
          title={zh ? 'NFT 合集基础信息' : 'NFT collection basics'}
          description={zh
            ? '合集名称同时作为矿池名称；社区代币价格既用于铸造，也用于后续专属 AMM 的 NFT 买卖。'
            : 'The collection name is also the pool name; the Community Token price applies to both minting and later NFT trades in the dedicated AMM.'}
        />
        <div className="nft-pool-form-grid">
          <Field
            wide
            label={zh ? 'NFT 合集名称' : 'NFT collection name'}
            hint={zh ? '最多 64 个 UTF-8 字节，且不能使用 Factory 保留名称。' : 'Up to 64 UTF-8 bytes and cannot use a Factory-reserved name.'}
          >
            <input className="input" value={poolName} onChange={event => onPoolNameChange(event.target.value)} placeholder={zh ? '例如：社区 NFT' : 'e.g. Community NFT'} />
          </Field>
          <Field label="NFT Symbol" hint={zh ? '1–16 个 UTF-8 字节。' : '1–16 UTF-8 bytes.'}>
            <input className="input" value={config.symbol} onChange={event => update('symbol', event.target.value)} placeholder="e.g. STONK" />
          </Field>
          <Field
            label={zh ? '每枚 NFT 的社区代币价格' : 'Community Token price per NFT'}
            hint={zh
              ? `白名单和公开铸造都需支付；后续专属 AMM 买卖每枚 NFT 时，也以这个数值作为社区代币交易价格，AMM 手续费另行计算 · ${tokenInfo.symbol || '社区代币'}`
              : `Paid by whitelist and public mints; each later NFT trade in the dedicated AMM also uses this Community Token price, with AMM fees calculated separately · ${tokenInfo.symbol || 'Community Token'}`}
          >
            <input type="number" min="0" step="any" className="input" value={config.communityTokenPrice} onChange={event => update('communityTokenPrice', event.target.value)} placeholder="1000" />
          </Field>
          <Field
            label={zh ? '最大供应量' : 'Maximum supply'}
            hint={zh ? '白名单与公开铸造共享该供应上限。' : 'Whitelist and public mints share this supply cap.'}
          >
            <input type="number" min="1" step="1" className="input" value={config.maxSupply} onChange={event => update('maxSupply', event.target.value)} placeholder="1000" />
          </Field>
        </div>
      </div>
    );
  }

  if (section === 'mint') {
    return (
      <div className="nft-pool-config index-broker-create-config">
        <SectionHeading
          title={zh ? '选择铸造准入方式' : 'Choose mint access'}
          description={zh
            ? '选择完全公开、纯白名单，或公开铸造与白名单混用；创建后不能更改。'
            : 'Choose open minting, whitelist-only access, or a mix of public and whitelist minting. This cannot be changed after creation.'}
        />
        <div className="wizard-choice-grid wizard-whitelist-mode">
          <button
            type="button"
            className={`wizard-choice-card ${openMint ? 'is-selected' : ''}`}
            onClick={() => updateMintAccessMode(INDEX_BROKER_MINT_ACCESS_MODES.OPEN)}
            aria-pressed={openMint}
          >
            <span className="wizard-choice-icon" aria-hidden="true">◎</span>
            <span className="wizard-choice-copy">
              <strong>{zh ? '公开 Mint（无需白名单）' : 'Open mint (no whitelist)'}</strong>
              <span>{zh ? '所有钱包按设置的 BNB 价格铸造，用户无需填写或领取白名单额度。' : 'Any wallet can mint at the configured BNB price without a whitelist allocation.'}</span>
            </span>
            <span className="wizard-choice-state">{openMint ? '✓' : '→'}</span>
          </button>
          <button
            type="button"
            className={`wizard-choice-card ${whitelistOnly ? 'is-selected' : ''}`}
            onClick={() => updateMintAccessMode(INDEX_BROKER_MINT_ACCESS_MODES.WHITELIST_ONLY)}
            aria-pressed={whitelistOnly}
          >
            <span className="wizard-choice-icon" aria-hidden="true">◇</span>
            <span className="wizard-choice-copy">
              <strong>{zh ? '纯白名单 Mint' : 'Whitelist-only mint'}</strong>
              <span>{zh ? '只允许名单钱包铸造；BNB 价格固定为 0，名单额度总和必须等于最大供应量。' : 'Only listed wallets may mint. The BNB price is fixed at zero and allocations must equal maximum supply.'}</span>
            </span>
            <span className="wizard-choice-state">{whitelistOnly ? '✓' : '→'}</span>
          </button>
          <button
            type="button"
            className={`wizard-choice-card ${mixedMint ? 'is-selected' : ''}`}
            onClick={() => updateMintAccessMode(INDEX_BROKER_MINT_ACCESS_MODES.MIXED)}
            aria-pressed={mixedMint}
          >
            <span className="wizard-choice-icon" aria-hidden="true">◈</span>
            <span className="wizard-choice-copy">
              <strong>{zh ? '公开 + 白名单混用' : 'Public + whitelist'}</strong>
              <span>{zh ? '名单钱包使用专属额度，其他钱包按 BNB 价格公开铸造；可选择保留名单供应。' : 'Listed wallets use allocations while other wallets mint at the BNB price; whitelist supply can be reserved.'}</span>
            </span>
            <span className="wizard-choice-state">{mixedMint ? '✓' : '→'}</span>
          </button>
        </div>
        <div className="nft-pool-form-grid">
          {!whitelistOnly && (
            <Field
              label={zh ? '公开铸造 BNB 价格' : 'Public mint BNB price'}
            >
              <input type="number" min="0" step="any" className="input" value={config.nativePrice} onChange={event => update('nativePrice', event.target.value)} placeholder="0.01" />
            </Field>
          )}
          {usesWhitelist && (
            <>
              <Field
                wide
                label={zh ? '白名单（每行：地址,额度）' : 'Whitelist (one address,allowance per line)'}
                hint={whitelistOnly
                  ? (zh
                    ? `纯白名单模式下，所有地址的额度合计必须等于最大供应量。当前合计：${whitelistAllocationTotal ?? '—'} / ${config.maxSupply || '—'}`
                    : `In whitelist-only mode, all allocations must total the maximum supply. Current total: ${whitelistAllocationTotal ?? '—'} / ${config.maxSupply || '—'}`)
                  : (zh
                    ? '地址不能重复，额度必须为正整数；名单账户铸造时免付 BNB，仍需支付社区代币。'
                    : 'Addresses must be unique with positive integer allowances; listed wallets mint without BNB but still pay Community Tokens.')}
              >
                <textarea className="input index-broker-whitelist" rows={6} value={config.whitelist} onChange={event => update('whitelist', event.target.value)} placeholder={'0x1234...,2\n0xabcd...,1'} />
              </Field>
              {mixedMint && (
                <label className="index-broker-check wizard-option-card">
                  <input type="checkbox" checked={config.lockWhitelistSlots} onChange={event => update('lockWhitelistSlots', event.target.checked)} />
                  <span>
                    <strong>{zh ? '为白名单保留供应额度' : 'Reserve supply for whitelist'}</strong>
                    <small>{zh ? '公开铸造不会占用尚未领取的白名单额度。' : 'Public mints cannot consume unclaimed whitelist allocations.'}</small>
                  </span>
                </label>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (section === 'rewards') {
    return (
      <div className="nft-pool-config index-broker-create-config">
        <SectionHeading
          title={zh ? '推荐返佣与社区挖矿等级' : 'Referral commission and community-mining levels'}
          description={zh
            ? '返佣从公开铸造支付的 BNB 中分出，不会向铸造者额外收费。'
            : 'Commission is taken from public-mint BNB and does not add an extra charge to the minter.'}
        />
        <div className="nft-pool-form-grid">
          <Field label={zh ? '推荐返佣比例' : 'Referral commission'} hint={whitelistOnly ? (zh ? '纯白名单模式没有付费公开铸造，返佣固定为 0%。' : 'Whitelist-only access has no paid public mints, so referral commission is fixed at 0%.') : undefined}>
            <div className="input-with-suffix"><input type="number" min="0" max="100" step="0.01" className="input" value={whitelistOnly ? '0' : config.referralPercent} onChange={event => update('referralPercent', event.target.value)} disabled={whitelistOnly} /><span>%</span></div>
          </Field>
          <Field
            wide
            label={zh ? '铸造BNB资金流向' : 'Mint BNB destination'}
            hint={receiverUsesBuyback
              ? (zh ? '当前将使用专属 AMM，公开铸造净 BNB 进入指数回购储备。' : 'The dedicated AMM is selected; net public-mint BNB enters the index-buyback reserve.')
              : (zh ? '公开铸造净 BNB 会发送到这个地址。' : 'Net public-mint BNB is sent to this address.')}
          >
            <label className="index-broker-check wizard-option-card">
              <input
                type="checkbox"
                checked={receiverUsesBuyback}
                onChange={event => update('useBuybackPool', event.target.checked)}
              />
              <span>
                <strong>{zh ? '进入回购池' : 'Send to buyback pool'}</strong>
                <small>{zh ? '铸造净 BNB 将用于指数回购。' : 'Net mint BNB will be reserved for index buybacks.'}</small>
              </span>
            </label>
            {!receiverUsesBuyback && (
              <input
                className="input"
                value={config.fundsReceiver}
                onChange={event => update('fundsReceiver', event.target.value)}
                placeholder="0x..."
              />
            )}
          </Field>
          <Field
            label={zh ? '等级推荐门槛' : 'Referral thresholds'}
            hint={zh ? '逗号分隔；从 0 开始并严格递增，最多 16 级。' : 'Comma-separated; start at 0 and strictly increase, up to 16 levels.'}
          >
            <input className="input" value={config.levelThresholds} onChange={event => update('levelThresholds', event.target.value)} />
          </Field>
          <Field
            label={zh ? '社区挖矿权重' : 'Community mining weights'}
            hint={zh ? '与门槛一一对应，必须为正数并严格递增。' : 'Match thresholds one-to-one and use positive, strictly increasing values.'}
          >
            <input className="input" value={config.levelWeights} onChange={event => update('levelWeights', event.target.value)} />
          </Field>
        </div>
      </div>
    );
  }

  if (section === 'renderer') {
    return (
      <div className="nft-pool-config index-broker-create-config wizard-renderer-step">
        <SectionHeading
          title={zh ? 'Renderer 与 NFT 效果模拟' : 'Renderer and NFT appearance simulator'}
          description={zh
            ? '可以使用平台默认 Renderer，也可以填写兼容的自定义合约；模拟参数不会写入部署配置。'
            : 'Use the default Renderer or a compatible custom contract; simulation values are not deployed.'}
        />
        <div className="nft-pool-form-grid">
          <Field wide label="Renderer" hint={zh ? '留空使用默认 Stonk Broker Renderer。' : 'Blank uses the default Stonk Broker Renderer.'}>
            <input className="input" value={config.renderer} onChange={event => update('renderer', event.target.value)} placeholder="0x..." />
          </Field>
          <RendererGuide
            expanded={rendererGuideExpanded}
            onToggle={() => setRendererGuideExpanded(current => !current)}
            zh={zh}
          />
          <label className="index-broker-check wizard-option-card nft-pool-form-wide">
            <input type="checkbox" checked={config.rerollEnabled} onChange={event => update('rerollEnabled', event.target.checked)} />
            <span>
              <strong>{zh ? '允许付费重新生成图片' : 'Allow paid image rerolls'}</strong>
              <small>{zh ? 'NFT 持有人可以支付社区代币，重新生成随机种子与视觉结果。' : 'NFT holders can pay Community Tokens to regenerate the random seed and visual result.'}</small>
            </span>
          </label>
          {config.rerollEnabled && (
            <Field wide label={zh ? '重新生成图片成本' : 'Image reroll cost'} hint={zh ? '留空或填 0 时，使用每枚 NFT 的社区代币价格。' : 'Blank or zero uses the Community Token price per NFT.'}>
              <input type="number" min="0" step="any" className="input" value={config.recommitPrice} onChange={event => update('recommitPrice', event.target.value)} />
            </Field>
          )}
          <IndexBrokerRendererPreview
            customRenderer={config.renderer}
            defaultRenderer={tokenInfo.defaultRenderer}
            poolName={poolName}
            tokenDecimals={tokenInfo.decimals}
            indexMiningTokenAddress={stakeMode ? config.stakingToken : ''}
            language={language}
            readProvider={readProvider}
            multicallAddress={multicallAddress}
            defaultExpanded={defaultPreviewExpanded}
            onStatusChange={onRendererStatusChange}
          />
        </div>
      </div>
    );
  }

  if (section === 'amm') {
    return (
      <div className="nft-pool-config index-broker-create-config">
        <SectionHeading
          title={zh ? '专属 AMM 与指数代币' : 'Dedicated AMM and index token'}
          description={loadingContext
            ? (zh ? '正在读取社区代币类型和默认指数代币…' : 'Reading token type and default index token…')
            : config.officialToken
              ? tokenInfo.pumpListed
                ? (zh
                  ? `已识别为 Pump 代币，已上市到 ${shortValue(tokenInfo.pumpPoolId)}；创建时会自动读取 DEX 并激活 AMM。`
                  : `Pump token detected and listed at ${shortValue(tokenInfo.pumpPoolId)}; the AMM activates automatically.`)
                : (zh
                  ? '已识别为 Pump 代币，但尚未上市；可以先创建，上市后再激活 AMM。'
                  : 'Pump token detected but not listed; create now and activate the AMM after listing.')
              : (zh ? '外部代币必须提供已支持的 DEX 价格源。' : 'External tokens require a supported DEX price source.')}
        />
        <div className="wizard-callout">
          <span className="wizard-callout-icon" aria-hidden="true">i</span>
          <div>
            <strong>{zh ? '实际交易手续费' : 'Effective trading fee'}</strong>
            <span>{zh ? '下方配置费会留在 AMM 作为指数回购储备；每笔交易还会固定收取 0.5% 平台费。' : 'The configured fee remains in the AMM for index buybacks; every trade also includes a fixed 0.5% platform fee.'}</span>
          </div>
        </div>
        <div className="nft-pool-form-grid">
          <Field label={zh ? '普通买卖配置费' : 'Normal configured fee'} hint={zh ? `实际总费率：${effectiveFee(config.normalFeePercent)}` : `Effective total: ${effectiveFee(config.normalFeePercent)}`}>
            <div className="input-with-suffix"><input type="number" min="0" max="100" step="0.01" className="input" value={config.normalFeePercent} onChange={event => update('normalFeePercent', event.target.value)} /><span>%</span></div>
          </Field>
          <Field label={zh ? '指定 NFT 买入配置费' : 'Specific NFT configured fee'} hint={zh ? `实际总费率：${effectiveFee(config.specificFeePercent)}` : `Effective total: ${effectiveFee(config.specificFeePercent)}`}>
            <div className="input-with-suffix"><input type="number" min="0" max="100" step="0.01" className="input" value={config.specificFeePercent} onChange={event => update('specificFeePercent', event.target.value)} /><span>%</span></div>
          </Field>
          <Field wide label={zh ? '指数代币（留空使用 Factory 默认值）' : 'Index token (blank uses Factory default)'}>
            <input className="input" value={config.indexToken} onChange={event => update('indexToken', event.target.value)} placeholder="0x..." />
            {indexTokenValidation?.loading && <div className="contract-field-feedback">{zh ? '正在验证 Basket 版本与 Router…' : 'Validating the Basket version and Router…'}</div>}
            {indexTokenValidation?.error && <div className="contract-field-feedback is-error">{indexTokenValidation.error}</div>}
            {indexTokenValidation?.valid && (
              <div className="contract-field-feedback is-success">
                {zh ? '已验证 Basket' : 'Basket verified'}
                {indexTokenValidation.symbol ? ` · ${indexTokenValidation.symbol}` : ''}
                {' · '}V{indexTokenValidation.version} · {shortValue(indexTokenValidation.router)}
              </div>
            )}
          </Field>

          {!loadingContext && config.officialToken === false && (
            <>
              <div className="dex-pool-discovery nft-pool-form-wide">
                <div className="dex-pool-discovery-header">
                  <div>
                    <strong>{zh ? '选择价格源池' : 'Select a price-source pool'}</strong>
                    <span>{zh ? `按流动性排序 · 共 ${poolDiscovery.pools.length} 个候选池` : `Sorted by liquidity · ${poolDiscovery.pools.length} candidates`}</span>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onRetryPoolDiscovery} disabled={poolDiscovery.loading}>
                    {poolDiscovery.loading ? (zh ? '查找中…' : 'Searching…') : (zh ? '重新查找' : 'Refresh')}
                  </button>
                </div>
                <p className="dex-pool-discovery-description">
                  {zh
                    ? 'NFT AMM 交易手续费会使用选择的 DEX 来计价。'
                    : 'NFT AMM trading fees are priced using the selected DEX.'}
                </p>

                {poolDiscovery.loading && poolDiscovery.pools.length === 0 && (
                  <div className="dex-pool-discovery-state"><span className="spinner" />{zh ? '正在查找 Pancake 候选池…' : 'Discovering Pancake pools…'}</div>
                )}
                {poolDiscovery.error && (
                  <div className="dex-pool-discovery-state is-error">
                    <span>{zh ? '候选池查找失败，请稍后重试。' : 'Pool discovery failed. Please retry.'}</span>
                    <small>{poolDiscovery.error}</small>
                  </div>
                )}
                {!poolDiscovery.loading && !poolDiscovery.error && poolDiscovery.pools.length === 0 && (
                  <div className="dex-pool-discovery-state">
                    {zh ? '没有找到可用的 Pancake V2、V3 或 V4 CL 池。请先为社区代币创建流动性池。' : 'No Pancake V2, V3, or V4 CL pool was found. Create liquidity for the Community Token first.'}
                  </div>
                )}

                {poolDiscovery.pools.length > 0 && (
                  <div className="dex-pool-candidate-list">
                    {poolDiscovery.pools.map(candidate => {
                      const candidateValue = candidate.address.toLowerCase();
                      const selected = currentSourceInput.toLowerCase() === candidateValue
                        && sourceType === Number(candidate.sourceType);
                      const supported = sourceIsSupported(candidate);
                      const validating = selected && sourceResolutionMatches && sourceResolution.loading;
                      const validationError = selected && sourceResolutionMatches ? sourceResolution.error : '';
                      const verified = selected && sourceResolutionMatches && sourceResolution.resolved;
                      const pairSymbol = candidate.pairedTokenSymbol || shortValue(candidate.pairedToken);
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          className={`dex-pool-candidate ${selected ? 'is-selected' : ''} ${!supported ? 'is-disabled' : ''}`}
                          onClick={() => selectPricePool(candidate)}
                          disabled={!supported}
                          aria-pressed={selected}
                        >
                          <span className="dex-pool-candidate-main">
                            <span className="dex-pool-version">{candidate.versionLabel.replace('Pancake ', '')}</span>
                            <strong>{tokenInfo.symbol || (zh ? '社区代币' : 'Community Token')} / {pairSymbol}</strong>
                            {candidate.feeTier && <span className="dex-pool-fee">{candidate.feeTier}</span>}
                          </span>
                          <span className="dex-pool-candidate-address">{shortValue(candidate.address)}</span>
                          <span className="dex-pool-candidate-metrics">
                            <span><small>{zh ? '流动性' : 'Liquidity'}</small><strong>{formatUsd(candidate.liquidityUsd)}</strong></span>
                            <span><small>24h {zh ? '交易量' : 'volume'}</small><strong>{formatUsd(candidate.volume24hUsd)}</strong></span>
                            <span><small>24h {zh ? '交易数' : 'txs'}</small><strong>{formatCompact(candidate.transactions24h)}</strong></span>
                          </span>
                          <span className={`dex-pool-candidate-status ${validationError ? 'is-error' : verified ? 'is-success' : ''}`}>
                            {!supported
                              ? (zh ? '当前部署未支持该版本' : 'This version is not supported')
                              : validating
                                ? (zh ? '正在进行链上支持检查…' : 'Checking on-chain support…')
                                : validationError
                                  ? validationError
                                  : verified
                                    ? (zh ? '✓ 已通过链上支持检查' : '✓ On-chain support verified')
                                    : selected
                                      ? (zh ? '等待链上检查' : 'Waiting for on-chain check')
                                      : (zh ? '点击选择并检查' : 'Select and check')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
}
