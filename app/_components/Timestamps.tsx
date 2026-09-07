'use client';

import styles from './Timestamps.module.css';

function format(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * When an item was added and last changed. Both values were already being
 * fetched by every detail query and then rendered nowhere — which meant
 * "when did I add this card?" had no answer anywhere in the UI.
 *
 * Formatting is client-side so it follows the viewer's own locale and time
 * zone; rendering it on the server would bake in the server's.
 */
export function Timestamps({ createdAt, updatedAt }: { createdAt: number; updatedAt: number }) {
  const changed = updatedAt > createdAt;
  return (
    <p className={styles.root}>
      Added {format(createdAt)}
      {changed && <> · last changed {format(updatedAt)}</>}
    </p>
  );
}
