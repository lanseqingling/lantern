# Dialogue, balloons, and paper narration

Load this reference for the currently exposed deterministic text-composition capabilities. These operations modify one explicit object at a time and produce revision-bound, undoable Working Revision changes.

## Keep meaning separate from appearance

A `Dialogue` stores the spoken content and optional story references. A `BalloonElement` is a visual carrier that points to a Dialogue. A paper `TextElement` with role `narration` stores its own non-dialogue content.

- Creating a balloon creates both one Dialogue and one BalloonElement.
- Updating `content` changes the Dialogue, while transform, tail, shape, and style change the BalloonElement.
- Duplicating a balloon duplicates its Dialogue so later edits remain independent.
- Deleting the last carrier of a Dialogue removes that unreferenced semantic object.
- Do not represent narration as a fake speaker or Dialogue.

## Target and edit in the declared coordinate space

Use current context and composition handles, then refresh them after every successful mutation.

- A balloon created in a Frame uses normalized `frame_local` position and transform.
- A paper balloon and narration use absolute `unit` coordinates.
- In a true spread, target a specific `PageSurface` for ordinary paper content. It must remain on that physical page.
- A frame-anchored breakout keeps `frame_local` coordinates and follows its Frame while drawing beyond the Frame border.
- A cross-page balloon is unit-owned and uses absolute `unit` geometry.

The inspection result's resolved `geometry` is evidence. Write the stored `transform` in its declared `coordinateSpace`.

## Use the limited visual vocabulary

The exposed balloon shapes are `normal`, `thought`, `caption_box`, and `cut_corner`. Balloon style can set font family and size, text/fill/stroke colors, stroke width, and horizontal or vertical writing. Tail targets use the same coordinate space as their balloon.

Paper narration supports content, transform, font family, size, weight, color, stroke, alignment, horizontal or vertical writing, and overlay front/back order. It is not a general nested text-layer system or an SFX editor.

## Change ownership deliberately

- `placement: breakout` converts one frame-layer balloon into a frame-anchored controlled breakout.
- `placement: page` converts a frame-layer, breakout, or cross-page balloon into ordinary paper content.
- `placement: cross_page` is valid only in a true spread. Provide a unit-space transform that visibly crosses both physical pages.

Changing ownership invalidates the old handle. Perform it as a separate operation and refresh context and composition before any later edit. Cross-page conversion is the one exception that accepts the destination transform and tail in the conversion call.

## Protect the true-spread gutter

A cross-page balloon may cross the binding, but its writing center and tail endpoint must not sit in the gutter safety band. Bias the balloon's center toward the intended reading-side page, keep the tail clearly on one side, and inspect the rendered spread after conversion. Lantern rejects geometry that does not cross both pages, leaves the spread canvas, or places the center or tail in the protected band.

This support is intentionally limited to one explicit balloon in an existing true spread. Do not infer arbitrary cross-unit text, multi-balloon restructuring, automatic avoidance, nested groups, or professional freeform typography. A true-spread restructuring or multi-object creative arrangement remains a Candidate when such a capability is available.
