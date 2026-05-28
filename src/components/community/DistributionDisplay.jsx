import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell, Brush } from 'recharts';
import { useWeb3 } from '../../contexts/Web3Context';
import { useCommunityRead, useLinearCalculator, useLinearTimeCalculator, useHourlyTickCalculator } from '../../hooks/useContract';
import { CONTRACTS, BLOCK_TIME_SECONDS } from '../../config/contracts';
import { formatTokenAmount, formatDate } from '../../utils/helpers';
import { useLanguage } from '../../contexts/LanguageContext';
import './DistributionDisplay.css';

// ── Calculator type detection ──
const CALCULATOR_ADDRESSES = {
  [CONTRACTS.LinearCalculator.toLowerCase()]: 'LINEAR_BLOCK',
  [CONTRACTS.LinearTimeCalculator.toLowerCase()]: 'LINEAR_TIME',
  [CONTRACTS.HourlyTickCalculator.toLowerCase()]: 'HOURLY_TICK',
};

function getCalculatorType(address) {
  if (!address) return null;
  return CALCULATOR_ADDRESSES[address.toLowerCase()] || 'UNKNOWN';
}

const CALCULATOR_LABELS = {
  LINEAR_BLOCK: 'Linear (Block-based)',
  LINEAR_TIME: 'Linear (Time-based)',
  HOURLY_TICK: 'Hourly Tick (Injection-based)',
  UNKNOWN: 'Unknown Calculator',
};

const CALCULATOR_ICONS = {
  LINEAR_BLOCK: '⛓️',
  LINEAR_TIME: '⏱️',
  HOURLY_TICK: '💉',
  UNKNOWN: '❓',
};

// ── Colors ──
const COLOR_ACTUAL = '#FF8F40';
const COLOR_FORECAST = '#9B83FA';
const COLOR_TIMELINE_GRADIENT = ['#7c3aed', '#3b82f6', '#06b6d4'];

export default function DistributionDisplay({ communityAddress, tokenInfo, community }) {
  const { t, language } = useLanguage();
  const communityContract = useCommunityRead(communityAddress);
  const linearCalc = useLinearCalculator();
  const linearTimeCalc = useLinearTimeCalculator();
  const hourlyCalc = useHourlyTickCalculator();

  const [calculatorType, setCalculatorType] = useState(null);
  const [calculatorAddress, setCalculatorAddress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInfoPopover, setShowInfoPopover] = useState(false);

  // Linear era data
  const [eras, setEras] = useState([]);
  const [currentRewardRate, setCurrentRewardRate] = useState(null);

  // Hourly tick data
  const [dailyChartData, setDailyChartData] = useState([]);
  const [hourlyChartData, setHourlyChartData] = useState([]);
  const [chartViewMode, setChartViewMode] = useState('daily'); // 'daily' or 'hourly'
  const [avgRewardPerDay, setAvgRewardPerDay] = useState(0);
  const [totalInjected, setTotalInjected] = useState(null);

  const currentPhaseRef = useRef(null);

  // Step 1: Detect calculator type from chain
  useEffect(() => {
    if (!communityContract) return;
    let cancelled = false;

    async function detectCalculator() {
      try {
        const addr = await communityContract.rewardCalculator();
        if (cancelled) return;
        setCalculatorAddress(addr);
        setCalculatorType(getCalculatorType(addr));
      } catch (err) {
        console.error('Failed to read rewardCalculator:', err);
        if (!cancelled) {
          setError('Failed to detect calculator type');
          setLoading(false);
        }
      }
    }

    detectCalculator();
    return () => { cancelled = true; };
  }, [communityContract]);

  // Step 2: Load distribution data based on calculator type
  useEffect(() => {
    if (!calculatorType || !communityAddress) return;
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        if (calculatorType === 'LINEAR_BLOCK' || calculatorType === 'LINEAR_TIME') {
          await loadLinearEras(cancelled);
        } else if (calculatorType === 'HOURLY_TICK') {
          await loadHourlyData(cancelled);
        } else {
          // Unknown calculator: try to load from community distribution JSON
          loadFromCommunityInfo();
        }
      } catch (err) {
        console.error('Failed to load distribution data:', err);
        if (!cancelled) setError(t('detail.distLoadingError') || 'Failed to load distribution data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, [calculatorType, communityAddress, linearCalc, linearTimeCalc, hourlyCalc, language]);

  // ── Load linear eras from chain ──
  const loadLinearEras = async (cancelled) => {
    const calc = calculatorType === 'LINEAR_BLOCK' ? linearCalc : linearTimeCalc;
    if (!calc) return;

    try {
      const count = await calc.distributionCountMap(communityAddress);
      const eraCount = Number(count);
      const loadedEras = [];

      for (let i = 0; i < eraCount; i++) {
        const era = await calc.distributionErasMap(communityAddress, i);
        loadedEras.push({
          amount: era.amount,
          startCursor: era.startCursor,
          stopCursor: era.stopCursor,
        });
      }

      // Also get current reward rate
      let rate = 0n;
      try {
        rate = await calc.getCurrentRewardRate(communityAddress);
      } catch { /* might be 0 */ }

      if (!cancelled) {
        setEras(loadedEras);
        setCurrentRewardRate(rate);
      }
    } catch (err) {
      // Fallback: try to load from community.distribution JSON field
      console.warn('Chain read failed, trying community info distribution:', err);
      loadFromCommunityInfo();
    }
  };

  // ── Load from community info JSON (fallback) ──
  const loadFromCommunityInfo = () => {
    if (!community?.distribution || community.distribution.length === 0) return;

    const parsed = community.distribution;
    const mappedEras = parsed.map(d => ({
      amount: BigInt(Math.round(d.amount)),
      startCursor: BigInt(d.start),
      stopCursor: BigInt(d.end),
    }));
    setEras(mappedEras);
  };

  // ── Load hourly tick data ──
  const loadHourlyData = async (cancelled) => {
    if (!hourlyCalc) return;

    try {
      const PAST_DAYS = 6; // index 0~6 is past 7 days (including today)
      const TOTAL_DAYS = 14; // including 7 future days

      const getLocalDayStartSec = (dayOffset) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + dayOffset);
        return Math.floor(d.getTime() / 1000);
      };

      const rangeStart = getLocalDayStartSec(-PAST_DAYS); // 6 days ago local midnight
      const rewards = await hourlyCalc.getHourlyRewards(communityAddress, BigInt(rangeStart), BigInt(TOTAL_DAYS * 24));

      // Aggregate by day (24-hour buckets)
      const dailyRewards = Array.from({ length: TOTAL_DAYS }, () => 0n);
      for (let i = 0; i < rewards.length; i++) {
        const dayIdx = Math.floor(i / 24);
        if (dayIdx < TOTAL_DAYS) {
          dailyRewards[dayIdx] += rewards[i];
        }
      }

      const days = [];
      const todayIdx = PAST_DAYS; // index 6 is today

      for (let d = 0; d < TOTAL_DAYS; d++) {
        const dayStartSec = rangeStart + d * 86400;
        const dayTotal = dailyRewards[d];
        const dayTotalNum = Number(ethers.formatUnits(dayTotal, tokenInfo?.decimals || 18));

        // Determine label
        const dayDate = new Date(dayStartSec * 1000);
        const dateStr = dayDate.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });

        const isToday = d === todayIdx;
        const isTomorrow = d === todayIdx + 1;

        const label = isToday ? `${dateStr} (${t('detail.distToday')})` : isTomorrow ? `${dateStr} (${t('detail.distTomorrow')})` : dateStr;

        // Split today's bar into actual/forecast
        let actual = dayTotalNum;
        let forecast = 0;
        if (isToday) {
          const elapsedRatio = getTodayElapsedRatio();
          actual = dayTotalNum * elapsedRatio;
          forecast = dayTotalNum * (1 - elapsedRatio);
        } else if (isTomorrow || d > todayIdx) {
          actual = 0;
          forecast = dayTotalNum;
        }

        days.push({
          label,
          actual: Math.round(actual * 100) / 100,
          forecast: Math.round(forecast * 100) / 100,
          total: Math.round(dayTotalNum * 100) / 100,
          isToday,
          isTomorrow,
        });
      }

      // Generate hourly chart data (336 hours)
      const hours = [];
      const now = Math.floor(Date.now() / 1000);
      const currentHourSec = Math.floor(now / 3600) * 3600;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStartSec = Math.floor(todayStart.getTime() / 1000);

      for (let i = 0; i < rewards.length; i++) {
        const hourStartSec = rangeStart + i * 3600;
        const hourTotal = Number(ethers.formatUnits(rewards[i], tokenInfo?.decimals || 18));

        const hourDate = new Date(hourStartSec * 1000);
        const dateStr = hourDate.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
        const hourStr = hourDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

        const isPast = hourStartSec < currentHourSec;
        const isCurrent = hourStartSec === currentHourSec;

        let actual = 0;
        let forecast = 0;

        if (isPast) {
          actual = hourTotal;
        } else if (isCurrent) {
          const elapsedMins = new Date().getMinutes();
          const ratio = elapsedMins / 60;
          actual = hourTotal * ratio;
          forecast = hourTotal * (1 - ratio);
        } else {
          forecast = hourTotal;
        }

        hours.push({
          label: `${dateStr} ${hourStr}`,
          actual: Math.round(actual * 100) / 100,
          forecast: Math.round(forecast * 100) / 100,
          total: Math.round(hourTotal * 100) / 100,
        });
      }

      // Average reward per day (past 7 days including today, exclude zero days)
      const pastDays = days.slice(0, 7);
      const activeDays = pastDays.filter(d => d.total > 0);
      const avg = activeDays.length > 0
        ? activeDays.reduce((sum, d) => sum + d.total, 0) / activeDays.length
        : 0;

      // Get total injected
      let injected = null;
      try {
        injected = await hourlyCalc.totalInjected(communityAddress);
      } catch { /* might not be available */ }

      if (!cancelled) {
        setDailyChartData(days);
        setHourlyChartData(hours);
        setAvgRewardPerDay(avg);
        setTotalInjected(injected);
      }
    } catch (err) {
      console.error('Failed to load hourly rewards:', err);
      if (!cancelled) setError('Failed to load hourly reward data');
    }
  };

  // ── Helpers ──
  function getTodayElapsedRatio() {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    return Math.min(1, Math.max(0, (now.getTime() - dayStart.getTime()) / (24 * 3600 * 1000)));
  }

  function isCurrentPeriod(startCursor, stopCursor) {
    const now = calculatorType === 'LINEAR_BLOCK'
      ? BigInt(Math.floor(Date.now() / 1000 / BLOCK_TIME_SECONDS)) // rough estimate
      : BigInt(Math.floor(Date.now() / 1000));
    return startCursor <= now && stopCursor >= now;
  }

  function isPastPeriod(stopCursor) {
    const now = calculatorType === 'LINEAR_BLOCK'
      ? BigInt(Math.floor(Date.now() / 1000 / BLOCK_TIME_SECONDS))
      : BigInt(Math.floor(Date.now() / 1000));
    return stopCursor < now;
  }

  function formatCursorToDate(cursor) {
    if (calculatorType === 'LINEAR_BLOCK') {
      // Estimate: current block ~= Date.now()/1000/3, so cursor * 3 * 1000 = ms
      const estimatedMs = Number(cursor) * BLOCK_TIME_SECONDS * 1000;
      const d = new Date(estimatedMs);
      // This is a rough estimate, show with a hint
      return d.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) + ` (${t('detail.distEst')})`;
    }
    // Time-based: cursor is unix timestamp
    return new Date(Number(cursor) * 1000).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getRewardPerDay(amount) {
    if (calculatorType === 'LINEAR_BLOCK') {
      // amount is per block, ~28800 blocks/day (86400/3)
      const blocksPerDay = 86400 / BLOCK_TIME_SECONDS;
      return Number(ethers.formatUnits(amount, tokenInfo?.decimals || 18)) * blocksPerDay;
    }
    // Time-based: amount is per second
    return Number(ethers.formatUnits(amount, tokenInfo?.decimals || 18)) * 86400;
  }

  // ── Scroll to current era ──
  useEffect(() => {
    if (currentPhaseRef.current) {
      currentPhaseRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [eras]);

  // ── Custom Tooltip for recharts ──
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const actual = payload.find(p => p.dataKey === 'actual');
    const forecast = payload.find(p => p.dataKey === 'forecast');
    return (
      <div className="dist-chart-tooltip">
        <div className="dist-chart-tooltip-label">{label}</div>
        {actual && actual.value > 0 && (
          <div className="dist-chart-tooltip-row" style={{ color: COLOR_ACTUAL }}>
            {t('detail.distDistributed')}: {actual.value.toLocaleString()} {tokenInfo?.symbol || ''}
          </div>
        )}
        {forecast && forecast.value > 0 && (
          <div className="dist-chart-tooltip-row" style={{ color: COLOR_FORECAST }}>
            {t('detail.distForecast')}: {forecast.value.toLocaleString()} {tokenInfo?.symbol || ''}
          </div>
        )}
      </div>
    );
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="distribution-section glass-card">
        <div className="distribution-header">
          <h3 className="distribution-title">{t('detail.distScheduleTitle')}</h3>
        </div>
        <div className="distribution-loading">
          <div className="spinner" />
          <span>{t('detail.distLoading')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="distribution-section glass-card">
        <div className="distribution-header">
          <h3 className="distribution-title">{t('detail.distScheduleTitle')}</h3>
        </div>
        <div className="distribution-empty">{error}</div>
      </div>
    );
  }

  return (
    <div className="distribution-section glass-card">
      {/* Header with calculator type badge */}
      <div className="distribution-header" style={{ position: 'relative' }}>
        <h3 className="distribution-title" style={{ display: 'flex', alignItems: 'center' }}>
          {t('detail.distScheduleTitle')}
          {calculatorType === 'HOURLY_TICK' && (
            <span
              className="distribution-info-trigger"
              onClick={() => setShowInfoPopover(!showInfoPopover)}
              title={language === 'zh' ? '点击查看详情' : 'Click to view details'}
              style={{
                cursor: 'pointer',
                marginLeft: 'var(--space-2)',
                fontSize: 'var(--font-size-md)',
                userSelect: 'none',
                opacity: 0.8,
                transition: 'opacity 0.2s',
              }}
            >
              ⓘ
            </span>
          )}
        </h3>

        {/* Info popover absolutely positioned relative to header */}
        {showInfoPopover && calculatorType === 'HOURLY_TICK' && (
          <div className="distribution-info-popover glass-card">
            <button className="popover-close-btn" onClick={() => setShowInfoPopover(false)}>×</button>
            <div className="popover-title">{t('detail.distDailyRewardTitle')}</div>
            <div className="popover-content">
              {t('detail.distDailyRewardDesc')}
            </div>
          </div>
        )}

        {calculatorType !== 'HOURLY_TICK' && (
          <div className="distribution-calculator-badge">
            <span className="calculator-icon">{CALCULATOR_ICONS[calculatorType] || '❓'}</span>
            <span className="calculator-label">
              {calculatorType === 'LINEAR_BLOCK' && t('detail.distLinearBlock')}
              {calculatorType === 'LINEAR_TIME' && t('detail.distLinearTime')}
              {calculatorType === 'UNKNOWN' && t('detail.distUnknownCalc')}
            </span>
          </div>
        )}
      </div>

      {/* LINEAR_BLOCK or LINEAR_TIME: Timeline display */}
      {(calculatorType === 'LINEAR_BLOCK' || calculatorType === 'LINEAR_TIME') && (
        <LinearEraTimeline
          eras={eras}
          calculatorType={calculatorType}
          tokenInfo={tokenInfo}
          isCurrentPeriod={isCurrentPeriod}
          isPastPeriod={isPastPeriod}
          formatCursorToDate={formatCursorToDate}
          getRewardPerDay={getRewardPerDay}
          currentPhaseRef={currentPhaseRef}
        />
      )}

      {/* HOURLY_TICK: Daily/Hourly bar chart */}
      {calculatorType === 'HOURLY_TICK' && (
        <HourlyTickChart
          chartData={dailyChartData}
          hourlyData={hourlyChartData}
          chartViewMode={chartViewMode}
          setChartViewMode={setChartViewMode}
          avgRewardPerDay={avgRewardPerDay}
          totalInjected={totalInjected}
          tokenInfo={tokenInfo}
          CustomTooltip={CustomTooltip}
        />
      )}

      {/* Unknown calculator */}
      {calculatorType === 'UNKNOWN' && (
        <div className="distribution-empty">
          <p>{language === 'zh' ? '未知的计算策略合约，地址为：' : 'Unknown calculator at address:'}</p>
          <code className="address">{calculatorAddress}</code>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════

function LinearEraTimeline({ eras, calculatorType, tokenInfo, isCurrentPeriod, isPastPeriod, formatCursorToDate, getRewardPerDay, currentPhaseRef }) {
  const { t, language } = useLanguage();
  if (!eras || eras.length === 0) {
    return <div className="distribution-empty">{t('detail.distNoEras')}</div>;
  }

  // Reverse to show newest first? Actually show in chronological order.
  const sortedEras = [...eras].sort((a, b) => Number(a.startCursor - b.startCursor));

  return (
    <div className="timeline-container">
      <div className="timeline-line" />
      {sortedEras.map((era, index) => {
        const isCurrent = isCurrentPeriod(era.startCursor, era.stopCursor);
        const isPast = isPastPeriod(era.stopCursor);
        const rewardPerDay = getRewardPerDay(era.amount);

        return (
          <div
            key={index}
            ref={isCurrent ? currentPhaseRef : null}
            className={`timeline-item ${isCurrent ? 'timeline-item--current' : ''} ${isPast ? 'timeline-item--past' : ''}`}
          >
            {/* Timeline dot */}
            <div className={`timeline-dot ${isCurrent ? 'timeline-dot--current' : isPast ? 'timeline-dot--past' : ''}`}>
              {isCurrent && <div className="timeline-dot-pulse" />}
            </div>

            {/* Era card */}
            <div className={`timeline-card ${isCurrent ? 'timeline-card--current' : ''}`}>
              {/* Status badge */}
              {isCurrent && (
                <div className="timeline-badge timeline-badge--current">
                  <span className="timeline-badge-dot" />
                  {t('detail.distOngoing')}
                </div>
              )}
              {isPast && (
                <div className="timeline-badge timeline-badge--past">{t('detail.distCompleted')}</div>
              )}
              {!isCurrent && !isPast && (
                <div className="timeline-badge timeline-badge--future">{t('detail.distUpcoming')}</div>
              )}

              {/* Reward amount */}
              <div className="timeline-reward">
                <div className="timeline-reward-label">{t('detail.distRewardPerDay')}</div>
                <div className={`timeline-reward-value ${isCurrent ? 'timeline-reward-value--current' : ''}`}>
                  {rewardPerDay.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  <span className="timeline-reward-symbol">{tokenInfo?.symbol || t('detail.historyTokens')}</span>
                </div>
                <div className="timeline-rate-hint">
                  {formatTokenAmount(era.amount, tokenInfo?.decimals || 18, 6)}
                  {calculatorType === 'LINEAR_BLOCK' ? (language === 'zh' ? '/区块' : '/block') : (language === 'zh' ? '/秒' : '/sec')}
                </div>
              </div>

              {/* Date range */}
              <div className="timeline-dates">
                <div className="timeline-date-item">
                  <svg className="timeline-date-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <div className="timeline-date-col">
                    <span className="timeline-date-label">{t('detail.distStart')}</span>
                    <span className="timeline-date-value">{formatCursorToDate(era.startCursor)}</span>
                  </div>
                </div>
                <div className="timeline-date-arrow">
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                <div className="timeline-date-item">
                  <svg className="timeline-date-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <div className="timeline-date-col">
                    <span className="timeline-date-label">{t('detail.distEnd')}</span>
                    <span className="timeline-date-value">{formatCursorToDate(era.stopCursor)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HourlyTickChart({ chartData, hourlyData, chartViewMode, setChartViewMode, avgRewardPerDay, totalInjected, tokenInfo, CustomTooltip }) {
  const { t, language } = useLanguage();
  if (!chartData || chartData.length === 0) {
    return <div className="distribution-empty">{t('detail.distNoInjectionData')}</div>;
  }

  const decimals = tokenInfo?.decimals || 18;
  const symbol = tokenInfo?.symbol || t('detail.historyTokens');

  const activeData = chartViewMode === 'daily' ? chartData : hourlyData;

  return (
    <div className="hourly-tick-section">
      {/* Header and view controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div className="hourly-info-title" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'rgba(220, 220, 240, 0.8)' }}>
          {chartViewMode === 'daily' ? t('detail.distDailyRewardVolume') : t('detail.distHourlyRewardVolume')}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', background: 'rgba(255,255,255,0.03)', padding: 3, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={() => setChartViewMode('daily')}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: chartViewMode === 'daily' ? '#7c3aed' : 'transparent',
              color: chartViewMode === 'daily' ? 'white' : 'rgba(200, 200, 240, 0.7)',
              boxShadow: chartViewMode === 'daily' ? '0 2px 8px rgba(124, 58, 237, 0.4)' : 'none',
              transition: 'all 0.2s'
            }}
          >
            {t('detail.distDaily')}
          </button>
          <button
            onClick={() => setChartViewMode('hourly')}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: chartViewMode === 'hourly' ? '#7c3aed' : 'transparent',
              color: chartViewMode === 'hourly' ? 'white' : 'rgba(200, 200, 240, 0.7)',
              boxShadow: chartViewMode === 'hourly' ? '0 2px 8px rgba(124, 58, 237, 0.4)' : 'none',
              transition: 'all 0.2s'
            }}
          >
            {t('detail.distHourly')}
          </button>
        </div>
      </div>

      {/* Bar chart */}
      <div className="hourly-chart-wrapper">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={activeData} barCategoryGap={chartViewMode === 'daily' ? '20%' : '10%'}>
            <XAxis
              dataKey="label"
              tickFormatter={(v, index) => {
                if (chartViewMode === 'daily') return v;
                // For hourly view, only show the date label at the start of each day (index % 24 === 0)
                return index % 24 === 0 ? v.split(' ')[0] : '';
              }}
              tick={{ fontSize: 11, fill: 'rgba(200, 200, 240, 0.7)' }}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'rgba(200, 200, 240, 0.7)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(1)}K` : v.toFixed(0)}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(124, 58, 237, 0.08)' }} />
            <Legend
              iconType="square"
              iconSize={10}
              wrapperStyle={{ fontSize: 11, color: 'rgba(200, 200, 240, 0.7)', paddingBottom: 'var(--space-2)' }}
            />
            <Bar dataKey="actual" name={t('detail.distDistributed')} stackId="a" fill={COLOR_ACTUAL} radius={[0, 0, 0, 0]} />
            <Bar dataKey="forecast" name={t('detail.distForecast')} stackId="a" fill={COLOR_FORECAST} radius={[4, 4, 0, 0]} />
            
            {/* Beautiful scroll Brush for the 336 hours in Hourly View */}
            {chartViewMode === 'hourly' && (
              <Brush
                dataKey="label"
                height={16}
                stroke="rgba(124, 58, 237, 0.25)"
                fill="rgba(20, 20, 30, 0.9)"
                startIndex={activeData.length >= 192 ? 144 : Math.max(0, activeData.length - 48)}
                endIndex={activeData.length >= 192 ? 191 : activeData.length - 1}
                tickFormatter={(v) => v.split(' ')[0]}
                travellerWidth={8}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Stats row */}
      <div className="hourly-stats">
        <div className="hourly-stat-item">
          <span className="hourly-stat-label">{t('detail.distAvgRewardPerDay')}</span>
          <span className="hourly-stat-value hourly-stat-value--accent">
            {avgRewardPerDay.toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbol}
          </span>
        </div>
        {totalInjected && (
          <div className="hourly-stat-item">
            <span className="hourly-stat-label">{t('detail.distTotalInjected')}</span>
            <span className="hourly-stat-value">
              {formatTokenAmount(totalInjected, decimals, 2)} {symbol}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
