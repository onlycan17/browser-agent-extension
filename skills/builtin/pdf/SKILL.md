---
name: pdf
description: Use this skill to read, render, merge, split, rotate, or fill PDFs.
icon: https://static.asidehq.com/apps/builtin-skills/pdf.jpg
---

# PDF

Use `aside.pdf` in the REPL.
Always `await` each call before using its result or output files.

```js
await aside.pdf.renderPages({
  filePath: './input.pdf',
  outputDir: './tmp/pdf',
  pages: [1, 3],
  maxDimension: 1600,
});
await aside.pdf.extractText({ filePath: './input.pdf', pages: [1, 3] });
await aside.pdf.merge({
  files: [{ filePath: './a.pdf', pages: [1, 3] }, { filePath: './b.pdf' }],
  outputPath: './artifacts/merged.pdf',
});
await aside.pdf.split({ filePath: './input.pdf', outputDir: './artifacts/pages', pages: [1, 3] });
await aside.pdf.rotate({ filePath: './input.pdf', outputPath: './artifacts/rotated.pdf', pages: [1], degrees: 90 });
await aside.pdf.getFormFields({ filePath: './input.pdf' });
await aside.pdf.fillFormFields({
  filePath: './input.pdf',
  outputPath: './artifacts/filled.pdf',
  fields: [
    { field_id: 'name', value: 'Ada' },
    { field_id: 'age', value: 42 },
    { field_id: 'subscribe', value: true },
    { field_id: 'plan', value: 'premium' },
    { field_id: 'notes', value: null },
  ],
});
```

Parameters and results:

- All `pages` parameters use one-based page numbers and default to every page when omitted.
- `renderPages({ filePath, outputDir, pages?, maxDimension? })`: `maxDimension` accepts 256–4096 pixels (default 1600). Returns each PNG's page, path, width, and height.
- `extractText({ filePath, pages? })`: returns embedded text by page; it does not perform OCR.
- `merge({ files: [{ filePath, pages? }], outputPath })`: preserves file order; omitted `pages` includes every page.
- `split({ filePath, outputDir, pages? })`: creates one PDF per selected page, or every page when omitted.
- `rotate({ filePath, outputPath, degrees, pages? })`: rotates selected or all pages relative to their current orientation. `degrees` accepts `-270`, `-180`, `-90`, `90`, `180`, or `270`.
- `getFormFields({ filePath })`: returns `field_id`, `type`, `options`, and `export_value` for constructing fill input.
- `fillFormFields({ filePath, outputPath, fields })`: each field requires `field_id` and `value`. Values may be strings, numbers, booleans, or `null`; use returned options for choices, booleans for checkboxes, and export-value strings for radio fields. XFA forms are not supported.
