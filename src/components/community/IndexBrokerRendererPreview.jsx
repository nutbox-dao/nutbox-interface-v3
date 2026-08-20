import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { IndexBrokerNFTRendererABI } from '../../config/abis';
import { shortenAddress } from '../../utils/helpers';
import { multicallRead } from '../../utils/multicall';

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

function tokenAmount(value, decimals, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`${label} must be a token amount`);
  }
  try {
    return ethers.parseUnits(normalized, decimals);
  } catch (cause) {
    throw new Error(`${label} exceeds the token precision`, { cause });
  }
}

function decodeBase64Utf8(value) {
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseTokenImage(tokenUri) {
  const uri = String(tokenUri || '').trim();
  if (!uri) return '';

  try {
    let json;
    if (uri.startsWith('data:application/json;base64,')) {
      json = decodeBase64Utf8(uri.slice('data:application/json;base64,'.length));
    } else if (uri.startsWith('data:application/json,')) {
      json = decodeURIComponent(uri.slice('data:application/json,'.length));
    } else if (uri.startsWith('{')) {
      json = uri;
    } else {
      return '';
    }
    return String(JSON.parse(json).image || '').trim();
  } catch {
    return '';
  }
}

function previewImageUris(uri) {
  const value = String(uri || '').trim();
  if (value.startsWith('ipfs://')) {
    const path = value.slice('ipfs://'.length).replace(/^ipfs\//, '');
    const [cid, ...segments] = path.split('/');
    const suffix = segments.length ? `/${segments.join('/')}` : '';
    return [
      ...(cid && /^[\da-z]+$/i.test(cid) ? [`https://${cid}.ipfs.4everland.io${suffix}`] : []),
      `https://ipfs.io/ipfs/${path}`,
      `https://dweb.link/ipfs/${path}`,
    ];
  }
  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return [value];
  return [];
}

function extractSvgImage(svg) {
  try {
    const document = new DOMParser().parseFromString(String(svg || ''), 'image/svg+xml');
    const image = document.querySelector('image');
    return String(image?.getAttribute('href') || image?.getAttribute('xlink:href') || '').trim();
  } catch {
    return '';
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function preloadImage(source, signal, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      image.onload = null;
      image.onerror = null;
    };
    const abort = () => {
      cleanup();
      image.src = '';
      reject(new Error('Image load aborted'));
    };
    const timer = setTimeout(() => {
      cleanup();
      image.src = '';
      reject(new Error('Image load timed out'));
    }, timeoutMs);
    image.onload = () => {
      cleanup();
      resolve(source);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Image load failed'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    image.src = source;
  });
}

async function firstLoadableImage(candidates, parentSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal?.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.any(candidates.map(source => preloadImage(source, controller.signal)));
  } catch (cause) {
    throw new Error('All preview image sources failed', { cause });
  } finally {
    controller.abort();
    parentSignal?.removeEventListener('abort', abort);
  }
}

function compatibilityErrorMessage(error, zh) {
  const code = error?.code || error?.info?.error?.code || error?.cause?.code;
  if (['TIMEOUT', 'NETWORK_ERROR', 'SERVER_ERROR'].includes(code)) {
    return zh
      ? '验证 Renderer 时 RPC 请求失败，请稍后重试'
      : 'The RPC request failed while validating the Renderer; please retry';
  }
  return zh
    ? 'Renderer 必须兼容 renderSVG、renderTokenURI 和 renderContractURI'
    : 'The Renderer must support renderSVG, renderTokenURI, and renderContractURI';
}

function PreviewField({ label, value, onChange, placeholder, inputMode = 'numeric' }) {
  return (
    <div className="input-group">
      <label>{label}</label>
      <input
        className="input"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
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
  indexMiningTokenAddress,
  language,
  readProvider,
  multicallAddress,
  defaultExpanded = false,
  onStatusChange,
}) {
  const zh = language === 'zh';
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [params, setParams] = useState({
    collectionName: '',
    tokenId: '1',
    seed: randomSeed(),
    referralCount: '3',
    referrerTokenId: '2',
    miningWeight: '12000',
    indexMiningWeight: '5000000',
    indexMiningTokenUnit: '',
    level: '2',
    miningActive: true,
    indexMiningActive: true,
  });
  const [preview, setPreview] = useState({ loading: false, image: '', imageCandidates: [], address: '', error: '' });
  const [compatibility, setCompatibility] = useState({ loading: false, valid: false, address: '', error: '' });
  const [unitContext, setUnitContext] = useState({ loading: false, decimals: tokenDecimals, error: '' });
  const rendererAddress = String(customRenderer || '').trim() || String(defaultRenderer || '').trim();
  const tokenUnitPlaceholder = useMemo(
    () => (10n ** BigInt(Number.isInteger(unitContext.decimals) ? unitContext.decimals : 18)).toString(),
    [unitContext.decimals],
  );
  const update = (key, value) => setParams(current => ({ ...current, [key]: value }));

  useEffect(() => {
    const tokenAddress = String(indexMiningTokenAddress || '').trim();
    if (!tokenAddress) {
      setUnitContext({ loading: false, decimals: tokenDecimals, error: '' });
      return undefined;
    }
    if (!readProvider || !ethers.isAddress(tokenAddress)) {
      setUnitContext({ loading: false, decimals: tokenDecimals, error: zh ? '质押代币地址无效' : 'Invalid staking-token address' });
      return undefined;
    }

    let cancelled = false;
    setUnitContext(current => ({ ...current, loading: true, error: '' }));
    new ethers.Contract(tokenAddress, ['function decimals() view returns (uint8)'], readProvider).decimals()
      .then(decimals => {
        const normalizedDecimals = Number(decimals);
        if (!Number.isInteger(normalizedDecimals) || normalizedDecimals < 0 || normalizedDecimals > 77) {
          throw new Error('Unsupported staking-token decimals');
        }
        if (!cancelled) setUnitContext({ loading: false, decimals: normalizedDecimals, error: '' });
      })
      .catch(() => {
        if (!cancelled) setUnitContext({ loading: false, decimals: tokenDecimals, error: zh ? '无法读取质押代币 decimals' : 'Could not read staking-token decimals' });
      });
    return () => { cancelled = true; };
  }, [indexMiningTokenAddress, readProvider, tokenDecimals, zh]);

  useEffect(() => {
    onStatusChange?.(compatibility);
  }, [compatibility, onStatusChange]);

  useEffect(() => {
    if (!readProvider || !multicallAddress || !rendererAddress || !ethers.isAddress(rendererAddress)) {
      setCompatibility({ loading: false, valid: false, address: rendererAddress, error: '' });
      return undefined;
    }

    let cancelled = false;
    setCompatibility({ loading: true, valid: false, address: rendererAddress, error: '' });
    const timer = setTimeout(async () => {
      try {
        const canonicalParams = {
          collectionName: poolName.trim() || 'Index Broker Compatibility Check',
          tokenId: 1n,
          seed: 1n,
          referralCount: 0n,
          referrerTokenId: 0n,
          miningWeight: 10_000n,
          indexMiningWeight: BigInt(tokenUnitPlaceholder),
          indexMiningTokenUnit: BigInt(tokenUnitPlaceholder),
          level: 1,
          miningActive: true,
          indexMiningActive: true,
        };
        const { svg, tokenUri, contractUri } = await multicallRead(readProvider, multicallAddress, [
          {
            key: 'svg',
            target: rendererAddress,
            contractInterface: IndexBrokerNFTRendererABI,
            functionName: 'renderSVG',
            args: [canonicalParams],
          },
          {
            key: 'tokenUri',
            target: rendererAddress,
            contractInterface: IndexBrokerNFTRendererABI,
            functionName: 'renderTokenURI',
            args: [canonicalParams],
          },
          {
            key: 'contractUri',
            target: rendererAddress,
            contractInterface: IndexBrokerNFTRendererABI,
            functionName: 'renderContractURI',
            args: [canonicalParams.collectionName],
          },
        ]);
        if (!String(svg).trimStart().startsWith('<svg') || !String(tokenUri).trim() || !String(contractUri).trim()) {
          throw new Error('Renderer returned invalid metadata');
        }
        if (!cancelled) setCompatibility({ loading: false, valid: true, address: rendererAddress, error: '' });
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to validate Index Broker Renderer:', error);
        setCompatibility({
          loading: false,
          valid: false,
          address: rendererAddress,
          error: compatibilityErrorMessage(error, zh),
        });
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [multicallAddress, poolName, readProvider, rendererAddress, tokenUnitPlaceholder, zh]);

  useEffect(() => {
    if (!expanded) return undefined;
    if (!readProvider || !multicallAddress || !rendererAddress) {
      setPreview({
        loading: false,
        image: '',
        imageCandidates: [],
        address: rendererAddress,
        error: zh ? '正在读取默认 Renderer 地址…' : 'Resolving the default Renderer address…',
      });
      return undefined;
    }
    if (!ethers.isAddress(rendererAddress)) {
      setPreview({
        loading: false,
        image: '',
        imageCandidates: [],
        address: rendererAddress,
        error: zh ? '请输入有效的 Renderer 地址' : 'Enter a valid Renderer address',
      });
      return undefined;
    }

    let cancelled = false;
    const requestController = new AbortController();
    setPreview(current => ({ ...current, loading: true, address: rendererAddress, error: '' }));
    const timer = setTimeout(async () => {
      try {
        const level = unsignedInteger(params.level, 'Level');
        if (level > 4_294_967_295n) throw new Error('Level exceeds uint32');
        const indexMiningTokenDecimals = Number.isInteger(unitContext.decimals) ? unitContext.decimals : 18;
        const renderParams = {
          collectionName: params.collectionName.trim() || poolName.trim() || 'Index Broker Preview',
          tokenId: unsignedInteger(params.tokenId, 'Token ID'),
          seed: unsignedInteger(params.seed, 'Seed'),
          referralCount: unsignedInteger(params.referralCount, 'Referral count'),
          referrerTokenId: unsignedInteger(params.referrerTokenId, 'Referrer token ID'),
          miningWeight: unsignedInteger(params.miningWeight, 'Mining weight'),
          indexMiningWeight: tokenAmount(
            params.indexMiningWeight,
            indexMiningTokenDecimals,
            'Index mining weight',
          ),
          indexMiningTokenUnit: unsignedInteger(
            params.indexMiningTokenUnit || tokenUnitPlaceholder,
            'Index mining token unit',
          ),
          level: Number(level),
          miningActive: params.miningActive,
          indexMiningActive: params.indexMiningActive,
        };
        const { svg, tokenUri } = await multicallRead(readProvider, multicallAddress, [
          {
            key: 'svg',
            target: rendererAddress,
            contractInterface: IndexBrokerNFTRendererABI,
            functionName: 'renderSVG',
            args: [renderParams],
          },
          {
            key: 'tokenUri',
            target: rendererAddress,
            contractInterface: IndexBrokerNFTRendererABI,
            functionName: 'renderTokenURI',
            args: [renderParams],
          },
        ]);
        if (!String(svg).trimStart().startsWith('<svg')) throw new Error('Renderer returned invalid SVG');
        const externalSvgImage = extractSvgImage(svg);
        const imageCandidates = unique([
          ...previewImageUris(parseTokenImage(tokenUri)),
          ...previewImageUris(externalSvgImage),
          ...(!externalSvgImage ? [`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`] : []),
        ]);
        if (imageCandidates.length === 0) throw new Error('Renderer returned no supported preview image');
        if (cancelled) return;
        const image = await firstLoadableImage(imageCandidates, requestController.signal);
        if (!cancelled) {
          const orderedCandidates = [image, ...imageCandidates.filter(candidate => candidate !== image)];
          setPreview({
            loading: false,
            image,
            imageCandidates: orderedCandidates,
            address: rendererAddress,
            error: '',
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to preview Index Broker Renderer:', error);
          const imageLoadFailed = error.message === 'All preview image sources failed';
          setPreview({
            loading: false,
            image: '',
            imageCandidates: [],
            address: rendererAddress,
            error: imageLoadFailed
              ? (zh
                ? '图片资源加载失败，请检查 IPFS 网关连接'
                : 'The image could not be loaded; check the IPFS gateway connection')
              : (zh
                ? '无法使用这些参数调用 Renderer，请检查各字段和合约地址'
                : 'Could not call the Renderer with these parameters; check the fields and contract address'),
          });
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      requestController.abort();
      clearTimeout(timer);
    };
  }, [expanded, multicallAddress, params, poolName, readProvider, rendererAddress, tokenUnitPlaceholder, unitContext.decimals, zh]);

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
          {(compatibility.loading || compatibility.error || compatibility.valid) && (
            <div className={`contract-field-feedback index-broker-renderer-compatibility ${compatibility.error ? 'is-error' : compatibility.valid ? 'is-success' : ''}`}>
              {compatibility.loading
                ? (zh ? '正在验证 Renderer 完整元数据接口…' : 'Validating the complete Renderer metadata interface…')
                : compatibility.error || (zh ? 'Renderer 完整接口已验证' : 'Complete Renderer interface verified')}
            </div>
          )}
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
            <PreviewField
              label={zh ? '指数挖矿权重（代币数量）' : 'Index mining weight (tokens)'}
              value={params.indexMiningWeight}
              onChange={value => update('indexMiningWeight', value)}
              inputMode="decimal"
            />
            <PreviewField
              label={zh ? '指数挖矿代币单位' : 'Index mining token unit'}
              value={params.indexMiningTokenUnit}
              onChange={value => update('indexMiningTokenUnit', value)}
              placeholder={tokenUnitPlaceholder}
            />
            {(unitContext.loading || unitContext.error) && (
              <div className={`contract-field-feedback index-broker-renderer-unit-status ${unitContext.error ? 'is-error' : ''}`}>
                {unitContext.loading
                  ? (zh ? '正在读取质押代币精度…' : 'Reading staking-token decimals…')
                  : unitContext.error}
              </div>
            )}
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
              <img
                src={preview.image}
                alt={zh ? 'Index Broker Renderer 预览' : 'Index Broker Renderer preview'}
                onError={() => {
                  setPreview(current => {
                    const currentIndex = current.imageCandidates.indexOf(current.image);
                    const nextImage = current.imageCandidates[currentIndex + 1];
                    return nextImage
                      ? { ...current, image: nextImage }
                      : {
                        ...current,
                        image: '',
                        error: zh
                          ? '图片资源加载失败，请检查 IPFS 网关连接'
                          : 'The image could not be loaded; check the IPFS gateway connection',
                      };
                  });
                }}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
