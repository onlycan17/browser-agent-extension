---
name: pptx
description: Use this skill whenever a PowerPoint .pptx file must be read, created, inspected, or edited, including slides, notes, images, tables, charts, layouts, and package metadata.
icon: https://static.asidehq.com/apps/builtin-skills/pptx.jpg
license: Proprietary. LICENSE.txt has complete terms
---

# PPTX creation, editing, and analysis

Use bundled MarkItDown for a quick ordered-content pass and `python-pptx` for
structure and manipulation. A PPTX is an OOXML ZIP package, so use Python's
standard `zipfile` and XML parsing for package-level content and metadata.

- Do not use `read_file` for PPTX content; it intentionally redirects here.
- Put Python directly in the Bash call with a quoted heredoc. Do not hide the
  manipulation in a temporary `.py` file unless the user asks for a script.
- Do not install packages. `markitdown[pptx]` and `python-pptx` are bundled.
- Load existing decks and make targeted changes instead of recreating them from
  extracted Markdown.
- Save edits to a new artifact unless the user requests in-place modification.
- Use `zipfile` rather than OS-specific unzip commands; it works on Windows and
  macOS.

## Quick reference

| Task | Approach |
| --- | --- |
| Read or analyze content | MarkItDown, then `Presentation(path)` inventory |
| Edit or create from a template | Reuse its layouts and placeholders |
| Create from scratch | `Presentation()` with an explicit visual system |
| Package-level feature | Inspect and minimally edit OOXML |
| Verify | MarkItDown, reopen, compare structure, and test ZIP integrity |

## Reading content

Run `python -m markitdown input.pptx` for an ordered text and notes overview, but
do not stop there. Build a basic inventory with `python-pptx`: slide order and
count, presentation dimensions, layout names, per-slide shape types and counts,
notes presence, core properties, and the ZIP entry list.

Inspect shape geometry, placeholder indices, grouped shapes, text runs, tables,
charts, pictures, notes text, relationships, masters, and relevant package parts
only when the task or basic inventory calls for them.

MarkItDown cannot establish that a deck has no images, charts, comments,
embedded objects, or important spatial relationships.

## Editing workflow

1. Inventory the source deck, layouts, placeholders, media, notes, and special
   parts.
2. Identify the existing layout and placeholder conventions for each target
   slide.
3. Make the smallest `python-pptx` change that satisfies the request.
4. Use raw OOXML only for the package-level portion and preserve all other package
   entries and relationships.
5. Save to a new artifact and repeat the content and structural checks.

When editing:

- prefer template layouts and placeholders over recreated text boxes;
- change only the intended run when formatting varies;
- avoid replacing an entire text frame when paragraph/run formatting must remain;
- preserve chart workbooks, media, notes, comments, and embedded objects unless
  the task removes them;
- match neighboring geometry, typography, colors, and spacing;
- inspect exact support before slide reordering, animations, transitions,
  comments, or embedded-object manipulation.

## Creating from scratch

Use `Presentation()` and set the slide size explicitly when the target format is
known. Define the audience, purpose, key message, and slide sequence before
adding content. Give each slide one main point and put supporting detail in notes
or an appendix.

Use `slide_layouts`, shape factories, text frames, `ChartData`, tables, picture
shapes, and notes slides as appropriate. Work in `Inches` and `Pt`, not raw EMUs.
Use native charts when editability matters and images when visual fidelity
matters more. Preserve image aspect ratio unless cropping is requested.

## Design ideas

Do not default to a sequence of plain title-and-bullet slides. Choose a visual
system that reflects the subject and apply it consistently.

### Before starting

- Pick a content-informed palette rather than generic blue.
- Give one color roughly 60–70% visual weight, use one or two supporting colors,
  and reserve one sharp accent.
- Decide whether the deck uses dark/light contrast by section or one consistent
  background system.
- Choose one repeatable motif such as rounded image frames, number badges, or a
  distinctive edge treatment.
- Reuse the template's theme and conventions when one is supplied.

### Color palettes

Use these only as starting points and adapt them to the subject:

| Theme | Primary | Secondary | Accent |
| --- | --- | --- | --- |
| Midnight Executive | `1E2761` | `CADCFC` | `FFFFFF` |
| Forest & Moss | `2C5F2D` | `97BC62` | `F5F5F5` |
| Coral Energy | `F96167` | `F9E795` | `2F3C7E` |
| Warm Terracotta | `B85042` | `E7E8D1` | `A7BEAE` |
| Charcoal Minimal | `36454F` | `F2F2F2` | `212121` |
| Berry & Cream | `6D2E46` | `A26769` | `ECE2D0` |

### For each slide

Use a visual element when it carries meaning: image, chart, diagram, icon,
timeline, comparison, or large metric. Useful layouts include two-column,
comparison, process flow, 2x2 cards, half-bleed image, and large-stat callout.
Vary layouts across the deck while preserving alignment and spacing rules.

### Typography

Choose fonts available on the target system and use a clear hierarchy:

| Element | Typical size |
| --- | --- |
| Slide title | 36–44 pt bold |
| Section header | 20–24 pt bold |
| Body text | 14–18 pt |
| Caption or source | 10–12 pt |

Increase sizes for sparse or presentation-room decks. Left-align body copy;
center primarily titles and short callouts.

### Spacing

Keep at least 0.5 inch outer margins and roughly 0.3–0.5 inch between content
blocks. Use consistent gaps, align related objects, account for text-frame
internal margins, and leave intentional whitespace.

### Avoid common mistakes

- repeated title-and-bullet layouts and text-only walls;
- centered paragraph text and weak title/body size contrast;
- arbitrary colors, inconsistent gaps, and low-contrast text or shapes;
- tiny sources, narrow text boxes, and excessive wrapping;
- decorative charts that do not communicate information;
- leftover template instructions or placeholder text;
- styling only a few slides while leaving the rest visually unrelated.

## QA

Treat verification as a search for defects, not a confirmation pass.

### Content QA

Run MarkItDown on the output and check for missing, duplicated, stale, or
misordered content. Search for placeholder markers such as `lorem`, `ipsum`,
`xxxx`, and template instructions. Confirm speaker notes and sources remain on
the intended slides.

### Structural QA

Reopen with `Presentation` and compare slide, layout, shape, media, chart, note,
comment, embedded-object, relationship, and core-property counts. Check that
every shape remains within slide bounds and that intended placeholder indices
and layouts are preserved. Run `ZipFile(path).testzip()`.

### Visual QA

Bounds and structure cannot detect text overflow, low contrast, unintended
overlap, bad cropping, or poor hierarchy; because the bundled tools do not render
slides or convert them to images, report visual QA as unavailable.

### Verification loop

1. Generate or edit the deck.
2. Run content and structural checks.
3. List every issue found instead of assuming the first pass is complete.
4. Fix the affected slides and recheck them; one fix can create another defect.

## Dependencies

- Bundled: `markitdown[pptx]` and `python-pptx`

## Documentation lookup policy

For an uncertain API or support boundary only, consult the
[python-pptx documentation](https://python-pptx.readthedocs.io/en/latest/) or
[MarkItDown 0.1.5 documentation](https://github.com/microsoft/markitdown/tree/v0.1.5).
