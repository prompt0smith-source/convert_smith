import type { PdfUnicodeCMap } from "./types.js";

export function parseToUnicodeCMap(bytes: Uint8Array): PdfUnicodeCMap | undefined {
  const source = Buffer.from(bytes).toString("latin1").replace(/%[^\r\n]*/g, "");
  const codeToText = new Map<string, string>();
  const codeSpaceByteLengths = readCodeSpaceByteLengths(source);

  for (const block of readBlocks(source, "beginbfchar", "endbfchar")) {
    const pairs = [...block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)];
    for (const [, sourceHex, unicodeHex] of pairs) {
      codeToText.set(normalizeHex(sourceHex), decodeUnicodeHex(unicodeHex));
    }
  }

  for (const block of readBlocks(source, "beginbfrange", "endbfrange")) {
    const ranges = [...block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)];
    for (const [, startHex, endHex, unicodeStartHex, unicodeArray] of ranges) {
      if (unicodeArray) {
        applyArrayRange(codeToText, startHex, endHex, unicodeArray);
      } else if (unicodeStartHex) {
        applySequentialRange(codeToText, startHex, endHex, unicodeStartHex);
      }
    }
  }

  if (codeToText.size === 0) return undefined;

  const textToCode = new Map<string, Uint8Array>();
  for (const [codeHex, text] of codeToText) {
    if (!textToCode.has(text)) {
      textToCode.set(text, hexToBytes(codeHex));
    }
  }

  const inferredByteLengths = new Set<number>(codeSpaceByteLengths);
  for (const codeHex of codeToText.keys()) {
    inferredByteLengths.add(codeHex.length / 2);
  }

  return {
    codeToText,
    textToCode,
    codeByteLengths: [...inferredByteLengths].filter((length) => length > 0).sort((left, right) => right - left)
  };
}

export function decodeBytesWithCMap(bytes: Uint8Array, cmap: PdfUnicodeCMap): string {
  let offset = 0;
  let text = "";
  while (offset < bytes.length) {
    let matched = false;
    for (const byteLength of cmap.codeByteLengths) {
      if (offset + byteLength > bytes.length) continue;
      const codeHex = bytesToHex(bytes.subarray(offset, offset + byteLength));
      const mapped = cmap.codeToText.get(codeHex);
      if (mapped !== undefined) {
        text += mapped;
        offset += byteLength;
        matched = true;
        break;
      }
    }
    if (!matched) {
      text += String.fromCharCode(bytes[offset]);
      offset += 1;
    }
  }
  return text.normalize("NFC");
}

export function encodeTextWithCMap(text: string, cmap: PdfUnicodeCMap): Uint8Array | undefined {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const char of Array.from(text.normalize("NFC"))) {
    const bytes = cmap.textToCode.get(char);
    if (!bytes) return undefined;
    chunks.push(bytes);
    total += bytes.length;
  }

  const encoded = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    encoded.set(chunk, offset);
    offset += chunk.length;
  }
  return encoded;
}

function readCodeSpaceByteLengths(source: string): number[] {
  const lengths = new Set<number>();
  for (const block of readBlocks(source, "begincodespacerange", "endcodespacerange")) {
    const pairs = [...block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)];
    for (const [, startHex, endHex] of pairs) {
      if (startHex.length === endHex.length && startHex.length % 2 === 0) {
        lengths.add(startHex.length / 2);
      }
    }
  }
  return [...lengths];
}

function readBlocks(source: string, begin: string, end: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(`${begin}([\\s\\S]*?)${end}`, "g");
  for (const match of source.matchAll(pattern)) {
    blocks.push(match[1]);
  }
  return blocks;
}

function applyArrayRange(codeToText: Map<string, string>, startHex: string, endHex: string, unicodeArray: string): void {
  const start = BigInt(`0x${normalizeHex(startHex)}`);
  const end = BigInt(`0x${normalizeHex(endHex)}`);
  const width = normalizeHex(startHex).length;
  const entries = [...unicodeArray.matchAll(/<([0-9a-fA-F]+)>/g)].map((match) => decodeUnicodeHex(match[1]));
  const count = Number(end - start + 1n);
  for (let index = 0; index < Math.min(count, entries.length); index += 1) {
    codeToText.set(bigIntToHex(start + BigInt(index), width), entries[index]);
  }
}

function applySequentialRange(codeToText: Map<string, string>, startHex: string, endHex: string, unicodeStartHex: string): void {
  const start = BigInt(`0x${normalizeHex(startHex)}`);
  const end = BigInt(`0x${normalizeHex(endHex)}`);
  const width = normalizeHex(startHex).length;
  const unicodeStart = firstCodePoint(decodeUnicodeHex(unicodeStartHex));
  if (unicodeStart === undefined) return;

  const count = Number(end - start + 1n);
  for (let index = 0; index < count; index += 1) {
    codeToText.set(bigIntToHex(start + BigInt(index), width), String.fromCodePoint(unicodeStart + index));
  }
}

function decodeUnicodeHex(hex: string): string {
  const bytes = hexToBytes(normalizeHex(hex));
  if (bytes.length >= 2 && bytes.length % 2 === 0) {
    let text = "";
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return text.normalize("NFC");
  }
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("").normalize("NFC");
}

function firstCodePoint(text: string): number | undefined {
  const first = Array.from(text)[0];
  return first ? first.codePointAt(0) : undefined;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = normalizeHex(hex);
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function bigIntToHex(value: bigint, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

function normalizeHex(value: string): string {
  const compact = value.replace(/\s+/g, "");
  return (compact.length % 2 === 0 ? compact : `${compact}0`).toUpperCase();
}
