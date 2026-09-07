'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Icon, Input } from '@sovereignfs/ui';
import { unwrapDekWithCmk } from '@sovereignfs/sdk/e2ee-crypto';
import { decryptJson } from '@sovereignfs/sdk/e2ee-object';
import type { DocumentListItem } from '../_lib/documentActions';
import { documentTypeLabel, normalizeDocumentMetadata } from '../_lib/documentMetadata';
import type { DocumentMetadata } from '../_lib/documentMetadata';
import { useE2eeUnlock } from '../_lib/useE2eeUnlock';
import styles from '../documents/page.module.css';

interface ResolvedDocument {
  doc: DocumentListItem;
  title: string;
  subtitle: string;
  locked: boolean;
}

function addedOn(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function DocumentsListView({ documents }: { documents: DocumentListItem[] }) {
  const { state, cmk } = useE2eeUnlock();
  const [decrypted, setDecrypted] = useState<Record<string, DocumentMetadata>>({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (state !== 'unlocked' || !cmk) return;
    let cancelled = false;
    void (async () => {
      const entries: Array<[string, DocumentMetadata]> = [];
      for (const doc of documents) {
        try {
          const dek = await unwrapDekWithCmk(doc.cipher.wrappedDek, cmk);
          const meta = await decryptJson<Partial<DocumentMetadata>>(dek, doc.cipher.encryptedMetadata);
          entries.push([doc.id, normalizeDocumentMetadata(meta)]);
        } catch {
          // One unreadable document must not hide the rest.
        }
      }
      if (!cancelled && entries.length > 0) setDecrypted(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [documents, state, cmk]);

  const resolved = useMemo<ResolvedDocument[]>(
    () =>
      documents.map((doc) => {
        const meta = decrypted[doc.id];
        if (!meta) {
          return {
            doc,
            title: 'Encrypted document',
            subtitle: `Added ${addedOn(doc.createdAt)}`,
            locked: true,
          };
        }
        const type = meta.documentType ? documentTypeLabel(meta.documentType) : '';
        return {
          doc,
          title: meta.title || 'Untitled document',
          subtitle: [type, meta.issuer].filter(Boolean).join(' · ') || `Added ${addedOn(doc.createdAt)}`,
          locked: false,
        };
      }),
    [documents, decrypted],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return resolved;
    return resolved.filter(
      ({ title, subtitle, locked }) =>
        !locked &&
        (title.toLowerCase().includes(needle) || subtitle.toLowerCase().includes(needle)),
    );
  }, [resolved, query]);

  return (
    <>
      {documents.length > 4 && (
        <div className={styles.search}>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search documents"
            aria-label="Search documents"
          />
        </div>
      )}

      {visible.length === 0 ? (
        <p className={styles.noMatches} role="status" aria-live="polite">
          No documents match “{query}”. Documents that are still locked can&rsquo;t be searched.
        </p>
      ) : (
        <section className={styles.documentGrid} aria-label="Documents">
          {visible.map(({ doc, title, subtitle }) => (
            <Link key={doc.id} href={`/wallet/documents/${doc.id}`} className={styles.documentLink}>
              <Card interactive className={styles.documentTile}>
                <h2 className={styles.documentTitle}>
                  <Icon name="lock" size="sm" aria-hidden />
                  {title}
                </h2>
                <p className={styles.documentSubtitle}>{subtitle}</p>
              </Card>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
