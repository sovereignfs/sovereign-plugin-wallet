/** The barcode format enum stored on a card, with its user-facing label. */
export const BARCODE_FORMAT_OPTIONS = [
  { value: 'qr', label: 'QR code' },
  { value: 'code128', label: 'Code 128' },
  { value: 'code39', label: 'Code 39' },
  { value: 'ean13', label: 'EAN-13' },
  { value: 'upc', label: 'UPC' },
  { value: 'other', label: 'Other' },
] as const;

/**
 * Single source for the `<option>` lists in NewCardDialog and CardDetailView's
 * edit form. They previously each hard-coded the same six options with a
 * comment asking future editors to keep three places in sync by hand.
 */
export const BARCODE_FORMAT_LABELS: Record<string, string> = Object.fromEntries(
  BARCODE_FORMAT_OPTIONS.map((option) => [option.value, option.label]),
);

export function barcodeFormatLabel(format: string | null): string {
  if (!format) return '—';
  return BARCODE_FORMAT_LABELS[format] ?? format;
}
