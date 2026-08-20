import { ethers } from 'ethers';
import {
  INDEX_BROKER_MINT_ACCESS_MODES,
  INDEX_BROKER_MINING_MODES,
  INDEX_BROKER_SOURCE_TYPES,
  parseIndexBrokerWhitelist,
} from '../../utils/indexBrokerNft';
import IndexBrokerRendererPreview from './IndexBrokerRendererPreview';

const ZERO_ADDRESS = ethers.ZeroAddress;

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

function estimateReferral(nativePrice, platformFeeBps, referralPercent) {
  const price = Number(nativePrice);
  const referral = Number(referralPercent);
  const platform = Number(platformFeeBps || 0);
  if (!Number.isFinite(price) || !Number.isFinite(referral) || price <= 0 || referral <= 0) return null;
  return Math.max(0, price * (1 - platform / 10_000) * referral / 100);
}

function effectiveFee(value) {
  const configured = Number(value);
  if (!Number.isFinite(configured)) return '—';
  const total = (Math.round(configured * 100) + 50) / 100;
  return `${total.toFixed(2).replace(/\.?0+$/, '')}%`;
}

export default function IndexBrokerNFTPoolFields({
  section,
  config,
  onChange,
  language,
  tokenInfo,
  loadingContext,
  sourceResolution,
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
  const update = (key, value) => onChange(current => ({ ...current, [key]: value }));
  const sourceType = Number(config.sourceType);
  const selectedSourceFactory = sourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR
    ? sourceFactories.pancakeV2
    : sourceType === INDEX_BROKER_SOURCE_TYPES.V3_POOL
      ? sourceFactories.pancakeV3
      : '';
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
  const receiver = String(config.fundsReceiver || '').trim();
  const receiverUsesBuyback = !receiver || receiver.toLowerCase() === ZERO_ADDRESS.toLowerCase();
  const estimatedReferral = estimateReferral(
    whitelistOnly ? '0' : config.nativePrice,
    tokenInfo.platformFeeBps,
    whitelistOnly ? '0' : config.referralPercent,
  );

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

  const updateSourceType = value => {
    const nextSourceType = Number(value);
    const sourceFactory = nextSourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR
      ? sourceFactories.pancakeV2
      : nextSourceType === INDEX_BROKER_SOURCE_TYPES.V3_POOL
        ? sourceFactories.pancakeV3
        : '';
    onChange(current => ({
      ...current,
      sourceType: value,
      sourceFactory: sourceFactory || '',
      sourcePool: '',
      sourcePoolId: '',
      sourcePoolManager: '',
      sourceCurrency0: '',
      sourceCurrency1: '',
      sourceHooks: '',
      sourceFee: '',
      sourceTickSpacing: '',
      sourceParameters: '',
    }));
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
            <input className="input" value={poolName} onChange={event => onPoolNameChange(event.target.value)} placeholder={zh ? '例如：社区指数经纪人' : 'e.g. Community Index Brokers'} />
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
        <div className="wizard-callout">
          <strong>{zh ? '返佣计算方式' : 'How commission is calculated'}</strong>
          <span>
            {zh
              ? `推荐佣金 = 公开铸造 BNB 价格 ×（1 − ${Number(tokenInfo.platformFeeBps || 0) / 100}% 平台费）× 推荐比例`
              : `Referral commission = public-mint BNB price × (1 − ${Number(tokenInfo.platformFeeBps || 0) / 100}% platform fee) × referral rate`}
            {estimatedReferral !== null
              ? (zh ? `；按当前费率估算约为 ${estimatedReferral.toFixed(6)} BNB / 枚。` : `; approximately ${estimatedReferral.toFixed(6)} BNB per NFT at the current fee rate.`)
              : ''}
          </span>
          <span>{zh ? '仅带有效推荐 NFT 的付费公开铸造产生返佣，佣金发给推荐 NFT 的当前持有人；平台费率后续可能调整。' : 'Only paid public mints with a valid referrer NFT earn commission. It is paid to that NFT’s current owner, and the platform fee may change later.'}</span>
        </div>
        <div className="nft-pool-form-grid">
          <Field label={zh ? '推荐返佣比例' : 'Referral commission'} hint={whitelistOnly ? (zh ? '纯白名单模式没有付费公开铸造，返佣固定为 0%。' : 'Whitelist-only access has no paid public mints, so referral commission is fixed at 0%.') : undefined}>
            <div className="input-with-suffix"><input type="number" min="0" max="100" step="0.01" className="input" value={whitelistOnly ? '0' : config.referralPercent} onChange={event => update('referralPercent', event.target.value)} disabled={whitelistOnly} /><span>%</span></div>
          </Field>
          <Field
            wide
            label={zh ? '公开铸造收款地址' : 'Public mint receiver'}
            hint={receiverUsesBuyback
              ? (zh ? '当前将使用专属 AMM，公开铸造净 BNB 进入指数回购储备。' : 'The dedicated AMM is selected; net public-mint BNB enters the index-buyback reserve.')
              : (zh ? '公开铸造净 BNB 会发送到这个地址。' : 'Net public-mint BNB is sent to this address.')}
          >
            <div className="wizard-inline-field-action">
              <input className="input" value={config.fundsReceiver} onChange={event => update('fundsReceiver', event.target.value)} placeholder={ZERO_ADDRESS} />
              <button type="button" className={`btn btn-sm ${receiverUsesBuyback ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => update('fundsReceiver', ZERO_ADDRESS)}>
                {zh ? '进入回购池' : 'Use buyback pool'}
              </button>
            </div>
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
          <Field wide label="Renderer" hint={zh ? '留空使用 V11 默认 Stonk Broker Renderer。' : 'Blank uses the default V11 Stonk Broker Renderer.'}>
            <input className="input" value={config.renderer} onChange={event => update('renderer', event.target.value)} placeholder="0x..." />
          </Field>
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
          <strong>{zh ? '实际交易手续费' : 'Effective trading fee'}</strong>
          <span>{zh ? '下方配置费会留在 AMM 作为指数回购储备；每笔交易还会固定收取 0.5% 平台费。' : 'The configured fee remains in the AMM for index buybacks; every trade also includes a fixed 0.5% platform fee.'}</span>
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
                {zh ? '已验证 Basket' : 'Basket verified'} · V{indexTokenValidation.version} · {shortValue(indexTokenValidation.router)}
              </div>
            )}
          </Field>

          {!loadingContext && config.officialToken === false && (
            <>
              <div className="wizard-callout nft-pool-form-wide">
                <strong>{zh ? 'DEX 价格源的作用' : 'What the DEX price source does'}</strong>
                <span>{zh
                  ? '专属 AMM 会用这里的流动性池，把每枚 NFT 的社区代币价格换算成 BNB 价值，从而计算买卖价格和交易费用。请选择社区代币已有流动性的 Pancake 版本，并填写对应的池地址；平台会使用默认 Factory 自动验证。'
                  : 'The dedicated AMM uses this liquidity pool to convert the Community Token price per NFT into a BNB value for trade pricing and fees. Choose the Pancake version where the Community Token has liquidity and enter that pool; the platform verifies it against the default Factory.'}</span>
              </div>
              <Field label={zh ? 'Pancake 价格源版本' : 'Pancake price-source version'}>
                <select className="input" value={config.sourceType} onChange={event => updateSourceType(event.target.value)}>
                  <option value={INDEX_BROKER_SOURCE_TYPES.V2_PAIR} disabled={!sourceCapabilities.pancakeV2}>
                    Pancake V2{sourceCapabilities.pancakeV2 ? '' : (zh ? '（当前未支持）' : ' (not supported)')}
                  </option>
                  <option value={INDEX_BROKER_SOURCE_TYPES.V3_POOL} disabled={!sourceCapabilities.pancakeV3}>
                    Pancake V3{sourceCapabilities.pancakeV3 ? '' : (zh ? '（当前未支持）' : ' (not supported)')}
                  </option>
                  <option value={INDEX_BROKER_SOURCE_TYPES.PANCAKE_V4_CL} disabled={!sourceCapabilities.pancakeV4Cl}>
                    Pancake V4 CL{sourceCapabilities.pancakeV4Cl ? '' : (zh ? '（当前未支持）' : ' (not supported)')}
                  </option>
                </select>
              </Field>
              {(sourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR || sourceType === INDEX_BROKER_SOURCE_TYPES.V3_POOL) ? (
                <Field
                  wide
                  label={zh ? 'Pancake 交易池地址' : 'Pancake pool address'}
                  hint={zh
                    ? `使用平台默认的 ${sourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR ? 'Pancake V2' : 'Pancake V3'} Factory 自动验证${selectedSourceFactory ? ` · ${shortValue(selectedSourceFactory)}` : ''}`
                    : `Automatically verified against the platform default ${sourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR ? 'Pancake V2' : 'Pancake V3'} Factory${selectedSourceFactory ? ` · ${shortValue(selectedSourceFactory)}` : ''}`}
                >
                  <input className="input" value={config.sourcePool} onChange={event => update('sourcePool', event.target.value.trim())} placeholder="0x..." spellCheck="false" />
                  {sourceResolutionMatches && sourceResolution.loading && <div className="contract-field-feedback">{zh ? '正在验证 Factory、交易对与流动性…' : 'Validating the Factory, token pair, and liquidity…'}</div>}
                  {sourceResolutionMatches && sourceResolution.error && <div className="contract-field-feedback is-error">{sourceResolution.error}</div>}
                  {sourceResolutionMatches && sourceResolution.resolved && sourceResolution.details && (
                    <div className="contract-field-feedback is-success">
                      {zh ? '价格池已验证' : 'Price pool verified'} · {shortValue(sourceResolution.details.currency0)} / {shortValue(sourceResolution.details.currency1)}
                      {sourceResolution.details.fee !== null ? ` · Fee ${sourceResolution.details.fee}` : ''}
                    </div>
                  )}
                </Field>
              ) : (
                <Field wide label="Pool ID" hint={zh ? '前端会从 Pool Manager 自动读取并校验完整 PoolKey。' : 'The full PoolKey is resolved and verified through the Pool Manager.'}>
                  <input className="input" value={config.sourcePoolId} onChange={event => update('sourcePoolId', event.target.value.trim())} placeholder="0x… (bytes32)" spellCheck="false" />
                  {sourceResolutionMatches && sourceResolution.loading && <div className="contract-field-feedback">{zh ? '正在读取链上 PoolKey 与流动性…' : 'Reading the on-chain PoolKey and liquidity…'}</div>}
                  {sourceResolutionMatches && sourceResolution.error && <div className="contract-field-feedback is-error">{sourceResolution.error}</div>}
                  {sourceResolutionMatches && sourceResolution.resolved && sourceResolution.details && (
                    <div className="contract-field-feedback is-success">
                      {zh ? '已验证' : 'Verified'} · {shortValue(sourceResolution.details.currency0)} / {shortValue(sourceResolution.details.currency1)} · Fee {sourceResolution.details.fee}
                    </div>
                  )}
                </Field>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
}
