'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, ConfirmDialog, Icon, PageHeader, Spinner } from '@sovereignfs/ui';
import { unwrapDekWithCmk } from '@sovereignfs/sdk/e2ee-crypto';
import { decryptBlob, decryptJson, encryptJson } from '@sovereignfs/sdk/e2ee-object';
import type { DocumentDetail } from '../_lib/documentActions';
import { deleteDocument, updateDocument } from '../_lib/documentActions';
import { documentTypeLabel, normalizeDocumentMetadata } from '../_lib/documentMetadata';
import type { DocumentMetadata } from '../_lib/documentMetadata';
import { formatBytes, safeBlobContentType } from '../_lib/mediaTypes';
import { useE2eeUnlock } from '../_lib/useE2eeUnlock';
import { DocumentFields, readDocumentFields } from './DocumentFields';
import { Timestamps } from './Timestamps';
import formStyles from './CardForm.module.css';
import styles from './DocumentDetailView.module.css';

/** A locked/undecryptable document's whole-page state. */
function DocumentNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <PageHeader title={title} />
      <Card className={styles.card}>{children}</Card>
    </>
  );
}

/**
 * Documents are always encrypted (SPEC: required, not opt-in) — nothing here
 * ever renders until this device's CMK is unlocked. Decryption happens
 * entirely client-side: the ciphertext is fetched from its signed URL,
 * decrypted in the browser, and rendered via a Blob URL that's revoked on
 * unmount — the runtime and server never see plaintext bytes.
 */
export function DocumentDetailView({ document: doc }: { document: DocumentDetail }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, startDelete] = useTransition();
  const [savePending, startSave] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const unlock = useE2eeUnlock();
  const [dek, setDek] = useState<CryptoKey | null>(null);
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState(false);

  useEffect(() => {
    if (unlock.state !== 'unlocked' || !unlock.cmk) return;
    const cmk = unlock.cmk;
    let cancelled = false;
    let createdUrl: string | null = null;
    void (async () => {
      try {
        const unwrapped = await unwrapDekWithCmk(doc.wrappedDek, cmk);
        const meta = normalizeDocumentMetadata(
          await decryptJson<Partial<DocumentMetadata>>(unwrapped, doc.encryptedMetadata),
        );
        const res = await fetch(doc.downloadUrl);
        const ciphertext = await res.blob();
        const plaintext = await decryptBlob(unwrapped, {
          ciphertext,
          iv: doc.blobIv,
          algorithmVersion: doc.blobAlgorithmVersion,
          // A `blob:` URL inherits this origin, so the type it is built with
          // goes through the same allowlist as anything the server stores —
          // the metadata is client-authored and could otherwise name
          // `text/html` (see `mediaTypes.ts`).
          contentType: safeBlobContentType(meta.originalContentType),
        });
        if (cancelled) return;
        createdUrl = URL.createObjectURL(plaintext);
        setDek(unwrapped);
        setObjectUrl(createdUrl);
        setMetadata(meta);
      } catch {
        if (!cancelled) setDecryptError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [doc, unlock.state, unlock.cmk]);

  function handleDelete() {
    setActionError(null);
    startDelete(async () => {
      const result = await deleteDocument(doc.id);
      if (!result.ok) {
        setDeleteConfirmOpen(false);
        setActionError(result.error);
        return;
      }
      router.push('/wallet/documents');
      router.refresh();
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setActionError(null);
    const formData = new FormData(e.currentTarget);
    const fields = readDocumentFields(formData);
    if (!fields.title) return setActionError('Title is required.');
    if (!dek || !metadata) {
      return setActionError('Encryption key is not available. Please reload and try again.');
    }

    startSave(async () => {
      // Only the metadata is re-sealed — under the document's existing DEK,
      // so the stored ciphertext is never re-uploaded to rename a document.
      const next: DocumentMetadata = {
        ...fields,
        originalFilename: metadata.originalFilename,
        originalContentType: metadata.originalContentType,
      };
      let payload: string;
      try {
        payload = JSON.stringify(await encryptJson(dek, next));
      } catch {
        return setActionError('These details could not be encrypted. Please try again.');
      }
      const body = new FormData();
      body.set('encryptedMetadata', payload);
      const result = await updateDocument(doc.id, body);
      if (!result.ok) return setActionError(result.error);
      setMetadata(next);
      setEditing(false);
      router.refresh();
    });
  }

  if (unlock.state === 'checking') {
    return (
      <div className={styles.loading} role="status" aria-live="polite">
        <Spinner />
        <span>Checking encryption…</span>
      </div>
    );
  }

  if (unlock.state !== 'unlocked') {
    return (
      <DocumentNotice title="Encrypted document">
        <p className={formStyles.help}>
          This document is encrypted.{' '}
          <Link href="/account/security" className={styles.inlineLink}>
            Unlock client-side encryption in Account → Security
          </Link>{' '}
          to view it.
        </p>
      </DocumentNotice>
    );
  }

  if (decryptError) {
    return (
      <DocumentNotice title="Encrypted document">
        <p className={formStyles.error} role="status">
          This document can&rsquo;t be opened with your current encryption key. That happens if it
          came from another account&rsquo;s backup, or if encryption was reset since it was saved —
          it can only be opened with the recovery secret it was created under.
        </p>
      </DocumentNotice>
    );
  }

  if (!metadata || !objectUrl) {
    return (
      <div className={styles.loading} role="status" aria-live="polite">
        <Spinner />
        <span>Decrypting…</span>
      </div>
    );
  }

  const isImage = metadata.originalContentType.startsWith('image/');

  if (editing) {
    return (
      <>
        <PageHeader title={metadata.title || 'Untitled document'} />
        <Card>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <DocumentFields initial={metadata} />
            <p className={formStyles.help}>
              The file itself stays as it is — only these details are re-encrypted and saved.
            </p>
            {actionError && (
              <p className={formStyles.error} role="status" aria-live="polite">
                {actionError}
              </p>
            )}
            <div className={formStyles.actions}>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savePending}>
                {savePending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </Card>
      </>
    );
  }

  const details: Array<[string, string]> = [
    ['Document type', metadata.documentType ? documentTypeLabel(metadata.documentType) : '—'],
    ['Issuer', metadata.issuer || '—'],
    ['Country', metadata.country || '—'],
    ['Document number', metadata.documentNumber || '—'],
    ['Notes', metadata.notes || '—'],
    ['File', `${metadata.originalFilename || 'Unnamed file'} · ${formatBytes(doc.sizeBytes)}`],
  ];

  return (
    <>
      <PageHeader title={metadata.title || 'Untitled document'} />
      <Card className={styles.card}>
        <p className={styles.encryptedBadge}>
          <Icon name="lock" size="sm" aria-hidden />
          Encrypted
        </p>
        {isImage ? (
          <img src={objectUrl} alt={metadata.title} className={styles.preview} />
        ) : (
          <p className={formStyles.help}>
            This file type can&rsquo;t be previewed. Download it to open it.
          </p>
        )}
        <p>
          <a href={objectUrl} download={metadata.originalFilename || 'document'}>
            Download {metadata.originalFilename || 'file'}
          </a>
        </p>
        <dl className={styles.fields}>
          {details.map(([label, value]) => (
            <div key={label} className={styles.field}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <Timestamps createdAt={doc.createdAt} updatedAt={doc.updatedAt} />
        {actionError && (
          <p className={formStyles.error} role="status" aria-live="polite">
            {actionError}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Edit details
          </Button>
          <Button type="button" variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
            Delete
          </Button>
        </div>
      </Card>
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete this document?"
        message={`"${metadata.title || 'Untitled document'}" will be permanently removed.`}
        confirmLabel={deletePending ? 'Deleting…' : 'Delete'}
        destructive
        pending={deletePending}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
