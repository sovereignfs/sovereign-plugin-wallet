'use client';

import { FormField, Input, Select, Textarea } from '@sovereignfs/ui';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '../_lib/documentMetadata';
import type { DocumentMetadata } from '../_lib/documentMetadata';
import styles from './CardForm.module.css';

/**
 * The document detail fields SPEC WLT-08 requires — title, issuer, document
 * type, country, document number, notes. Every one of them is encrypted
 * client-side before submission, so none of it is ever readable server-side.
 *
 * Shared by the upload dialog and the edit form so the two can't drift.
 * Only the title is required: photographing a warranty card shouldn't
 * demand a passport's worth of fields.
 */
export function DocumentFields({ initial }: { initial?: Partial<DocumentMetadata> }) {
  return (
    <>
      <FormField label="Title" required>
        {(field) => (
          <Input {...field} name="title" required placeholder="Passport" defaultValue={initial?.title} />
        )}
      </FormField>
      <div className={styles.fieldRow}>
        <FormField label="Document type">
          {(field) => (
            <Select {...field} name="documentType" defaultValue={initial?.documentType ?? ''}>
              <option value="">Not specified</option>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DOCUMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Country">
          {(field) => (
            <Input {...field} name="country" placeholder="Sri Lanka" defaultValue={initial?.country} />
          )}
        </FormField>
      </div>
      <div className={styles.fieldRow}>
        <FormField label="Issuer">
          {(field) => (
            <Input
              {...field}
              name="issuer"
              placeholder="Department of Immigration"
              defaultValue={initial?.issuer}
            />
          )}
        </FormField>
        <FormField label="Document number">
          {(field) => (
            <Input {...field} name="documentNumber" defaultValue={initial?.documentNumber} />
          )}
        </FormField>
      </div>
      <FormField label="Notes">
        {(field) => <Textarea {...field} name="notes" rows={3} defaultValue={initial?.notes} />}
      </FormField>
    </>
  );
}

/** Reads the WLT-08 fields off a submitted form. */
export function readDocumentFields(formData: FormData) {
  const get = (key: string) => String(formData.get(key) ?? '').trim();
  return {
    title: get('title'),
    issuer: get('issuer'),
    documentType: get('documentType'),
    country: get('country'),
    documentNumber: get('documentNumber'),
    notes: get('notes'),
  };
}
