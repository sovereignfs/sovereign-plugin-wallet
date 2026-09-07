import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';
import { CardsListView } from '../_components/CardsListView';
import { NewCardDialog } from '../_components/NewCardDialog';
import { listCards } from '../_lib/actions';
import styles from './page.module.css';

export default async function CardsPage() {
  const cards = await listCards();

  return (
    <PageContainer maxWidth="md" className={styles.page}>
      <PageHeader
        title="Cards"
        description="Loyalty and membership cards."
        action={<NewCardDialog />}
      />

      {cards.length === 0 ? (
        <EmptyState
          icon="credit-card"
          heading="No cards yet"
          description="Add a loyalty or membership card to keep its barcode one tap away at the till."
        />
      ) : (
        <CardsListView cards={cards} />
      )}
    </PageContainer>
  );
}
