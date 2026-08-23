import Link from 'next/link';
import { Card, EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';
import { getWalletItemCounts } from './_lib/counts';
import styles from './page.module.css';

export default async function WalletPage() {
  const counts = await getWalletItemCounts();
  const isEmpty = counts.cards === 0 && counts.documents === 0;

  return (
    <PageContainer maxWidth="md" className={styles.page}>
      <PageHeader title="Wallet" description="Your loyalty cards and sensitive documents." />

      {isEmpty && (
        <EmptyState
          icon="package"
          heading="Your wallet is empty"
          description="Cards and documents you add will show up here."
        />
      )}

      <section className={styles.categoryGrid} aria-label="Wallet categories">
        <Link href="/wallet/cards" className={styles.categoryLink}>
          <Card interactive className={styles.categoryCard}>
            <h2 className={styles.categoryTitle}>Cards</h2>
            <p className={styles.categoryCount}>
              {counts.cards} {counts.cards === 1 ? 'card' : 'cards'}
            </p>
            <p className={styles.categoryDescription}>Loyalty and membership cards.</p>
          </Card>
        </Link>
        <Link href="/wallet/documents" className={styles.categoryLink}>
          <Card interactive className={styles.categoryCard}>
            <h2 className={styles.categoryTitle}>Documents</h2>
            <p className={styles.categoryCount}>
              {counts.documents} {counts.documents === 1 ? 'document' : 'documents'}
            </p>
            <p className={styles.categoryDescription}>Encrypted sensitive-document snapshots.</p>
          </Card>
        </Link>
      </section>
    </PageContainer>
  );
}
