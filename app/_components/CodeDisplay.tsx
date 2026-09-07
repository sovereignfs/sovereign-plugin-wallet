'use client';

import { useEffect, useRef, useState } from 'react';
import { JSBARCODE_FORMATS } from '../_lib/qr';
import styles from './CodeDisplay.module.css';

export interface CodeDisplayProps {
  format: string | null;
  payload: string;
  /** Render at scan size — bigger module/bar width for a scanner to read off a screen. */
  large?: boolean;
}

/**
 * Renders a QR code or 1D barcode entirely client-side — the payload never
 * leaves the browser (SPEC: "No payload sent to an external service").
 * `qrcode` draws to canvas; `jsbarcode` draws to an inline SVG. Both load
 * lazily so the (client-only, DOM-drawing) libraries never end up in a
 * server bundle.
 *
 * Both drawing libraries paint *into* an existing element rather than
 * replacing it, so each render clears the target first. Without that, a
 * payload that fails to encode (a letter in an EAN-13, say) leaves the
 * previously drawn code on screen next to its own error message — showing a
 * barcode that no longer matches the card.
 */
export function CodeDisplay({ format, payload, large = false }: CodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);

  const jsbarcodeFormat = format
    ? JSBARCODE_FORMATS[format as keyof typeof JSBARCODE_FORMATS]
    : undefined;

  useEffect(() => {
    setError(null);
    let cancelled = false;

    if (format === 'qr') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      void import('qrcode')
        .then(({ default: QRCode }) => QRCode.toCanvas(canvas, payload, { width: large ? 320 : 200 }))
        .catch(() => {
          if (cancelled) return;
          // Clear whatever was drawn before, so a stale code can't be
          // mistaken for the current card's.
          canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
          setError('This card’s value can’t be shown as a QR code.');
        });
      return () => {
        cancelled = true;
      };
    }

    if (jsbarcodeFormat) {
      const svg = svgRef.current;
      if (!svg) return;
      void import('jsbarcode')
        .then(({ default: JsBarcode }) => {
          JsBarcode(svg, payload, {
            format: jsbarcodeFormat,
            displayValue: false,
            width: large ? 3 : 2,
            height: large ? 140 : 100,
          });
        })
        .catch(() => {
          if (cancelled) return;
          svg.replaceChildren();
          svg.removeAttribute('width');
          svg.removeAttribute('height');
          setError(`This card’s value isn’t a valid ${jsbarcodeFormat} code.`);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [format, jsbarcodeFormat, payload, large]);

  if (format !== 'qr' && !jsbarcodeFormat) {
    return (
      <p className={styles.unsupported}>
        No barcode preview for this format — the value is shown below.
      </p>
    );
  }

  return (
    <div className={styles.root}>
      {/* The rendered code is a picture of `payload`, which is always shown as
          text nearby — so it is decorative to assistive tech rather than an
          image needing its own description. */}
      {format === 'qr' ? (
        <canvas ref={canvasRef} aria-hidden="true" />
      ) : (
        <svg ref={svgRef} aria-hidden="true" />
      )}
      {error && (
        <p className={styles.error} role="status" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
