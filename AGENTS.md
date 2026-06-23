# AGENTS.md

## Convert Smith PDF Editing Safety Rules

These rules are mandatory for every future change to the PDF editor.

1. Never implement PDF editing by rasterizing the page and drawing text, images, or lines on top of that raster image as the saved result.
2. Never use white rectangles, opaque masks, transparent masks, or image-backed cover-ups to hide original PDF content during save.
3. Existing PDF text edits must save through native PDF content-stream/object patching, or fail safely with a clear Korean message.
4. If a text edit cannot be safely applied to the original PDF text command, the allowed fallback is:
   - neutralize the original text command if safe, and
   - insert a real embedded-font PDF text object at the target position.
5. Image, line, and table edits must not be saved unless native object patching is implemented. UI selection/preview is allowed, but fake visual reconstruction is forbidden by default.
6. Overlay UI may be used only for selection handles, caret/input capture, drag handles, warnings, and temporary interaction controls. Overlay UI must not be treated as the saved PDF content.
7. For edit preview, prefer a real temporary PDF copy created by the native edit engine and opened in the viewer. Do not use screenshot/canvas/image compositing as the authoritative preview or save path.
8. When a direct edit is unsafe or ambiguous, stop saving. Do not partially save a fake-looking result.

Violation of these rules is a blocking bug, not a UI polish issue.
