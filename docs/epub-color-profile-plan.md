# EPUB Color Profile Normalization Plan

## Goal

EPUB generation should produce predictable image color across common EPUB readers.

The proposed policy is:

- Monochrome manga pages: keep grayscale JPEG and apply/embed a Dot Gain grayscale profile.
- Non-monochrome images: convert to sRGB and embed an sRGB ICC profile.
- Full-color works: treat every page as color output and normalize all images to sRGB.

This avoids mixed color profiles such as cover images with no ICC, insert pages with sRGB, and colophon pages with Adobe RGB.

## Current Behavior

Observed EPUB samples show mixed profile states:

- Some cover images are color JPEGs with no ICC profile.
- Some color insert/intermission pages are sRGB.
- Colophon images are often Adobe RGB (1998).
- Monochrome body pages are often grayscale JPEGs with Dot Gain, but some files may have no ICC.

The current application behavior also allows this mixture:

- Existing JPEG/PNG files are copied into the EPUB without normalization.
- PSD files converted through Photoshop embed the active color profile, but are not explicitly converted to sRGB.
- TIFF files converted through the Rust image pipeline are encoded as RGB JPEG without explicit ICC embedding.

## Target Policy

### Mixed Monochrome + Color Works

Use this policy for typical manga EPUBs with mostly monochrome body pages plus color cover/insert/colophon pages.

| Image type | Output color mode | Output profile |
| --- | --- | --- |
| Grayscale body page | Grayscale JPEG | Dot Gain |
| Blank page | Match work policy | Dot Gain for monochrome flow, sRGB for full-color flow |
| Cover | RGB JPEG | sRGB |
| Color insert/intermission | RGB JPEG | sRGB |
| Colophon | RGB JPEG | sRGB |
| Any Adobe RGB color image | RGB JPEG | Convert to sRGB, then embed sRGB |
| Any color image with no ICC | RGB JPEG | Assume sRGB, embed sRGB |

### Full-Color Works

Use this policy when the work is intentionally full color.

| Image type | Output color mode | Output profile |
| --- | --- | --- |
| All pages | RGB JPEG | sRGB |
| Any source profile | RGB JPEG | Convert/normalize to sRGB |
| Images with no ICC | RGB JPEG | Assume sRGB, embed sRGB |

## Required Settings

Add an EPUB image color profile setting with these modes:

- `Auto: monochrome body + sRGB color`
  - Default.
  - Grayscale pages remain grayscale with Dot Gain.
  - Color pages become sRGB.
- `Full color: all sRGB`
  - Converts all pages to RGB JPEG with embedded sRGB.
- `Preserve original`
  - Keeps the current behavior for compatibility or debugging.

Optional advanced setting:

- Grayscale profile:
  - Default: Dot Gain.
  - Future alternatives can be added if a publisher requires a different grayscale profile.

## Detection Rules

Determine each page's output treatment during EPUB generation:

1. If the user selects `Full color: all sRGB`, output every image as RGB sRGB.
2. If `Auto` is selected:
   - Treat JPEGs with one component as grayscale.
   - Treat PSD/TIFF/project metadata `Grayscale` or `Bitmap` as grayscale unless the page is explicitly marked color.
   - Treat RGB/CMYK/Lab/indexed/color JPEG/PNG as color.
   - Treat cover, color insert pages, and colophon as color if source metadata indicates RGB/color.
3. If uncertain:
   - Prefer color sRGB for cover/colophon/insert pages.
   - Prefer preserving grayscale for body pages only when the source is clearly grayscale.

## Conversion Requirements

### Color Images

For color images:

1. Read source ICC profile if present.
2. Convert pixel values from the source profile to sRGB.
3. If no source ICC exists, assume sRGB.
4. Encode as RGB JPEG.
5. Embed sRGB ICC.

Important: do not merely replace the ICC profile label. Adobe RGB images must be converted to sRGB.

### Grayscale Images

For monochrome manga body pages:

1. Preserve grayscale JPEG output when possible.
2. Embed the selected Dot Gain ICC profile.
3. If a source grayscale page has no ICC, assign/embed Dot Gain.
4. Avoid converting grayscale body pages to RGB in `Auto` mode because it increases file size and can alter tone handling.

### Blank Pages

Blank pages should follow the selected work policy:

- `Auto`: generate grayscale blank JPEG with Dot Gain when the surrounding body is monochrome.
- `Full color`: generate RGB blank JPEG with sRGB.

## Implementation Outline

1. Add ICC profile assets to the application resources:
   - sRGB ICC profile.
   - Dot Gain grayscale ICC profile.
2. Add EPUB color profile settings to metadata/types:
   - `auto`
   - `full_color_srgb`
   - `preserve_original`
3. Add UI controls to the EPUB generation modal:
   - A compact dropdown for color profile policy.
   - Default to `Auto`.
4. Replace direct image copy in EPUB generation with a normalization step when policy is not `preserve_original`.
5. Use a color-management capable conversion path:
   - Photoshop path for PSD can use explicit profile conversion to sRGB before JPEG save.
   - Rust path needs an ICC-aware library or a controlled external conversion tool.
6. Embed ICC profiles in all generated JPEGs according to policy.
7. Add validation/reporting after EPUB build:
   - Count color sRGB images.
   - Count grayscale Dot Gain images.
   - Warn if any color image remains Adobe RGB or has no ICC.
   - Warn if any grayscale body page has no Dot Gain profile.

## Risks And Notes

- Rust's `image` crate can decode/encode images but is not sufficient by itself for accurate ICC color conversion and ICC embedding.
- Photoshop can handle ICC conversion well, but relying on it for every EPUB image may be slower and requires Photoshop installation.
- If a color image has no ICC profile, assuming sRGB is standard for EPUB/web workflows, but it is still an assumption.
- Dot Gain profile choice should be confirmed against the publisher's delivery requirements.
- Re-encoding every JPEG can change file size and compression artifacts. Quality settings should be tested.

## Verification Plan

Test with representative EPUBs:

- Mostly monochrome manga with color cover, insert, and colophon.
- Full-color work.
- Inputs with:
  - sRGB color JPEG.
  - Adobe RGB color JPEG.
  - Color JPEG with no ICC.
  - Grayscale JPEG with Dot Gain.
  - Grayscale JPEG with no ICC.
  - PSD and TIFF sources.

For each generated EPUB, verify:

- All color JPEGs have embedded sRGB.
- All grayscale body JPEGs have embedded Dot Gain in `Auto` mode.
- All pages have embedded sRGB in `Full color` mode.
- No Adobe RGB remains unless `Preserve original` is selected.
- EPUB structure and OPF references remain valid.

## Recommended First Milestone

Implement `Auto` mode for generated/copy paths used by EPUB output:

- Normalize all color JPEG/PNG/PSD/TIFF pages to sRGB.
- Ensure all grayscale JPEG body pages have Dot Gain embedded.
- Add a post-build profile summary so users can see what happened.

Keep `Preserve original` available until the new pipeline has been tested with several publisher samples.
