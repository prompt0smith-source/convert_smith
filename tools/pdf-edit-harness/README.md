# PDF Edit Harness

This harness runs the PDF editor safety smoke tests used by Convert Smith.

Commands:

- `npm run test:pdf-edit-harness`
- `npm run smoke:pdf-edit-harness`

The current harness delegates to `scripts/pdf-editor-smoke.mjs` and verifies:

- direct text replacement on a generated PDF fixture
- replacement-font path for text that cannot be encoded by the original font
- saved PDF validation

Fixtures and generated output should stay local and must not use copyrighted external PDFs.
