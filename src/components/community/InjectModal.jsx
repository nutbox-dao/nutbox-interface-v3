import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../../contexts/Web3Context';
import { useToast } from '../../contexts/ToastContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { HourlyTickCalculatorABI, ERC20ABI } from '../../config/abis';
import { formatTokenAmount } from '../../utils/helpers';
import useTimedActionLoading from '../../hooks/useTimedActionLoading';

export default function InjectModal({ communityAddress, tokenInfo, onClose, onSuccess }) {
  const { t, language } = useLanguage();
  const { account, getWriteSigner, readProvider, isConnected, contracts } = useWeb3();
  const toast = useToast();

  const tokenAddress = tokenInfo?.address;
  const decimals = tokenInfo?.decimals || 18;
  const symbol = tokenInfo?.symbol || '';

  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState(0n);
  const [allowance, setAllowance] = useState(0n);
  const [loading, setLoading] = useTimedActionLoading(null); // 'approve' | 'inject' | null

  const refresh = useCallback(async () => {
    if (!readProvider || !account || !tokenAddress) return;
    try {
      const token = new ethers.Contract(tokenAddress, ERC20ABI, readProvider);
      const [bal, allow] = await Promise.all([
        token.balanceOf(account),
        token.allowance(account, contracts.HourlyTickCalculator),
      ]);
      setBalance(bal);
      setAllowance(allow);
    } catch (err) {
      console.error('Failed to load inject balance/allowance:', err);
    }
  }, [readProvider, account, tokenAddress, contracts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const parsedAmount = (() => {
    const str = (amount || '').trim();
    if (!str || isNaN(Number(str))) return null;
    try {
      return ethers.parseUnits(str, decimals);
    } catch {
      return null;
    }
  })();

  const isValidAmount = parsedAmount !== null && parsedAmount > 0n && parsedAmount <= balance;

  const handleInject = async () => {
    if (!tokenAddress || !isValidAmount) return;
    try {
      const writeSigner = await getWriteSigner();
      // Step 1: approve if allowance is insufficient (one-click flow)
      if (allowance < parsedAmount) {
        setLoading('approve');
        const token = new ethers.Contract(tokenAddress, ERC20ABI, writeSigner);
        toast.info(t('inject.toastApproving', { symbol }));
        const approveTx = await token.approve(contracts.HourlyTickCalculator, ethers.MaxUint256);
        await approveTx.wait();
        toast.success(t('inject.toastApproveSuccess'));
        setAllowance(ethers.MaxUint256);
      }

      // Step 2: inject
      setLoading('inject');
      const calc = new ethers.Contract(contracts.HourlyTickCalculator, HourlyTickCalculatorABI, writeSigner);
      toast.info(t('inject.toastInjecting', { amount: amount.trim(), symbol }));
      const tx = await calc.inject(communityAddress, parsedAmount);
      await tx.wait();
      toast.success(t('inject.toastSuccess', { amount: amount.trim(), symbol }));
      onSuccess?.();
      onClose?.();
    } catch (err) {
      console.error('Inject failed:', err);
      toast.error(err.reason || err.shortMessage || (language === 'zh' ? '注入失败' : 'Inject failed'));
    } finally {
      setLoading(null);
    }
  };

  const setMax = () => {
    if (balance > 0n) setAmount(ethers.formatUnits(balance, decimals));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{t('inject.modalTitle')}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Distribution description */}
          <div className="glass-card" style={{ padding: 'var(--space-4)', background: 'rgba(124, 58, 237, 0.04)', border: '1px solid rgba(124, 58, 237, 0.15)', borderRadius: '8px' }}>
            <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 'var(--space-2)' }}>
              {t('inject.descTitle')}
            </h3>
            <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.85, lineHeight: 1.55, marginBottom: 'var(--space-2)' }}>
              {t('inject.descBody', { symbol })}
            </p>
            <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.6, lineHeight: 1.5 }}>
              {t('inject.descNote')}
            </p>
          </div>

          {/* Wallet / chain gating */}
          {!isConnected ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-4)', color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
              {t('inject.connectFirst')}
            </div>
          ) : (
            <>
              {/* Amount input */}
              <div className="input-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label>{t('inject.amountLabel')}</label>
                  <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>
                    {t('inject.balanceLabel')}: {formatTokenAmount(balance, decimals, 4)} {symbol}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <input
                    type="number"
                    className="input"
                    placeholder="0.0"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    min="0"
                    step="any"
                    disabled={!!loading}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={setMax}
                    disabled={!!loading || balance <= 0n}
                    style={{ flexShrink: 0 }}
                  >
                    {t('inject.max')}
                  </button>
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, flexShrink: 0 }}>{symbol}</span>
                </div>
                {amount && !isValidAmount && parsedAmount !== null && parsedAmount > 0n && (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)', marginTop: 4 }}>
                    {t('inject.amountTooBig')}
                  </span>
                )}
              </div>

              {/* One-click inject: approves automatically if allowance is insufficient */}
              <button
                className="btn btn-primary btn-lg"
                onClick={handleInject}
                disabled={!isValidAmount || loading !== null}
                style={{ width: '100%' }}
              >
                {loading === 'approve' ? (
                  <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {t('inject.approving')}</>
                ) : loading === 'inject' ? (
                  <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {t('inject.injecting')}</>
                ) : (
                  t('inject.btnInjectConfirm', { amount: amount.trim() || '0', symbol })
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
