# Convert Smith PDF Editor Engine Notes

## Product Direction

Convert Smith must not fake text editing by painting a white rectangle over the original PDF and drawing new text on top.

The PDF editor follows this order:

1. Direct text edit
   - Match the original text in the PDF content stream.
   - Replace or empty the original text token directly.
   - Preserve the original PDF text command and font resource where possible.

2. Replacement-font text object mode
   - Used only when the original text token is matched but the original PDF font cannot encode the new text.
   - The original text token is emptied first.
   - A local font that can cover every replacement glyph is embedded.
   - A new real PDF text object is inserted at the same position.
   - No white rectangle background is drawn.

3. Safe fail mode
   - Used when a PDF is image-only, text matching is ambiguous, no suitable font exists, or the structure is too complex.
   - The app must fail clearly instead of creating a visually fake edit.

## Current Implementation

- `PdfNativeEditOrchestrator` is the primary text-edit save entry for replace/delete edits.
- `PdfDirectTextEditService` still performs the low-level content stream token patching.
- `FontInventoryService` scans local OS font folders and checks glyph coverage before a replacement font is embedded.
- `PdfEditorFontService.resolveEmbeddedFont()` never falls back to Helvetica for replacement-font mode.
- Renderer text edit/delete preview no longer uses text white-cover overlays.

## Current Limitations

- Full PDF operator state tracking is still limited.
- Complex Type3 fonts, clipped text, hidden text, rotated text, and some subset-font cases may fail safely.
- Image/line move tools may still use visual reconstruction for those object types.
- Font collection files such as TTC/OTC are discovered but skipped for embedding unless a reliable embedding path is added.
- The UI does not yet expose a full per-item capability badge or manual font import selector.

## Verification

Use:

```bash
npm run build
npm run smoke:pdf-editor
npm run smoke
```

The PDF editor smoke harness verifies:

- direct Latin text replacement persists,
- replacement-font Korean mode works when a local Korean-capable font is available,
- text replacement paths do not create white rectangle operators.
