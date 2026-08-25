/**
 * TemplateGradeShader
 *
 * The grade a view template puts over the finished frame: saturation, contrast,
 * a warm or cool push, a vignette, and optionally a hard step down to a few
 * levels of tone, which is what makes shading read as drawn rather than lit.
 * Done in display space, so the numbers behave the way they would in an image
 * editor.
 *
 * Kept apart from ColorGradeShader on purpose: that one grades in Kelvin for the
 * manual controls, this one takes the template's own numbers unchanged so a
 * template looks the same here as it does in the viewer it came from.
 */
export const TemplateGradeShader = {
  name: 'TemplateGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    warmth: { value: 0 },
    vignette: { value: 0 },
    levels: { value: 0 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float warmth;
    uniform float vignette;
    uniform float levels;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = pow(max(texel.rgb, 0.0), vec3(1.0 / 2.2));

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, saturation);
      color = (color - 0.5) * contrast + 0.5;
      color *= vec3(1.0 + warmth, 1.0 + warmth * 0.2, 1.0 - warmth);

      if (levels > 0.5) {
        color = floor(clamp(color, 0.0, 1.0) * levels + 0.5) / levels;
      }

      float radius = length(vUv - 0.5) * 1.414;
      color *= 1.0 - vignette * smoothstep(0.35, 1.0, radius);

      gl_FragColor = vec4(pow(clamp(color, 0.0, 1.0), vec3(2.2)), texel.a);
    }
  `,
}
