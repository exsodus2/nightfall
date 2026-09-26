// GLSL for the VFX surface (SURFACE 8) of the city material. materials.ts splices these two
// strings in: VFX_GLSL_DECLARATIONS before main() (it may call datum/skyColor/lighting/carLight/
// strokeFor/bayer/noise2 defined above it), VFX_GLSL_BRANCH as the body of `if (SURFACE > 7.5)`.
// The branch writes the same locals as every other surface (code, thin, paper, ink, emission,
// useCharacter) and then shares fog, tone mapping and fade-in with the rest of the city.
//
// Per-draw data, chosen so VFX draws never touch the props' own channels:
//   cellColor.a * 255 = mode (VFX_MODE), cellColor.rgb = secondary colour
//   charColor.rgb = main colour, charColor.a = mode parameter (blur / density / intensity)
//   charRotation = wheel angle (only read by the wheel mode)
//   u_vfxCenter / u_vfxHalf / u_vfxAxis / u_vfxSeed = volume placement (steam, searchlights)
// Positions are textmode world coordinates (Y down), like v_worldPosition.

export const VFX_SURFACE = 8;
export const VFX_MODE = { wheel: 10, steam: 20, beam: 30 } as const;

export const VFX_GLSL_DECLARATIONS = `
uniform vec3 u_vfxCenter, u_vfxHalf, u_vfxAxis;
uniform float u_vfxSeed;
float vfxHash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vfxNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vfxHash3(i), vfxHash3(i + vec3(1, 0, 0)), f.x), mix(vfxHash3(i + vec3(0, 1, 0)), vfxHash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(vfxHash3(i + vec3(0, 0, 1)), vfxHash3(i + vec3(1, 0, 1)), f.x), mix(vfxHash3(i + vec3(0, 1, 1)), vfxHash3(i + 1.0), f.x), f.y), f.z);
}
// Light scattered by vapour at q: ambient sky glow plus the scene's point lights (street lamps,
// neon signs) without a surface normal, plus passing headlights.
vec3 vfxScatter(vec3 q) {
  vec3 sum = vec3(0.1, 0.13, 0.16);
  for (int i = 0; i < 8; i++) {
    vec3 delta = datum(i).xyz - q;
    float d2 = dot(delta, delta), radius = datum(i).w;
    sum += datum(i + 8).rgb * pow(max(0.0, 1.0 - d2 / (radius * radius)), 2.0) / (1.0 + d2 * 0.023) * 2.2;
  }
  return sum + carLight(q, vec3(0.0, -1.0, 0.0), 0.0) * 0.8;
}
// Entry/exit distances of a ray through an axis-aligned box.
vec2 vfxSlab(vec3 ro, vec3 rd, vec3 lo, vec3 hi) {
  vec3 inv = sign(rd + 1e-7) / max(abs(rd), vec3(1e-5));
  vec3 a = (lo - ro) * inv, b = (hi - ro) * inv, n = min(a, b), f = max(a, b);
  return vec2(max(max(max(n.x, n.y), n.z), 0.0), min(min(f.x, f.y), f.z));
}
`;

export const VFX_GLSL_BRANCH = `
  int vfxMode = int(v_cellColor.a * 255.0 + 0.5);
  if (vfxMode == ${VFX_MODE.wheel}) {
    // Spinning wheel, drawn on a quad over the tyre's sidewall (v_uv 0..1). Big on screen: a real
    // wheel - tyre, a rim traced by strokes that follow the circle, five spokes turning with the
    // wheel (and smearing into a disc with speed), a hub cap. Small: the rim as O's around the
    // official spinning glyph ('+' rotated by the wheel angle, t.charRotation). Tiny: one 'o'.
    vec2 q = (v_uv - 0.5) * 2.0;
    float r = length(q);
    if (r > 1.0) discard;
    float across = 2.0 / max(max(fwidth(v_uv.x), fwidth(v_uv.y)), 1e-4); // cells across the wheel
    float spin = v_glyphFlags.a * 6.2831853, blur = v_glyphColor.a;
    vec3 light = lighting(p, n, vec3(1.0), 0.25);
    vec3 metal = v_glyphColor.rgb * light, rubber = v_cellColor.rgb * light;
    paper = rubber * 0.55;
    if (across < 2.6) { code = A_O; thin = across < 1.6; ink = rubber * 2.6 + metal * 0.25; }
    else if (across < 8.0) {
      if (r > 0.7) { code = A_O; thin = true; ink = rubber * 2.8; }
      else { useCharacter = true; ink = metal * (1.5 - blur * 0.5); paper = rubber * 0.7; }
    } else if (r > 0.9) { code = A_DOT; thin = true; ink = rubber * 2.2; }
    else if (r > 0.62) {
      // Tyre wall and rim: iso-lines of r, drawn with the stroke that follows the circle on screen.
      code = strokeFor(r); thin = r > 0.78;
      ink = r > 0.78 ? rubber * 3.0 : metal * 1.9;
      if (r <= 0.78) paper = metal * 0.3;
    } else if (r < 0.17) { code = across > 14.0 ? A_AT : A_O; ink = metal * 2.2; paper = metal * 0.35; }
    else {
      float a = atan(q.y, q.x) - spin, sector = 6.2831853 / 5.0;
      float k = floor(a / sector + 0.5), d = abs(a - k * sector);        // angle to the nearest spoke
      float halfWidth = mix(0.17, sector * 0.5, blur);
      float spokeAngle = k * sector + spin;
      if (blur > 0.92) { code = A_COLON; thin = true; ink = metal * 0.9; }   // a blurred disc
      else if (d < halfWidth) {
        code = strokeFor(dot(q, vec2(-sin(spokeAngle), cos(spokeAngle))));
        thin = blur > 0.6; ink = metal * (2.5 - blur * 1.1);
      } else { code = A_SPACE; ink = metal; paper = rubber * 0.35; }
    }
  } else if (vfxMode == ${VFX_MODE.steam}) {
    // Steam plume: density integrated along the view ray through the volume box, rising noise,
    // widening with height, lit by the lamps and signs around it. Thin cells are dithered away so
    // the street shows through; dense cells draw vapour characters.
    vec3 lo = u_vfxCenter - u_vfxHalf, hi = u_vfxCenter + u_vfxHalf;
    vec2 span = vfxSlab(eye, view, lo, hi);
    if (span.y <= span.x) discard;
    float stepLength = (span.y - span.x) / 7.0, density = 0.0;
    vec3 mid = vec3(0);
    for (int i = 0; i < 7; i++) {
      vec3 q = eye + view * (span.x + (float(i) + 0.5) * stepLength);
      vec3 local = (q - u_vfxCenter) / u_vfxHalf;
      float rise = clamp((1.0 - local.y) * 0.5, 0.0, 1.0);              // 0 at the base, 1 at the top
      float radius = 0.14 + 0.8 * rise;
      vec2 across = local.xz - vec2(0.3, 0.12) * rise * rise;                 // the plume leans with the wind
      float shape = 1.0 - smoothstep(radius * 0.1, radius * 0.9, length(across));
      float swirl = vfxNoise3(q * vec3(1.3, 0.7, 1.3) + vec3(u_vfxSeed * 17.0, u_time * 0.9, 0.0)) * 0.65
                  + vfxNoise3(q * 1.9 + vec3(0.0, u_time * 1.6, u_vfxSeed * 5.0)) * 0.35;
      float dq = shape * smoothstep(0.0, 0.12, rise) * (1.0 - smoothstep(0.45, 1.0, rise)) * max(swirl - 0.36, 0.0) * 3.2;
      density += dq * stepLength; mid += q * dq;
    }
    // Near the eye the plume thins out (walking through steam must not blind the view).
    float alpha = (1.0 - exp(-density * v_glyphColor.a)) * smoothstep(1.5, 7.0, span.x);
    // Draw only the dense wisps (a world-space mask, so no screen-door pattern); a narrow ordered
    // dither softens their edges only.
    if (alpha < 0.22 + bayer(gl_FragCoord.xy) * 0.2) discard;
    vec3 light = vfxScatter(density > 0.001 ? mid / max(density / stepLength, 1e-4) : p);
    vec3 vapour = v_glyphColor.rgb * light;
    code = alpha < 0.36 ? A_DOT : alpha < 0.52 ? A_COLON : A_TILDE; thin = alpha < 0.72;
    // Steam scatters the light around it, so its cells read brighter than the street behind.
    ink = vapour * (0.7 + alpha * 1.2);
    paper = vec3(0.006, 0.01, 0.013) + vapour * (0.1 + alpha * 0.22);
    emission = vapour * alpha * 0.08;
  } else if (vfxMode == ${VFX_MODE.beam}) {
    // Searchlight: closest approach of the view ray to the beam axis, a slowly widening cone,
    // brighter when looking along it. Strokes run along the beam on screen.
    vec3 w0 = eye - u_vfxCenter, axis = u_vfxAxis;
    float b = dot(view, axis), d = dot(view, w0), e = dot(axis, w0), denom = max(1.0 - b * b, 1e-4);
    float along = clamp((e - b * d) / denom, 0.0, u_vfxHalf.y), ray = max((b * e - d) / denom, 0.0);
    float dist = length(w0 + view * ray - axis * along);
    float radius = u_vfxHalf.x * (1.0 + along * 0.011);
    float haze = 0.65 + 0.35 * noise2(vec2(along * 0.05 - u_time * 0.2, u_vfxSeed * 30.0));
    float intensity = exp(-pow(dist / radius, 2.0)) * (1.0 - smoothstep(u_vfxHalf.y * 0.25, u_vfxHalf.y, along)) * haze * (1.0 + 0.8 * b * b) * v_glyphColor.a * 0.85;
    if (intensity < 0.16 + bayer(gl_FragCoord.xy) * 0.55) discard;
    code = strokeFor(dot(p, normalize(cross(axis, view)))); thin = intensity < 0.6;
    ink = v_glyphColor.rgb * (0.35 + intensity * 1.1);
    paper = skyColor(view) * 0.9 + v_glyphColor.rgb * intensity * 0.06;
    emission = v_glyphColor.rgb * intensity * 0.25;
  } else discard;
`;
