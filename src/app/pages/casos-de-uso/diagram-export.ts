const SVG_NS = 'http://www.w3.org/2000/svg';

let cachedFontCss: Promise<string> | null = null;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function rasterizeSvg(source: SVGSVGElement): Promise<HTMLCanvasElement> {
  const width = Math.max(Math.round(source.getBoundingClientRect().width), 1);
  const height = Math.max(Math.round(source.getBoundingClientRect().height), 1);
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute('style');
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', String(width));
  background.setAttribute('height', String(height));
  background.setAttribute('fill', '#ffffff');
  clone.insertBefore(background, clone.firstChild);

  const fontCss = await ptSansCss();
  if (fontCss) {
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = fontCss;
    clone.insertBefore(style, clone.firstChild);
  }

  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(url);
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('canvas');
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error(type));
        }
      },
      type,
      quality,
    );
  });
}

export async function canvasToPdf(canvas: HTMLCanvasElement): Promise<Blob> {
  const jpeg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  return jpegToPdf(jpeg, canvas.width, canvas.height);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('svg'));
    image.src = url;
  });
}

async function ptSansCss(): Promise<string> {
  cachedFontCss ??= fetchPtSans().catch((error: unknown) => {
    cachedFontCss = null;
    throw error;
  });
  try {
    return await cachedFontCss;
  } catch {
    return '';
  }
}

async function fetchPtSans(): Promise<string> {
  const link = document.querySelector<HTMLLinkElement>('link[href*="PT+Sans"]');
  if (!link) {
    return '';
  }
  const css = await (await fetch(link.href)).text();
  const faces = css.match(/@font-face\s*\{[^}]+\}/g) ?? [];
  const normal = faces.filter((face) => !/font-style:\s*italic/.test(face));
  const inlined = await Promise.all(normal.map((face) => inlineFace(face, link.href)));
  return inlined.filter(Boolean).join('\n');
}

async function inlineFace(face: string, baseHref: string): Promise<string> {
  const match = face.match(/url\(([^)]+)\)/);
  if (!match) {
    return '';
  }
  const raw = match[1].replace(/["']/g, '');
  if (raw.startsWith('data:')) {
    return face;
  }
  const response = await fetch(new URL(raw, baseHref));
  if (!response.ok) {
    return '';
  }
  const base64 = toBase64(new Uint8Array(await response.arrayBuffer()));
  const format = /woff2/.test(raw) ? 'woff2' : 'woff';
  return face.replace(/url\([^)]+\)(?:\s*format\([^)]+\))?/, `url("data:font/${format};base64,${base64}") format("${format}")`);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

function jpegToPdf(jpeg: Uint8Array, pixelWidth: number, pixelHeight: number): Blob {
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 28;
  const scale = Math.min((pageWidth - margin * 2) / pixelWidth, (pageHeight - margin * 2) / pixelHeight);
  const drawWidth = pixelWidth * scale;
  const drawHeight = pixelHeight * scale;
  const x = (pageWidth - drawWidth) / 2;
  const y = (pageHeight - drawHeight) / 2;
  const content = `q\n${num(drawWidth)} 0 0 ${num(drawHeight)} ${num(x)} ${num(y)} cm\n/Im0 Do\nQ\n`;
  const encoder = new TextEncoder();
  const objects = [
    encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'),
    encoder.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    encoder.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageWidth)} ${num(pageHeight)}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`,
    ),
    encoder.encode(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`),
    concat(
      encoder.encode(
        `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      encoder.encode('\nendstream'),
    ),
  ];

  const header = encoder.encode('%PDF-1.4\n');
  const parts: Uint8Array[] = [header];
  const offsets = [0];
  let cursor = header.length;
  objects.forEach((body, index) => {
    const chunk = concat(encoder.encode(`${index + 1} 0 obj\n`), body, encoder.encode('\nendobj\n'));
    offsets.push(cursor);
    parts.push(chunk);
    cursor += chunk.length;
  });

  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF`;
  parts.push(encoder.encode(xref));
  return new Blob(parts.map((part) => new Uint8Array(part)), { type: 'application/pdf' });
}

function num(value: number): string {
  return value.toFixed(2);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
