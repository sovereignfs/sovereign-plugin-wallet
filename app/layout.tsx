import type { ReactNode } from 'react';
import { registerPortabilityHandlers } from './_lib/portability';
import { WalletE2eeProvider } from './_lib/useE2eeUnlock';

export default async function WalletLayout({ children }: { children: ReactNode }) {
  // In-process and reset on restart — the platform SDK requires
  // re-registering from a request-scoped plugin route, so this runs on
  // every request to any Wallet page. A registration failure must not
  // block Wallet's own UI.
  try {
    await registerPortabilityHandlers();
  } catch {
    // best-effort platform integration
  }

  // One unlock check per page, shared by every consumer below (list tiles,
  // upload gate, detail views) instead of one per component.
  return <WalletE2eeProvider>{children}</WalletE2eeProvider>;
}
