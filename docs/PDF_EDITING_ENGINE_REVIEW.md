# PDF Editing Engine Review

## Current State

- The PDF editor opens in a dedicated viewer window and uses IPC-safe main-process services.
- Text layer/object extraction exists in `PdfEditorService`, `PdfReadingOrderService`, `LocalFontMatchService`, and `PdfEditorObjectDetectionService`.
- Native text editing now uses a hybrid pipeline under `src/main/pdf-native-edit`.
- `NativePdfTextEditEngine` is the primary save path for text replace/delete/add planning.
- `PdfNativeEditOrchestrator` is only a compatibility adapter and delegates to `NativePdfTextEditEngine`.
- The viewer now requests a single-page PDF.js canvas preview through `pdfEditor:getPagePreview` instead of relying on Chrome PDF iframe layout or hidden PDFium windows.

## Hybrid Editing Contract

Convert Smith keeps the fast overlay-style editing UX, but saving is limited to operations that can be represented as real PDF edits.

- UI overlays are allowed for selection, typing, handles, drag preview, and immediate feedback.
- Text saves must use native content stream patching.
- Existing text replacement uses `nativeSpanId` when a PDF.js text item can be matched to one native text span.
- If the original font can encode the replacement and geometry did not move, save mode is `direct_replace`.
- Text deletion patches the original text token to empty through `delete_original`.
- Text movement or replacement requiring a different font uses `neutralize_and_insert`: the original text command is emptied, then a real embedded-font PDF text object is inserted.
- New text uses `add_text` with a local embeddable font.
- Unsupported edits stop the whole save. Partial save is not used.

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

## Image, Line, And Table Scope

- Image, line, and table detection may be shown in the UI for inspection and preview.
- Image/line/table movement or deletion is save-limited unless a real native object patch exists.
- The editor must not save these edits by drawing white rectangles over the original content.

## Verification

After saving, Convert Smith verifies:

- The output is still a valid PDF.
- Obvious editor-created white rectangle cover-up operators are not present in the text edit path.
- A visual diff compares edited pages and ignores only the edited bounding boxes with padding.
- If verification fails, the incomplete output file is deleted and the save fails safely.

## Flatten Risk

- `flattenSignedPages` converts signed pages into rendered image pages.
- This can destroy text/vector editability for those pages.
- The default is therefore `false`; users must opt into flattening knowingly.
