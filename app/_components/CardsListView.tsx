'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Icon, Input } from '@sovereignfs/ui';
import { unwrapDekWithCmk } from '@sovereignfs/sdk/e2ee-crypto';
import { decryptJson } from '@sovereignfs/sdk/e2ee-object';
import type { CardListItem } from '../_lib/actions';
import { barcodeFormatLabel } from '../_lib/barcodeFormats';
import { useE2eeUnlock } from '../_lib/useE2eeUnlock';
import styles from '../cards/page.module.css';

interface DecryptedCardMeta {
  title: string;
  issuer: string;
}

/** What a tile displays, once any decryption that was possible has happened. */
interface ResolvedCard {
  card: CardListItem;
  title: string;
  issuer: string;
  /** True while an encrypted card's title is still unreadable on this device. */
  locked: boolean;
}

/**
 * Decrypts title/issuer for every encrypted card in one pass, sharing the
 * single CMK from the provider. Only these two fields are decrypted here —
 * notes and payload stay sealed until the detail page.
 */
function useResolvedCards(cards: CardListItem[]): ResolvedCard[] {
  const { state, cmk } = useE2eeUnlock();
  const [decrypted, setDecrypted] = useState<Record<string, DecryptedCardMeta>>({});

  useEffect(() => {
    if (state !== 'unlocked' || !cmk) return;
    let cancelled = false;
    void (async () => {
      const entries: Array<[string, DecryptedCardMeta]> = [];
      for (const card of cards) {
        if (!card.encrypted || !card.cipher) continue;
        try {
          const dek = await unwrapDekWithCmk(card.cipher.wrappedDek, cmk);
          entries.push([card.id, await decryptJson<DecryptedCardMeta>(dek, card.cipher.encryptedMetadata)]);
        } catch {
          // Leave this one locked; one unreadable card must not hide the rest.
        }
      }
      if (!cancelled && entries.length > 0) setDecrypted(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [cards, state, cmk]);

  return useMemo(
    () =>
      cards.map((card) => {
        if (!card.encrypted) {
          return { card, title: card.title, issuer: card.issuer, locked: false };
        }
        const meta = decrypted[card.id];
        return meta
          ? { card, title: meta.title, issuer: meta.issuer, locked: false }
          : { card, title: '', issuer: '', locked: true };
      }),
    [cards, decrypted],
  );
}

/**
 * A locked card still needs to be tellable apart from the others. Its title
 * is genuinely unreadable, so the tile falls back to the two things the
 * server legitimately knows in plaintext — the barcode family and when the
 * card was added — instead of showing every locked card as the same
 * indistinguishable "Encrypted card" row.
 */
function lockedSubtitle(card: CardListItem): string {
  const added = new Date(card.createdAt * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const format = barcodeFormatLabel(card.barcodeFormat);
  return format === '—' ? `Added ${added}` : `${format} · added ${added}`;
}

export function CardsListView({ cards }: { cards: CardListItem[] }) {
  const resolved = useResolvedCards(cards);
  const [query, setQuery] = useState('');

  // Filtering runs on decrypted titles, so it only ever matches cards this
  // device can actually read — searching cannot leak anything the server
  // knows and the user doesn't.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return resolved;
    return resolved.filter(
      ({ title, issuer }) =>
        title.toLowerCase().includes(needle) || issuer.toLowerCase().includes(needle),
    );
  }, [resolved, query]);

  return (
    <>
      {cards.length > 4 && (
        <div className={styles.search}>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search cards"
            aria-label="Search cards"
          />
        </div>
      )}

      {visible.length === 0 ? (
        <p className={styles.noMatches} role="status" aria-live="polite">
          No cards match “{query}”. Cards that are still locked can&rsquo;t be searched.
        </p>
      ) : (
        <section className={styles.cardGrid} aria-label="Cards">
          {visible.map(({ card, title, issuer, locked }) => (
            <Link key={card.id} href={`/wallet/cards/${card.id}`} className={styles.cardLink}>
              <Card interactive className={styles.cardTile}>
                <h2 className={styles.cardTitle}>
                  {card.encrypted && <Icon name="lock" size="sm" aria-hidden />}
                  {locked ? 'Encrypted card' : title || 'Untitled card'}
                </h2>
                <p className={styles.cardIssuer}>
                  {locked ? lockedSubtitle(card) : issuer || barcodeFormatLabel(card.barcodeFormat)}
                </p>
              </Card>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
