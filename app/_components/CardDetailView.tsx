'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  ConfirmDialog,
  FormField,
  Icon,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '@sovereignfs/ui';
import { unwrapDekWithCmk } from '@sovereignfs/sdk/e2ee-crypto';
import { decryptJson } from '@sovereignfs/sdk/e2ee-object';
import type { CardDetail } from '../_lib/actions';
import { deleteCard, updateCard } from '../_lib/actions';
import { BARCODE_FORMAT_OPTIONS, barcodeFormatLabel } from '../_lib/barcodeFormats';
import { buildCardFormData } from '../_lib/cardImageForm';
import { useE2eeUnlock } from '../_lib/useE2eeUnlock';
import { useDecryptedImage } from '../_lib/useDecryptedImage';
import { CodeDisplay } from './CodeDisplay';
import { CopyButton } from './CopyButton';
import { FileField } from './FileField';
import { ScanView } from './ScanView';
import { Timestamps } from './Timestamps';
import styles from './CardDetailView.module.css';
import formStyles from './CardForm.module.css';

interface DecryptedCard {
  title: string;
  issuer: string;
  notes: string;
  payload: string;
}

/** A locked/undecryptable card's whole-page state — no content, one explanation. */
function CardNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <PageHeader title={title} />
      <Card className={styles.card}>{children}</Card>
    </>
  );
}

/**
 * Renders a card's detail view. For an encrypted card, nothing is decrypted
 * until this device's CMK is unlocked (`useE2eeUnlock`) — the server never
 * sees plaintext, and this component shows a locked-state placeholder
 * instead of the card content when it isn't unlocked (RFC 0060).
 */
export function CardDetailView({ card }: { card: CardDetail }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savePending, startSave] = useTransition();
  const [encryptOnSave, setEncryptOnSave] = useState(false);

  const unlock = useE2eeUnlock();
  const [dek, setDek] = useState<CryptoKey | null>(null);
  const [decrypted, setDecrypted] = useState<DecryptedCard | null>(null);
  const [decryptError, setDecryptError] = useState(false);
  const frontImageUrl = useDecryptedImage(card.frontImage, card.encrypted ? dek : null);
  const backImageUrl = useDecryptedImage(card.backImage, card.encrypted ? dek : null);

  useEffect(() => {
    if (!card.encrypted) return;
    // A row flagged encrypted whose cipher columns didn't parse can never be
    // decrypted — surface it as the same "can't open" state rather than
    // spinning forever waiting for a decryption that will never start.
    if (!card.cipher) {
      setDecryptError(true);
      return;
    }
    if (unlock.state !== 'unlocked' || !unlock.cmk) return;
    const cipher = card.cipher;
    const cmk = unlock.cmk;
    let cancelled = false;
    void (async () => {
      try {
        const unwrappedDek = await unwrapDekWithCmk(cipher.wrappedDek, cmk);
        const metadata = await decryptJson<{ title: string; issuer: string; notes: string }>(
          unwrappedDek,
          cipher.encryptedMetadata,
        );
        const payload = await decryptJson<string>(unwrappedDek, cipher.encryptedPayload);
        if (cancelled) return;
        setDek(unwrappedDek);
        setDecrypted({ ...metadata, payload });
      } catch {
        if (!cancelled) setDecryptError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card, unlock.state, unlock.cmk]);

  function handleDelete() {
    setDeleteError(null);
    startDelete(async () => {
      const result = await deleteCard(card.id);
      if (!result.ok) {
        setDeleteConfirmOpen(false);
        setDeleteError(result.error);
        return;
      }
      router.push('/wallet/cards');
      router.refresh();
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveError(null);
    const formData = new FormData(e.currentTarget);
    const title = String(formData.get('title') ?? '').trim();
    const payload = String(formData.get('payload') ?? '').trim();
    if (!title) return setSaveError('Display name is required.');
    if (!payload) return setSaveError('Card payload is required.');

    startSave(async () => {
      let built;
      if (card.encrypted && card.cipher) {
        if (!dek) {
          setSaveError('Encryption key is not available. Please reload and try again.');
          return;
        }
        built = await buildCardFormData(formData, null, { dek, wrappedDek: card.cipher.wrappedDek });
      } else if (encryptOnSave) {
        // Upgrading a plaintext card to an encrypted one. Same rule as
        // creation: if the key vanished, refuse rather than quietly saving
        // the card in the clear.
        if (!unlock.cmk) {
          setSaveError(
            'Encryption isn’t unlocked on this device any more, so nothing was saved. Unlock it in Account → Security and try again.',
          );
          return;
        }
        built = await buildCardFormData(formData, unlock.cmk);
      } else {
        built = await buildCardFormData(formData, null);
      }

      if (!built.ok) return setSaveError(built.error);
      const result = await updateCard(card.id, built.formData);
      if (!result.ok) return setSaveError(result.error);
      setEditing(false);
      setEncryptOnSave(false);
      router.refresh();
    });
  }

  if (card.encrypted) {
    if (unlock.state === 'checking') {
      return (
        <div className={styles.loading} role="status" aria-live="polite">
          <Spinner />
          <span>Checking encryption…</span>
        </div>
      );
    }
    if (decryptError) {
      return (
        <CardNotice title="Encrypted card">
          <p className={formStyles.error} role="status">
            This card can&rsquo;t be opened with your current encryption key. That happens if it
            came from another account&rsquo;s backup, or if encryption was reset since it was
            saved — it can only be opened with the recovery secret it was created under.
          </p>
        </CardNotice>
      );
    }
    if (unlock.state !== 'unlocked') {
      return (
        <CardNotice title="Encrypted card">
          <p className={formStyles.help}>
            This card is encrypted.{' '}
            <Link href="/account/security" className={styles.inlineLink}>
              Unlock client-side encryption in Account → Security
            </Link>{' '}
            to view it.
          </p>
        </CardNotice>
      );
    }
    if (!decrypted) {
      return (
        <div className={styles.loading} role="status" aria-live="polite">
          <Spinner />
          <span>Decrypting…</span>
        </div>
      );
    }
  }

  const display = card.encrypted && decrypted ? decrypted : card;

  if (editing) {
    return (
      <>
        <PageHeader title={display.title || 'Untitled card'} />
        <Card>
          <form onSubmit={handleSubmit} className={formStyles.form}>
            <FormField label="Display name" required>
              {(field) => <Input {...field} name="title" required defaultValue={display.title} />}
            </FormField>
            <FormField label="Issuer">
              {(field) => <Input {...field} name="issuer" defaultValue={display.issuer} />}
            </FormField>
            <FormField label="Barcode format">
              {(field) => (
                <Select {...field} name="barcodeFormat" defaultValue={card.barcodeFormat ?? 'qr'}>
                  {BARCODE_FORMAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              label="Card payload"
              required
              hint="The value encoded in the barcode/QR code."
            >
              {(field) => (
                <Textarea {...field} name="payload" required rows={2} defaultValue={display.payload} />
              )}
            </FormField>
            <FormField label="Notes">
              {(field) => <Textarea {...field} name="notes" rows={3} defaultValue={display.notes} />}
            </FormField>
            <FormField
              label="Front image"
              hint={card.frontImage ? 'Replace the current image.' : 'Optional.'}
            >
              {(field) => (
                <FileField field={field} name="frontImage" accept="image/*" hint="Image file" />
              )}
            </FormField>
            <FormField
              label="Back image"
              hint={card.backImage ? 'Replace the current image.' : 'Optional.'}
            >
              {(field) => (
                <FileField field={field} name="backImage" accept="image/*" hint="Image file" />
              )}
            </FormField>

            {!card.encrypted && (
              <>
                <label className={formStyles.encryptOption}>
                  <input
                    type="checkbox"
                    checked={encryptOnSave}
                    disabled={unlock.state !== 'unlocked'}
                    onChange={(e) => setEncryptOnSave(e.currentTarget.checked)}
                  />{' '}
                  Encrypt this card
                </label>
                {unlock.state !== 'unlocked' && unlock.state !== 'checking' && (
                  <p className={formStyles.help}>
                    Set up client-side encryption in Account → Security to encrypt this card.
                  </p>
                )}
                {encryptOnSave && (
                  <p className={formStyles.encryptWarning}>
                    Saving will encrypt this card. It will then only be readable on devices where
                    you&rsquo;ve unlocked encryption, and can&rsquo;t be recovered without your
                    recovery secret.
                  </p>
                )}
              </>
            )}

            {saveError && (
              <p className={formStyles.error} role="status" aria-live="polite">
                {saveError}
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

  return (
    <>
      <PageHeader title={display.title || 'Untitled card'} />
      <Card className={styles.card}>
        {card.encrypted && (
          <p className={styles.encryptedBadge}>
            <Icon name="lock" size="sm" aria-hidden />
            Encrypted
          </p>
        )}
        <CodeDisplay format={card.barcodeFormat} payload={display.payload} />
        <div className={styles.scanActions}>
          <Button type="button" onClick={() => setScanning(true)}>
            Show for scanning
          </Button>
          <CopyButton value={display.payload} label="Copy number" />
        </div>
        {(frontImageUrl || backImageUrl) && (
          <div className={styles.images}>
            {frontImageUrl && <img src={frontImageUrl} alt="Card front" className={styles.image} />}
            {backImageUrl && <img src={backImageUrl} alt="Card back" className={styles.image} />}
          </div>
        )}
        <dl className={styles.fields}>
          <div className={styles.field}>
            <dt>Issuer</dt>
            <dd>{display.issuer || '—'}</dd>
          </div>
          <div className={styles.field}>
            <dt>Barcode format</dt>
            <dd>{barcodeFormatLabel(card.barcodeFormat)}</dd>
          </div>
          <div className={styles.field}>
            <dt>Payload</dt>
            <dd className={styles.payload}>{display.payload}</dd>
          </div>
          <div className={styles.field}>
            <dt>Notes</dt>
            <dd>{display.notes || '—'}</dd>
          </div>
        </dl>
        <Timestamps createdAt={card.createdAt} updatedAt={card.updatedAt} />
        {deleteError && (
          <p className={formStyles.error} role="status" aria-live="polite">
            {deleteError}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button type="button" variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
            Delete
          </Button>
        </div>
      </Card>
      <ScanView
        open={scanning}
        onClose={() => setScanning(false)}
        title={display.title || 'Untitled card'}
        format={card.barcodeFormat}
        payload={display.payload}
      />
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete this card?"
        message={`"${display.title || 'Untitled card'}" will be permanently removed.`}
        confirmLabel={deletePending ? 'Deleting…' : 'Delete'}
        destructive
        pending={deletePending}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
