import type { PDFDocument } from "pdf-lib";
import PDFArray from "pdf-lib/cjs/core/objects/PDFArray";
import PDFDict from "pdf-lib/cjs/core/objects/PDFDict";
import PDFName from "pdf-lib/cjs/core/objects/PDFName";
import PDFRawStream from "pdf-lib/cjs/core/objects/PDFRawStream";
import PDFRef from "pdf-lib/cjs/core/objects/PDFRef";
import PDFStream from "pdf-lib/cjs/core/objects/PDFStream";
import PDFContentStream from "pdf-lib/cjs/core/structures/PDFContentStream";
import { decodePDFRawStream } from "pdf-lib/cjs/core/streams/decode";
import type { PdfEditorEdit } from "../types/conversion.js";

interface DirectTextEditResult {
  replacedCount: number;
  deletedCount: number;
}

interface ReplacementPatch {
  start: number;
  end: number;
  value: string;
}

interface FontCodec {
  fontResourceName: string;
  decode: (bytes: number[]) => string;
  encode: (text: string) => number[];
}

interface TextCandidate {
  pageNumber: number;
  streamIndex: number;
  order: number;
  text: string;
  token: PdfToken;
  textToken?: PdfToken;
  stringTokens: PdfToken[];
  operator: "Tj" | "TJ" | "'" | "\"";
  fontResourceName?: string;
  fontCodec?: FontCodec;
}

interface CandidateMatch {
  candidate: TextCandidate;
  original: string;
}

interface PdfToken {
  type: "string" | "hex" | "array" | "word" | "name";
  raw: string;
  start: number;
  end: number;
  elements?: PdfToken[];
}

const TEXT_OPERATORS = new Set(["Tj", "TJ", "'", "\""]);
const CANDIDATE_NOT_FOUND_MESSAGE = [
  "원본 PDF의 텍스트 명령을 찾지 못해 저장을 중단했습니다.",
  "기존 텍스트를 흰 박스로 덮어쓰는 방식은 사용하지 않았고, 원본 파일은 변경하지 않았습니다."
].join("\n");

/**
 * @deprecated Legacy direct patcher retained for reference only.
 * NativePdfTextEditEngine is the primary PDF text save path.
 */
export class PdfDirectTextEditService {
  apply(pdfDoc: PDFDocument, edits: PdfEditorEdit[]): DirectTextEditResult {
    const textEdits = edits.filter((edit) => edit.action === "replace" || edit.action === "delete");
    if (textEdits.length === 0) return { replacedCount: 0, deletedCount: 0 };

    const pages = pdfDoc.getPages();
    let replacedCount = 0;
    let deletedCount = 0;

    for (const [pageNumber, pageEdits] of groupEditsByPage(textEdits)) {
      const page = pages[pageNumber - 1];
      if (!page) throw new Error(`${pageNumber}페이지를 찾지 못해 PDF 직접 편집을 중단했습니다.`);

      const contentStreams = getPageContentStreams(page);
      const streamStates = createContentStreamStates(contentStreams);
      const fontCodecs = createPageFontCodecs(page);
      const candidates = streamStates.flatMap((state) =>
        extractTextCandidates(state.content, pageNumber, state.streamIndex, fontCodecs)
      );
      const usedCandidates = new Set<TextCandidate>();

      for (const edit of pageEdits) {
        const match = findBestCandidate(candidates, usedCandidates, edit);
        if (!match) {
          throw new Error(
            [
              CANDIDATE_NOT_FOUND_MESSAGE,
              `대상 텍스트: ${summarizeText(edit.originalText || "")}`
            ].join("\n")
          );
        }

        const replacement = edit.action === "delete" ? "" : (edit.replacementText || "").normalize("NFC");
        const nextText = buildCandidateReplacementText(match.candidate.text, match.original, replacement);
        const patch = createTextCommandPatch(match.candidate, nextText);
        streamStates[match.candidate.streamIndex].patches.push(patch);
        usedCandidates.add(match.candidate);

        if (edit.action === "delete") deletedCount += 1;
        if (edit.action === "replace") replacedCount += 1;
      }

      for (const state of streamStates) {
        if (state.patches.length === 0) continue;
        const nextContent = applyPatches(state.content, state.patches);
        const nextStream = (pdfDoc as any).context.flateStream(Buffer.from(nextContent, "binary"));
        const nextRef = (pdfDoc as any).context.register(nextStream);
        contentStreams.set(state.streamIndex, nextRef);
      }
    }

    return { replacedCount, deletedCount };
  }
}

function getPageContentStreams(page: any): PDFArray {
  const contents = page.node.normalizedEntries().Contents;
  if (!contents || typeof contents.size !== "function") {
    throw new Error("PDF 페이지 content stream을 찾지 못했습니다.");
  }
  return contents;
}

function createContentStreamStates(contentStreams: PDFArray): Array<{
  streamIndex: number;
  stream: any;
  content: string;
  patches: ReplacementPatch[];
}> {
  const states: Array<{
    streamIndex: number;
    stream: any;
    content: string;
    patches: ReplacementPatch[];
  }> = [];

  for (let streamIndex = 0; streamIndex < contentStreams.size(); streamIndex += 1) {
    const stream = contentStreams.lookup(streamIndex);
    states.push({
      streamIndex,
      stream,
      content: decodeStreamBytes(stream),
      patches: []
    });
  }

  return states;
}

function createPageFontCodecs(page: any): Map<string, FontCodec> {
  const codecs = new Map<string, FontCodec>();
  const fontDict = page.node.normalizedEntries().Font;
  if (!isPdfDictLike(fontDict)) return codecs;

  for (const [fontNameObject, fontObject] of fontDict.entries()) {
    const fontResourceName = decodeNameObject(fontNameObject);
    const font = resolvePdfObject(fontDict.context, fontObject);
    if (!isPdfDictLike(font)) continue;

    const toUnicode = lookupDictObject(font, "ToUnicode");
    if (!toUnicode) continue;

    try {
      const cmapSource = decodeStreamBytes(toUnicode);
      const codec = createToUnicodeCodec(fontResourceName, cmapSource);
      if (codec) codecs.set(fontResourceName, codec);
    } catch {
      // A broken CMap should not break page loading; this font will use the simple byte fallback.
    }
  }

  return codecs;
}

function extractTextCandidates(
  content: string,
  pageNumber: number,
  streamIndex: number,
  fontCodecs: Map<string, FontCodec>
): TextCandidate[] {
  const tokens = tokenizePdfContent(content, 0, content.length);
  const candidates: TextCandidate[] = [];
  const operands: PdfToken[] = [];
  let activeFontName: string | undefined;
  let order = 0;

  for (const token of tokens) {
    if (token.type === "word" && !isOperandWord(token.raw)) {
      if (token.raw === "Tf") {
        const fontToken = [...operands].reverse().find((item) => item.type === "name");
        activeFontName = fontToken ? decodePdfNameToken(fontToken.raw) : activeFontName;
      }

      if (TEXT_OPERATORS.has(token.raw)) {
        const candidate = createCandidateFromOperator(
          token.raw as TextCandidate["operator"],
          operands,
          pageNumber,
          streamIndex,
          order,
          activeFontName,
          activeFontName ? fontCodecs.get(activeFontName) : undefined
        );
        order += 1;
        if (candidate) candidates.push(candidate);
      }

      operands.length = 0;
      continue;
    }
    operands.push(token);
  }

  return candidates;
}

function createCandidateFromOperator(
  operator: TextCandidate["operator"],
  operands: PdfToken[],
  pageNumber: number,
  streamIndex: number,
  order: number,
  fontResourceName?: string,
  fontCodec?: FontCodec
): TextCandidate | undefined {
  if (operator === "TJ") {
    const token = operands[operands.length - 1];
    if (!token || token.type !== "array") return undefined;
    const stringTokens = (token.elements || []).filter((item) => item.type === "string" || item.type === "hex");
    const text = normalizePdfDisplayText(stringTokens.map((item) => decodeTextToken(item, fontCodec)).join(""));
    if (!text) return undefined;
    return { pageNumber, streamIndex, order, text, token, stringTokens, operator, fontResourceName, fontCodec };
  }

  const token = operands[operands.length - 1];
  if (!token || (token.type !== "string" && token.type !== "hex")) return undefined;
  const text = normalizePdfDisplayText(decodeTextToken(token, fontCodec));
  if (!text) return undefined;
  return {
    pageNumber,
    streamIndex,
    order,
    text,
    token,
    textToken: token,
    stringTokens: [token],
    operator,
    fontResourceName,
    fontCodec
  };
}

function findBestCandidate(
  candidates: TextCandidate[],
  usedCandidates: Set<TextCandidate>,
  edit: PdfEditorEdit
): CandidateMatch | undefined {
  const original = normalizePdfDisplayText(edit.originalText || "");
  if (!original) return undefined;

  const exactMatches = candidates
    .filter((candidate) => !usedCandidates.has(candidate) && candidate.text === original)
    .map((candidate) => ({ candidate, original }));
  if (exactMatches.length > 0) return chooseSourceIndexMatch(exactMatches, edit.sourceIndex);

  const containingMatches = candidates
    .filter((candidate) => !usedCandidates.has(candidate) && candidate.text.includes(original))
    .map((candidate) => ({ candidate, original }));
  if (containingMatches.length > 0) return chooseSourceIndexMatch(containingMatches, edit.sourceIndex);

  return undefined;
}

function chooseSourceIndexMatch(matches: CandidateMatch[], sourceIndex: number | undefined): CandidateMatch {
  if (matches.length <= 1 || sourceIndex === undefined) return matches[0];
  return [...matches].sort(
    (a, b) => Math.abs(a.candidate.order - sourceIndex) - Math.abs(b.candidate.order - sourceIndex)
  )[0];
}

function buildCandidateReplacementText(candidateText: string, originalText: string, replacement: string): string {
  if (candidateText === originalText) return replacement;
  const index = candidateText.indexOf(originalText);
  if (index < 0) return replacement;
  return `${candidateText.slice(0, index)}${replacement}${candidateText.slice(index + originalText.length)}`;
}

function createTextCommandPatch(candidate: TextCandidate, nextText: string): ReplacementPatch {
  if (candidate.operator === "TJ") {
    return {
      start: candidate.token.start,
      end: candidate.token.end,
      value: encodeReplacementArrayForCandidate(candidate, nextText)
    };
  }

  const token = candidate.textToken;
  if (!token) throw new Error("PDF 텍스트 operand를 찾지 못했습니다.");
  return {
    start: token.start,
    end: token.end,
    value: encodeReplacementForCandidate(candidate, nextText)
  };
}

function encodeReplacementArrayForCandidate(candidate: TextCandidate, replacement: string): string {
  if (!replacement) return "[]";
  const elements = candidate.token.elements || [];
  const stringTokens = elements.filter((item) => item.type === "string" || item.type === "hex");
  if (stringTokens.length === 0) {
    return `[${encodeReplacementForCandidate(candidate, replacement)}]`;
  }

  const replacementChars = Array.from(replacement);
  let offset = 0;
  let hasEmittedText = false;
  const parts: string[] = [];
  const lastStringToken = stringTokens[stringTokens.length - 1];

  for (const element of elements) {
    if (element.type === "string" || element.type === "hex") {
      const originalLength = Math.max(0, Array.from(decodeTextToken(element, candidate.fontCodec)).length);
      const takeCount = element === lastStringToken
        ? replacementChars.length - offset
        : Math.min(originalLength, replacementChars.length - offset);
      const chunk = replacementChars.slice(offset, offset + Math.max(0, takeCount)).join("");
      offset += Math.max(0, takeCount);
      if (chunk) {
        parts.push(encodeReplacementForToken(candidate, element, chunk));
        hasEmittedText = true;
      }
      continue;
    }

    if (!hasEmittedText || offset >= replacementChars.length) continue;
    parts.push(element.raw);
  }

  if (offset < replacementChars.length) {
    parts.push(encodeReplacementForToken(candidate, lastStringToken, replacementChars.slice(offset).join("")));
  }

  return parts.length ? `[${parts.join(" ")}]` : "[]";
}

function encodeReplacementForCandidate(candidate: TextCandidate, replacement: string): string {
  return encodeReplacementForToken(candidate, candidate.stringTokens[0] || candidate.textToken, replacement);
}

function encodeReplacementForToken(candidate: TextCandidate, token: PdfToken | undefined, replacement: string): string {
  if (candidate.fontCodec) {
    if (!replacement) return "<>";
    try {
      return `<${bytesToHex(candidate.fontCodec.encode(replacement))}>`;
    } catch (error) {
      throw new Error(
        [
          "수정한 텍스트를 원본 PDF 폰트 코드로 다시 매핑하지 못했습니다.",
          "기존 텍스트를 흰 박스로 덮어쓰는 방식은 사용하지 않았고, 원본 파일은 변경하지 않았습니다.",
          error instanceof Error ? `상세: ${error.message}` : undefined
        ].filter(Boolean).join("\n")
      );
    }
  }

  if (!token || token.type === "string") return encodeLiteralPdfString(replacement);
  if (!replacement) return "<>";
  const decoded = decodeHexTokenBytes(token.raw);
  if (isUtf16Be(decoded)) {
    return `<${bytesToHex(encodeUtf16BeWithBom(replacement))}>`;
  }
  assertLatin1Replacement(replacement);
  return `<${bytesToHex(Array.from(Buffer.from(replacement, "binary")))}>`;
}

function createToUnicodeCodec(fontResourceName: string, cmapSource: string): FontCodec | undefined {
  const codeToText = parseToUnicodeCMap(cmapSource);
  if (codeToText.size === 0) return undefined;

  const reverseEntries = new Map<string, string>();
  for (const [code, text] of codeToText) {
    if (!reverseEntries.has(text)) reverseEntries.set(text, code);
  }
  const reverseKeys = [...reverseEntries.keys()].sort((a, b) => b.length - a.length);
  const codeByteLengths = [...new Set([...codeToText.keys()].map((key) => key.length / 2))]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a);

  return {
    fontResourceName,
    decode(bytes) {
      let index = 0;
      let text = "";
      while (index < bytes.length) {
        let matched = false;
        for (const byteLength of codeByteLengths) {
          const slice = bytes.slice(index, index + byteLength);
          if (slice.length !== byteLength) continue;
          const key = bytesToHex(slice);
          const value = codeToText.get(key);
          if (value !== undefined) {
            text += value;
            index += byteLength;
            matched = true;
            break;
          }
        }
        if (!matched) {
          text += String.fromCharCode(bytes[index]);
          index += 1;
        }
      }
      return text;
    },
    encode(text) {
      const bytes: number[] = [];
      let index = 0;
      while (index < text.length) {
        let matched = false;
        for (const key of reverseKeys) {
          if (!text.startsWith(key, index)) continue;
          bytes.push(...hexToBytes(reverseEntries.get(key)!));
          index += key.length;
          matched = true;
          break;
        }
        if (!matched) {
          const char = Array.from(text.slice(index))[0] || "";
          throw new Error(
            `'${char}' 문자는 원본 PDF 폰트의 ToUnicode 매핑에서 역변환할 수 없습니다. 해당 글자가 원본 PDF 폰트에 포함되어 있지 않을 수 있습니다.`
          );
        }
      }
      return bytes;
    }
  };
}

function parseToUnicodeCMap(cmapSource: string): Map<string, string> {
  const tokens = tokenizeCMap(cmapSource);
  const map = new Map<string, string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "beginbfchar") {
      index += 1;
      while (index + 1 < tokens.length && tokens[index] !== "endbfchar") {
        const source = normalizeHexToken(tokens[index]);
        const target = normalizeHexToken(tokens[index + 1]);
        if (source && target) map.set(source, decodeUnicodeHex(target));
        index += 2;
      }
      continue;
    }

    if (token === "beginbfrange") {
      index += 1;
      while (index + 2 < tokens.length && tokens[index] !== "endbfrange") {
        const start = normalizeHexToken(tokens[index]);
        const end = normalizeHexToken(tokens[index + 1]);
        if (!start || !end) {
          index += 1;
          continue;
        }
        index += 2;

        if (tokens[index] === "[") {
          index += 1;
          let code = Number.parseInt(start, 16);
          const endCode = Number.parseInt(end, 16);
          while (index < tokens.length && tokens[index] !== "]" && code <= endCode) {
            const target = normalizeHexToken(tokens[index]);
            if (target) map.set(numberToHex(code, start.length), decodeUnicodeHex(target));
            code += 1;
            index += 1;
          }
          while (index < tokens.length && tokens[index] !== "]") index += 1;
          if (tokens[index] === "]") index += 1;
          continue;
        }

        const target = normalizeHexToken(tokens[index]);
        if (target) {
          const startCode = Number.parseInt(start, 16);
          const endCode = Number.parseInt(end, 16);
          const targetCode = Number.parseInt(target, 16);
          for (let code = startCode; code <= endCode; code += 1) {
            map.set(numberToHex(code, start.length), decodeUnicodeHex(numberToHex(targetCode + code - startCode, target.length)));
          }
        }
        index += 1;
      }
    }
  }

  return map;
}

function tokenizeCMap(source: string): string[] {
  return source
    .replace(/%[^\r\n]*/g, " ")
    .match(/<[^>]+>|\[|\]|[^\s\[\]<]+/g) || [];
}

function decodeTextToken(token: PdfToken, fontCodec?: FontCodec): string {
  const bytes = token.type === "hex" ? decodeHexTokenBytes(token.raw) : decodeLiteralTokenBytes(token.raw);
  if (fontCodec) return fontCodec.decode(bytes);
  return decodeBytesToText(bytes);
}

function decodeStreamBytes(stream: any): string {
  if (stream instanceof PDFRawStream) {
    return Buffer.from(decodePDFRawStream(stream).decode()).toString("binary");
  }
  if (stream instanceof PDFContentStream || typeof stream?.getUnencodedContents === "function") {
    return Buffer.from(stream.getUnencodedContents()).toString("binary");
  }
  if (stream instanceof PDFStream || typeof stream?.getContents === "function") {
    return Buffer.from(stream.getContents()).toString("binary");
  }
  throw new Error("지원하지 않는 PDF stream 형식입니다.");
}

function lookupDictObject(dict: PDFDict | any, key: string): any {
  const value = dict.get(PDFName.of(key));
  return value ? resolvePdfObject(dict.context, value) : undefined;
}

function resolvePdfObject(context: any, object: any): any {
  if (
    object instanceof PDFRef ||
    (object && typeof object.objectNumber === "number" && typeof object.generationNumber === "number")
  ) {
    return context.lookup(object);
  }
  return object;
}

function applyPatches(content: string, patches: ReplacementPatch[]): string {
  return [...patches]
    .sort((a, b) => b.start - a.start)
    .reduce((next, patch) => `${next.slice(0, patch.start)}${patch.value}${next.slice(patch.end)}`, content);
}

function tokenizePdfContent(content: string, start: number, end: number): PdfToken[] {
  const tokens: PdfToken[] = [];
  let index = start;

  while (index < end) {
    index = skipWhitespaceAndComments(content, index, end);
    if (index >= end) break;

    const char = content[index];
    if (char === "(") {
      const token = readLiteralString(content, index, end);
      tokens.push(token);
      index = token.end;
      continue;
    }
    if (char === "<" && content[index + 1] !== "<") {
      const token = readHexString(content, index, end);
      tokens.push(token);
      index = token.end;
      continue;
    }
    if (char === "[") {
      const token = readArray(content, index, end);
      tokens.push(token);
      index = token.end;
      continue;
    }
    if (char === "/") {
      const token = readNameToken(content, index, end);
      tokens.push(token);
      index = token.end;
      continue;
    }

    const token = readRegularToken(content, index, end, "word");
    tokens.push(token);
    index = token.end;
  }

  return tokens;
}

function readLiteralString(content: string, start: number, end: number): PdfToken {
  let index = start + 1;
  let depth = 1;
  let escaped = false;
  while (index < end) {
    const char = content[index];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        index += 1;
        break;
      }
    }
    index += 1;
  }
  return { type: "string", raw: content.slice(start, index), start, end: index };
}

function readHexString(content: string, start: number, end: number): PdfToken {
  let index = start + 1;
  while (index < end && content[index] !== ">") index += 1;
  if (index < end) index += 1;
  return { type: "hex", raw: content.slice(start, index), start, end: index };
}

function readArray(content: string, start: number, end: number): PdfToken {
  let index = start + 1;
  let depth = 1;
  while (index < end && depth > 0) {
    const char = content[index];
    if (char === "(") {
      index = readLiteralString(content, index, end).end;
      continue;
    }
    if (char === "<" && content[index + 1] !== "<") {
      index = readHexString(content, index, end).end;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    index += 1;
  }
  const tokenEnd = index;
  return {
    type: "array",
    raw: content.slice(start, tokenEnd),
    start,
    end: tokenEnd,
    elements: tokenizePdfContent(content, start + 1, Math.max(start + 1, tokenEnd - 1))
  };
}

function readRegularToken(content: string, start: number, end: number, type: "word" | "name"): PdfToken {
  let index = start;
  while (index < end && !isDelimiter(content[index])) index += 1;
  if (index === start) index += 1;
  return { type, raw: content.slice(start, index), start, end: index };
}

function readNameToken(content: string, start: number, end: number): PdfToken {
  let index = start + 1;
  while (index < end && !isDelimiter(content[index])) index += 1;
  return { type: "name", raw: content.slice(start, Math.max(start + 1, index)), start, end: Math.max(start + 1, index) };
}

function skipWhitespaceAndComments(content: string, start: number, end: number): number {
  let index = start;
  while (index < end) {
    const char = content[index];
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (char === "%") {
      while (index < end && content[index] !== "\n" && content[index] !== "\r") index += 1;
      continue;
    }
    break;
  }
  return index;
}

function decodeLiteralTokenBytes(raw: string): number[] {
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const code = body.charCodeAt(index) & 0xff;
    if (body[index] !== "\\") {
      bytes.push(code);
      continue;
    }
    const next = body[++index];
    if (next === undefined) break;
    if (next === "n") bytes.push(0x0a);
    else if (next === "r") bytes.push(0x0d);
    else if (next === "t") bytes.push(0x09);
    else if (next === "b") bytes.push(0x08);
    else if (next === "f") bytes.push(0x0c);
    else if (next === "\r" || next === "\n") {
      if (next === "\r" && body[index + 1] === "\n") index += 1;
    } else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let count = 0; count < 2 && /[0-7]/.test(body[index + 1] || ""); count += 1) {
        octal += body[++index];
      }
      bytes.push(Number.parseInt(octal, 8) & 0xff);
    } else {
      bytes.push(next.charCodeAt(0) & 0xff);
    }
  }
  return bytes;
}

function decodeHexTokenBytes(raw: string): number[] {
  return hexToBytes(normalizeHexToken(raw) || "");
}

function decodeBytesToText(bytes: number[]): string {
  if (isUtf16Be(bytes)) return decodeUtf16Be(bytes.slice(2));
  return String.fromCharCode(...bytes);
}

function encodeLiteralPdfString(text: string): string {
  if (!text) return "()";
  assertLatin1Replacement(text);
  return `(${Array.from(text).map(escapeLiteralChar).join("")})`;
}

function escapeLiteralChar(char: string): string {
  if (char === "\\") return "\\\\";
  if (char === "(") return "\\(";
  if (char === ")") return "\\)";
  if (char === "\n") return "\\n";
  if (char === "\r") return "\\r";
  const code = char.charCodeAt(0);
  if (code < 0x20 || code > 0xff) return `\\${code.toString(8).padStart(3, "0").slice(-3)}`;
  return char;
}

function assertLatin1Replacement(text: string): void {
  for (const char of Array.from(text)) {
    if (char.charCodeAt(0) > 0xff) {
      throw new Error(
        [
          "현재 원본 텍스트 명령은 이 문자를 직접 교체할 수 있는 폰트 매핑을 제공하지 않습니다.",
          "흰 배경 덮어쓰기 방식으로 저장하지 않기 위해 변환을 중단했습니다.",
          "한글/특수문자는 PDF 내부 폰트 CMap 직접 매핑이 가능한 경우에만 저장됩니다."
        ].join("\n")
      );
    }
  }
}

function encodeUtf16BeWithBom(text: string): number[] {
  const bytes = [0xfe, 0xff];
  for (const char of Array.from(text)) {
    const code = char.charCodeAt(0);
    bytes.push((code >> 8) & 0xff, code & 0xff);
  }
  return bytes;
}

function decodeUtf16Be(bytes: number[]): string {
  let text = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  }
  return text;
}

function decodeUnicodeHex(hex: string): string {
  return decodeUtf16Be(hexToBytes(hex));
}

function isUtf16Be(bytes: number[]): boolean {
  return bytes[0] === 0xfe && bytes[1] === 0xff;
}

function isOperandWord(value: string): boolean {
  return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value) || value === "true" || value === "false" || value === "null";
}

function isDelimiter(char: string): boolean {
  return isWhitespace(char) || "()<>[]{}/%".includes(char);
}

function isWhitespace(char: string): boolean {
  return char === "\x00" || char === "\t" || char === "\n" || char === "\f" || char === "\r" || char === " ";
}

function normalizePdfDisplayText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().normalize("NFC");
}

function normalizeHexToken(raw: string): string | undefined {
  if (!raw.startsWith("<") || !raw.endsWith(">")) return undefined;
  let hex = raw.slice(1, -1).replace(/\s+/g, "").toUpperCase();
  if (!/^[0-9A-F]*$/.test(hex)) return undefined;
  if (hex.length % 2) hex += "0";
  return hex;
}

function hexToBytes(hex: string): number[] {
  const normalized = hex.replace(/\s+/g, "").toUpperCase();
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    const pair = normalized.slice(index, index + 2);
    if (!pair) continue;
    bytes.push(Number.parseInt(pair.padEnd(2, "0"), 16) & 0xff);
  }
  return bytes;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((byte) => (byte & 0xff).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function numberToHex(value: number, width: number): string {
  return Math.max(0, value).toString(16).padStart(width, "0").slice(-width).toUpperCase();
}

function decodeNameObject(name: PDFName): string {
  if (typeof name?.decodeText === "function") return name.decodeText().replace(/^\//, "");
  return String(name || "").replace(/^\//, "");
}

function isPdfDictLike(value: unknown): value is PDFDict {
  return Boolean(
    value &&
    typeof (value as PDFDict).entries === "function" &&
    typeof (value as PDFDict).get === "function" &&
    (value as PDFDict).context
  );
}

function decodePdfNameToken(raw: string): string {
  return raw.slice(1).replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
}

function groupEditsByPage(edits: PdfEditorEdit[]): Map<number, PdfEditorEdit[]> {
  const grouped = new Map<number, PdfEditorEdit[]>();
  for (const edit of edits) {
    const bucket = grouped.get(edit.pageNumber) || [];
    bucket.push(edit);
    grouped.set(edit.pageNumber, bucket);
  }
  return grouped;
}

function summarizeText(text: string): string {
  const normalized = normalizePdfDisplayText(text);
  return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
}
