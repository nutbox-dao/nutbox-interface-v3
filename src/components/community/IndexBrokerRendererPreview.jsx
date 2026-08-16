import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { IndexBrokerNFTRendererABI } from '../../config/abis';
import { shortenAddress } from '../../utils/helpers';

function randomSeed() {
  return BigInt(ethers.hexlify(ethers.randomBytes(32))).toString();
}

function unsignedInteger(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized || (!/^\d+$/.test(normalized) && !/^0x[\da-f]+$/i.test(normalized))) {
    throw new Error(`${label} must be an unsigned integer`);
  }
  return BigInt(normalized);
}

function PreviewField({ label, value, onChange, placeholder }) {
  return (
    <div className="input-group">
      <label>{label}</label>
      <input
        className="input"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode="numeric"
        spellCheck="false"
      />
    </div>
  );
}

export default function IndexBrokerRendererPreview({
  customRenderer,
  defaultRenderer,
  poolName,
  tokenDecimals,
  language,
  readProvider,
}) {
  const zh = language === 'zh';
  const [expanded, setExpanded] = useState(false);
  const [params, setParams] = useState({
    collectionName: '',
    tokenId: '1',
    seed: randomSeed(),
    referralCount: '3',
    referrerTokenId: '2',
    miningWeight: '12000',
    indexMiningWeight: '5000000',
    communityTokenUnit: '1',
    level: '2',
    miningActive: true,
    indexMiningActive: true,
  });
  const [preview, setPreview] = useState({ loading: false, image: '', address: '', error: '' });
  const rendererAddress = String(customRenderer || '').trim() || String(defaultRenderer || '').trim();
  const tokenUnitPlaceholder = useMemo(
    () => (10n ** BigInt(Number.isInteger(tokenDecimals) ? tokenDecimals : 18)).toString(),
    [tokenDecimals],
  );
  const update = (key, value) => setParams(current => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!expanded) return undefined;
    if (!readProvider || !rendererAddress) {
      setPreview({
        loading: false,
        image: '',
        address: rendererAddress,
        error: zh ? '正在读取默认 Renderer 地址…' : 'Resolving the default Renderer address…',
      });
      return undefined;
    }
    if (!ethers.isAddress(rendererAddress)) {
      setPreview({
        loading: false,
        image: '',
        address: rendererAddress,
        error: zh ? '请输入有效的 Renderer 地址' : 'Enter a valid Renderer address',
      });
      return undefined;
    }

    let cancelled = false;
    setPreview(current => ({ ...current, loading: true, address: rendererAddress, error: '' }));
    const timer = setTimeout(async () => {
      try {
        const level = unsignedInteger(params.level, 'Level');
        if (level > 4_294_967_295n) throw new Error('Level exceeds uint32');
        const renderParams = {
          collectionName: params.collectionName.trim() || poolName.trim() || 'Index Broker Preview',
          tokenId: unsignedInteger(params.tokenId, 'Token ID'),
          seed: unsignedInteger(params.seed, 'Seed'),
          referralCount: unsignedInteger(params.referralCount, 'Referral count'),
          referrerTokenId: unsignedInteger(params.referrerTokenId, 'Referrer token ID'),
          miningWeight: unsignedInteger(params.miningWeight, 'Mining weight'),
          indexMiningWeight: unsignedInteger(params.indexMiningWeight, 'Index mining weight'),
          communityTokenUnit: unsignedInteger(
            params.communityTokenUnit || tokenUnitPlaceholder,
            'Community Token unit',
          ),
          level: Number(level),
          miningActive: params.miningActive,
          indexMiningActive: params.indexMiningActive,
        };
        const renderer = new ethers.Contract(rendererAddress, IndexBrokerNFTRendererABI, readProvider);
        const svg = await renderer.renderSVG(renderParams);
        if (!String(svg).trimStart().startsWith('<svg')) throw new Error('Renderer returned invalid SVG');
        if (!cancelled) {
          setPreview({
            loading: false,
            image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
            address: rendererAddress,
            error: '',
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to preview Index Broker Renderer:', error);
          setPreview({
            loading: false,
            image: '',
            address: rendererAddress,
            error: zh
              ? '无法使用这些参数调用 Renderer，请检查各字段和合约地址'
              : 'Could not call the Renderer with these parameters; check the fields and contract address',
          });
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [expanded, params, poolName, readProvider, rendererAddress, tokenUnitPlaceholder, zh]);

  return (
    <div className="index-broker-renderer-preview nft-pool-form-wide">
      <button
        type="button"
        className="index-broker-renderer-toggle"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
      >
        <span>
          <strong>{zh ? 'Renderer 图片预览' : 'Renderer image preview'}</strong>
          <small>
            {rendererAddress
              ? `${String(customRenderer || '').trim() ? (zh ? '自定义' : 'Custom') : (zh ? '平台默认' : 'Platform default')} · ${shortenAddress(rendererAddress)}`
              : (zh ? '展开后使用链上 Renderer 生成 SVG' : 'Expand to generate an SVG with the on-chain Renderer')}
          </small>
        </span>
        <span className="index-broker-renderer-action">
          <small>{expanded ? (zh ? '收起' : 'Collapse') : (zh ? '展开预览' : 'Expand preview')}</small>
          <span className={`index-broker-renderer-chevron ${expanded ? 'is-expanded' : ''}`}>⌄</span>
        </span>
      </button>

      {expanded && (
        <div className="renderer-preview index-broker-renderer-body">
          <div className="renderer-preview-copy">
            <div>
              <strong>{zh ? '实际链上渲染' : 'Live on-chain render'}</strong>
              <span>{zh ? '修改字段后会自动重新生成' : 'The image regenerates after you edit a field'}</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => update('seed', randomSeed())}
              disabled={preview.loading}
            >
              {zh ? '随机 Seed' : 'Random seed'}
            </button>
          </div>

          <div className="renderer-preview-parameters index-broker-renderer-parameters">
            <div className="input-group index-broker-renderer-collection">
              <label>{zh ? '合集名称' : 'Collection name'}</label>
              <input
                className="input"
                value={params.collectionName}
                onChange={event => update('collectionName', event.target.value)}
                placeholder={poolName.trim() || 'Index Broker Preview'}
              />
            </div>
            <PreviewField label="Token ID" value={params.tokenId} onChange={value => update('tokenId', value)} />
            <PreviewField label="Seed" value={params.seed} onChange={value => update('seed', value)} placeholder="0 = unrevealed" />
            <PreviewField label={zh ? '推荐数量' : 'Referral count'} value={params.referralCount} onChange={value => update('referralCount', value)} />
            <PreviewField label={zh ? '推荐人 NFT ID' : 'Referrer NFT ID'} value={params.referrerTokenId} onChange={value => update('referrerTokenId', value)} />
            <PreviewField label={zh ? '社区挖矿权重' : 'Community mining weight'} value={params.miningWeight} onChange={value => update('miningWeight', value)} />
            <PreviewField label={zh ? '指数挖矿权重' : 'Index mining weight'} value={params.indexMiningWeight} onChange={value => update('indexMiningWeight', value)} />
            <PreviewField
              label={zh ? '社区代币最小单位' : 'Community Token unit'}
              value={params.communityTokenUnit}
              onChange={value => update('communityTokenUnit', value)}
              placeholder={tokenUnitPlaceholder}
            />
            <PreviewField label={zh ? '等级' : 'Level'} value={params.level} onChange={value => update('level', value)} />
            <label className="index-broker-check index-broker-renderer-check">
              <input type="checkbox" checked={params.miningActive} onChange={event => update('miningActive', event.target.checked)} />
              <span>{zh ? '社区挖矿已激活' : 'Community mining active'}</span>
            </label>
            <label className="index-broker-check index-broker-renderer-check">
              <input type="checkbox" checked={params.indexMiningActive} onChange={event => update('indexMiningActive', event.target.checked)} />
              <span>{zh ? '指数挖矿已激活' : 'Index mining active'}</span>
            </label>
          </div>

          <div className="renderer-preview-stage">
            {preview.loading ? (
              <div className="renderer-preview-status">
                <span className="spinner" />
                {zh ? '正在调用 Renderer 生成图片…' : 'Calling the Renderer to generate the image…'}
              </div>
            ) : preview.error ? (
              <div className="renderer-preview-status is-error">{preview.error}</div>
            ) : preview.image ? (
              <img src={preview.image} alt={zh ? 'Index Broker Renderer 预览' : 'Index Broker Renderer preview'} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
