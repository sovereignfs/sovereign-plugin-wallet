import { PageContainer, Spinner } from '@sovereignfs/ui';
import styles from './loading.module.css';

/**
 * Every Wallet route blocks on I/O before it can render — the card and
 * document detail pages resolve `sdk.storage` signed URLs in the server
 * render path, and the list pages query the plugin store. Without a
 * `loading.tsx` those routes navigate to a blank frame first (the repo rule:
 * a route that blocks on network gets one).
 */
export default function WalletLoading() {
  return (
    <PageContainer maxWidth="md">
      <div className={styles.root} role="status" aria-live="polite">
        <Spinner />
        <span>Loading…</span>
      </div>
    </PageContainer>
  );
}
