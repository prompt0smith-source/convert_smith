import { writeFile } from "node:fs/promises";
import { PDFName, type PDFDocument } from "pdf-lib";
import { encodeTextWithCMap } from "./PdfToUnicodeCMap.js";
import type {
  NativePdfEditCapability,
  NativePdfTextSpan,
  ParsedPdfContentStream,
  PdfContentStreamPatch
} from "./types.js";

export class PdfContentStreamWriter {
  createPatches(capabilities: NativePdfEditCapability[]): PdfContentStreamPatch[] {
    return capabilities.map((capability) => {
      if (!capability.directEditable || !capability.matchedSpan) {
        throw new Error("직접 편집 불가능한 capability로 patch를 만들 수 없습니다.");
      }
      const replacementText = String(capability.edit.replacementText || "").normalize("NFC");
      const replacementBytes = encodeReplacementToken(capability.matchedSpan, replacementText);

      return {
        pageNumber: capability.matchedSpan.pageNumber,
        streamId: capability.matchedSpan.streamId,
        operatorIndex: capability.matchedSpan.operatorIndex,
        encodedStart: capability.matchedSpan.encodedStart,
        encodedEnd: capability.matchedSpan.encodedEnd,
        replacementBytes,
        originalText: capability.matchedSpan.decodedText,
        replacementText
      };
    });
  }

  async write(
    pdfDoc: PDFDocument,
    streams: ParsedPdfContentStream[],
    patches: PdfContentStreamPatch[],
    outputPath: string
  ): Promise<void> {
    const streamsById = new Map(streams.map((stream) => [stream.streamId, stream]));
    const patchesByStream = new Map<string, PdfContentStreamPatch[]>();

    for (const patch of patches) {
      const list = patchesByStream.get(patch.streamId) || [];
      list.push(patch);
      patchesByStream.set(patch.streamId, list);
    }

    for (const [streamId, streamPatches] of patchesByStream) {
      const stream = streamsById.get(streamId);
      if (!stream) throw new Error(`수정할 content stream을 찾지 못했습니다: ${streamId}`);

      const patchedBytes = applyPatches(stream.decodedBytes, streamPatches);
      const newStream = pdfDoc.context.flateStream(patchedBytes);

      if (stream.contentRef) {
        pdfDoc.context.assign(stream.contentRef, newStream);
      } else if (stream.contentArray && stream.contentArrayIndex !== undefined) {
        const newRef = pdfDoc.context.register(newStream);
        stream.contentArray.set(stream.contentArrayIndex, newRef);
      } else {
        const newRef = pdfDoc.context.register(newStream);
        stream.pageNode.set(PDFName.Contents, newRef);
      }
    }

    await writeFile(outputPath, await pdfDoc.save({ useObjectStreams: false }));
  }
}

function applyPatches(originalBytes: Uint8Array, patches: PdfContentStreamPatch[]): Uint8Array {
  const sorted = [...patches].sort((left, right) => right.encodedStart - left.encodedStart);
  validatePatchRanges(sorted);

  let current = originalBytes;
  for (const patch of sorted) {
    const before = current.slice(0, patch.encodedStart);
    const after = current.slice(patch.encodedEnd);
    const next = new Uint8Array(before.length + patch.replacementBytes.length + after.length);
    next.set(before, 0);
    next.set(patch.replacementBytes, before.length);
    next.set(after, before.length + patch.replacementBytes.length);
    current = next;
  }
  return current;
}

function validatePatchRanges(patches: PdfContentStreamPatch[]): void {
  let previousStart = Number.POSITIVE_INFINITY;
  for (const patch of patches) {
    if (patch.encodedStart < 0 || patch.encodedEnd <= patch.encodedStart) {
      throw new Error("content stream patch 범위가 올바르지 않습니다.");
    }
    if (patch.encodedEnd > previousStart) {
      throw new Error("content stream patch 범위가 서로 겹칩니다.");
    }
    previousStart = patch.encodedStart;
  }
}

function encodeReplacementToken(span: NativePdfTextSpan, replacementText: string): Uint8Array {
  if (span.textEncoding === "to_unicode_cmap") {
    const bytes = encodeReplacementWithUnicodeMap(span, replacementText);
    return sourceToBytes(`<${bytesToHex(bytes)}>`);
  }
  if (span.encodedKind === "hex") {
    return sourceToBytes(`<${bytesToHex(ansiBytes(replacementText))}>`);
  }
  if (span.encodedKind === "literal") {
    return sourceToBytes(`(${escapeLiteralString(replacementText)})`);
  }
  if (span.encodedKind === "array") {
    return sourceToBytes(`(${escapeLiteralString(replacementText)})`);
  }
  throw new Error("지원하지 않는 텍스트 token 형식입니다.");
}

function encodeReplacementWithUnicodeMap(span: NativePdfTextSpan, replacementText: string): Uint8Array {
  if (replacementText.length === 0) return new Uint8Array();
  const cmap = span.unicodeToBytes
    ? { codeToText: new Map<string, string>(), textToCode: span.unicodeToBytes, codeByteLengths: [] }
    : undefined;
  const bytes = cmap ? encodeTextWithCMap(replacementText, cmap) : undefined;
  if (!bytes) {
    throw new Error("새 문자열을 현재 PDF 폰트 CMap으로 encoding할 수 없습니다.");
  }
  return bytes;
}

function ansiBytes(value: string): Uint8Array {
  return new Uint8Array(Array.from(value, (char) => char.charCodeAt(0) & 0xff));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function escapeLiteralString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function sourceToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "latin1"));
}
