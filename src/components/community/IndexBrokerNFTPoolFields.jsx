import {
  INDEX_BROKER_MINING_MODES,
  INDEX_BROKER_SOURCE_TYPES,
} from '../../utils/indexBrokerNft';
import IndexBrokerRendererPreview from './IndexBrokerRendererPreview';

function Field({ label, children, wide = false, hint }) {
  return (
    <div className={`input-group ${wide ? 'nft-pool-form-wide' : ''}`}>
      <label>{label}</label>
      {children}
      {hint && <div className="contract-field-feedback">{hint}</div>}
    </div>
  );
}

export default function IndexBrokerNFTPoolFields({
  config,
  onChange,
  language,
  tokenInfo,
  loadingContext,
  sourceResolution,
  sourceCapabilities,
  poolName,
  readProvider,
  templateAddresses,
}) {
  const zh = language === 'zh';
  const update = (key, value) => onChange(current => ({ ...current, [key]: value }));
  const sourceType = Number(config.sourceType);
  const whitelistOnly = Number(config.nativePrice || 0) === 0;
  const stakeMode = config.miningMode === INDEX_BROKER_MINING_MODES.STAKE;
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
  const updateSourceType = value => onChange(current => ({
    ...current,
    sourceType: value,
    sourcePoolId: '',
    sourcePoolManager: '',
    sourceCurrency0: '',
    sourceCurrency1: '',
    sourceHooks: '',
    sourceFee: '',
    sourceTickSpacing: '',
    sourceParameters: '',
  }));
  const shortValue = value => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : '';

  return (
    <div className="nft-pool-config index-broker-create-config">
      <div className="nft-pool-config-heading">
        <strong>{zh ? 'Index Broker NFT 配置' : 'Index Broker NFT configuration'}</strong>
        <span>
          {zh
            ? '铸造支付社区代币并进入专属 AMM；NFT 同时参与社区挖矿和指数挖矿。'
            : 'Minting deposits Community Tokens into a dedicated AMM; each NFT supports community and index mining.'}
        </span>
      </div>

      <div className="nft-pool-form-grid">
        <Field wide label={zh ? '指数挖矿模式' : 'Index mining mode'}>
          <select className="input" value={config.miningMode} onChange={event => updateMiningMode(event.target.value)}>
            <option value={INDEX_BROKER_MINING_MODES.BURN} disabled={!tokenInfo.burnTemplateSupported}>
              {zh ? 'Burn：销毁社区代币获得权重' : 'Burn: burn Community Tokens for weight'}
            </option>
            <option value={INDEX_BROKER_MINING_MODES.STAKE} disabled={!tokenInfo.stakeTemplateSupported}>
              {zh ? 'Stake：质押指定 ERC20 获得权重' : 'Stake: deposit an ERC20 for weight'}
            </option>
          </select>
        </Field>
        {stakeMode && (
          <Field wide label={zh ? '指数挖矿质押代币' : 'Index mining staking token'} hint={zh ? '创建后不可修改；本金和挖矿权重随 NFT 一起转移。' : 'Immutable after creation; principal and weight follow the NFT on transfer.'}>
            <input className="input" value={config.stakingToken} onChange={event => update('stakingToken', event.target.value)} placeholder="0x..." />
          </Field>
        )}
        <Field label="NFT Symbol">
          <input className="input" maxLength={16} value={config.symbol} onChange={event => update('symbol', event.target.value)} placeholder="e.g. STONK" />
        </Field>
        <Field label={zh ? '公开铸造收款地址' : 'Public mint receiver'} hint={zh ? '留空时由 Factory 自动设为专属 AMM，铸造 BNB 进入指数回购储备。' : 'Blank selects the dedicated AMM so public-mint BNB funds index buybacks.'}>
          <input className="input" value={config.fundsReceiver} onChange={event => update('fundsReceiver', event.target.value)} placeholder="0x..." />
        </Field>
        <Field label={zh ? '每枚 NFT 社区代币成本' : 'Community Token per NFT'} hint={tokenInfo.symbol ? tokenInfo.symbol : undefined}>
          <input type="number" min="0" step="any" className="input" value={config.communityTokenPrice} onChange={event => update('communityTokenPrice', event.target.value)} placeholder="1000" />
        </Field>
        {!stakeMode && (
          <Field label={zh ? '指数挖矿重新激活成本' : 'Index mining activation cost'} hint={zh ? `可填 0 表示免费重新激活 · ${tokenInfo.symbol || '社区代币'}` : `0 allows free reactivation · ${tokenInfo.symbol || 'Community Token'}`}>
            <input type="number" min="0" step="any" className="input" value={config.indexMiningActivationTokenAmount} onChange={event => update('indexMiningActivationTokenAmount', event.target.value)} placeholder="100" />
          </Field>
        )}
        <Field label={zh ? '公开铸造 BNB 价格' : 'Public mint BNB price'} hint={whitelistOnly ? (zh ? '0 表示纯白名单矿池' : '0 creates a whitelist-only pool') : undefined}>
          <input type="number" min="0" step="any" className="input" value={config.nativePrice} onChange={event => update('nativePrice', event.target.value)} placeholder="0.01" />
        </Field>
        <Field label={zh ? '最大供应量' : 'Max supply'}>
          <input type="number" min="1" step="1" className="input" value={config.maxSupply} onChange={event => update('maxSupply', event.target.value)} placeholder="1000" />
        </Field>
        <Field label={zh ? '推荐返佣比例' : 'Referral commission'} hint={whitelistOnly ? (zh ? '纯白名单矿池必须为 0%' : 'Must be 0% for whitelist-only pools') : undefined}>
          <div className="input-with-suffix"><input type="number" min="0" max="100" step="0.1" className="input" value={config.referralPercent} onChange={event => update('referralPercent', event.target.value)} /><span>%</span></div>
        </Field>
        <Field wide label="Renderer" hint={zh ? '留空使用 V11 默认 Stonk Broker Renderer' : 'Blank uses the V11 Stonk Broker renderer'}>
          <input className="input" value={config.renderer} onChange={event => update('renderer', event.target.value)} placeholder="0x..." />
        </Field>
        <IndexBrokerRendererPreview
          customRenderer={config.renderer}
          defaultRenderer={tokenInfo.defaultRenderer}
          poolName={poolName}
          tokenDecimals={tokenInfo.decimals}
          language={language}
          readProvider={readProvider}
        />
        <Field label={zh ? '等级推荐门槛' : 'Referral thresholds'}>
          <input className="input" value={config.levelThresholds} onChange={event => update('levelThresholds', event.target.value)} />
        </Field>
        <Field label={zh ? '社区挖矿权重' : 'Community mining weights'}>
          <input className="input" value={config.levelWeights} onChange={event => update('levelWeights', event.target.value)} />
        </Field>
      </div>

      <div className="nft-pool-config-heading index-broker-subheading">
        <strong>{zh ? '白名单与揭图' : 'Whitelist and reveal'}</strong>
      </div>
      <div className="nft-pool-form-grid">
        <Field
          wide
          label={zh ? '白名单（每行：地址,额度）' : 'Whitelist (one address,allowance per line)'}
          hint={zh ? '合约要求至少一个白名单地址；纯白名单模式的额度总和必须等于最大供应量。' : 'At least one address is required; whitelist-only allocations must equal max supply.'}
        >
          <textarea className="input index-broker-whitelist" rows={4} value={config.whitelist} onChange={event => update('whitelist', event.target.value)} placeholder={'0x1234...,2\n0xabcd...,1'} />
        </Field>
        <label className="index-broker-check">
          <input type="checkbox" checked={config.lockWhitelistSlots} onChange={event => update('lockWhitelistSlots', event.target.checked)} />
          <span>{zh ? '为白名单保留供应额度' : 'Reserve supply for whitelist'}</span>
        </label>
        <label className="index-broker-check">
          <input type="checkbox" checked={config.rerollEnabled} onChange={event => update('rerollEnabled', event.target.checked)} />
          <span>{zh ? '允许付费重新生成 NFT' : 'Allow paid NFT rerolls'}</span>
        </label>
        {config.rerollEnabled && (
          <Field label={zh ? '重新生成成本' : 'Reroll cost'} hint={zh ? `留空时使用每枚 NFT 的 ${tokenInfo.symbol || '社区代币'} 成本` : 'Blank uses the NFT Community Token cost'}>
            <input type="number" min="0" step="any" className="input" value={config.recommitPrice} onChange={event => update('recommitPrice', event.target.value)} />
          </Field>
        )}
      </div>

      <div className="nft-pool-config-heading index-broker-subheading">
        <strong>{zh ? '专属 AMM 与指数代币' : 'Dedicated AMM and index token'}</strong>
        <span>
          {loadingContext
            ? (zh ? '正在读取社区代币类型和默认指数代币…' : 'Reading token type and default index token…')
            : config.officialToken
              ? tokenInfo.pumpListed
                ? (zh
                  ? `已识别为 Pump 代币，已上市到 ${shortValue(tokenInfo.pumpPoolId)}；创建时合约会自动读取 DEX 并立即激活 AMM。`
                  : `Pump token detected and listed at ${shortValue(tokenInfo.pumpPoolId)}; the contract resolves its DEX and activates the AMM immediately.`)
                : (zh
                  ? '已识别为 Pump 代币，但尚未上市；可以先创建矿池，AMM 会等待代币上市后再调用 activate 激活。'
                  : 'Pump token detected but not listed yet; the pool can be created now and its AMM can be activated after listing.')
              : (zh ? '外部代币必须提供已支持的 DEX 价格源。' : 'External tokens require a supported DEX price source.')}
        </span>
      </div>
      <div className="nft-pool-form-grid">
        <Field label={zh ? '普通买卖手续费' : 'Normal trading fee'}>
          <div className="input-with-suffix"><input type="number" min="0" max="100" step="0.1" className="input" value={config.normalFeePercent} onChange={event => update('normalFeePercent', event.target.value)} /><span>%</span></div>
        </Field>
        <Field label={zh ? '指定 NFT 买入手续费' : 'Specific NFT fee'}>
          <div className="input-with-suffix"><input type="number" min="0" max="100" step="0.1" className="input" value={config.specificFeePercent} onChange={event => update('specificFeePercent', event.target.value)} /><span>%</span></div>
        </Field>
        <Field wide label={zh ? '指数代币（留空使用 Factory 默认值）' : 'Index token (blank uses Factory default)'}>
          <input className="input" value={config.indexToken} onChange={event => update('indexToken', event.target.value)} placeholder="0x..." />
        </Field>

        {!loadingContext && config.officialToken === false && (
          <>
            <Field label={zh ? 'DEX 价格源类型' : 'DEX price source'}>
              <select className="input" value={config.sourceType} onChange={event => updateSourceType(event.target.value)}>
                <option value={INDEX_BROKER_SOURCE_TYPES.V2_PAIR}>V2 Pair</option>
                <option value={INDEX_BROKER_SOURCE_TYPES.V3_POOL}>V3 Pool</option>
                <option value={INDEX_BROKER_SOURCE_TYPES.UNISWAP_V4} disabled={!sourceCapabilities.uniswapV4}>
                  Uniswap V4{sourceCapabilities.uniswapV4 ? '' : (zh ? '（当前未启用）' : ' (not enabled)')}
                </option>
                <option value={INDEX_BROKER_SOURCE_TYPES.PANCAKE_V4_CL} disabled={!sourceCapabilities.pancakeV4Cl}>
                  Pancake V4 CL{sourceCapabilities.pancakeV4Cl ? '' : (zh ? '（当前未启用）' : ' (not enabled)')}
                </option>
              </select>
            </Field>
            {(sourceType === INDEX_BROKER_SOURCE_TYPES.V2_PAIR || sourceType === INDEX_BROKER_SOURCE_TYPES.V3_POOL) ? (
              <>
                <Field label={zh ? 'DEX Factory' : 'DEX factory'}><input className="input" value={config.sourceFactory} onChange={event => update('sourceFactory', event.target.value)} placeholder="0x..." /></Field>
                <Field label={zh ? '交易池地址' : 'Pool address'}><input className="input" value={config.sourcePool} onChange={event => update('sourcePool', event.target.value)} placeholder="0x..." /></Field>
              </>
            ) : (
              <Field
                wide
                label="Pool ID"
                hint={zh ? '只需填写 Pool ID；前端会从 Pool Manager 自动读取并校验完整 PoolKey。' : 'Enter only the Pool ID; the full PoolKey is resolved and validated through the Pool Manager.'}
              >
                <input
                  className="input"
                  value={config.sourcePoolId}
                  onChange={event => update('sourcePoolId', event.target.value.trim())}
                  placeholder="0x… (bytes32)"
                  spellCheck="false"
                />
                {sourceResolution.loading && (
                  <div className="contract-field-feedback">
                    {zh ? '正在读取链上 PoolKey 与流动性…' : 'Reading the on-chain PoolKey and liquidity…'}
                  </div>
                )}
                {sourceResolution.error && (
                  <div className="contract-field-feedback is-error">{sourceResolution.error}</div>
                )}
                {sourceResolution.resolved && sourceResolution.details && (
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
