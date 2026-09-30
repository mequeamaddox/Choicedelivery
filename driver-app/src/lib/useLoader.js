import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

// Loads data, reloads when the screen comes back into view, and optionally every pollMs while open.
export function useLoader(load, { pollMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true, refreshing: false });
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(async (refreshing = false) => {
    if (refreshing) setState((s) => ({ ...s, refreshing: true }));
    try {
      const data = await loadRef.current();
      setState({ data, error: null, loading: false, refreshing: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false, refreshing: false }));
    }
  }, []);
  useFocusEffect(useCallback(() => {
    run();
    if (!pollMs) return undefined;
    const id = setInterval(() => { if (AppState.currentState === 'active') run(); }, pollMs);
    return () => clearInterval(id);
  }, [run, pollMs]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') run(); });
    return () => sub.remove();
  }, [run]);
  return { ...state, reload: run, refresh: () => run(true), setData: (data) => setState((s) => ({ ...s, data })) };
}
