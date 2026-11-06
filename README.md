# Cube Simulator

A hyper-real, physically simulated jelly cube that runs in the browser.

**Play:** https://nickcason.github.io/cube-simulator/

Grab it, throw it, poke it — then go to work on it:

| Tool | What it does |
| --- | --- |
| Hand | Drag to grab and throw, tap to poke |
| Knife | Swipe across the jelly to slice it (partial swipes leave a slit) |
| Nail gun | Fire nails that stay embedded and wobble with the jelly |
| Mallet | Smack it — frozen jelly shatters |
| Torch | Melt it until it sags, drips and caves in |
| Cryo spray | Freeze it solid and frosty |
| Melon baller | Scoop out a ball of jelly |
| Cherry bomb | Plant a bomb, stand back |
| Syringe | Pump it up until it bursts |
| Magnet | Pull the nails — and whatever they're stuck in |

**Heal** ejects every nail, thaws and cools it, pulls every fragment back into
place and fuses it into a pristine cube.

**Make it yours** (the colour button in the dock):

- **Flavor** — cherry, lime, blue raspberry, grape, orange, lemon, watermelon, cola,
  **rainbow** (six layered slices — the layers show on every cut face) or any custom colour.
- **Texture** — Jello (clear, wobbly), Gummy (cloudy, chewy, firmer), Sour (sugar-crystal
  coating), Crystal (glass-clear), Creamy (milky panna-cotta).
- **Edges** — Sharp, Soft, Round or Pillow; the cube re-forms with the new rounding.

**Settings** (the sliders button) fine-tune everything live — each slider shows what it
means (Wobbly, Syrupy, Moon, Super ball…):

| Group | Settings |
| --- | --- |
| Feel | Firmness, Viscosity, Density (weight), Squash (volume keeping → foam), Bounce, Grip |
| Look | Opacity, Translucency, Colour depth, Gloss, Refraction |
| Bubbles | Count (0–240), Size |
| World | Gravity (Moon → Jupiter), Cube size |

Picking a texture resets the material sliders to that texture; **Reset** puts everything back.

Choices are remembered. You can also link straight to a combo, e.g.
`?flavor=rainbow&texture=gummy&edges=pillow`.

![Rainbow jelly cube](docs/rainbow.jpg)

Keys: `1`–`0` tools, `H` heal, `M` sound, hold `Space` for slow motion. Drag empty space to orbit, scroll or pinch to zoom.

## How it works

- **Physics:** XPBD soft body on a tetrahedral mesh (~6.6k tets) with the stable
  Neo-Hookean constraints of Macklin & Müller (2021), rigid-motion-preserving
  damping, friction, inter-piece contact and sleeping. Temperature softens or
  stiffens the material per tet.
- **Cutting:** conforming tet splitting along implicit surfaces (planes, spheres)
  with vertex snapping for flat, clean cut faces; partial cuts are re-glued
  outside the knife stroke; frozen fracture splits along element boundaries.
- **Rendering:** three.js with a custom multi-pass jelly shader — per-pixel
  thickness from back-face depth, two-interface refraction with dispersion and
  total internal reflection, Beer–Lambert absorption, scattering, studio
  reflections — plus area-ratio caustics and a tinted shadow on the floor,
  bloom and tone mapping.
- **Sound:** every sound is synthesized with WebAudio.

## Develop

```sh
npm install
npm run dev     # http://localhost:5190
npm test        # physics/cutting tests (node --test)
npm run build
```
