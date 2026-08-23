import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';
import { DocumentUploadGate, EncryptionRequiredNotice } from '../_components/DocumentUploadGate';
import { DocumentsListView } from '../_components/DocumentsListView';
import { listDocuments } from '../_lib/documentActions';
import styles from './page.module.css';

export default async function DocumentsPage() {
  const documents = await listDocuments();

  return (
    <PageContainer maxWidth="md" className={styles.page}>
      <PageHeader
        title="Documents"
        description="Sensitive documents, always encrypted client-side."
        action={<DocumentUploadGate />}
      />
      <EncryptionRequiredNotice />

      {documents.length === 0 ? (
        <EmptyState
          icon="package"
          heading="No documents yet"
          description="Add your first sensitive document."
        />
      ) : (
        <DocumentsListView documents={documents} />
      )}
    </PageContainer>
  );
}
