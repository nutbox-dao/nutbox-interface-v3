import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import { useWeb3 } from '../../contexts/Web3Context';
import { ERC20ABI, NutboxSwapWrapperABI } from '../../config/abis';
import { applySwapSlippage, buildNutboxSwapSource } from '../../utils/nutboxSwap';
import { shortenAddress } from '../../utils/helpers';
import useTimedActionLoading from '../../hooks/useTimedActionLoading';

const QUOTE_DELAY_MS = 450;
const DEFAULT_SLIPPAGE_PERCENT = '1';
const MAX_SLIPPAGE_PERCENT = 50;
const SLIPPAGE_PRESETS = [1, 3, 5];
const SWAP_GAS_LIMIT = 2_000_000n;

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

function displayAmount(value, decimals, maximumFractionDigits = 6) {
  if (value == null) return '—';
  const formatted = ethers.formatUnits(value, decimals);
  const [whole, fraction = ''] = formatted.split('.');
  const compactFraction = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '');
  return compactFraction ? `${whole}.${compactFraction}` : whole;
}

function parseSlippageBps(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0.01 || percent > MAX_SLIPPAGE_PERCENT) return null;
  return Math.ceil(percent * 100);
}

function normalizeSlippageInput(value) {
  const sanitized = String(value || '').replace(/[^\d.]/g, '');
  const [whole = '', ...fractionParts] = sanitized.split('.');
  if (fractionParts.length === 0) return whole;
  return `${whole}.${fractionParts.join('').slice(0, 2)}`;
}

function readableSwapError(error, zh) {
  const message = String(error?.shortMessage || error?.reason || error?.message || '');
  if (/user rejected|user denied|action_rejected/i.test(message)) {
    return zh ? '你取消了钱包操作' : 'The wallet action was cancelled';
  }
  if (/insufficient funds/i.test(message)) return zh ? 'BNB 余额不足（请预留 Gas）' : 'Insufficient BNB balance (keep some for gas)';
  if (/allowance|transfer amount exceeds/i.test(message)) return zh ? '代币余额或授权额度不足' : 'Insufficient token balance or allowance';
  if (/slippage/i.test(message)) return zh ? '价格变化超过设置的滑点保护，请重新获取报价' : 'The price moved beyond the configured slippage limit';
  if (/unsupported dex|pair is unavailable|pool id is unavailable|router.*unavailable|quoter.*unavailable/i.test(message)) {
    return zh ? '该社区尚未配置可用的 Nutbox Swap 交易池' : 'This community does not have a supported Nutbox Swap pool';
  }
  return message.split('\n')[0].slice(0, 180) || (zh ? '交易失败' : 'Trade failed');
}

export default function CommunityTokenTradeCard({ community, tokenInfo }) {
  const { language } = useLanguage();
  const toast = useToast();
  const {
    account, network, contracts, readProvider, getWriteSigner,
    isConnected, connecting, connect,
  } = useWeb3();
  const [side, setSide] = useState('buy');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [market, setMarket] = useState({ loading: true, supported: false, error: '' });
  const [balances, setBalances] = useState({ native: 0n, token: 0n });
  const [busy, setBusy] = useTimedActionLoading('');
  const [slippageInput, setSlippageInput] = useState(DEFAULT_SLIPPAGE_PERCENT);
  const quoteRequestRef = useRef(0);
  const zh = language === 'zh';

  const tokenAddress = tokenInfo?.address || community?.cToken || '';
  const tokenDecimals = Number(tokenInfo?.decimals ?? 18);
  const symbol = tokenInfo?.symbol || community?.tick || 'TOKEN';
  const wrapperAddress = contracts.NutboxSwapWrapper;
  const inputDecimals = side === 'buy' ? network.nativeCurrency.decimals : tokenDecimals;
  const outputDecimals = side === 'buy' ? tokenDecimals : network.nativeCurrency.decimals;
  const inputSymbol = side === 'buy' ? network.nativeCurrency.symbol : symbol;
  const outputSymbol = side === 'buy' ? symbol : network.nativeCurrency.symbol;
  const parsedAmount = useMemo(() => parseAmount(amount, inputDecimals), [amount, inputDecimals]);
  const slippageBps = useMemo(() => parseSlippageBps(slippageInput), [slippageInput]);
  const minimumReceived = useMemo(
    () => (quote != null && slippageBps != null ? applySwapSlippage(quote, slippageBps) : null),
    [quote, slippageBps],
  );
  const isHighSlippage = Number(slippageInput) > 5;
  const inputBalance = side === 'buy' ? balances.native : balances.token;

  const buildSource = useCallback(() => buildNutboxSwapSource({
    dexVersion: community?.dexVersion,
    pair: community?.tradePair,
    contracts,
    readProvider,
  }), [community?.dexVersion, community?.tradePair, contracts, readProvider]);

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
    } catch (error) {
      console.warn('Failed to load swap balances:', error);
    }
  }, [account, readProvider, tokenAddress]);

  useEffect(() => {
    let cancelled = false;
    setMarket({ loading: true, supported: false, error: '' });
    setAmount('');
    setQuote(null);
    setQuoteError('');

    (async () => {
      try {
        if (!wrapperAddress || !ethers.isAddress(wrapperAddress)) {
          throw new Error(zh ? '当前网络未部署 Nutbox Swap' : 'Nutbox Swap is not deployed on this network');
        }
        if (!ethers.isAddress(tokenAddress)) throw new Error(zh ? '社区代币地址无效' : 'Invalid Community Token address');
        const wrapper = new ethers.Contract(wrapperAddress, NutboxSwapWrapperABI, readProvider);
        const [registered] = await wrapper.getImportedMarket(tokenAddress);
        if (!registered) {
          throw new Error(zh ? '该社区代币尚未在 Nutbox Swap 注册' : 'This Community Token is not registered in Nutbox Swap');
        }
        await buildSource();
        if (!cancelled) setMarket({ loading: false, supported: true, error: '' });
      } catch (error) {
        if (!cancelled) setMarket({ loading: false, supported: false, error: readableSwapError(error, zh) });
      }
    })();
    return () => { cancelled = true; };
  }, [buildSource, readProvider, tokenAddress, wrapperAddress, zh]);

  useEffect(() => { loadBalances(); }, [loadBalances]);

  useEffect(() => {
    const requestId = ++quoteRequestRef.current;
    setQuote(null);
    setQuoteError('');
    if (!market.supported || !parsedAmount) {
      setQuoteLoading(false);
      return undefined;
    }

    setQuoteLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const { sourceType, sourceData } = await buildSource();
        const wrapper = new ethers.Contract(wrapperAddress, NutboxSwapWrapperABI, readProvider);
        const result = side === 'buy'
          ? await wrapper.getFunction('quoteBuy').staticCall(tokenAddress, sourceType, sourceData, parsedAmount)
          : await wrapper.getFunction('quoteSell').staticCall(tokenAddress, sourceType, sourceData, parsedAmount);
        if (requestId !== quoteRequestRef.current) return;
        if (result <= 0n) throw new Error(zh ? '当前交易池无法给出有效报价' : 'The selected pool returned no quote');
        setQuote(result);
      } catch (error) {
        if (requestId === quoteRequestRef.current) setQuoteError(readableSwapError(error, zh));
      } finally {
        if (requestId === quoteRequestRef.current) setQuoteLoading(false);
      }
    }, QUOTE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [buildSource, market.supported, parsedAmount, readProvider, side, tokenAddress, wrapperAddress, zh]);

  const selectSide = (nextSide) => {
    if (nextSide === side) return;
    quoteRequestRef.current += 1;
    setSide(nextSide);
    setAmount('');
    setQuote(null);
    setQuoteError('');
  };

  const setMax = () => {
    if (!isConnected) return;
    if (side === 'buy') {
      const gasReserve = ethers.parseEther('0.002');
      const maximum = balances.native > gasReserve ? balances.native - gasReserve : 0n;
      setAmount(ethers.formatUnits(maximum, network.nativeCurrency.decimals));
    } else {
      setAmount(ethers.formatUnits(balances.token, tokenDecimals));
    }
  };

  const executeTrade = async () => {
    if (!parsedAmount || !market.supported || slippageBps == null) return;
    try {
      setBusy(side);
      const writeSigner = await getWriteSigner();
      const trader = await writeSigner.getAddress();
      const { sourceType, sourceData } = await buildSource();
      const readWrapper = new ethers.Contract(wrapperAddress, NutboxSwapWrapperABI, readProvider);
      const liveQuote = side === 'buy'
        ? await readWrapper.getFunction('quoteBuy').staticCall(tokenAddress, sourceType, sourceData, parsedAmount)
        : await readWrapper.getFunction('quoteSell').staticCall(tokenAddress, sourceType, sourceData, parsedAmount);
      const minimumOut = applySwapSlippage(liveQuote, slippageBps);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const wrapper = new ethers.Contract(wrapperAddress, NutboxSwapWrapperABI, writeSigner);

      let tx;
      if (side === 'buy') {
        if (parsedAmount >= balances.native) throw new Error(zh ? 'BNB 余额不足（请预留 Gas）' : 'Insufficient BNB balance (keep some for gas)');
        tx = await wrapper.buyToken(
          tokenAddress, sourceType, sourceData, minimumOut,
          trader, deadline, ethers.ZeroAddress,
          { value: parsedAmount, gasLimit: SWAP_GAS_LIMIT },
        );
      } else {
        if (parsedAmount > balances.token) throw new Error(zh ? '代币余额不足' : 'Insufficient token balance');
        const token = new ethers.Contract(tokenAddress, ERC20ABI, writeSigner);
        const allowance = await token.allowance(trader, wrapperAddress);
        if (allowance < parsedAmount) {
          toast.info(zh ? `请先授权 ${symbol}` : `Approve ${symbol} first`);
          const approval = await token.approve(wrapperAddress, parsedAmount);
          await approval.wait();
        }
        tx = await wrapper.sellToken(
          tokenAddress, sourceType, sourceData, parsedAmount,
          minimumOut, trader, deadline, ethers.ZeroAddress,
          { gasLimit: SWAP_GAS_LIMIT },
        );
      }

      toast.info(zh ? '交易已提交，等待链上确认…' : 'Trade submitted. Waiting for confirmation…');
      await tx.wait();
      toast.success(zh ? '交易成功' : 'Trade completed');
      setAmount('');
      setQuote(null);
      await loadBalances();
    } catch (error) {
      console.error('Nutbox swap failed:', error);
      toast.error(readableSwapError(error, zh));
    } finally {
      setBusy('');
    }
  };

  const insufficientBalance = parsedAmount && (
    side === 'buy' ? parsedAmount >= inputBalance : parsedAmount > inputBalance
  );
  const actionDisabled = Boolean(
    busy || market.loading || !market.supported || !parsedAmount || quoteLoading || !quote
      || insufficientBalance || slippageBps == null,
  );

  return (
    <aside className="community-token-trade glass-card">
      <div className="community-token-trade-heading">
        <div className="community-token-trade-logo">{symbol.slice(0, 2).toUpperCase()}</div>
        <div>
          <span>{zh ? '社区代币交易' : 'Community Token trade'}</span>
          <strong>{symbol}</strong>
        </div>
      </div>

      <div className="community-token-trade-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={side === 'buy'} className={side === 'buy' ? 'active' : ''} onClick={() => selectSide('buy')}>
          {zh ? '买入' : 'Buy'}
        </button>
        <button type="button" role="tab" aria-selected={side === 'sell'} className={side === 'sell' ? 'active' : ''} onClick={() => selectSide('sell')}>
          {zh ? '卖出' : 'Sell'}
        </button>
      </div>

      <div className="community-token-swap-field">
        <div className="community-token-swap-field-head">
          <span>{zh ? '支付' : 'You pay'}</span>
          <button type="button" onClick={setMax} disabled={!isConnected || !market.supported}>
            {zh ? '余额' : 'Balance'} {displayAmount(inputBalance, inputDecimals, 4)}
          </button>
        </div>
        <div className="community-token-swap-input-row">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            placeholder="0.0"
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
            disabled={!market.supported || Boolean(busy)}
          />
          <strong>{inputSymbol}</strong>
        </div>
      </div>

      <div className="community-token-swap-arrow">↓</div>

      <div className="community-token-swap-field output">
        <div className="community-token-swap-field-head"><span>{zh ? '预计收到' : 'You receive'}</span></div>
        <div className="community-token-swap-input-row">
          <span className={quoteLoading ? 'is-loading' : ''}>
            {quoteLoading ? '…' : displayAmount(quote, outputDecimals)}
          </span>
          <strong>{outputSymbol}</strong>
        </div>
      </div>

      {market.loading ? (
        <div className="community-token-swap-status">{zh ? '正在检查 Nutbox Swap 市场…' : 'Checking the Nutbox Swap market…'}</div>
      ) : !market.supported ? (
        <div className="community-token-swap-status error">{market.error}</div>
      ) : quoteError ? (
        <div className="community-token-swap-status error">{quoteError}</div>
      ) : (
        <div className="community-token-swap-status">
          {zh ? '实时报价 · 5 分钟有效' : 'Live quote · 5-minute deadline'}
        </div>
      )}

      {minimumReceived != null && (
        <div className="community-token-swap-minimum">
          <span>{zh ? `最少收到（${slippageInput}%）` : `Minimum received (${slippageInput}%)`}</span>
          <strong>{displayAmount(minimumReceived, outputDecimals)} {outputSymbol}</strong>
        </div>
      )}

      <div className="community-token-slippage">
        <div className="community-token-slippage-heading">
          <span>{zh ? '最大滑点' : 'Max slippage'}</span>
          {isHighSlippage && <em>{zh ? '⚠ 高滑点' : '⚠ High slippage'}</em>}
        </div>
        <div className="community-token-slippage-options" role="group" aria-label={zh ? '最大滑点' : 'Maximum slippage'}>
          {SLIPPAGE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={Number(slippageInput) === preset ? 'active' : ''}
              disabled={Boolean(busy)}
              onClick={() => setSlippageInput(String(preset))}
            >
              {preset}%
            </button>
          ))}
          <label className={!SLIPPAGE_PRESETS.includes(Number(slippageInput)) ? 'active' : ''}>
            <input
              type="text"
              inputMode="decimal"
              value={slippageInput}
              aria-label={zh ? '自定义滑点百分比' : 'Custom slippage percentage'}
              disabled={Boolean(busy)}
              onChange={(event) => setSlippageInput(normalizeSlippageInput(event.target.value))}
            />
            <span>%</span>
          </label>
        </div>
        {slippageBps == null && (
          <small>{zh ? '请输入 0.01% 至 50% 的滑点' : 'Enter slippage between 0.01% and 50%'}</small>
        )}
      </div>

      {!isConnected ? (
        <button type="button" className="btn btn-primary community-token-trade-action" disabled={connecting} onClick={connect}>
          {zh ? '连接钱包' : 'Connect wallet'}
        </button>
      ) : (
        <button type="button" className="btn btn-primary community-token-trade-action" disabled={actionDisabled} onClick={executeTrade}>
          {busy
            ? (zh ? '交易处理中…' : 'Trading…')
            : side === 'buy'
              ? (zh ? `买入 ${symbol}` : `Buy ${symbol}`)
              : (zh ? `卖出 ${symbol}` : `Sell ${symbol}`)}
        </button>
      )}

      <a className="community-token-trade-address" href={`${network.explorerUrl}/token/${tokenAddress}`} target="_blank" rel="noreferrer">
        {shortenAddress(tokenAddress, 6)} ↗
      </a>
    </aside>
  );
}
