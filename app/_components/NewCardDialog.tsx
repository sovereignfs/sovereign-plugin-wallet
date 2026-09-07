'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, FormField, Input, Select, Textarea } from '@sovereignfs/ui';
import { createCard } from '../_lib/actions';
import { buildCardFormData } from '../_lib/cardImageForm';
import { useE2eeUnlock } from '../_lib/useE2eeUnlock';
import { BARCODE_FORMAT_OPTIONS } from '../_lib/barcodeFormats';
import { FileField } from './FileField';
import styles from './CardForm.module.css';

export function NewCardDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const unlock = useE2eeUnlock();
  const canEncrypt = unlock.state === 'unlocked';

  function close() {
    setOpen(false);
    setError(null);
    setEncrypt(false);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const title = String(formData.get('title') ?? '').trim();
    const payload = String(formData.get('payload') ?? '').trim();
    if (!title) return setError('Display name is required.');
    if (!payload) return setError('Card payload is required.');

    startTransition(async () => {
      // If the user asked for encryption, it happens or the card is not
      // saved. Falling through to the plaintext path when the CMK went away
      // between render and submit would silently store the payload, issuer
      // and notes in the clear on a card the user explicitly marked private.
      if (encrypt && !unlock.cmk) {
        setError(
          'Encryption isn’t unlocked on this device any more, so this card wasn’t saved. Unlock it in Account → Security and try again.',
        );
        return;
      }

      const built = await buildCardFormData(formData, encrypt ? unlock.cmk : null);
      if (!built.ok) return setError(built.error);

      const result = await createCard(built.formData);
      if (!result.ok) return setError(result.error);
      close();
      router.push(`/wallet/cards/${result.id}`);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Add card
      </Button>
      <Dialog open={open} onClose={close} size="md" title="Add card">
        <form onSubmit={handleSubmit} className={styles.form}>
          <FormField label="Display name" required>
            {(field) => <Input {...field} name="title" required placeholder="Coffee rewards" />}
          </FormField>
          <FormField label="Issuer">
            {(field) => <Input {...field} name="issuer" placeholder="Acme Coffee Co." />}
          </FormField>
          <FormField label="Barcode format">
            {(field) => (
              <Select {...field} name="barcodeFormat" defaultValue="qr">
                {BARCODE_FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Card payload" required hint="The value encoded in the barcode/QR code.">
            {(field) => <Textarea {...field} name="payload" required rows={2} />}
          </FormField>
          <FormField label="Notes">
            {(field) => <Textarea {...field} name="notes" rows={3} />}
          </FormField>
          <FormField label="Front image" hint="Optional.">
            {(field) => (
              <FileField field={field} name="frontImage" accept="image/*" hint="Image file" />
            )}
          </FormField>
          <FormField label="Back image" hint="Optional.">
            {(field) => (
              <FileField field={field} name="backImage" accept="image/*" hint="Image file" />
            )}
          </FormField>
          <label className={styles.encryptOption}>
            <input
              type="checkbox"
              checked={encrypt}
              disabled={!canEncrypt}
              onChange={(e) => setEncrypt(e.currentTarget.checked)}
            />{' '}
            Encrypt this card
          </label>
          {unlock.state !== 'checking' && !canEncrypt && (
            <p className={styles.help}>
              Set up client-side encryption in Account → Security to encrypt cards. Loyalty cards
              are private either way — encryption additionally protects them from the operator or
              runtime.
            </p>
          )}
          {canEncrypt && encrypt && (
            <p className={styles.encryptWarning}>
              This card will only be readable on devices where you&rsquo;ve unlocked encryption. If
              you lose your recovery secret and every enrolled device, it can&rsquo;t be recovered.
            </p>
          )}
          {error && (
            <p className={styles.error} role="status" aria-live="polite">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding…' : 'Add card'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
