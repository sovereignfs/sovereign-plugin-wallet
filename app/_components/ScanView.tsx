'use client';

import { useEffect } from 'react';
import { Button, Dialog } from '@sovereignfs/ui';
import { CodeDisplay } from './CodeDisplay';
import { CopyButton } from './CopyButton';
import styles from './ScanView.module.css';

/**
 * The "hold it up to the scanner" view: the barcode as large as the screen
 * allows, on a plain light surface, with the payload spelled out underneath
 * for the times the scanner gives up and a person has to type it.
 *
 * Screen brightness is the other half of making a screen scannable, but
 * there is no web API for it — raising it needs `sdk.device.*`, which
 * doesn't exist yet (roadmap W-54/W-55). The white backdrop is the part
 * that can be done today: it maximizes contrast for the reader regardless
 * of the viewer's theme, so this surface deliberately does not follow dark
 * mode.
 */
export function ScanView({
  open,
  onClose,
  title,
  format,
  payload,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  format: string | null;
  payload: string;
}) {
  // Nothing here should sleep the screen mid-scan. The Wake Lock API is
  // best-effort and unsupported on some browsers, so failure is ignored.
  useEffect(() => {
    if (!open) return;
    let released = false;
    let sentinel: { release: () => Promise<void> } | null = null;
    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      }
    ).wakeLock;
    void wakeLock?.request('screen').then(
      (lock) => {
        if (released) void lock.release();
        else sentinel = lock;
      },
      () => undefined,
    );
    return () => {
      released = true;
      void sentinel?.release().catch(() => undefined);
    };
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} size="md" title={title}>
      <div className={styles.stage}>
        <CodeDisplay format={format} payload={payload} large />
        <p className={styles.payload}>{payload}</p>
      </div>
      <div className={styles.actions}>
        <CopyButton value={payload} label="Copy number" />
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
