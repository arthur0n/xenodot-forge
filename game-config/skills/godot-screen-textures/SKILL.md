---
name: godot-screen-textures
description: Read screen-space textures (screen color, depth, normal-roughness) inside a Godot 4.x spatial post-process shader, including correct depth linearization per renderer and normal decoding. Use this skill whenever a shader needs hint_screen_texture, hint_depth_texture, or hint_normal_roughness_texture, when depth values look all-white/all-black or non-linear, when normals seem wrong, or as the prerequisite step before any edge-detection or outline shader.
---

# Godot Screen-Space Texture Access

Canonical uniforms and decode functions for reading the screen, depth, and normal buffers in a post-process spatial shader. These are the building blocks every screen-space effect samples from.

## Requirements

- The fullscreen quad rig from skill `godot-postprocess-quad` must already exist; this skill only edits `res://shaders/post/post_process.gdshader`.
- Godot **4.3+** (reversed-Z; the linearization below assumes it).
- **Renderer matters — check Project Settings → Rendering → Renderer before writing code:**
  - `hint_normal_roughness_texture` exists **only in Forward+**. On Mobile or Compatibility it is unavailable; any plan that needs normals must state "Forward+ required" to the user instead of writing code that compiles but reads garbage.
  - Depth NDC reconstruction differs on Compatibility (OpenGL): see the variant in the code.

## Project conventions

- All three uniforms and the helper functions live at the top of `post_process.gdshader`, above `vertex()`. Later skills assume these exact names: `screen_texture`, `depth_texture`, `normal_texture`, `get_linear_depth()`, `get_normal()`.
- For pixel-art pipelines use `filter_nearest`; smoothing filters reintroduce blur the SubViewport setup removed.

## Code

```glsl
uniform sampler2D screen_texture : hint_screen_texture, repeat_disable, filter_nearest;
uniform sampler2D depth_texture : hint_depth_texture, repeat_disable, filter_nearest;
uniform sampler2D normal_texture : hint_normal_roughness_texture, repeat_disable, filter_nearest;

// Linear view-space depth at a given UV (Forward+/Mobile, Godot 4.3+ reversed-Z).
float get_linear_depth(vec2 uv, mat4 inv_projection_matrix) {
	float depth = texture(depth_texture, uv).x;
	vec3 ndc = vec3(uv * 2.0 - 1.0, depth);
	// Compatibility (OpenGL) renderer instead requires:
	// vec3 ndc = vec3(uv, depth) * 2.0 - 1.0;
	vec4 view = inv_projection_matrix * vec4(ndc, 1.0);
	view.xyz /= view.w;
	return -view.z;
}

// View-space normal at a given UV, decoded from 0..1 to -1..1.
vec3 get_normal(vec2 uv) {
	return texture(normal_texture, uv).xyz * 2.0 - 1.0;
}
```

Usage inside `fragment()`: pass `INV_PROJECTION_MATRIX` explicitly — built-ins are not visible inside helper functions:

```glsl
float d = get_linear_depth(SCREEN_UV, INV_PROJECTION_MATRIX);
vec3 n = get_normal(SCREEN_UV);
vec3 screen = texture(screen_texture, SCREEN_UV).rgb;
```

## Verification checklist

Verify each buffer with a one-line visualization in `fragment()` (run one at a time):

- [ ] `ALBEDO = vec3(fract(get_linear_depth(SCREEN_UV, INV_PROJECTION_MATRIX)));` → repeating grayscale bands following object distance, like contour lines. Smooth gradient OK; **uniform white or black = broken**.
- [ ] `ALBEDO = get_normal(SCREEN_UV) * 0.5 + 0.5;` → faces colored by orientation (distinct colors per face of a cube). Flat single color = broken.
- [ ] `ALBEDO = texture(screen_texture, SCREEN_UV).rgb;` → the scene looks normal (identity pass-through).

## Error → Fix

| Symptom                                                             | Fix                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Depth all white/black                                               | Raw depth used without linearization, or wrong NDC variant for the renderer (see Compatibility line in code) |
| Depth bands look inverted vs. 4.2-era tutorials                     | Reversed-Z in 4.3+ — keep this skill's code, distrust pre-4.3 snippets                                       |
| Normals flat gray / shader error on `hint_normal_roughness_texture` | Renderer is not Forward+ — switch renderer or drop normal-based features                                     |
| Sky areas produce garbage normals/depth                             | Expected: sky writes no G-buffer; later effects must threshold or mask, not "fix" this here                  |
| `INV_PROJECTION_MATRIX` undefined in helper function                | Built-ins only exist in main functions; pass it as a parameter (as in this skill's code)                     |
| Screen texture is blurry in pixel-art project                       | Uniform declared without `filter_nearest`                                                                    |
