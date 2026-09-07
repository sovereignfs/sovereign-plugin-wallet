'use client';

import Link from 'next/link';
import { Icon } from '@sovereignfs/ui';
import type { E2eeState } from '@sovereignfs/sdk';
import { useE2eeUnlock } from '../_lib/useE2eeUnlock';
import { NewDocumentDialog } from './NewDocumentDialog';
import styles from './DocumentUploadGate.module.css';

/**
 * Header action: the real upload button once this device is unlocked, nothing
 * otherwise. The blocked-state explanation is a separate component
 * (`EncryptionRequiredNotice`) rendered below the page header rather than
 * here — `PageHeader`'s action slot is sized for a single button, and a
 * multi-line notice there squeezes the title/description column (see
 * `EncryptionRequiredNotice`'s own comment).
 */
export function DocumentUploadGate() {
  const unlock = useE2eeUnlock();

  if (unlock.state !== 'unlocked' || !unlock.cmk) return null;
  return <NewDocumentDialog cmk={unlock.cmk} />;
}

function blockedMessage(state: Exclude<E2eeState, 'unlocked'>): string {
  switch (state) {
    case 'unsupported':
      return "Uploading documents needs a modern browser (WebCrypto + IndexedDB support) and isn't available here.";
    case 'locked':
      return 'Client-side encryption is set up on your account, but this device hasn’t been unlocked yet.';
    case 'not-set-up':
      return 'Sensitive documents require client-side encryption. Set it up before uploading — Sovereign and the operator can never read an encrypted document, even with full server access.';
  }
}

/**
 * Explains why document upload is blocked (SPEC: "Sensitive-document upload
 * is blocked until client-side encryption setup is complete" — unlike
 * loyalty cards, there is no plaintext fallback for documents at all).
 * Rendered as its own full-width block below the page header — see
 * `DocumentUploadGate`'s comment for why it isn't in the header action slot.
 */
export function EncryptionRequiredNotice() {
  const unlock = useE2eeUnlock();

  if (unlock.state === 'checking' || unlock.state === 'unlocked') return null;

  return (
    <div className={styles.blocked}>
      <span className={styles.icon}>
        <Icon name="lock" aria-hidden />
      </span>
      <div className={styles.text}>
        <p className={styles.message}>{blockedMessage(unlock.state)}</p>
        <Link href="/account/security" className={styles.link}>
          Go to Account → Security
        </Link>
      </div>
    </div>
  );
}
