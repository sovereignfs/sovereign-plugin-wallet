import type { ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@sovereignfs/ui';
import styles from './BackLink.module.css';

/** Same pattern as Plainwrite's BackLink — a card/document detail page has no
 * other way back to its list besides the browser's own back button. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={styles.backLink}>
      <Icon name="chevron-left" size="sm" aria-hidden />
      {children}
    </Link>
  );
}
