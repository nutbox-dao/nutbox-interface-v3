import { useMemo, useRef, useState } from 'react';

export default function LiquidityRangeChart({
  currentPrice, minPrice, maxPrice, fullRange, onRangeChange, disabled = false,
  selectedLabel = 'Selected range', currentLabel = 'Current price',
  lowLabel = 'Lower price', highLabel = 'Higher price',
}) {
  const chartRef = useRef(null);
  const dragRef = useRef(null);
  const [dragMode, setDragMode] = useState('');
  const chart = useMemo(() => {
    const visibleMin = currentPrice / 4;
    const visibleMax = currentPrice * 4;
    const candidates = [currentPrice, visibleMin, visibleMax].filter(value => Number.isFinite(value) && value > 0);
    const low = Math.min(...candidates);
    const high = Math.max(...candidates);
    const domainLow = Math.log(low);
    const domainHigh = Math.log(high);
    const positionOf = (value) => {
      if (!Number.isFinite(value) || value <= 0 || domainHigh <= domainLow) return 50;
      return Math.min(100, Math.max(0, (Math.log(value) - domainLow) / (domainHigh - domainLow) * 100));
    };
    const selectedLeft = fullRange ? 0 : positionOf(minPrice);
    const selectedRight = fullRange ? 100 : positionOf(maxPrice);
    return {
      domainLow,
      domainHigh,
      current: positionOf(currentPrice),
      selected: { left: selectedLeft, width: Math.max(1, selectedRight - selectedLeft) },
    };
  }, [currentPrice, fullRange, maxPrice, minPrice]);

  const priceFromClientX = (clientX) => {
    const bounds = chartRef.current?.getBoundingClientRect();
    if (!bounds?.width) return currentPrice;
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    return Math.exp(chart.domainLow + ratio * (chart.domainHigh - chart.domainLow));
  };

  const startDrag = (mode, event) => {
    if (disabled || !onRangeChange) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startPrice: priceFromClientX(event.clientX),
      minPrice,
      maxPrice,
    };
    setDragMode(mode);
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || disabled || !onRangeChange) return;
    const pointerPrice = priceFromClientX(event.clientX);
    const domainMin = Math.exp(chart.domainLow);
    const domainMax = Math.exp(chart.domainHigh);
    const minimumGap = 1.0001;
    if (drag.mode === 'min') {
      onRangeChange({ minPrice: Math.min(pointerPrice, maxPrice / minimumGap), maxPrice });
      return;
    }
    if (drag.mode === 'max') {
      onRangeChange({ minPrice, maxPrice: Math.max(pointerPrice, minPrice * minimumGap) });
      return;
    }
    const ratio = pointerPrice / drag.startPrice;
    let nextMin = drag.minPrice * ratio;
    let nextMax = drag.maxPrice * ratio;
    if (nextMin < domainMin) {
      nextMax *= domainMin / nextMin;
      nextMin = domainMin;
    }
    if (nextMax > domainMax) {
      nextMin *= domainMax / nextMax;
      nextMax = domainMax;
    }
    onRangeChange({ minPrice: nextMin, maxPrice: nextMax });
  };

  const endDrag = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragMode('');
  };

  return (
    <div
      ref={chartRef}
      className={`liquidity-range-chart${dragMode ? ` dragging-${dragMode}` : ''}`}
      aria-label="Liquidity price range chart"
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="liquidity-range-selection"
        style={{ left: `${chart.selected.left}%`, width: `${chart.selected.width}%` }}
        onPointerDown={event => startDrag('range', event)}
      >
        <button
          type="button"
          className="liquidity-range-drag-zone"
          aria-label="Move price range"
          disabled={disabled}
          onPointerDown={event => { event.stopPropagation(); startDrag('range', event); }}
        />
        <span className="liquidity-range-selection-label">{selectedLabel}</span>
        <button
          type="button"
          className="liquidity-range-handle min"
          aria-label="Minimum price"
          disabled={disabled}
          onPointerDown={event => { event.stopPropagation(); startDrag('min', event); }}
        />
        <button
          type="button"
          className="liquidity-range-handle max"
          aria-label="Maximum price"
          disabled={disabled}
          onPointerDown={event => { event.stopPropagation(); startDrag('max', event); }}
        />
      </div>
      <div className="liquidity-range-axis" aria-hidden="true">
        {[0, 25, 50, 75, 100].map(position => <i key={position} style={{ left: `${position}%` }} />)}
      </div>
      <div className="liquidity-range-current" style={{ left: `${chart.current}%` }}><i /><span>{currentLabel}</span></div>
      <small className="left">{fullRange ? 'MIN' : lowLabel}</small>
      <small className="right">{fullRange ? 'MAX' : highLabel}</small>
    </div>
  );
}
