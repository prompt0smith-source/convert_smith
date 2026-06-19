import { decodePDFRawStream, PDFArray, PDFContentStream, PDFDict, PDFName, PDFRawStream, PDFStream } from "pdf-lib";
import type { ParsedPdfContentStream, PdfFontInfo, PdfFontMap } from "./types.js";
import { parseToUnicodeCMap } from "./PdfToUnicodeCMap.js";

export class PdfFontMapResolver {
  resolve(streams: ParsedPdfContentStream[]): Map<number, PdfFontMap> {
    const pageFonts = new Map<number, PdfFontMap>();
    const seenPages = new Set<number>();

    for (const stream of streams) {
      if (seenPages.has(stream.pageNumber)) continue;
      seenPages.add(stream.pageNumber);
      pageFonts.set(stream.pageNumber, this.resolvePageFonts(stream));
    }

    return pageFonts;
  }

  private resolvePageFonts(stream: ParsedPdfContentStream): PdfFontMap {
    const fonts: PdfFontMap = new Map();
    const resources = stream.pageNode.Resources();
    const fontDictionary = resources?.lookupMaybe(PDFName.Font, PDFDict);
    if (!fontDictionary) return fonts;

    for (const [resourceNameObject, fontObjectRef] of fontDictionary.entries()) {
      const fontObject = fontDictionary.context.lookup(fontObjectRef);
      if (!(fontObject instanceof PDFDict)) continue;

      const resourceName = resourceNameObject.decodeText();
      const descriptor = this.findFontDescriptor(fontObject);
      const baseFont = readName(fontObject, "BaseFont") || readName(descriptor, "FontName");
      const subtype = readName(fontObject, "Subtype");
      const encoding = this.readEncoding(fontObject);
      const toUnicodeStream = fontObject.lookupMaybe(PDFName.of("ToUnicode"), PDFStream);
      const toUnicodeMap = toUnicodeStream ? parseToUnicodeCMap(this.decodeStream(toUnicodeStream)) : undefined;
      const hasToUnicode = Boolean(toUnicodeMap);
      const isEmbedded = Boolean(
        descriptor?.lookupMaybe(PDFName.of("FontFile"), PDFStream) ||
          descriptor?.lookupMaybe(PDFName.of("FontFile2"), PDFStream) ||
          descriptor?.lookupMaybe(PDFName.of("FontFile3"), PDFStream)
      );
      const isSubset = Boolean(baseFont && /^[A-Z]{6}\+/.test(baseFont));

      fonts.set(resourceName, {
        pageNumber: stream.pageNumber,
        resourceName,
        subtype,
        baseFont,
        encoding,
        hasToUnicode,
        isEmbedded,
        isSubset,
        supportsSimpleAnsiText: this.supportsSimpleAnsiText({ subtype, encoding, baseFont, isSubset }),
        supportsToUnicodeEncoding: Boolean(toUnicodeMap?.textToCode.size),
        toUnicodeMap
      });
    }

    return fonts;
  }

  private findFontDescriptor(fontObject: PDFDict): PDFDict | undefined {
    const directDescriptor = fontObject.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    if (directDescriptor) return directDescriptor;

    const descendants = fontObject.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
    const descendant = descendants?.lookupMaybe(0, PDFDict);
    return descendant?.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
  }

  private readEncoding(fontObject: PDFDict): string | undefined {
    const encoding = fontObject.lookup(PDFName.of("Encoding"));
    if (encoding instanceof PDFName) return encoding.decodeText();
    if (encoding instanceof PDFDict) return readName(encoding, "BaseEncoding");
    return undefined;
  }

  private supportsSimpleAnsiText({
    subtype,
    encoding,
    baseFont,
    isSubset
  }: {
    subtype?: string;
    encoding?: string;
    baseFont?: string;
    isSubset: boolean;
  }): boolean {
    if (isSubset) return false;
    if (subtype === "Type0") return false;
    if (encoding && !["WinAnsiEncoding", "MacRomanEncoding", "StandardEncoding"].includes(encoding)) return false;
    return Boolean(subtype === "Type1" || subtype === "TrueType" || baseFont);
  }

  private decodeStream(stream: PDFStream): Uint8Array {
    if (stream instanceof PDFRawStream) {
      return decodePDFRawStream(stream).decode();
    }
    if (stream instanceof PDFContentStream) {
      return stream.getUnencodedContents();
    }
    return stream.getContents();
  }
}

function readName(dict: PDFDict | undefined, key: string): string | undefined {
  const value = dict?.lookup(PDFName.of(key));
  if (value instanceof PDFName) return value.decodeText();
  return undefined;
}
