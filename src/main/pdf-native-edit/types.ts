import type {
  PDFArray,
  PDFPageLeaf,
  PDFRawStream,
  PDFRef,
  PDFStream
} from "pdf-lib";
import type { PdfEditorEdit } from "../types/conversion.js";

export type NativePdfEditMode = "native_text_edit" | "surface_overlay_edit" | "failed";

export type NativePdfEditFallbackReason =
  | "image_only_pdf"
  | "text_span_not_found"
  | "no_to_unicode_map"
  | "unsupported_font_encoding"
  | "replacement_too_long"
  | "multi_operator_text"
  | "rotated_or_complex_transform"
  | "parser_failed"
  | "encrypted_pdf"
  | "unsupported_content_stream"
  | "non_replace_edit"
  | "geometry_changed"
  | "ambiguous_text_span"
  | "native_patch_failed"
  | "verification_failed";

export interface NativePdfEditRequest {
  sourcePath: string;
  outputPath: string;
  edits: PdfEditorEdit[];
}

export interface NativePdfEditResult {
  mode: NativePdfEditMode;
  outputPath?: string;
  editedCount: number;
  deletedCount: number;
  addedCount: number;
  warnings: string[];
  capabilities: NativePdfEditCapability[];
}

export interface NativePdfTextSpan {
  pageNumber: number;
  sourceIndex: number;
  streamId: string;
  streamIndex: number;
  operatorIndex: number;
  operator: "Tj" | "TJ";
  rawOperator: string;
  decodedText: string;
  fontResourceName?: string;
  fontSize?: number;
  fillColor?: string;
  transformMatrix: PdfMatrix;
  estimatedX: number;
  estimatedY: number;
  estimatedWidth: number;
  estimatedHeight: number;
  encodedKind: "literal" | "hex" | "array";
  encodedStart: number;
  encodedEnd: number;
  encodedBytes: Uint8Array;
}

export interface NativePdfEditCapability {
  edit: PdfEditorEdit;
  directEditable: boolean;
  reason?: NativePdfEditFallbackReason;
  detail?: string;
  matchedSpan?: NativePdfTextSpan;
}

export interface PdfContentStreamPatch {
  pageNumber: number;
  streamId: string;
  operatorIndex: number;
  encodedStart: number;
  encodedEnd: number;
  replacementBytes: Uint8Array;
  originalText: string;
  replacementText: string;
}

export interface ParsedPdfContentStream {
  pageNumber: number;
  pageHeight: number;
  streamId: string;
  streamIndex: number;
  decodedBytes: Uint8Array;
  decodedSource: string;
  operators: PdfTextOperator[];
  pageNode: PDFPageLeaf;
  contentRef?: PDFRef;
  contentArray?: PDFArray;
  contentArrayIndex?: number;
  contentObject: PDFRawStream | PDFStream;
  unsupportedReason?: NativePdfEditFallbackReason;
}

export interface PdfTextOperator {
  operator: string;
  operatorIndex: number;
  byteStart: number;
  byteEnd: number;
  raw: string;
  operands: PdfToken[];
  fontResourceName?: string;
  fontSize?: number;
  fillColor?: string;
  transformMatrix: PdfMatrix;
  estimatedX: number;
  estimatedY: number;
  estimatedHeight: number;
}

export interface PdfToken {
  type: "array" | "hexString" | "literalString" | "name" | "number" | "word" | "other";
  raw: string;
  value?: string | number;
  decodedText?: string;
  bytes?: Uint8Array;
  items?: PdfToken[];
  start: number;
  end: number;
}

export interface PdfFontInfo {
  pageNumber: number;
  resourceName: string;
  subtype?: string;
  baseFont?: string;
  encoding?: string;
  hasToUnicode: boolean;
  isEmbedded: boolean;
  isSubset: boolean;
  supportsSimpleAnsiText: boolean;
}

export type PdfFontMap = Map<string, PdfFontInfo>;

export type PdfMatrix = [number, number, number, number, number, number];

export interface PdfEditVerificationRequest {
  outputPath: string;
  expectedReplacementTexts?: string[];
}

export interface PdfEditVerificationResult {
  ok: boolean;
  message: string;
  details?: string;
}
