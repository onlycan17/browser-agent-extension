---
name: xlsx
description: Use this skill whenever an .xlsx or .xlsm workbook must be read, created, inspected, or edited, including formulas, formatting, charts, images, comments, validation, links, macros, and workbook metadata.
icon: https://static.asidehq.com/apps/builtin-skills/xlsx.svg
license: Proprietary. LICENSE.txt has complete terms
---

# Requirements for outputs

Use bundled pandas for tabular analysis and `openpyxl` for workbook structure and
editing. An XLSX/XLSM is an OOXML ZIP package, so use Python's standard `zipfile`
and XML parsing for package-level content and metadata.

- Do not use `read_file` for XLSX/XLSM content; it intentionally redirects here.
- Put Python directly in the Bash call with a quoted heredoc. Do not hide the
  manipulation in a temporary `.py` file unless the user asks for a script.
- Do not install packages. pandas and `openpyxl` are already bundled.
- Use pandas for analysis or a new data-only workbook. Use `openpyxl` for targeted
  changes to an existing workbook.
- Save edits to a new artifact unless the user requests in-place modification.
- Use `zipfile` rather than OS-specific unzip commands; it works on Windows and
  macOS.

## All Excel files

### Professional font

Use one consistent professional font unless the user or existing template
specifies another. Apply a clear hierarchy for titles, headers, labels, inputs,
and notes rather than formatting each cell independently.

### Formula integrity

Deliver formulas without known `#REF!`, `#DIV/0!`, `#VALUE!`, `#N/A`, or
`#NAME?` errors. Inspect formula strings, references, ranges, and representative
edge cases. Because `openpyxl` does not calculate formulas, do not claim that
calculated results are error-free unless a compatible spreadsheet engine has
actually recalculated the workbook.

### Preserve existing templates

Study and match existing formats, styles, formulas, table conventions, merged
ranges, widths, heights, hidden state, conditional formatting, validation,
protection, and print settings. Existing template conventions override all
generic recommendations below.

## Financial models

### Color-coding standards

When the workbook has no established convention:

- blue font (`0000FF`): hardcoded inputs and scenario variables;
- black font (`000000`): formulas and calculations;
- green font (`008000`): references to other sheets in the same workbook;
- red font (`FF0000`): links to external workbooks;
- yellow fill (`FFFF00`): assumptions requiring attention or update.

Do not impose these conventions on non-model workbooks or templates using a
different system.

### Number-formatting standards

- Store display years as text when separators would be misleading.
- State units in headers, such as `Revenue ($mm)`.
- Use currency formats with thousands separators.
- Display zeros as `-`, including percentages when appropriate.
- Default percentages to `0.0%` and valuation multiples to `0.0x`.
- Display negatives in parentheses rather than with a minus sign.

### Formula-construction rules

Place assumptions such as growth, margins, and multiples in dedicated cells and
reference them from formulas. Prefer `=B5*(1+$B$6)` over embedding `1.05` in the
formula. Use formulas for totals, ratios, growth, differences, and projections
that should respond to changed inputs; do not replace them with Python-computed
hardcoded values.

Check denominators, range endpoints, cross-sheet names, absolute/relative
references, circularity, and projection-period consistency before filling
formulas across a model.

### Documentation for hardcodes

Document material hardcodes in cell comments or adjacent source cells. Include
the source, date, specific document/page/reference, and URL when available.

## Overview

| Need | Use |
| --- | --- |
| Filtering, joins, grouping, statistics, cleanup | pandas |
| Formulas, styles, tables, charts, validation, comments | `openpyxl` |
| Existing formatted workbook | `openpyxl` for the saved artifact |
| Cached formula values | Separate `data_only=True` read-only copy; values may be stale |
| Macros or package-level metadata | ZIP/XML inventory |
| Large data-only workbook | pandas or `read_only=True` |

Do not round-trip an existing workbook through `DataFrame.to_excel()`. That path
does not preserve the workbook's non-tabular features.

## Important requirements

- Inspect and edit with `data_only=False` so formulas remain formulas.
- Never save a workbook loaded with `data_only=True`; it contains cached results
  instead of formula expressions.
- For XLSM, load with `keep_vba=True` and save with an `.xlsm` extension. This
  preserves VBA package parts but does not inspect, edit, or execute macro code.
- Use `keep_links=True` when cached external-workbook link data must survive.
- Use `read_only=True` only to stream values; perform metadata inspection in
  normal mode.

Start with a basic inventory:

- workbook properties, calculation settings, defined names, and sheet order;
- visible, hidden, and very-hidden sheets;
- worksheet dimensions; and
- the ZIP entry list and package integrity.

Then inspect only the cells, formulas, styles, comments, links, tables, drawings,
validation, protection, print settings, relationships, or package parts relevant
to the task and anything unusual found in the basic inventory.

`max_row` and `max_column` may include styled but visually empty cells. Hidden
sheets, rows, or columns may contain formula inputs and dependencies.

## Reading and analyzing data

### Data analysis with pandas

Use `read_excel()` for dataframe analysis, with `sheet_name=None` when all sheets
are needed. Specify `dtype`, `usecols`, converters, and date handling when
inference could alter identifiers, leading zeros, dates, or nullable values.

Use pandas for filtering, grouping, joins, statistics, cleanup, and simple new
exports. For an existing workbook, apply analysis results through `openpyxl`
instead of exporting the dataframe over the source file.

### Workbook analysis with `openpyxl`

Load normally with `data_only=False` and inspect sheet objects, cell metadata,
tables, drawings, names, and relationships. If cached formula results matter,
open a second read-only copy with `data_only=True`; treat those values as the
last stored results, which may be stale, and never save that copy.

## Excel file workflows

### Wrong: hardcoded calculated values

Do not calculate a total, ratio, growth rate, or average in Python and store only
the result when users expect the workbook to remain dynamic. That disconnects
the displayed result from future input changes and hides its dependencies.

### Correct: workbook formulas

Use `=SUM(B2:B9)`, `=(C4-C2)/C2`, or `=AVERAGE(D2:D19)` when the result should
update with inputs. A Python-calculated value is appropriate only when the
requested artifact is intentionally static or the value cannot be represented
reliably as a workbook formula.

### Common workflow

1. Inventory the workbook and package before changing anything.
2. Choose pandas for analysis and `openpyxl` for workbook manipulation.
3. Make the smallest targeted change while matching existing conventions.
4. Save to a new artifact with the correct XLSX/XLSM extension.
5. Reopen with `data_only=False` and verify formulas, styles, and metadata.
6. Run `ZipFile(output).testzip()` and compare important package parts before
   and after the edit.

### Creating new Excel files

Use `Workbook()` and establish descriptive sheet names, one header row per table,
frozen headers, filters, sensible widths, consistent fonts, and explicit number
formats. Add tables, validation, conditional formatting, charts, comments,
hyperlinks, and defined names through their `openpyxl` APIs as required. Keep
table and defined names unique and synchronize their ranges with the data.

### Editing existing Excel files

Use `load_workbook()` with the appropriate flags, select sheets by name, and
change only intended cells or objects. Match neighboring styles and formulas.
Avoid broad row/column insertion or deletion in complex workbooks unless
required, because charts, tables, names, pivots, validation, and external
references may not update exactly as Excel would.

## Recalculating formulas

`openpyxl` stores formulas but does not evaluate them. Calculation flags can ask
Excel or another spreadsheet engine to recalculate on open, but they do not
produce verified cached results in the current environment.

Report that calculated values, formula errors, pivot refreshes, and external-link
refreshes remain unverified until a compatible engine recalculates the workbook.
Do not substitute Python-computed constants just to create cached values.

## Formula-verification checklist

### Essential verification

- Test two or three representative formulas before filling a range.
- Verify Excel's 1-based row/column mapping and off-by-one range endpoints.
- Confirm every referenced sheet, name, and cell exists.
- Scan formula strings for literal error tokens such as `#REF!`.
- Check formula consistency across rows and projection periods.

### Common pitfalls

- null/NaN handling and unexpected inferred types;
- identifiers or years converted to numbers;
- division by zero and invalid cross-sheet quoting;
- absolute references that should be relative, or the reverse;
- multiple matching labels when only the first was used;
- formulas extending into far-right columns or hidden sheets;
- unintended circular references.

### Formula-review strategy

Start with a small sample and inspect its construction and dependencies before
filling the formula across the intended range. Reason through zero, negative,
blank, and unusually large inputs when applicable; do not describe these as
executed tests because `openpyxl` does not evaluate formulas. Reopen the output
and confirm the formulas remain formula strings.

## Best practices

### Library selection

- Use pandas for dataframe-oriented analysis and simple new exports.
- Use `openpyxl` for formulas, formatting, charts, comments, validation, links,
  names, and modifications to existing workbooks.
- Use `zipfile` and XML for package-level inspection and targeted changes beyond
  the public object model.

### Working with `openpyxl`

- Remember that cell indices are 1-based.
- Use streaming modes for scale only when their feature limitations are safe.
- Preserve extension/package compatibility for XLSM and template formats.
- Verify package-level shapes and parts before and after saving.
- Consult official documentation before relying on private attributes or an API
  whose preservation behavior is uncertain.

### Working with pandas

- Specify types for identifiers and other inference-sensitive columns.
- Read only needed sheets and columns for large workbooks.
- Treat dataframe output as a new workbook unless preservation of the original
  workbook is irrelevant.

## Verification

Reload with `data_only=False` and verify requested values, formulas, styles,
number formats, comments, hyperlinks, and names. Compare task-relevant sheets,
tables, images, charts, validations, external links, defined names, relationships,
and VBA parts. Confirm that the extension matches the package type and no
unexpected OOXML part disappeared.

Structural checks do not verify rendered layout, calculated results, pivot or
external-link refreshes, macros, or every package-level Excel feature. State
which remain unverified.

## Documentation lookup policy

For an uncertain API or support boundary only, consult the
[openpyxl 3.1 documentation](https://openpyxl.readthedocs.io/en/3.1/) or
[pandas 2.2.3 Excel I/O documentation](https://pandas.pydata.org/pandas-docs/version/2.2.3/user_guide/io.html#excel-files).
