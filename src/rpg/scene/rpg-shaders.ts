// Optional GLSL for the city material (materials.ts, owned by the lead): an "RPG combatant" surface
// (SURFACE 9) = the prop surface's lighting plus a fresnel rim in the figure's own hue, so enemies
// separate from the dark street without outlines drawn in geometry. Splice it like VFX_GLSL_BRANCH:
//
//   in cityMaterial(), replace   `if (SURFACE > 7.5) {`
//   with                         `if (SURFACE > 8.5) {\n${RPG_GLSL_BRANCH}\n  } else if (SURFACE > 7.5) {`
//
// then call enableEnemyRimLight(true) (rpg/scene) so drawEnemies records its instances with
// surface 9 (PropRecorder.surface) / sets u_surface 9 on the direct path. Until then enemies use the
// plain prop surface 2 and still read through their emissive seams, eyes and ground ring.
// The branch uses only locals/functions the surface-2 branch already uses (p, n, view, eye,
// lighting, bayer) and writes the shared outputs (paper, ink, emission, useCharacter), so fog, tone
// mapping and glyph transforms apply as for any prop. It carries the props' range dissolve itself
// because main()'s range test only covers surfaces 2-3 and 5.

/** Surface id of the rim-lit enemy material branch. */
export const RPG_SURFACE = 9;

/** Body of `if (SURFACE > 8.5) { ... }` in the city material. */
export const RPG_GLSL_BRANCH = `
    float rpgRange = v_cellColor.a * 255.0;
    if (rpgRange < 254.5) {
      float rpgEnd = rpgRange * 4.0, rpgFade = 1.0 - smoothstep(rpgEnd * 0.76, rpgEnd, length(p.xz - eye.xz));
      if (bayer(gl_FragCoord.xy) > rpgFade) discard;
    }
    vec3 rpgAlbedo = v_glyphColor.rgb;
    float rpgPeak = max(rpgAlbedo.r, max(rpgAlbedo.g, rpgAlbedo.b));
    float rpgEmissive = smoothstep(0.64, 0.95, rpgPeak);
    vec3 rpgLit = mix(lighting(p, n, rpgAlbedo, 0.22), rpgAlbedo, rpgEmissive * 0.9);
    // Fresnel from the per-cell normal: silhouette cells of the ellipsoid torso/head and grazing box
    // faces catch a cool rim tinted by the part's own hue (emissive parts already glow).
    float rpgRim = pow(1.0 - clamp(abs(dot(n, view)), 0.0, 1.0), 2.5) * (1.0 - rpgEmissive);
    vec3 rpgHue = rpgAlbedo / max(rpgPeak, 0.08);
    vec3 rpgRimColor = mix(vec3(0.55, 0.62, 0.7), rpgHue, 0.6) * 0.32;
    emission = rpgAlbedo * rpgEmissive * 0.7 + rpgRimColor * rpgRim * 0.4;
    paper = rpgLit * 0.5 + rpgRimColor * rpgRim * 0.35;
    ink = rpgLit * 1.45 + rpgRimColor * rpgRim * 1.2;
    useCharacter = true;
`;
