import {
  decodePDFRawStream,
  PDFArray,
  PDFContentStream,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFDocument
} from "pdf-lib";
import type {
  NativePdfEditFallbackReason,
  ParsedPdfContentStream,
  PdfMatrix,
  PdfTextOperator,
  PdfToken
} from "./types.js";

const PDF_OPERATOR_NAMES = new Set([
  "b",
  "B",
  "b*",
  "B*",
  "BDC",
  "BI",
  "BMC",
  "BT",
  "BX",
  "c",
  "cm",
  "CS",
  "cs",
  "d",
  "d0",
  "d1",
  "Do",
  "DP",
  "EI",
  "EMC",
  "ET",
  "EX",
  "f",
  "F",
  "f*",
  "G",
  "g",
  "gs",
  "h",
  "i",
  "ID",
  "j",
  "J",
  "K",
  "k",
  "l",
  "m",
  "M",
  "MP",
  "n",
  "q",
  "Q",
  "re",
  "RG",
  "rg",
  "ri",
  "s",
  "S",
  "SC",
  "sc",
  "SCN",
  "scn",
  "sh",
  "T*",
  "Tc",
  "Td",
  "TD",
  "Tf",
  "Tj",
  "TJ",
  "TL",
  "Tm",
  "Tr",
  "Ts",
  "Tw",
  "Tz",
  "v",
  "w",
  "W",
  "W*",
  "y",
  "'",
  "\""
]);

interface TextGraphicsState {
  ctm: PdfMatrix;
  textMatrix: PdfMatrix;
  lineMatrix: PdfMatrix;
  fontResourceName?: string;
  fontSize?: number;
  fillColor?: string;
  leading: number;
}

interface ParsedOperators {
  operators: PdfTextOperator[];
  unsupportedReason?: NativePdfEditFallbackReason;
}

export class PdfContentStreamParser {
  parseDocument(pdfDoc: PDFDocument): ParsedPdfContentStream[] {
    const streams: ParsedPdfContentStream[] = [];

    pdfDoc.getPages().forEach((page, pageIndex) => {
      const pageNumber = pageIndex + 1;
      const pageHeight = page.getHeight();
      const contents = page.node.get(PDFName.Contents);
      if (!contents) return;

      if (contents instanceof PDFRef) {
        const stream = page.doc.context.lookup(contents, PDFStream);
        streams.push(this.parseStream(pageNumber, pageHeight, page.node, stream, 0, contents));
        return;
      }

      if (contents instanceof PDFArray) {
        for (let index = 0; index < contents.size(); index += 1) {
          const entry = contents.get(index);
          const stream = page.doc.context.lookup(entry, PDFStream);
          streams.push(
            this.parseStream(
              pageNumber,
              pageHeight,
              page.node,
              stream,
              index,
              entry instanceof PDFRef ? entry : undefined,
              contents,
              index
            )
          );
        }
        return;
      }

      if (contents instanceof PDFStream) {
        streams.push(this.parseStream(pageNumber, pageHeight, page.node, contents, 0));
      }
    });

    return streams;
  }

  private parseStream(
    pageNumber: number,
    pageHeight: number,
    pageNode: ParsedPdfContentStream["pageNode"],
    stream: PDFStream,
    streamIndex: number,
    contentRef?: PDFRef,
    contentArray?: PDFArray,
    contentArrayIndex?: number
  ): ParsedPdfContentStream {
    const streamId = `${pageNumber}:${streamIndex}:${contentRef?.toString() || "direct"}`;
    try {
      const decodedBytes = this.decodeStream(stream);
      const decodedSource = bytesToSource(decodedBytes);
      const parsed = this.parseOperators(decodedSource, pageHeight);
      return {
        pageNumber,
        pageHeight,
        streamId,
        streamIndex,
        decodedBytes,
        decodedSource,
        operators: parsed.operators,
        pageNode,
        contentRef,
        contentArray,
        contentArrayIndex,
        contentObject: stream,
        unsupportedReason: parsed.unsupportedReason
      };
    } catch {
      return {
        pageNumber,
        pageHeight,
        streamId,
        streamIndex,
        decodedBytes: new Uint8Array(),
        decodedSource: "",
        operators: [],
        pageNode,
        contentRef,
        contentArray,
        contentArrayIndex,
        contentObject: stream,
        unsupportedReason: "parser_failed"
      };
    }
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

  private parseOperators(source: string, pageHeight: number): ParsedOperators {
    const operators: PdfTextOperator[] = [];
    const state = createDefaultState();
    const graphicsStack: TextGraphicsState[] = [];
    let unsupportedReason: NativePdfEditFallbackReason | undefined;
    let operands: PdfToken[] = [];
    let offset = 0;

    while (offset < source.length) {
      const parsed = parseToken(source, offset);
      if (!parsed) break;
      offset = parsed.nextOffset;

      if (parsed.token.type === "word" && PDF_OPERATOR_NAMES.has(parsed.token.raw)) {
        const operatorName = parsed.token.raw;
        if (operatorName === "BI" || operatorName === "ID") {
          unsupportedReason = "unsupported_content_stream";
          break;
        }

        const combined = multiplyMatrix(state.ctm, state.textMatrix);
        const fontSize = state.fontSize || 0;
        const byteStart = operands[0]?.start ?? parsed.token.start;
        const textOperator: PdfTextOperator = {
          operator: operatorName,
          operatorIndex: operators.length,
          byteStart,
          byteEnd: parsed.token.end,
          raw: source.slice(byteStart, parsed.token.end),
          operands,
          fontResourceName: state.fontResourceName,
          fontSize: state.fontSize,
          fillColor: state.fillColor,
          transformMatrix: [...combined],
          estimatedX: roundPoint(combined[4]),
          estimatedY: roundPoint(pageHeight - combined[5] - fontSize),
          estimatedHeight: roundPoint(fontSize || 0)
        };
        operators.push(textOperator);
        applyOperatorState(operatorName, operands, state, graphicsStack);
        operands = [];
      } else {
        operands.push(parsed.token);
      }
    }

    return { operators, unsupportedReason };
  }
}

function parseToken(source: string, startOffset: number): { token: PdfToken; nextOffset: number } | undefined {
  let offset = skipWhitespaceAndComments(source, startOffset);
  if (offset >= source.length) return undefined;

  const char = source[offset];
  if (char === "(") return parseLiteralString(source, offset);
  if (char === "[") return parseArray(source, offset);
  if (char === "<" && source[offset + 1] !== "<") return parseHexString(source, offset);
  if (char === "/") return parseName(source, offset);

  const end = readRegularTokenEnd(source, offset);
  const raw = source.slice(offset, end);
  const number = parsePdfNumber(raw);
  return {
    token: {
      type: number === undefined ? "word" : "number",
      raw,
      value: number ?? raw,
      start: offset,
      end
    },
    nextOffset: end
  };
}

function parseArray(source: string, start: number): { token: PdfToken; nextOffset: number } {
  const items: PdfToken[] = [];
  let offset = start + 1;
  while (offset < source.length) {
    offset = skipWhitespaceAndComments(source, offset);
    if (source[offset] === "]") {
      const end = offset + 1;
      return {
        token: {
          type: "array",
          raw: source.slice(start, end),
          items,
          start,
          end
        },
        nextOffset: end
      };
    }

    const parsed = parseToken(source, offset);
    if (!parsed) break;
    items.push(parsed.token);
    offset = parsed.nextOffset;
  }

  return {
    token: {
      type: "array",
      raw: source.slice(start, offset),
      items,
      start,
      end: offset
    },
    nextOffset: offset
  };
}

function parseLiteralString(source: string, start: number): { token: PdfToken; nextOffset: number } {
  const bytes: number[] = [];
  let offset = start + 1;
  let depth = 1;

  while (offset < source.length) {
    const code = source.charCodeAt(offset) & 0xff;

    if (code === 0x5c) {
      const escaped = readEscapedLiteralByte(source, offset + 1);
      if (escaped.byte !== undefined) bytes.push(escaped.byte);
      offset = escaped.nextOffset;
      continue;
    }

    if (code === 0x28) {
      depth += 1;
      bytes.push(code);
      offset += 1;
      continue;
    }

    if (code === 0x29) {
      depth -= 1;
      offset += 1;
      if (depth === 0) {
        const byteArray = new Uint8Array(bytes);
        return {
          token: {
            type: "literalString",
            raw: source.slice(start, offset),
            value: source.slice(start + 1, offset - 1),
            decodedText: decodePdfStringBytes(byteArray),
            bytes: byteArray,
            start,
            end: offset
          },
          nextOffset: offset
        };
      }
      bytes.push(code);
      continue;
    }

    bytes.push(code);
    offset += 1;
  }

  const byteArray = new Uint8Array(bytes);
  return {
    token: {
      type: "literalString",
      raw: source.slice(start, offset),
      decodedText: decodePdfStringBytes(byteArray),
      bytes: byteArray,
      start,
      end: offset
    },
    nextOffset: offset
  };
}

function parseHexString(source: string, start: number): { token: PdfToken; nextOffset: number } {
  let offset = start + 1;
  while (offset < source.length && source[offset] !== ">") offset += 1;
  const end = Math.min(source.length, offset + 1);
  const rawHex = source.slice(start + 1, offset).replace(/\s+/g, "");
  const normalizedHex = rawHex.length % 2 === 0 ? rawHex : `${rawHex}0`;
  const bytes = new Uint8Array(normalizedHex.length / 2);
  for (let index = 0; index < normalizedHex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalizedHex.slice(index, index + 2), 16);
  }

  return {
    token: {
      type: "hexString",
      raw: source.slice(start, end),
      value: rawHex,
      decodedText: decodePdfStringBytes(bytes),
      bytes,
      start,
      end
    },
    nextOffset: end
  };
}

function parseName(source: string, start: number): { token: PdfToken; nextOffset: number } {
  const end = readRegularTokenEnd(source, start + 1);
  const raw = source.slice(start, end);
  return {
    token: {
      type: "name",
      raw,
      value: decodePdfName(raw.slice(1)),
      start,
      end
    },
    nextOffset: end
  };
}

function applyOperatorState(
  operator: string,
  operands: PdfToken[],
  state: TextGraphicsState,
  graphicsStack: TextGraphicsState[]
): void {
  if (operator === "q") {
    graphicsStack.push(cloneState(state));
    return;
  }
  if (operator === "Q") {
    const previous = graphicsStack.pop();
    if (previous) Object.assign(state, previous);
    return;
  }
  if (operator === "BT") {
    state.textMatrix = identityMatrix();
    state.lineMatrix = identityMatrix();
    return;
  }
  if (operator === "Tf") {
    const fontName = readNameOperand(operands[0]);
    const fontSize = readNumberOperand(operands[1]);
    if (fontName) state.fontResourceName = fontName;
    if (fontSize !== undefined) state.fontSize = fontSize;
    return;
  }
  if (operator === "Td" || operator === "TD") {
    const tx = readNumberOperand(operands[0]) ?? 0;
    const ty = readNumberOperand(operands[1]) ?? 0;
    if (operator === "TD") state.leading = -ty;
    state.lineMatrix = multiplyMatrix(state.lineMatrix, [1, 0, 0, 1, tx, ty]);
    state.textMatrix = [...state.lineMatrix];
    return;
  }
  if (operator === "Tm") {
    const values = operands.slice(0, 6).map((token) => readNumberOperand(token));
    if (values.every((value): value is number => value !== undefined)) {
      state.textMatrix = [values[0], values[1], values[2], values[3], values[4], values[5]];
      state.lineMatrix = [...state.textMatrix];
    }
    return;
  }
  if (operator === "TL") {
    state.leading = readNumberOperand(operands[0]) ?? state.leading;
    return;
  }
  if (operator === "T*") {
    state.lineMatrix = multiplyMatrix(state.lineMatrix, [1, 0, 0, 1, 0, -state.leading]);
    state.textMatrix = [...state.lineMatrix];
    return;
  }
  if (operator === "cm") {
    const values = operands.slice(0, 6).map((token) => readNumberOperand(token));
    if (values.every((value): value is number => value !== undefined)) {
      state.ctm = multiplyMatrix(state.ctm, [values[0], values[1], values[2], values[3], values[4], values[5]]);
    }
    return;
  }
  if (operator === "rg") {
    state.fillColor = serializeRgb(operands);
    return;
  }
  if (operator === "g") {
    const gray = readNumberOperand(operands[0]);
    if (gray !== undefined) state.fillColor = serializeRgbValue(gray, gray, gray);
  }
}

function readEscapedLiteralByte(source: string, start: number): { byte?: number; nextOffset: number } {
  if (start >= source.length) return { nextOffset: start };
  const char = source[start];
  const code = source.charCodeAt(start) & 0xff;

  if (char === "\n") return { nextOffset: start + 1 };
  if (char === "\r") return { nextOffset: source[start + 1] === "\n" ? start + 2 : start + 1 };
  if (char === "n") return { byte: 0x0a, nextOffset: start + 1 };
  if (char === "r") return { byte: 0x0d, nextOffset: start + 1 };
  if (char === "t") return { byte: 0x09, nextOffset: start + 1 };
  if (char === "b") return { byte: 0x08, nextOffset: start + 1 };
  if (char === "f") return { byte: 0x0c, nextOffset: start + 1 };
  if (char === "(" || char === ")" || char === "\\") return { byte: code, nextOffset: start + 1 };

  if (/[0-7]/.test(char)) {
    let octal = char;
    let offset = start + 1;
    while (offset < source.length && octal.length < 3 && /[0-7]/.test(source[offset])) {
      octal += source[offset];
      offset += 1;
    }
    return { byte: Number.parseInt(octal, 8) & 0xff, nextOffset: offset };
  }

  return { byte: code, nextOffset: start + 1 };
}

function createDefaultState(): TextGraphicsState {
  return {
    ctm: identityMatrix(),
    textMatrix: identityMatrix(),
    lineMatrix: identityMatrix(),
    leading: 0,
    fillColor: "000000"
  };
}

function cloneState(state: TextGraphicsState): TextGraphicsState {
  return {
    ctm: [...state.ctm],
    textMatrix: [...state.textMatrix],
    lineMatrix: [...state.lineMatrix],
    fontResourceName: state.fontResourceName,
    fontSize: state.fontSize,
    fillColor: state.fillColor,
    leading: state.leading
  };
}

function identityMatrix(): PdfMatrix {
  return [1, 0, 0, 1, 0, 0];
}

function multiplyMatrix(left: PdfMatrix, right: PdfMatrix): PdfMatrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
}

function serializeRgb(operands: PdfToken[]): string | undefined {
  const red = readNumberOperand(operands[0]);
  const green = readNumberOperand(operands[1]);
  const blue = readNumberOperand(operands[2]);
  if (red === undefined || green === undefined || blue === undefined) return undefined;
  return serializeRgbValue(red, green, blue);
}

function serializeRgbValue(red: number, green: number, blue: number): string {
  return [red, green, blue]
    .map((value) => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, "0"))
    .join("");
}

function readNameOperand(token?: PdfToken): string | undefined {
  return token?.type === "name" && typeof token.value === "string" ? token.value : undefined;
}

function readNumberOperand(token?: PdfToken): number | undefined {
  return token?.type === "number" && typeof token.value === "number" && Number.isFinite(token.value)
    ? token.value
    : undefined;
}

function parsePdfNumber(raw: string): number | undefined {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readRegularTokenEnd(source: string, start: number): number {
  let offset = start;
  while (offset < source.length && !isWhitespace(source.charCodeAt(offset)) && !isDelimiter(source[offset])) {
    offset += 1;
  }
  return offset;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let offset = start;
  while (offset < source.length) {
    const code = source.charCodeAt(offset);
    if (isWhitespace(code)) {
      offset += 1;
      continue;
    }
    if (source[offset] === "%") {
      while (offset < source.length && source[offset] !== "\n" && source[offset] !== "\r") offset += 1;
      continue;
    }
    break;
  }
  return offset;
}

function isWhitespace(code: number): boolean {
  return code === 0x00 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20;
}

function isDelimiter(char: string): boolean {
  return char === "(" || char === ")" || char === "<" || char === ">" || char === "[" || char === "]" || char === "{" || char === "}" || char === "/" || char === "%";
}

function decodePdfName(value: string): string {
  return value.replace(/#([0-9a-fA-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
}

function decodePdfStringBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return text.normalize("NFC");
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    let text = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      text += String.fromCharCode(bytes[index] | (bytes[index + 1] << 8));
    }
    return text.normalize("NFC");
  }
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("").normalize("NFC");
}

function bytesToSource(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function roundPoint(value: number): number {
  return Math.round(value * 100) / 100;
}
