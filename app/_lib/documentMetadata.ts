/**
 * The shape encrypted into `wallet_items.encrypted_metadata` for a document.
 *
 * SPEC WLT-08 requires title, issuer, document type, country, document
 * number, filename and notes to be captured and stored **encrypted**; the
 * SPEC's metadata-minimization rule keeps all of it out of plaintext. Only
 * the item id, owner, timestamps, storage key, encryption version and the
 * coarse `kind_hint` are ever readable server-side.
 *
 * Every field except `title` is optional — a user photographing a loyalty
 * receipt shouldn't be made to fill in a passport's worth of fields.
 */
export interface DocumentMetadata {
  title: string;
  issuer: string;
  documentType: string;
  country: string;
  documentNumber: string;
  notes: string;
  originalFilename: string;
  originalContentType: string;
}

/**
 * Coarse, non-identifying document categories. Stored *inside* the encrypted
 * metadata like everything else — `kind_hint` gets only `'document'`, never
 * the specific type, so the plaintext row says nothing about what the
 * document is.
 */
export const DOCUMENT_TYPES = [
  'passport',
  'id-card',
  'driving-licence',
  'permit',
  'certificate',
  'insurance',
  'other',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  passport: 'Passport',
  'id-card': 'ID card',
  'driving-licence': 'Driving licence',
  permit: 'Permit',
  certificate: 'Certificate',
  insurance: 'Insurance',
  other: 'Other',
};

export function documentTypeLabel(value: string): string {
  if (!value) return '—';
  return DOCUMENT_TYPE_LABELS[value] ?? value;
}

/** Fills in every field so a bundle written by an older version still reads cleanly. */
export function normalizeDocumentMetadata(raw: Partial<DocumentMetadata> | null): DocumentMetadata {
  return {
    title: typeof raw?.title === 'string' ? raw.title : '',
    issuer: typeof raw?.issuer === 'string' ? raw.issuer : '',
    documentType: typeof raw?.documentType === 'string' ? raw.documentType : '',
    country: typeof raw?.country === 'string' ? raw.country : '',
    documentNumber: typeof raw?.documentNumber === 'string' ? raw.documentNumber : '',
    notes: typeof raw?.notes === 'string' ? raw.notes : '',
    originalFilename: typeof raw?.originalFilename === 'string' ? raw.originalFilename : '',
    originalContentType:
      typeof raw?.originalContentType === 'string' ? raw.originalContentType : '',
  };
}
