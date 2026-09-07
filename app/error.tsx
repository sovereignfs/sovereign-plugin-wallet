'use client';

import { useEffect } from 'react';
import { Button, PageContainer, PageHeader } from '@sovereignfs/ui';
import styles from './error.module.css';

/**
 * Plugin-scoped error boundary. Without one, an unexpected failure anywhere
 * under `/wallet` drops the user on the bare platform 500 with no context and
 * no way back — the convention every plugin follows (`plugins/console`,
 * `plugins/warden`, `example-plugins/example-encrypted`).
 *
 * The copy leads with the reassurance that matters most here: nothing in an
 * encrypted card or document can be lost by a render failure, because the
 * ciphertext and the keys are untouched by it.
 */
export default function WalletError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('[wallet] unhandled error', error);
  }, [error]);

  return (
    <PageContainer maxWidth="sm">
      <PageHeader title="Something went wrong" />
      <div className={styles.boundary}>
        <p className={styles.message}>
          Wallet couldn&rsquo;t show this page. Your cards and documents are unchanged — nothing
          was deleted, and encrypted items are still encrypted.
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </PageContainer>
  );
}
