# PDF Editing Engine Review

## Current State

- The PDF editor opens in a dedicated viewer window and uses IPC-safe main-process services.
- Text layer/object extraction exists in `PdfEditorService`, `PdfReadingOrderService`, `LocalFontMatchService`, and `PdfEditorObjectDetectionService`.
- Limited native text editing exists under `src/main/pdf-native-edit`, but it must fail clearly when a PDF cannot be edited safely.
- The viewer now requests a single-page PDF.js canvas preview through `pdfEditor:getPagePreview` instead of relying on Chrome PDF iframe layout or hidden PDFium windows.

## Stamp And Signature Scope

- Signature stamping is a PDF tool operation, not a full text editing engine.
- Default signature save must keep the page as PDF content and embed the signature image with `pdf-lib`.
- Page rasterization is allowed only when `flattenSignedPages` is explicitly enabled.

## Not Implemented As Universal Editing

- Complex PDFs, scanned/image PDFs, Type3 fonts, glyph-subset fonts that cannot encode new text, ambiguous repeated text, and vector-outlined text cannot be promised as directly editable.
- Table, image, and line movement currently depend on detected objects and may be limited by the PDF's original structure.

## White-Box Overlay Rule

- White rectangles must not be used as the default way to hide original text.
- If native text neutralization cannot be verified, the operation should fail or fall back to a clearly labeled add-text/stamp mode.
- Temporary HTML overlays are allowed only for selection, active input, drag handles, and immediate visual feedback.

## Flatten Risk

- `flattenSignedPages` converts signed pages into rendered image pages.
- This can destroy text/vector editability for those pages.
- The default is therefore `false`; users must opt into flattening knowingly.
