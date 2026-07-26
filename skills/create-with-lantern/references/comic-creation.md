# Composable comic-creation contracts

Load this reference when creating, redrawing, replacing, or recomposing comic content. It is not a required end-to-end workflow. Start from the part that matches the creator's request, combine only the relevant contracts, and let the creator's stated intent override general craft guidance.

## Match the planning depth to the task

First distinguish the requested creative scope and preserve everything outside it.

- For one image or Frame, understand that target and only the adjacent context needed for continuity.
- For an existing-page recomposition, inspect its current structure and rendered composition before moving or replacing anything. Treat a requested prominence or size change as a constraint on the smallest affected Frame group, not automatically as an isolated resize. Prefer reusing its fixed AssetVersions unless the creator asks for new art.
- For one page, identify its narrative focus, reading flow, and relationships among its Frames before producing art that depends on those Frames.
- For several pages, add a lightweight page-beat and continuity plan. Do not require a persisted Storyboard Beat when the current catalog cannot create one.
- For a Chapter, deepen the page-level plan only as the story needs; do not force every page through one rigid template.
- Treat a Comic cover and Chapter cover as independent compositions rather than ordinary story panels.

The Agent may revise a layout after seeing real images. Planning establishes editable intent; it does not freeze the composition.

Choose only the steps the task needs, but use the creator's requested result as the completion condition. A plan, Asset, generated image, or partial layout is an intermediate result when the creator asked for a finished Frame, page, page sequence, Chapter, or cover.

## Keep composition separate from pixels

Lantern owns editable comic structure: PresentationUnits, PageSurfaces, Frames, reading order, crop, bleed, overlap, breakout, Dialogue, balloons, and paper text. Host image generation supplies visual source material.

When an intended image belongs to one Frame, generate or obtain one independent image for that Frame by default. A generation request should describe only that shot and should explicitly exclude panel grids, panel borders, contact sheets, split-screen layouts, speech balloons, dialogue, captions, page numbers, and other page furniture. Multiple shots may be generated in parallel only when they are returned as separate images that can be placed independently.

This default does not prohibit:

- a Comic or Chapter cover composed as one finished illustration;
- an intentional full-page, full-bleed, or true-spread source image;
- a paper-owned background or decorative overlay;
- an already flattened page supplied by the creator;
- a flattened composition the creator explicitly requests.

Before generating pixels, determine whether the requested result is one visual source or several independently editable shots, and identify the intended Frame, PageSurface, or paper placement for each source.

For each intended Frame image, establish the target aspect ratio, subject, action, shot scale, camera angle, relevant fixed references, continuity direction, and any negative space needed for later text. Ask the image capability for only that shot and exclude baked-in borders, balloons, text, and multi-panel layout.

## Use references as fixed creative baselines

Translate the creator's visual direction into observable style traits and the Comic's visual-style baseline. Use character, scene, prop, and other Assets for reusable identity, and pin the exact AssetVersion used for any placed image or visual comparison.

Before producing dependent shots, create or choose a baseline for a recurring character, scene, prop, or other identity whose consistency matters. A one-off detail or finished Frame source is not a reusable Asset-space identity by default. Do not create a structured Asset card for every generated shot unless the creator asks to preserve those shots as reusable assets. Exploratory art may precede asset confirmation when exploration is the creator's intent.

For a new shot, inspect only the relevant baseline images and nearby composed pages or Frames. Preserve character identity, costume, spatial anchors, time and weather, movement direction, and other facts that matter to the requested continuity. Do not rely on text descriptions alone when image handles are available.

## Load craft guidance only when it helps

Creating or recomposing a multi-Frame page requires reading-path and grouping decisions, so use [composition-craft.md](composition-craft.md). For narrower work, load it only when the task needs a creative choice about page rhythm, whitespace, page turns, spreads, bleed, breakout, dialogue space, sound effects, or motion cues. These techniques are optional means for serving the creator's intent, not a style template or a mandatory quality checklist.

## Enter and leave at the requested point

A creation task may use any applicable subset of this loop:

1. understand the creator's target and bounded context;
2. decide whether editable structure must change;
3. create or adjust the necessary page and Frame structure;
4. reuse, upload, or generate independent visual sources;
5. place fixed AssetVersions and adjust crop, transform, bleed, overlap, or breakout;
6. inspect the rendered result and refine only within the authorized scope;
7. inspect adjacent pages or baselines when consistency or story continuity requires it.

A replacement can begin at step 4, a recomposition at step 2, and a read-only review at step 6. Do not create resources, rewrite unaffected content, or expand the task merely to complete the loop.
