'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, FormField } from '@sovereignfs/ui';
import { generateDek, wrapDekWithCmk } from '@sovereignfs/sdk/e2ee-crypto';
import { encryptBlob, encryptJson } from '@sovereignfs/sdk/e2ee-object';
import { createDocument } from '../_lib/documentActions';
import { compressImageIfNeeded } from '../_lib/imageCompression';
import { MAX_DOCUMENT_BYTES, formatBytes, tooLargeMessage } from '../_lib/mediaTypes';
import { DocumentFields, readDocumentFields } from './DocumentFields';
import { FileField } from './FileField';
import formStyles from './CardForm.module.css';

/**
 * Sensitive-document upload (SPEC: client-side encryption required, not
 * opt-in — unlike loyalty cards). Only ever rendered by `DocumentUploadGate`
 * once this device's CMK is unlocked, so `unlock.cmk` is always present here;
 * still checked defensively in case the unlock state changes mid-session.
 */
export function NewDocumentDialog({ cmk }: { cmk: CryptoKey }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const fields = readDocumentFields(formData);
    const file = formData.get('file');
    if (!fields.title) return setError('Title is required.');
    if (!(file instanceof File) || file.size === 0) return setError('Choose a file to upload.');

    startTransition(async () => {
      // Size is checked before any crypto work, so an oversized PDF reports
      // its actual size instead of failing later as "something went wrong
      // encrypting this document" — images are downscaled first, everything
      // else has to fit as-is.
      const compressedFile = await compressImageIfNeeded(file, MAX_DOCUMENT_BYTES);
      if (compressedFile.size > MAX_DOCUMENT_BYTES) {
        return setError(tooLargeMessage(compressedFile.size, MAX_DOCUMENT_BYTES));
      }

      let uploadForm: FormData;
      try {
        const dek = await generateDek();
        const wrappedDek = await wrapDekWithCmk(dek, cmk);
        const encryptedBlob = await encryptBlob(dek, compressedFile);
        const encryptedMetadata = await encryptJson(dek, {
          ...fields,
          originalFilename: compressedFile.name,
          originalContentType: compressedFile.type,
        });

        uploadForm = new FormData();
        uploadForm.set('ciphertext', encryptedBlob.ciphertext, 'ciphertext.bin');
        uploadForm.set('blobIv', encryptedBlob.iv);
        uploadForm.set('blobAlgorithmVersion', encryptedBlob.algorithmVersion);
        uploadForm.set('encryptedMetadata', JSON.stringify(encryptedMetadata));
        uploadForm.set('wrappedDek', JSON.stringify(wrappedDek));
      } catch {
        return setError('This document could not be encrypted in your browser. Please try again.');
      }

      const result = await createDocument(uploadForm);
      if (!result.ok) return setError(result.error);
      close();
      router.push(`/wallet/documents/${result.id}`);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Add document
      </Button>
      <Dialog open={open} onClose={close} size="md" title="Add document">
        <form onSubmit={handleSubmit} className={formStyles.form}>
          <DocumentFields />
          <FormField
            label="File"
            required
            hint={`Encrypted in your browser before upload. Up to ${formatBytes(MAX_DOCUMENT_BYTES)}.`}
          >
            {(field) => <FileField field={field} name="file" hint="Any file type" />}
          </FormField>
          <p className={formStyles.encryptWarning}>
            This document will only be readable on devices where you&rsquo;ve unlocked encryption.
            If you lose your recovery secret and every enrolled device, it can&rsquo;t be recovered
            — not by you, not by Sovereign, not by the operator.
          </p>
          {error && (
            <p className={formStyles.error} role="status" aria-live="polite">
              {error}
            </p>
          )}
          <div className={formStyles.actions}>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Encrypting & uploading…' : 'Add document'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
