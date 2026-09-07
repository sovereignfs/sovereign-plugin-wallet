'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { E2eeState } from '@sovereignfs/sdk';
import { unwrapCmkWithDeviceKey } from '@sovereignfs/sdk/e2ee-crypto';
import { getE2eeLocalState } from '@sovereignfs/sdk/e2ee-state';
import { getE2eeStatus } from './e2ee';

export interface E2eeUnlock {
  /** `'checking'` is a local UI-only state before the status fetch + unlock check resolves. */
  state: 'checking' | E2eeState;
  /** The unwrapped Client Master Key for this device, present only when `state === 'unlocked'`. */
  cmk: CryptoKey | null;
  /** Re-runs the status fetch and unlock check — see `WalletE2eeProvider`. */
  refresh: () => void;
}

const E2eeUnlockContext = createContext<E2eeUnlock | null>(null);

/**
 * Resolves this device's client-side encryption unlock state (RFC 0060) once
 * per Wallet page and shares it with every consumer.
 *
 * Previously each consumer called this logic independently — on
 * `/wallet/documents` that meant three `getE2eeStatus()` server actions,
 * three IndexedDB reads and three CMK unwraps for one page load (the upload
 * gate, the blocked-state notice, and the list). Hoisting it into a provider
 * makes it one of each.
 *
 * The status is also re-checked when the tab regains focus, so unlocking in
 * Account → Security and coming back doesn't leave Wallet showing a stale
 * locked state until a full reload.
 */
export function WalletE2eeProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<Omit<E2eeUnlock, 'refresh'>>({
    state: 'checking',
    cmk: null,
  });
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { profile, devices } = await getE2eeStatus();
        const local = await getE2eeLocalState(profile, devices);
        if (cancelled) return;
        if (local.state !== 'unlocked' || !local.deviceKey || !local.activeEnrollment) {
          setResult({ state: local.state, cmk: null });
          return;
        }
        const cmk = await unwrapCmkWithDeviceKey(
          {
            wrappedCmk: local.activeEnrollment.wrappedCmk,
            algorithmVersion: local.activeEnrollment.algorithmVersion,
          },
          local.deviceKey,
        );
        if (!cancelled) setResult({ state: 'unlocked', cmk });
      } catch {
        // A failed status fetch or a device key that no longer unwraps the
        // CMK are both "this device can't read encrypted items right now".
        if (!cancelled) setResult({ state: 'locked', cmk: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    function onFocus() {
      refresh();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const value = useMemo<E2eeUnlock>(() => ({ ...result, refresh }), [result, refresh]);

  return <E2eeUnlockContext.Provider value={value}>{children}</E2eeUnlockContext.Provider>;
}

/**
 * This device's unlock state. Must be called under `WalletE2eeProvider`
 * (mounted in Wallet's `app/layout.tsx`), so every consumer on a page shares
 * one status fetch and one unwrapped CMK.
 */
export function useE2eeUnlock(): E2eeUnlock {
  const value = useContext(E2eeUnlockContext);
  if (!value) {
    throw new Error('useE2eeUnlock must be used within WalletE2eeProvider.');
  }
  return value;
}
