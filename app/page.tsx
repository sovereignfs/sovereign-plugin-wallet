import Link from 'next/link';
import { Card, EmptyState, Icon, PageContainer, PageHeader } from '@sovereignfs/ui';
import { getWalletItemCounts } from './_lib/counts';
import styles from './page.module.css';

const CATEGORIES = [
  {
    href: '/wallet/cards',
    title: 'Cards',
    icon: 'credit-card',
    description: 'Loyalty and membership cards.',
    unit: ['card', 'cards'],
  },
  {
    href: '/wallet/documents',
    title: 'Documents',
    icon: 'file-text',
    description: 'Encrypted sensitive-document snapshots.',
    unit: ['document', 'documents'],
  },
] as const;

export default async function WalletPage() {
  const counts = await getWalletItemCounts();
  const isEmpty = counts.cards === 0 && counts.documents === 0;
  const values = { Cards: counts.cards, Documents: counts.documents };

  // Empty *or* populated, never both. Showing "Your wallet is empty" stacked
  // on top of two tiles reading "0 cards" and "0 documents" said the same
  // thing three times and gave the first-run user no single obvious step.
  if (isEmpty) {
    return (
      <PageContainer maxWidth="md" className={styles.page}>
        <PageHeader title="Wallet" description="Your loyalty cards and sensitive documents." />
        <EmptyState
          icon="credit-card"
          heading="Your wallet is empty"
          description="Add a loyalty card to keep its barcode handy, or a document to store an encrypted copy."
          action={
            <Link href="/wallet/cards" className={styles.emptyAction}>
              Add your first card
            </Link>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="md" className={styles.page}>
      <PageHeader title="Wallet" description="Your loyalty cards and sensitive documents." />
      <section className={styles.categoryGrid} aria-label="Wallet categories">
        {CATEGORIES.map((category) => {
          const count = values[category.title];
          return (
            <Link key={category.href} href={category.href} className={styles.categoryLink}>
              <Card interactive className={styles.categoryCard}>
                <h2 className={styles.categoryTitle}>
                  <Icon name={category.icon} size="sm" aria-hidden />
                  {category.title}
                </h2>
                <p className={styles.categoryCount}>
                  {count} {count === 1 ? category.unit[0] : category.unit[1]}
                </p>
                <p className={styles.categoryDescription}>{category.description}</p>
              </Card>
            </Link>
          );
        })}
      </section>
    </PageContainer>
  );
}
