# Image Generation Reference

Supplementary reference for the imagegen skill. Contains style presets,
prompt templates, cost estimates, and advanced tips.

---

## Important: What gpt-image-1 Can and Cannot Do

### Strengths

- **Concept art and illustrations**: Excellent at producing stylized images across
  many art styles (painterly, flat, watercolor, etc.)
- **Character design**: Strong at generating characters with specific details when
  prompted well
- **Transparent backgrounds**: Supported natively via `background: "transparent"`
  with PNG output

### Limitations

- **Pixel art is interpretive, not pixel-perfect**: The model generates 1024x1024
  images that _look like_ pixel art but are not actual low-res pixel grids. For
  real game sprites, you may need to downscale and clean up output, or treat
  generated images as reference art.
- **Style consistency across generations**: Each generation is independent. Even
  with the same prompt, results will vary. Reuse exact style descriptions and
  specify colors by hex code to maximize consistency.
- **Seamless tiles**: The model can approximate tileable textures but they may not
  tile perfectly. Manual cleanup may be needed.
- **Transparent background bug**: When using `background: "transparent"`,
  gpt-image-1 sometimes removes white areas within the subject itself. See the
  "Transparent Background Best Practices" section in SKILL.md for workarounds.
- **No revised prompt**: gpt-image-1 does NOT return a `revised_prompt` via the
  `/v1/images/generations` endpoint (unlike DALL-E 3). You cannot see how the
  model reinterpreted your prompt.
- **No image preview in CLI**: Claude Code cannot display images inline. The user
  must open generated files in an external viewer.

---

## Style Presets

These are starting-point suggestions. Adapt them to the specific request —
combine elements, adjust details, change palettes. Do not use them as rigid
templates.

### Pixel Art

> "Pixel art style, clean pixels, limited color palette, no anti-aliasing,
> [NxN] pixel canvas"

Variations:

- **Retro 8-bit**: "8-bit retro pixel art, NES-era color palette, 4-color limit per sprite"
- **16-bit**: "16-bit pixel art, SNES-era, richer color palette, subtle shading"
- **Modern pixel**: "Modern pixel art, detailed sub-pixel shading, vibrant colors"

### Flat Vector / UI

> "Clean flat vector illustration, solid colors, no gradients, sharp edges,
> minimal design, suitable for UI"

### Hand-Painted / Concept Art

> "Digital painting style, visible brush strokes, rich color blending,
> concept art quality, painterly lighting"

### Isometric

> "Isometric perspective, 2:1 ratio, clean edges, game-ready isometric tile,
> consistent light source from top-left"

### Low-Poly 3D

> "Low-poly 3D render, flat-shaded polygons, minimalist geometric style,
> soft studio lighting"

### Watercolor / Storybook

> "Watercolor illustration style, soft edges, paper texture, gentle color
> bleeding, storybook quality"

---

## Game-Specific Style Presets

### By Game Genre

**Platformer (2D side-scroller)**

> "2D side-view perspective, vibrant colors, clear silhouette, readable at
> small size, platform-game style"

**Top-Down RPG**

> "Top-down perspective, 45-degree overhead view, RPG style, detailed but
> clean, readable at tile size"

**Card Game**

> "Card illustration style, portrait framing with border space, rich detail
> in center, painterly quality"

**Visual Novel**

> "Anime/manga illustration style, character portrait, expressive features,
> clean line art, soft cel shading"

**Mobile/Casual**

> "Bright cheerful style, rounded shapes, thick outlines, high contrast,
> mobile-friendly clarity"

### Tactics / SRPG Sub-Styles

**FFT / Yoshida Style** (Final Fantasy Tactics, Tactics Ogre)

> "Isometric tactical RPG, chibi pixel art sprites with 1:2 head-to-body
> ratio, muted earth-tone palette — aged parchment beiges, warm ambers,
> olive greens, dusty browns, slate blues. Dark grey outlines (#282828),
> medieval manuscript aesthetic, pencil hatching with warm watercolor tones,
> diamond tile grid, diorama quality"

**Tactics Ogre / Dark Tactics** (grittier variant)

> "Dark medieval isometric tactical RPG, pixel art with semi-realistic
> proportions, somber muted palette — dark browns, deep purples, charcoal
> greys, blood reds, cold blues. Political war drama aesthetic, limited
> color index, gritty fantasy, pencil etching with CG coloring"

**Shining Force / Classic 16-bit SRPG**

> "16-bit Genesis SRPG style, bright saturated pixel art, angled 3/4
> top-down view, vivid colorful palette, heroic adventure aesthetic,
> anime-influenced character design, tile-based terrain, clean readable
> sprites with bold outlines"

**Fire Emblem GBA**

> "GBA pixel art tactical RPG, top-down grid view, 16-color sprite
> palette, clean readable faction-colored units (blue player, red enemy),
> dark grey outlines (#282828), anime character portraits, snappy
> proportions, strategic clarity"

**Disgaea / Anime Tactics**

> "Anime chibi SRPG, extreme super-deformed proportions with oversized
> heads, vivid saturated high-contrast neon colors, 2D hand-drawn sprites
> on isometric terrain, exaggerated anime eyes and hair, comedic fantasy
> aesthetic, bright and energetic"

**HD-2D / Modern Tactics** (Triangle Strategy, Octopath Traveler)

> "HD-2D style, pixel art sprites in 3D environment, tilt-shift diorama
> effect with depth-of-field bokeh blur, volumetric lighting, SNES-inspired
> pixel characters on detailed terrain, dynamic shadows, warm atmospheric
> lighting, retro-modern hybrid, miniature diorama aesthetic"

### Palette Suggestions by Theme

| Theme          | Palette Description                                                |
| -------------- | ------------------------------------------------------------------ |
| Fantasy Forest | Deep greens, warm golds, mossy browns, dappled sunlight            |
| Dungeon/Dark   | Cool grays, deep purples, torch-orange highlights, dark atmosphere |
| Ocean/Water    | Teals, deep blues, seafoam white, coral accents                    |
| Desert/Arid    | Sandy yellows, terracotta, burnt orange, pale blue sky             |
| Cyberpunk      | Neon pink, electric blue, dark chrome, purple haze                 |
| Cozy/Wholesome | Warm pastels, soft pinks, cream, light wood tones                  |
| Horror         | Desaturated greens, blood red accents, deep shadows, fog gray      |

---

## Prompt Templates by Asset Type

### Characters / Sprites

```
[Style]. [Character description] in [pose]. Facing [direction].
[Outfit/armor/accessories]. [Color palette]. The subject is a standalone
element on a transparent background — do not remove any white or light
areas within the subject. For a [genre] game.
```

### Tilesets / Terrain

```
[Style]. [Terrain type] tile, seamlessly tileable. Top-down view.
[Lighting direction]. [Color palette]. [Texture details].
```

### Items / Collectibles

```
[Style]. [Item name/type], [key visual details]. Centered on canvas.
The subject is a standalone element on a transparent background — do not
remove any white or light areas within the subject. [Size context].
```

### UI Elements

```
[Style]. [UI element type] for a [game genre] game.
[State: normal/hover/pressed]. [Color scheme]. [Shape details].
Transparent background.
```

### Backgrounds / Scenes

```
[Style]. [Scene description]. [Time of day/lighting]. [Mood/atmosphere].
[Perspective]. [Dimensions context].
```

---

## Cost Estimates

Costs are approximate and subject to change. Check
[OpenAI pricing](https://openai.com/api/pricing/) for current rates.

| Quality | Square (1024x1024) | Rectangular (1024x1536 / 1536x1024) |
| ------- | ------------------ | ----------------------------------- |
| Low     | ~$0.011            | ~$0.014                             |
| Medium  | ~$0.042            | ~$0.063                             |
| High    | ~$0.167            | ~$0.250                             |

### Typical Session Costs

| Scenario                                  | Est. Cost |
| ----------------------------------------- | --------- |
| Quick prototype: 5 medium sprites         | ~$0.21    |
| Character sheet: 8 low-quality variations | ~$0.09    |
| Full tileset: 12 medium tiles             | ~$0.50    |
| Hero art: 2 high-quality scenes           | ~$0.50    |
| Heavy session: 20 mixed assets            | ~$1-3     |

---

## History File Schema (.imagegen-history.jsonl)

Append-only JSONL. Each line is a self-contained JSON object:

```jsonc
{
  "id": "assets/sprites/robot-idle-v2", // Auto-derived from output path
  "timestamp": "2026-03-15T14:32:07Z", // ISO 8601 UTC
  "prompt": "Pixel art style...", // Exact prompt sent to API
  "output": "assets/sprites/robot-idle-v2.png", // Relative to project root
  "params": {
    "size": "1024x1024",
    "quality": "medium",
    "background": "transparent",
    "model": "gpt-image-1",
  },
  "parentId": "assets/sprites/robot-idle", // null for first-of-concept
  "bytes": 231044,
  "outputFormat": "png", // Image encoding format
}
```

The file is **append-only** — entries are never modified in place. It is also
**disposable** — if deleted, the skill still works. Claude falls back to
conversation context for iteration.

---

## Tips for Better Results

1. **Iterate at low quality first.** Use `--quality low` to explore concepts
   quickly (~$0.01/image), then upgrade to `medium` or `high` for the keeper.

2. **Be explicit about what you do NOT want.** "No text", "no watermark",
   "no background elements", "no gradient".

3. **Reference real art styles.** "In the style of Studio Ghibli backgrounds"
   or "Celeste-inspired pixel art" gives the model strong anchors.

4. **For tilesets, generate one tile at a time.** Requesting a full grid in a
   single image produces inconsistent results.

5. **Transparent backgrounds work best with PNG.** Always use `--background
transparent` and a `.png` output path together. Include the anti-leak
   prompt language described in SKILL.md.

6. **Square (1024x1024) is most versatile.** Use rectangular only when the
   content clearly benefits (landscapes, tall characters).

7. **Specify colors by hex code for consistency.** "Using colors #3A7D44,
   #F2C94C, #EB5757" produces more consistent results across generations than
   "green, yellow, and red".
