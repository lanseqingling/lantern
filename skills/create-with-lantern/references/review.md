# Read-only comic review

Load this reference for page-composition review, character or scene consistency, adjacent-storyboard continuity, creative-expression analysis, or comparison with the latest saved version. The host Agent performs the judgment from direct visual and structured evidence. Lantern does not run a hidden review model, create a Task or Candidate, or modify the comic.

## Gather one coherent evidence set

1. Resolve the Chapter or Project.
2. Read one page, one true spread, or two adjacent PresentationUnits with `source: working`.
3. Inspect their final page preview and LCD structure at that same source revision.
4. Use exact placed-image or `asset_version` handles to fetch the relevant character, scene, prop, and visual-style images. When a relevant asset is not already used on the page, pass up to three stable Asset references in the context request so Lantern can return their bounded version handles. Inspect no more than three images at once.
5. Use the Comic and Chapter summaries, settings, StoryboardBeats, reading direction, and fixed image versions returned in context.
6. If the creator asks what changed since saving, repeat the page read and composition inspection with `source: latest_saved`. Do not mix handles from the two sources.

Match pages across sources by stable PresentationUnit identity first. A page present on only one side is added or removed; equal reading positions alone do not prove identity. Page LCD, StoryboardBeat versions, and placed images can be historical snapshot facts, while mutable Comic or Asset descriptions may describe the current Comic. State that distinction when it matters.

## Distinguish findings

- **Structural fact:** directly established by LCD, such as ownership, coordinate space, crop, z-order, reading order, bleed, or cross-page scope.
- **Visible finding:** directly supported by the final page preview, such as occlusion, cramped whitespace, a cut-off subject, or an unclear focal point.
- **Consistency risk:** a visible difference from an explicit character, scene, prop, style, or adjacent-page reference.
- **Creative suggestion:** an interpretation about rhythm, emphasis, emotion, or expression. It is not a validation error.

Do not invent an identity baseline when no fixed asset image or confirmed description is available. Do not turn a soft craft guideline into a server invariant.

## Single-page composition

Follow the declared reading direction and Frame reading sequence rather than inferring order only from position. Check focal hierarchy, usable whitespace, crop of important subjects, frame and overlay occlusion, bleed intent, controlled breakout, balloon tails, text legibility, dialogue density, and whether balloons obscure faces or essential action. On a true spread, also check that important text, faces, and action do not sit in the gutter safety area.

## Character and scene consistency

Compare the final page with the exact fixed references actually supplied. For characters, check stable identity features, proportions, hair, clothing, accessories, and intentionally changed forms. For scenes, check spatial layout, entrances, light direction, time, weather, and persistent props. Use visual-style images for line, palette, contrast, material, and lighting direction. Separate an intentional story change from an unexplained mismatch.

## Storyboard continuity

Limit the initial check to one PresentationUnit or two adjacent PresentationUnits. Combine Frame reading order, StoryboardBeat intent, Dialogue order, and final previews. Check action continuation, gaze and movement direction, character placement, spatial orientation, shot progression, information reveal, and pacing. A true spread is one shared PresentationUnit, not two independent pages.

## Creative expression

Compare each relevant StoryboardBeat with what the final composition visibly emphasizes. Discuss whether emotion, action, reveal, silence, dialogue, shot scale, and page turn support the intended effect. Mark alternatives as suggestions and preserve ambiguity that appears intentional.

## Report briefly

Lead with the overall finding, then list only material issues. For each issue name the page or object, distinguish its finding type, cite the relevant visible or structured evidence, and give a bounded suggestion. End with missing evidence or choices that require the creator. Do not assign a universal quality score and do not claim that suggestions were applied.
