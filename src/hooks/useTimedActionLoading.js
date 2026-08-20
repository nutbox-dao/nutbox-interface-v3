import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_TIMEOUT_MS = 60_000;

function clearButtonState(button) {
  if (!button) return;
  button.classList.remove('transaction-loading');
  button.removeAttribute('aria-busy');
}
export default function useTimedActionLoading(initialValue, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const [value, setValue] = useState(initialValue);
  const timerRef = useRef(null);
  const buttonRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearVisualState = useCallback(() => {
    clearTimer();
    clearButtonState(buttonRef.current);
    buttonRef.current = null;
  }, [clearTimer]);

  const setTimedValue = useCallback((nextValue) => {
    setValue(nextValue);
    clearVisualState();

    if (!nextValue) return;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLButtonElement) {
      buttonRef.current = activeElement;
      activeElement.classList.add('transaction-loading');
      activeElement.setAttribute('aria-busy', 'true');
    }

    timerRef.current = window.setTimeout(() => {
      setValue(initialValue);
      clearButtonState(buttonRef.current);
      buttonRef.current = null;
      timerRef.current = null;
    }, timeoutMs);
  }, [clearVisualState, initialValue, timeoutMs]);

  useEffect(() => clearVisualState, [clearVisualState]);

  return [value, setTimedValue];
}
