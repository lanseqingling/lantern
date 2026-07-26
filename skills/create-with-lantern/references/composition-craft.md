# Lightweight comic-composition craft

Load this reference when a creative layout decision depends on reading path, visual grouping, pacing, whitespace, page turns, spreads, bleed, breakout, dialogue space, sound effects, or motion cues. These are flexible craft heuristics, not LCD invariants, genre templates, or proof that a matching MCP capability exists. The creator's intent and the Comic's reading direction take priority.

## Design the reading path

Decide the intended sequence before choosing geometry. Spacing, alignment, Frame shape, subject placement, gaze, motion, contrast, text, and negative space all compete to guide attention; coordinates alone do not determine reading order.

Apply a clear but restrained gutter hierarchy when composing a multi-Frame page even if the creator describes only story content and does not mention spacing.

- Nearby Frames are usually perceived as a group. A wider gap can signal a row or column transition, a time shift, or a pause.
- For a horizontal run followed by a move downward, keep the Frames within the run relatively close and make the row transition more distinct.
- For a vertical run of small Frames that should be read before an adjacent tall Frame, keep the small Frames closely grouped and separate that group more clearly from the tall Frame.
- Start with a restrained, consistent base gutter. Prefer the page's established gutter or Lantern's layout value; when neither exists, about `1.5%` of the PageSurface's shorter side is a useful starting point.
- When spacing alone distinguishes a normal group transition, make the separating gutter roughly `1.2–1.4×` the group's internal gutter. This difference should remain perceptible but quiet. Reverse which axis is wider when the intended grouping reverses, such as a vertical run before an adjacent tall Frame.
- Keep a positive base gutter between ordinary Frames. Do not let resizing collapse gutters to zero unless the creator intentionally requests touching, overlap, or another explicit visual effect.
- Apply the same reasoning in the Comic's actual left-to-right or right-to-left direction. Never turn one spacing ratio into a universal rule.
- Shared top, bottom, or center alignment strengthens grouping. Breaking an alignment can create emphasis but may also create an unintended entry point.
- A large Frame, face, high-contrast area, or strong diagonal may attract attention before the nearest nominal reading position. Treat visual weight as part of the path.

Inspect the rendered page at thumbnail scale. The intended groups and primary entry should be apparent before fine details are readable.

## Reflow the affected group when space is constrained

Before enlarging or reshaping one Frame, inspect its row, column, neighboring Frames, outer safe boundary, and current gutters. Determine where the added area can come from.

- Use genuinely free space first. When the group already fills its available width or height, move the shared boundary and shrink or move the affected neighbor instead of expanding through the gutter.
- Preserve the group's intended outer boundary and gutter hierarchy unless the creator asks to change them.
- Change the smallest group that can satisfy the request, but judge the result against the whole page. Do not move unrelated Frames merely to make an isolated edit easier.
- Recheck every changed Frame's crop and focal subject after geometry changes; preserving an AssetVersion does not guarantee that its old crop still works.
- Inspect the final page again. Reject a nominally larger target Frame when the result creates accidental touching edges, breaks the reading path, or makes another Frame unusably narrow.

## Keep one content-safe rectangle per surface

Use one inset content-safe rectangle for each PageSurface. Prefer a safe boundary explicitly returned by Lantern; otherwise use `5%` of the surface's shorter side as the same inset on all four edges.

- Place ordinary outer Frame edges on or inside this rectangle by default, while allowing internal Frames to follow the composition.
- Keep dialogue, narration, faces, essential action, and other critical story information inside the rectangle.
- Bleed Frames, full-page art, breakout, and intentional decorative content may cross it to the paper edge; their critical content should still remain safe.
- In a true spread, apply the same rule independently to both PageSurfaces. Their two inner edges naturally form the protected center; do not invent a second craft safety boundary.
- Treat this as Agent composition guidance, not a server invariant or proof of UI snapping. Obey any stricter geometry or cross-page validation declared by the current capability catalog.

## Use Frames to control rhythm

- Frame count, area, shape, and whitespace should serve narrative duration and emphasis rather than a fixed page formula.
- Larger or quieter Frames can hold a reveal, environment, emotion, or pause. Small repeated Frames can compress detail, reactions, or rapid action.
- A diagonal border creates direction. Point it toward the next subject or action when useful, and avoid leading attention out of the page unintentionally.
- Repeated composition can express elapsed time, hesitation, or a subtle change when each repetition contributes new information.
- Bleed can open space, increase immersion, or intensify pressure. Breakout can emphasize a subject while preserving its source Frame. Overlap can connect simultaneous or dependent events.
- These emphasis devices lose force when used without hierarchy. Prefer a clear purpose over accumulating effects.

## Use page turns and true spreads deliberately

- Place a concealed reveal after the page turn when surprise depends on information not being visible early.
- A true spread suits a scene-scale reveal, decisive action, or relationship that genuinely needs one shared composition space.
- Keep faces, essential action, small text, and other critical detail inside either PageSurface's content-safe rectangle.
- Let cross-page gaze, movement, perspective, or atmosphere connect the two PageSurfaces; do not treat two workbench pages as a true spread.
- Use whitespace to slow time, isolate a subject, create unease, or leave emotional aftereffect. Empty space still participates in balance and direction.

## Reserve space for dialogue and narration

Plan important text with the image rather than placing it only wherever space remains.

- Balloon order should agree with the page direction, Frame order, and order within the Frame.
- Position balloons so they lead toward the speaker, expression, action, or next reading target.
- Keep related balloons visually grouped, while leaving enough separation to prevent uncertain speaker or reading order.
- Tails should identify speakers without crossing faces, essential action, or unrelated text.
- Preserve negative space around dialogue during image generation when the text is known in advance. Do not ask the image model to render the actual balloon or text.
- A cross-Frame or cross-page balloon binds moments semantically and should be used only when that continuity is intentional.
- Treat text density as a relationship among wording, balloon area, Frame area, and dramatic tempo, not as a universal character limit.

Use [dialogue-and-text.md](dialogue-and-text.md) for the actual exposed objects and edit limits.

## Treat sound effects as image and typography

A sound effect can communicate source, force, duration, rhythm, and direction. Its scale, repetition, angle, spacing, contrast, and overlap should support when and where the sound occurs.

- Align an impact sound with its contact point or force direction.
- Use repeated smaller marks for continuing rain, footsteps, machinery, or another ambient rhythm.
- Allow controlled overlap with art when integration adds force, but preserve faces, silhouettes, and essential action.
- A sound effect that breaks a Frame can intensify or connect moments, but it also changes reading order and layer hierarchy.
- Keep ambient effects subordinate when they are not the narrative focus.

Lantern's paper text is not a professional sound-effect editor. Use currently exposed text styling only when it achieves the intended result. When available capabilities allow it, an externally created transparent fixed image may carry more expressive lettering as paper or breakout art. Do not claim curved, warped, perspective, or other specialist typography unless the current catalog exposes it.

## Coordinate motion cues

- Parallel speed lines usually reinforce translation or camera travel; radial lines usually reinforce focus, approach, shock, or impact.
- Align speed lines, subject motion, Frame diagonals, perspective, and sound-effect direction unless conflict is intentional.
- Vary density, length, and contrast to concentrate force rather than filling the entire image uniformly.
- Preserve enough quiet area around the subject for pose and silhouette recognition.
- Maintain understandable screen direction across adjacent shots unless a reversal is deliberately established.
- Reduce motion marks during anticipation, stillness, or aftermath when contrast will make the action clearer.

Speed lines are visual source material, not a general Lantern structure. They may be included in one Frame's generated image or supplied as a separate transparent fixed image when the current upload and placement capabilities support that composition.

## Verify the composed result

Judge craft from the final rendered composition together with its structure:

1. trace the first, second, and later attention targets at thumbnail scale;
2. check that spacing and alignment form the intended groups;
3. check that visual weight, gaze, motion, and text support rather than contradict the path;
4. check dialogue, sound effects, important subjects, and content safety at reading scale;
5. adjust only the properties authorized by the creator and available in the current capability catalog.

Do not mechanically fix every deviation. Ambiguity, interruption, imbalance, or disorientation may be intentional creative choices.
