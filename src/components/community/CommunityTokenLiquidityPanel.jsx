import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import { useWeb3 } from '../../contexts/Web3Context';
import { ERC20ABI } from '../../config/abis';
import {
  addCurrentUniswapV4Liquidity,
  collectCurrentUniswapV4Fees,
  loadCurrentUniswapV4Pool,
  loadCurrentUniswapV4Positions,
  nativePriceToTick,
  rangeTicksFromPercent,
  readableLiquidityError,
  removeCurrentUniswapV4Liquidity,
  tickToNativePrice,
} from '../../utils/uniswapV4Liquidity';
import LiquidityRangeChart from './LiquidityRangeChart';

const RANGE_PRESETS = [10, 25, 50, 'full'];
const REMOVE_PRESETS = [25, 50, 75, 100];
const SLIPPAGE_BPS = 100;
const GAS_RESERVE = ethers.parseEther('0.005');

function sanitizeAmount(value) {
  const sanitized = String(value || '').replace(/[^\d.]/g, '');
  const [whole = '', ...fractions] = sanitized.split('.');
  return fractions.length ? `${whole}.${fractions.join('')}` : whole;
}

function parseAmount(value, decimals) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === '.' || normalized.endsWith('.')) return null;
  try {
    const amount = ethers.parseUnits(normalized, decimals);
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

function inputAmount(value, maximumFractionDigits = 8) {
  if (!Number.isFinite(value) || value <= 0) return '';
  return value.toFixed(maximumFractionDigits).replace(/\.?0+$/, '');
}

function displayUnits(value, decimals, digits = 5) {
  if (value == null) return '—';
  const number = Number(ethers.formatUnits(value, decimals));
  if (!Number.isFinite(number)) return '—';
  if (number > 0 && number < 0.00001) return number.toExponential(2);
  return number.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function displayPrice(value) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 0.0001) return value.toPrecision(5);
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function editablePrice(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 0.000001 || value >= 1_000_000) return value.toExponential(6);
  return value.toFixed(9).replace(/\.?0+$/, '');
}

function compactLiquidity(value) {
  const text = String(value || 0n);
  if (text.length <= 8) return Number(text).toLocaleString();
  return `${text.slice(0, 4)}…${text.slice(-3)}`;
}

export default function CommunityTokenLiquidityPanel({ community, tokenInfo }) {
  const { language } = useLanguage();
  const toast = useToast();
  const {
    account, network, contracts, readProvider, getWriteSigner,
    isConnected, connecting, connect,
  } = useWeb3();
  const zh = language === 'zh';
  const tokenAddress = tokenInfo?.address || community?.cToken || '';
  const tokenDecimals = Number(tokenInfo?.decimals ?? 18);
  const nativeDecimals = Number(network.nativeCurrency.decimals ?? 18);
  const symbol = tokenInfo?.symbol || community?.tick || 'TOKEN';
  const nativeSymbol = network.nativeCurrency.symbol;
  const [panel, setPanel] = useState('add');
  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [positions, setPositions] = useState([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [balances, setBalances] = useState({ native: 0n, token: 0n });
  const [rangePreset, setRangePreset] = useState(25);
  const [selectedTicks, setSelectedTicks] = useState(null);
  const [rangeInputs, setRangeInputs] = useState({ min: '', max: '' });
  const [rangeInputError, setRangeInputError] = useState('');
  const [nativeAmount, setNativeAmount] = useState('');
  const [tokenAmount, setTokenAmount] = useState('');
  const [removePercents, setRemovePercents] = useState({});
  const [busy, setBusy] = useState('');
  const [submitError, setSubmitError] = useState('');

  const loadPool = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextPool = await loadCurrentUniswapV4Pool({
        community, contracts, readProvider, tokenAddress, tokenDecimals, nativeDecimals,
      });
      setPool(nextPool);
    } catch (nextError) {
      console.error('Failed to load current V4 pool:', nextError);
      setError(readableLiquidityError(nextError, zh));
    } finally {
      setLoading(false);
    }
  }, [community, contracts, nativeDecimals, readProvider, tokenAddress, tokenDecimals, zh]);

  const loadBalances = useCallback(async () => {
    if (!account || !ethers.isAddress(tokenAddress)) {
      setBalances({ native: 0n, token: 0n });
      return;
    }
    try {
      const token = new ethers.Contract(tokenAddress, ERC20ABI, readProvider);
      const [native, tokenBalance] = await Promise.all([
        readProvider.getBalance(account),
        token.balanceOf(account),
      ]);
      setBalances({ native, token: tokenBalance });
    } catch (nextError) {
      console.warn('Failed to load liquidity balances:', nextError);
    }
  }, [account, readProvider, tokenAddress]);

  const loadPositions = useCallback(async (forceRefresh = false) => {
    if (!pool || !account) {
      setPositions([]);
      return;
    }
    setPositionsLoading(true);
    try {
      const nextPositions = await loadCurrentUniswapV4Positions({
        pool, account, contracts, readProvider, deploymentBlock: network.deploymentBlock,
        forceRefresh,
      });
      setPositions(nextPositions);
    } catch (nextError) {
      console.error('Failed to load current pool positions:', nextError);
      toast.error(readableLiquidityError(nextError, zh));
    } finally {
      setPositionsLoading(false);
    }
  }, [account, contracts, network.deploymentBlock, pool, readProvider, toast, zh]);

  useEffect(() => { loadPool(); }, [loadPool]);
  useEffect(() => { loadBalances(); }, [loadBalances]);
  useEffect(() => { loadPositions(); }, [loadPositions]);

  const rangePoolId = pool?.poolId;
  const rangeTickSpacing = pool?.tickSpacing;
  const rangeCurrentPrice = pool?.currentPrice;
  const range = useMemo(() => {
    if (!pool) return null;
    const ticks = selectedTicks || rangeTicksFromPercent(pool.currentPrice, 25, pool.tickSpacing, tokenDecimals, nativeDecimals);
    return {
      ...ticks,
      minPrice: tickToNativePrice(ticks.tickUpper, tokenDecimals, nativeDecimals),
      maxPrice: tickToNativePrice(ticks.tickLower, tokenDecimals, nativeDecimals),
      full: rangePreset === 'full',
    };
  }, [nativeDecimals, pool, rangePreset, selectedTicks, tokenDecimals]);

  useEffect(() => {
    if (!rangePoolId || !rangeTickSpacing || !rangeCurrentPrice) return;
    const ticks = rangeTicksFromPercent(rangeCurrentPrice, 25, rangeTickSpacing, tokenDecimals, nativeDecimals);
    const minPrice = tickToNativePrice(ticks.tickUpper, tokenDecimals, nativeDecimals);
    const maxPrice = tickToNativePrice(ticks.tickLower, tokenDecimals, nativeDecimals);
    setSelectedTicks(ticks);
    setRangePreset(25);
    setRangeInputs({ min: editablePrice(minPrice), max: editablePrice(maxPrice) });
    setRangeInputError('');
  }, [nativeDecimals, rangeCurrentPrice, rangePoolId, rangeTickSpacing, tokenDecimals]);

  const applyPriceRange = (minPrice, maxPrice, syncInputs = false) => {
    if (!pool || !Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0 || maxPrice <= minPrice) {
      setRangeInputError(zh ? '最低价必须大于 0，并且低于最高价' : 'Minimum price must be above 0 and below maximum price');
      return false;
    }
    const tickLower = nativePriceToTick(maxPrice, pool.tickSpacing, tokenDecimals, nativeDecimals);
    let tickUpper = nativePriceToTick(minPrice, pool.tickSpacing, tokenDecimals, nativeDecimals);
    if (tickLower >= tickUpper) tickUpper = tickLower + pool.tickSpacing;
    const nextTicks = { tickLower, tickUpper };
    setSelectedTicks(nextTicks);
    setRangePreset('custom');
    setRangeInputError('');
    if (syncInputs) {
      setRangeInputs({
        min: editablePrice(tickToNativePrice(tickUpper, tokenDecimals, nativeDecimals)),
        max: editablePrice(tickToNativePrice(tickLower, tokenDecimals, nativeDecimals)),
      });
    }
    return true;
  };

  const selectRangePreset = (preset) => {
    if (!pool) return;
    const ticks = rangeTicksFromPercent(pool.currentPrice, preset, pool.tickSpacing, tokenDecimals, nativeDecimals);
    setSelectedTicks(ticks);
    setRangePreset(preset);
    setRangeInputError('');
    setRangeInputs({
      min: editablePrice(tickToNativePrice(ticks.tickUpper, tokenDecimals, nativeDecimals)),
      max: editablePrice(tickToNativePrice(ticks.tickLower, tokenDecimals, nativeDecimals)),
    });
  };

  const updateRangeInput = (field, value) => {
    const nextInputs = { ...rangeInputs, [field]: value.replace(/[^\d.eE+-]/g, '') };
    setRangeInputs(nextInputs);
    const minPrice = Number(nextInputs.min);
    const maxPrice = Number(nextInputs.max);
    if (nextInputs.min && nextInputs.max) applyPriceRange(minPrice, maxPrice);
  };

  const validateRangeInputs = () => {
    // Keep the exact text the user entered. The executable range is aligned to
    // the pool's tick spacing internally, without rewriting the input on blur.
    applyPriceRange(Number(rangeInputs.min), Number(rangeInputs.max));
  };

  const rangeInputsValid = Boolean(rangeInputs.min && rangeInputs.max)
    && Number.isFinite(Number(rangeInputs.min))
    && Number.isFinite(Number(rangeInputs.max))
    && Number(rangeInputs.min) > 0
    && Number(rangeInputs.max) > Number(rangeInputs.min);

  const parsedNative = useMemo(() => parseAmount(nativeAmount, nativeDecimals), [nativeAmount, nativeDecimals]);
  const parsedToken = useMemo(() => parseAmount(tokenAmount, tokenDecimals), [tokenAmount, tokenDecimals]);
  const nativeWithSlippage = parsedNative ? parsedNative + parsedNative * BigInt(SLIPPAGE_BPS) / 10_000n : 0n;
  const tokenWithSlippage = parsedToken ? parsedToken + parsedToken * BigInt(SLIPPAGE_BPS) / 10_000n : 0n;
  const insufficientNative = nativeWithSlippage > 0n && nativeWithSlippage + GAS_RESERVE > balances.native;
  const insufficientToken = tokenWithSlippage > balances.token;

  const updateNativeAmount = (value) => {
    const next = sanitizeAmount(value);
    setSubmitError('');
    setNativeAmount(next);
    const numeric = Number(next);
    if (pool?.currentPrice && Number.isFinite(numeric)) setTokenAmount(inputAmount(numeric / pool.currentPrice, 6));
  };

  const updateTokenAmount = (value) => {
    const next = sanitizeAmount(value);
    setSubmitError('');
    setTokenAmount(next);
    const numeric = Number(next);
    if (pool?.currentPrice && Number.isFinite(numeric)) setNativeAmount(inputAmount(numeric * pool.currentPrice, 8));
  };

  const addLiquidity = async () => {
    setSubmitError('');
    if (!pool || !range) {
      setSubmitError(zh ? '当前流动性池暂不可用' : 'The current liquidity pool is unavailable');
      return;
    }
    if (!rangeInputsValid || rangeInputError) {
      setSubmitError(zh ? '请先设置有效的价格区间' : 'Set a valid price range first');
      return;
    }
    if (!parsedNative || !parsedToken) {
      setSubmitError(zh ? '请输入有效的存入数量' : 'Enter valid deposit amounts');
      return;
    }
    if (insufficientNative) {
      setSubmitError(zh ? `${nativeSymbol} 余额不足，请预留 Gas` : `Insufficient ${nativeSymbol}; keep some for gas`);
      return;
    }
    if (insufficientToken) {
      setSubmitError(zh ? `${symbol} 余额不足` : `Insufficient ${symbol} balance`);
      return;
    }
    try {
      setBusy('add');
      const signer = await getWriteSigner();
      const owner = await signer.getAddress();
      await addCurrentUniswapV4Liquidity({
        pool, amountNative: parsedNative, amountToken: parsedToken,
        tickLower: range.tickLower, tickUpper: range.tickUpper, slippageBps: SLIPPAGE_BPS,
        account: owner, signer, contracts,
        onApproval: () => toast.info(zh ? `请在钱包中授权 ${symbol}` : `Approve ${symbol} in your wallet`),
      });
      toast.success(zh ? '流动性添加成功' : 'Liquidity added');
      setSubmitError('');
      setNativeAmount('');
      setTokenAmount('');
      setPanel('positions');
      await Promise.all([loadBalances(), loadPool(), loadPositions(true)]);
    } catch (nextError) {
      console.error('Add V4 liquidity failed:', nextError);
      const message = readableLiquidityError(nextError, zh);
      setSubmitError(message);
      toast.error(message);
    } finally {
      setBusy('');
    }
  };

  const removeLiquidity = async (position) => {
    const percent = removePercents[position.tokenId.toString()] || 25;
    try {
      setBusy(`remove-${position.tokenId}`);
      const signer = await getWriteSigner();
      const owner = await signer.getAddress();
      await removeCurrentUniswapV4Liquidity({
        pool, position, percent, slippageBps: SLIPPAGE_BPS,
        account: owner, signer, contracts,
      });
      toast.success(zh ? `已移除 ${percent}% 流动性` : `Removed ${percent}% liquidity`);
      await Promise.all([loadBalances(), loadPool(), loadPositions(true)]);
    } catch (nextError) {
      console.error('Remove V4 liquidity failed:', nextError);
      toast.error(readableLiquidityError(nextError, zh));
    } finally {
      setBusy('');
    }
  };

  const collectFees = async (position) => {
    try {
      setBusy(`collect-${position.tokenId}`);
      const signer = await getWriteSigner();
      const owner = await signer.getAddress();
      await collectCurrentUniswapV4Fees({
        pool, position, account: owner, signer, contracts,
      });
      toast.success(zh ? '手续费奖励领取成功' : 'Fee rewards collected');
      await Promise.all([loadBalances(), loadPositions(true)]);
    } catch (nextError) {
      console.error('Collect V4 fees failed:', nextError);
      toast.error(readableLiquidityError(nextError, zh));
    } finally {
      setBusy('');
    }
  };

  if (loading) return <div className="community-liquidity-loading">{zh ? '正在读取当前交易池…' : 'Loading current pool…'}</div>;
  if (error || !pool || !range) return <div className="community-token-swap-status error">{error || (zh ? '无法读取当前交易池' : 'Unable to load the current pool')}</div>;

  const nativeIsCurrency0 = pool.currency0 === ethers.ZeroAddress;

  return (
    <div className="community-liquidity-panel">
      <div className="community-liquidity-summary">
        <div><span>{zh ? '当前价格' : 'Current price'}</span><strong>{displayPrice(pool.currentPrice)} {nativeSymbol}/{symbol}</strong></div>
        <div><span>{zh ? 'LP 费率' : 'LP fee'}</span><strong>{((pool.lpFee || pool.fee) / 10_000).toFixed(2)}%</strong></div>
        <div><span>{zh ? '活跃流动性' : 'Active liquidity'}</span><strong>{compactLiquidity(pool.liquidity)}</strong></div>
        <small>{zh ? '仅管理当前池' : 'Current pool only'} · {String(pool.poolId).slice(0, 8)}…{String(pool.poolId).slice(-6)}</small>
      </div>

      <div className="community-liquidity-subtabs" role="tablist">
        <button type="button" role="tab" aria-selected={panel === 'add'} className={panel === 'add' ? 'active' : ''} onClick={() => setPanel('add')}>
          {zh ? '增加流动性' : 'Add liquidity'}
        </button>
        <button type="button" role="tab" aria-selected={panel === 'positions'} className={panel === 'positions' ? 'active' : ''} onClick={() => setPanel('positions')}>
          {zh ? `我的仓位${positions.length ? ` (${positions.length})` : ''}` : `My positions${positions.length ? ` (${positions.length})` : ''}`}
        </button>
      </div>

      {panel === 'add' ? (
        <>
          <div className="community-liquidity-range-head">
            <span>{zh ? '价格区间' : 'Price range'}</span>
            <strong>{range.full ? (zh ? '全范围' : 'Full range') : `${displayPrice(range.minPrice)} – ${displayPrice(range.maxPrice)}`}</strong>
          </div>
          <div className="community-liquidity-manual-range">
            <label>
              <span>{zh ? '最低价' : 'Min price'}</span>
              <div><input value={rangeInputs.min} inputMode="decimal" onChange={event => updateRangeInput('min', event.target.value)} onBlur={validateRangeInputs} disabled={Boolean(busy)} /><small>{nativeSymbol}/{symbol}</small></div>
            </label>
            <span className="community-liquidity-range-separator">—</span>
            <label>
              <span>{zh ? '最高价' : 'Max price'}</span>
              <div><input value={rangeInputs.max} inputMode="decimal" onChange={event => updateRangeInput('max', event.target.value)} onBlur={validateRangeInputs} disabled={Boolean(busy)} /><small>{nativeSymbol}/{symbol}</small></div>
            </label>
          </div>
          {rangeInputError && <div className="community-liquidity-range-error">{rangeInputError}</div>}
          {!rangeInputError && rangePreset === 'custom' && (
            <div className="community-liquidity-range-note">
              {zh ? '链上执行时会自动对齐到最接近的有效价格刻度' : 'Execution is aligned to the nearest valid pool price tick'}
            </div>
          )}
          <LiquidityRangeChart
            currentPrice={pool.currentPrice}
            minPrice={range.minPrice}
            maxPrice={range.maxPrice}
            fullRange={range.full}
            disabled={Boolean(busy)}
            selectedLabel={zh ? '选择范围 · 可拖动' : 'Selected range · drag'}
            currentLabel={`${zh ? '当前价' : 'Current'} ${displayPrice(pool.currentPrice)}`}
            lowLabel={zh ? '低价' : 'Lower'}
            highLabel={zh ? '高价' : 'Higher'}
            onRangeChange={({ minPrice, maxPrice }) => applyPriceRange(minPrice, maxPrice, true)}
          />
          <div className="community-liquidity-range-options">
            {RANGE_PRESETS.map(preset => (
              <button key={preset} type="button" className={rangePreset === preset ? 'active' : ''} onClick={() => selectRangePreset(preset)} disabled={Boolean(busy)}>
                {preset === 'full' ? (zh ? '全范围' : 'Full') : `±${preset}%`}
              </button>
            ))}
          </div>

          <div className="community-liquidity-deposit">
            <label>
              <span>{zh ? '存入' : 'Deposit'} · {zh ? '余额' : 'Balance'} {displayUnits(balances.native, nativeDecimals, 4)}</span>
              <div><input value={nativeAmount} inputMode="decimal" placeholder="0.0" onChange={event => updateNativeAmount(event.target.value)} disabled={Boolean(busy)} /><strong>{nativeSymbol}</strong></div>
            </label>
            <label>
              <span>{zh ? '存入' : 'Deposit'} · {zh ? '余额' : 'Balance'} {displayUnits(balances.token, tokenDecimals, 4)}</span>
              <div><input value={tokenAmount} inputMode="decimal" placeholder="0.0" onChange={event => updateTokenAmount(event.target.value)} disabled={Boolean(busy)} /><strong>{symbol}</strong></div>
            </label>
          </div>
          <div className="community-liquidity-hint">{zh ? '按当前价格自动配比 · 1% 滑点保护 · 未使用的代币会自动退回' : 'Auto-balanced at the current price · 1% slippage protection · unused tokens are refunded'}</div>
          {!isConnected ? (
            <button type="button" className="btn btn-primary community-token-trade-action" disabled={connecting} onClick={connect}>{zh ? '连接钱包' : 'Connect wallet'}</button>
          ) : (
            <button type="button" className="btn btn-primary community-token-trade-action" disabled={Boolean(busy)} onClick={addLiquidity}>
              {busy === 'add' ? (zh ? '添加中…' : 'Adding…') : (zh ? '增加流动性' : 'Add liquidity')}
            </button>
          )}
          {submitError && <div className="community-liquidity-submit-error" role="alert">{submitError}</div>}
        </>
      ) : !isConnected ? (
        <div className="community-liquidity-empty">
          <span>{zh ? '连接钱包后查看这个池子的仓位' : 'Connect your wallet to view positions in this pool'}</span>
          <button type="button" className="btn btn-primary" disabled={connecting} onClick={connect}>{zh ? '连接钱包' : 'Connect wallet'}</button>
        </div>
      ) : positionsLoading ? (
        <div className="community-liquidity-loading">{zh ? '正在读取仓位…' : 'Loading positions…'}</div>
      ) : positions.length === 0 ? (
        <div className="community-liquidity-empty"><span>{zh ? '当前钱包在这个池子里暂无仓位' : 'This wallet has no positions in the current pool'}</span></div>
      ) : (
        <div className="community-liquidity-positions">
          {positions.map(position => {
            const key = position.tokenId.toString();
            const percent = removePercents[key] || 25;
            const nativeValue = nativeIsCurrency0 ? position.amount0 : position.amount1;
            const tokenValue = nativeIsCurrency0 ? position.amount1 : position.amount0;
            const nativeFees = nativeIsCurrency0 ? position.fee0 : position.fee1;
            const tokenFees = nativeIsCurrency0 ? position.fee1 : position.fee0;
            const hasFees = nativeFees > 0n || tokenFees > 0n;
            return (
              <article className="community-liquidity-position" key={key}>
                <div className="community-liquidity-position-head">
                  <strong>Position #{key}</strong>
                  <span className={position.inRange ? 'in-range' : ''}>{position.inRange ? (zh ? '区间内' : 'In range') : (zh ? '区间外' : 'Out of range')}</span>
                </div>
                <div className="community-liquidity-position-assets">
                  <small>{zh ? '仓位持仓' : 'Position holdings'}</small>
                  <div className="community-liquidity-position-values">
                    <span><b>{displayUnits(nativeValue, nativeDecimals)}</b> {nativeSymbol}</span>
                    <span><b>{displayUnits(tokenValue, tokenDecimals)}</b> {symbol}</span>
                  </div>
                </div>
                <small className="community-liquidity-position-range">{displayPrice(tickToNativePrice(position.tickUpper, tokenDecimals, nativeDecimals))} – {displayPrice(tickToNativePrice(position.tickLower, tokenDecimals, nativeDecimals))} {nativeSymbol}/{symbol}</small>
                <div className="community-liquidity-position-fees">
                  <div>
                    <small>{zh ? '未领取手续费' : 'Unclaimed fees'}</small>
                    <div>
                      <span><b>{displayUnits(nativeFees, nativeDecimals, 7)}</b> {nativeSymbol}</span>
                      <span><b>{displayUnits(tokenFees, tokenDecimals, 7)}</b> {symbol}</span>
                    </div>
                  </div>
                  <button type="button" disabled={Boolean(busy) || !hasFees} onClick={() => collectFees(position)}>
                    {busy === `collect-${key}` ? (zh ? '领取中…' : 'Collecting…') : (zh ? '领取手续费' : 'Collect fees')}
                  </button>
                </div>
                <div className="community-liquidity-remove-row">
                  <div>{REMOVE_PRESETS.map(option => <button type="button" key={option} className={percent === option ? 'active' : ''} disabled={Boolean(busy)} onClick={() => setRemovePercents(previous => ({ ...previous, [key]: option }))}>{option}%</button>)}</div>
                  <button type="button" className="remove" disabled={Boolean(busy)} onClick={() => removeLiquidity(position)}>{busy === `remove-${key}` ? (zh ? '移除中…' : 'Removing…') : (zh ? '移除' : 'Remove')}</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
