---
name: docx
description: Use this skill whenever a Word .docx file must be read, created, inspected, or edited, including its tables, images, headers, footers, comments, tracked changes, and package metadata.
icon: https://static.asidehq.com/apps/builtin-skills/docx.jpg
license: Proprietary. LICENSE.txt has complete terms
---

# DOCX creation, editing, and analysis

## Overview

Use bundled `python-docx` for ordinary document work. A DOCX is an OOXML ZIP
package, so use Python's standard `zipfile` and XML parsing for package-level
content and metadata.

- Do not use `read_file` for DOCX content; it intentionally redirects here.
- Put Python directly in the Bash call with a quoted heredoc. Do not hide the
  manipulation in a temporary `.py` file unless the user asks for a script.
- Do not install packages. `python-docx` is already bundled.
- Load existing documents and make targeted changes instead of recreating them
  from extracted text.
- Save edits to a new artifact unless the user requests in-place modification.
- Use `zipfile` rather than OS-specific unzip commands; it works on Windows and
  macOS.

## Quick reference

| Task | Approach |
| --- | --- |
| Read or analyze | `Document(path)` plus targeted ZIP/XML inspection |
| Create | `Document()` with explicit page, style, and section settings |
| Edit | Load the source and change only the necessary objects |
| Comments | `document.comments` and `document.add_comment()` |
| Tracked changes or package-level features | Inspect and minimally edit OOXML |
| Verify | Reopen, compare structure, and run `ZipFile.testzip()` |

### Reading content

Start with a basic inventory:

- paragraphs, tables, sections, headers, footers, and inline-shape counts;
- core properties; and
- the ZIP entry list and package integrity.

Then inspect only the containers and parts relevant to the task, such as runs,
styles, hyperlinks, numbering, image relationships, comments, footnotes,
endnotes, custom properties, embedded objects, or custom XML.

Paragraphs in tables, headers, footers, text boxes, or revision wrappers are not
all returned by `document.paragraphs`. Traverse those containers or inspect XML.

### Converting to images

The bundled libraries do not render DOCX pages. Do not claim visual fidelity,
pagination, or absence of clipping from structural inspection. Report page-image
conversion as unavailable in the bundled runtime.

### Accepting tracked changes

For acceptance, unwrap `w:ins` and `w:moveTo` while keeping their content;
remove `w:del` and `w:moveFrom` with their content; and remove `*PrChange`
children while retaining the current paragraph, run, table, or section
properties. Handle paragraph-mark and table revisions explicitly rather than
assuming every change is a run wrapper. Preserve unrelated bookmarks, comments,
relationships, and formatting, then verify the resulting text and confirm that
the targeted revision elements are gone.

## Creating new documents

### Setup

Create with `Document()`. Use `docx.shared` for physical units, `docx.enum` for
enumerations, styles for consistent formatting, and the document/section object
model for content. Keep code inline and import only the APIs the task needs.

### Validation

Save to a new artifact, reopen it with `Document`, repeat the structural
inventory, and run `ZipFile(path).testzip()`. Treat successful reopening as a
basic package check, not proof of rendered layout or full OOXML conformance.

### Page size

Set page width, height, orientation, and margins explicitly when layout matters.
Use `Inches`, `Cm`, or `Mm` instead of raw EMUs. For landscape pages, set the
orientation and swap page width and height together. Common defaults:

| Paper | Width | Height |
| --- | --- | --- |
| US Letter | 8.5 in | 11 in |
| A4 | 210 mm | 297 mm |

Compute available content width as page width minus left and right margins.

### Styles

Set the Normal style and built-in heading styles instead of formatting every run
individually. Use the exact built-in style names available in the document's
template. Preserve semantic heading levels so navigation and TOC fields work.
Match established styles when modifying an existing document.

### Lists

Use real numbering definitions or existing `List Bullet`/`List Number` styles.
Never simulate lists with Unicode bullets or manually typed numbers. Inspect
`word/numbering.xml` when continuation, restart behavior, or custom multilevel
numbering matters.

### Tables

Set table and column widths intentionally based on available content width.
Apply cell widths consistently, add readable cell margins, and match existing
borders, shading, alignment, and row behavior. A cell always contains at least
one paragraph; format its paragraphs and runs as needed. Do not use tables as
decorative divider lines.

### Images

Use `document.add_picture()` or `run.add_picture()` for ordinary inline images.
Set dimensions intentionally and preserve aspect ratio unless cropping is
requested. Inspect relationships and `word/media/` to inventory existing images.
Floating images, advanced wrapping, and some accessibility metadata may require
OOXML; check official support before implementing them.

### Page breaks

Use `document.add_page_break()`, a run break, or paragraph page-break settings.
Do not create pages with repeated empty paragraphs. Use a section break when the
following content needs different page geometry, columns, headers, or footers.

### Hyperlinks

Read hyperlinks through paragraph hyperlink objects and relationships where
available. For creation or changes, preserve relationship IDs and distinguish
external links from internal bookmarks. Consult the official API if needed.

### Footnotes

Inspect `word/footnotes.xml`, `word/endnotes.xml`, their relationships, content
types, and references. Add or modify them only when all linked parts and IDs are
understood.

### Tab stops

Use paragraph-format tab stops for aligned text and dot leaders. Do not align
content with repeated spaces. Confirm positions against the section's content
width and paragraph indentation.

### Multi-column layouts

Columns are section properties and may require targeted `w:cols` manipulation in
`sectPr`. Preserve column count, widths, spacing, separators, and section-break
behavior. Check current library support before using private XML APIs.

### Table of contents

Use semantic Heading 1/2/3 styles and insert a TOC field only when requested.
TOC fields require a field update in Word after opening and may not refresh
automatically. Do not hardcode page numbers as a substitute.

### Headers and footers

Use section header/footer objects and check `is_linked_to_previous` before
editing. Also inspect different-first-page and odd/even-page settings. Page
numbers and similar dynamic values are fields and may require OOXML plus a later
field update by Word.

### Critical rules for `python-docx`

- Set page geometry explicitly when layout matters.
- Use paragraphs, breaks, styles, and numbering instead of visual text hacks.
- Inspect runs before replacement; visible text may span multiple runs.
- Avoid assigning `paragraph.text` when run formatting, fields, hyperlinks, or
  bookmarks must survive.
- Inspect every container relevant to the task, not only body paragraphs.
- Do not assume a missing high-level API object means the package lacks content.

## Editing existing documents

### Step 1: Inspect

Inventory content, styles, sections, relationships, media, comments, revisions,
and other task-relevant parts. Identify whether the requested feature has a
public `python-docx` API before choosing raw OOXML.

### Step 2: Edit

Make a targeted object-model change when possible. Use raw OOXML only for the
package-level portion and preserve all other ZIP entries.

### Text replacement

Replace at run level when the target is contained in one run. If it spans runs,
map the visible character range back to its runs and change only those runs.
Assigning `paragraph.text` recreates children and loses run-level structure.
Apply the same rules to cell, header, and footer paragraphs.

### Step 3: Save and verify

Save to a new artifact, reopen it, and compare the same inventory. Reparse every
changed XML part and verify the relationships and content types it uses.

### Common pitfalls

- rebuilding a document from extracted text instead of modifying the source;
- searching only body paragraphs and missing tables, headers, or revision markup;
- replacing a full paragraph or text frame and losing child formatting;
- changing a linked header or footer without checking other sections;
- adding an OOXML element without its relationship or content type;
- treating structural validation as proof of visual layout.

## XML reference

### Schema compliance

When raw OOXML is unavoidable:

- change only the necessary part and retain every other original ZIP entry;
- preserve namespaces, relationship IDs, content types, element order, and
  `xml:space="preserve"` for significant leading or trailing whitespace;
- use valid IDs and maintain references across every related part;
- reparse each changed XML part before packaging.

Consult the official library documentation first. Research WordprocessingML
schema details only when the object model and documentation do not cover the
required feature.

### Tracked changes

Inventory `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, and property-change
elements such as `w:rPrChange` and `w:pPrChange`. Preserve change IDs, authors,
dates, and original formatting. Revision-wrapped paragraphs do not appear in
`Document.paragraphs`, so raw XML inspection is required for a complete review.
Use deletion-specific text elements inside deletion markup.

### Comments

Use `document.comments` to read ID, author, initials, timestamp, and body, and
`document.add_comment()` for ordinary new comments. To map comments to source
ranges or inspect replies/resolution metadata, inspect:

- `w:commentRangeStart`, `w:commentRangeEnd`, and `w:commentReference`;
- `word/comments*.xml` and `word/people.xml`;
- the associated relationships and content types.

Keep comment range markers as paragraph-level siblings of runs. Preserve comment
IDs and references across all comment-related parts.

### Images

Inspect `word/media/`, drawing elements, image relationships, and content types.
When replacing an image, preserve the intended relationship and geometry unless
the task asks for a layout change. Adding a raw image requires all of those
package links; prefer the public picture API for ordinary inline images.

## Validation

Reload with `Document`, repeat task-relevant checks, and run
`ZipFile(path).testzip()`. Compare paragraphs, tables, sections, media, comments,
headers, footers, relationships, core properties, and special package parts.
Confirm requested content changed, replaced content is gone, and unrelated parts
did not disappear.

Structural checks do not prove rendered layout or field results. State which
visual, pagination, field-update, macro, or package-level behavior remains
unverified.

## Dependencies

- Bundled: `python-docx`

## Documentation lookup policy

For an uncertain API or support boundary only, consult the
[python-docx documentation](https://python-docx.readthedocs.io/en/latest/).
