# Physics audit

How each interaction works, what you can control, and where the logic is
weak. Written 2026-11-06 from a line-by-line survey of the code. **Fixed**
marks what this pass changed. **Open** lists what's still weak, roughly
most noticeable first.

Settings → **Feel** holds the material knobs. Settings → **Lab controls**
(a switch) shows the knobs inside the hand and each tool. Every Lab knob
defaults to how things behaved before.

## The jelly itself

**Model.** A tetrahedral soft body solved by XPBD, 12–24 substeps a frame
(the rate adapts to the device). Each tet carries:
- shear stiffness (Firmness) and volume stiffness (Squash);
- non-rigid damping (Viscosity);
- density;
- per tet: a temperature multiplier (`tMu`), a volume scale (`tVS`, from
  torch slump and syringe), and now tear damage (`tDmg`).

Pieces sleep when still. A per-tet cap stops tiny tets from buzzing.

**Controls.** Firmness, Viscosity, Density, Squash, Bounce, Grip, and the new
**Rigidity** and **Toughness**.

**Fixed.**
- **Rigidity** (new): shape matching. Each moving piece is pulled toward its
  own rest shape, rotated and placed as it is now (`SoftBody._solveRigidity`).
  - It's a time constant, so it feels the same at any substep rate.
  - It's stable at any setting, and cheaper at high settings (pieces settle
    sooner).
  - Measured on a 1.2 m drop: landing squash goes from 22% (jelly) to 2%
    (rigid), and the wobble disappears.
  - Vertices a hand holds aren't pulled back.
- **New presets:**

  | preset | squash | rebound | settles |
  |---|---|---|---|
  | Tofu (firm, dead) | 7% | 1 cm | 1.6 s |
  | Putty (soft, dead) | 15% | 0 cm | 1.2 s |
  | Hard candy (rigid, glossy) | 2% | 16 cm | – |

  Glass is now rigid too.

**Open.**
- Firmness is clamped by `App.safeMu` (about 850·ρ·size²). Above that, XPBD at
  these substep counts rings, so "stiffer than Rubber" comes only from
  Rigidity.
- Frozen stiffness is capped by stability, not by material. Rubber can only
  stiffen 1.13× when frozen, slime 15×. The cap also shrinks when the device
  drops substeps.
- Hot jelly softens the same way for every material (`tMu = e^(−3.2T)`, down
  to 3.5%), while its volume stiffness stays full.

## Hand (grab, drag, throw, poke, two-hand tear)

**Model.**
- **Grab:** the vertices within a radius of the touch are pulled toward the
  finger each substep. The pull uses a compliant constraint, with a cap on
  how far a held vertex can move per substep. It backs off while the held
  piece presses into another piece.
- **Throw:** let go and the piece keeps the velocity it had.
- **Poke:** a quick tap adds a velocity kick.
- **Tear:** only two hands tear.
  1. Pull a piece apart past 1.12× the distance you took hold at.
  2. Once the middle band is stretched past the piece's limit, it starts to
     give: a ragged seam is cut across the pull but left glued, and the band
     either side softens.
  3. Keep pulling and the seam unzips from the edge nearest the most-stretched
     spot, a stage at a time (`unglue`), until the halves part.
  4. Ease off and the rip waits, still open, until the next pull.

**Controls.** Feel: Toughness, the Tearing switch. Lab: Grab size, Hand
strength, Poke.

**Fixed.**
- Tearing:
  - **Stretch and time:** it takes about 18% more stretch than before, and
    gives over a sustained pull rather than snapping. Both depend on
    stiffness: limit = material base × (1.08 + 0.17·softness) × √toughness;
    time = (0.6 + 1.6·softness) s × toughness. The rip runs across visibly
    (jello about 1 s, gummy about 0.6 s, slime about 0.8 s from first give to
    apart), and pauses when the slit relieves the stretch.
  - **No more violent flying apart:** at the 4–6× stretch a long pull reaches,
    the halves used to fly apart at 15–36 m/s. Now:
    - the torn ends stay soft and firm up over 1 s;
    - soft materials yield (the ends stay drawn out, like taffy);
    - each hand re-anchors on its half and eases back to the finger;
    - the cut's slivers are removed;
    - the jiggle is damped for 0.3 s.

    Result: 2–6 m/s.
  - Its timing runs on sim time (it used to run 5–10× fast in slow motion and
    during hit-stop), and its effects stay on the two torn halves.
- Grab radius and poke radius scale with cube size.

**Open.**
- The held patch keeps its world orientation (offsets are fixed at grab time),
  so a piece can't turn about the hand.
- The drag speed cap is per substep, so throw speed varies with device load
  (about 8.6 m/s at 720 Hz vs about 5 m/s at 420 Hz).
- Grab stiffness depends on local vertex mass: denser jelly is held more
  loosely.
- Poke is a velocity add: marshmallow and lead jump the same.

## Knife
**Model.**
- **Cut:** a plane through the eye and the stroke, limited to the part of
  the jelly under the stroke.
- **Snap:** vertices near the cut are snapped onto it, using the
  deformation gradient so the rest shape stays consistent.
- **Push:** both sides are pushed apart along the normal.

**Controls.** Lab: Knife push.

**Open.**
- A stroke that ends inside the jelly leaves a hinge, but both sides of the
  hinge still get pushed apart, adding strain.
- The push ignores mass.

## Nail gun and nails

**Model.**
- **Flight:** nails fly at 34 m/s.
- **Embed:** on hitting jelly, a nail is held by two barycentric anchors
  joined by a stiff distance constraint, and it gives the jelly a 2.6 m/s
  kick.
- **Free nails:** two-particle rods that hit only the floor and the wall.

**Controls.** Lab: Nail power (speed and kick).

**Fixed.** Freed nails (ricochets, popped loose, heal ejects, magnet
release) used to start at 3× their intended speed: 6× at 120 fps, 15× in
slow motion. They now start at their intended speed.

**Open.**
- Free nails pass through jelly.
- Embed depth and kick ignore material and speed.
- Any embedded nail keeps every piece awake, so nothing sleeps while one is
  in.

## Mallet

**Model.**
- **Strike:** a kinematic flat face drives a dent, about 13–26 cm × size,
  then lets go and the jelly springs back.
- **On-beat hits** (a predicted wobble period, ±20%) deepen the dent and lower
  damping. Six in a row burst it along seams.
- **Frozen jelly** shatters along crack planes instead.

**Controls.** Lab: Mallet force (depth and speed).

**Open.**
- The dent depth ignores stiffness, so rigid materials store 5–6× the energy
  for the same dent.
- The pusher hits every piece in its path.
- The beat model is empirical and mixes real time with sim time.
- The ringing (lower damping) is global.
- The table whack hits every vertex below 25 cm.
- Burst and shatter flings ignore mass.

## Torch

**Model.**
1. Heat goes in at r 0.3 (2.1/s), diffuses along the mesh and relaxes over
   about 22 s.
2. Hot tets soften (`tMu`) and slump (`tVS` drops to 0.62).
3. Bare, slumped tets melt in batches every 0.15 s.
4. Half their volume becomes liquid; the rest boils off.
5. The crater is smoothed and spikes are removed.

**Controls.** Lab: Torch heat, Boil-off.

**Fixed.**
- **The spike explosion from your screenshot.** Every melt batch used to
  re-smooth every corner any melt had ever exposed, across the whole body.
  Over a long torching the same corners were smoothed dozens of times, and
  tets were squeezed flat until they blew up into spikes.
- **Smoothing was applied in the wrong frame:** a rest-space move was added to
  current positions, so on a rotated piece it pointed the wrong way.
- **Now:** it smooths only that batch's rim, in the rest shape only, and won't
  shrink any tet below 70% of its size or below a floor.
- **Result:** a 60-batch torching keeps mesh quality flat, top speed 2.5 m/s,
  no spikes.

**Open.**
- Heat and slump radii don't scale with size.
- Diffusion runs on the mesh graph, so it's faster on bigger cubes.
- Heating wakes every piece every frame.
- Masses lag `tVS` until the next rebuild.
- Rigidity's target ignores `tVS`, so it fights slumping and inflation.

## Cryo

**Model.** It cools jelly (r 0.3, −1.5/s) and molten jelly (r 0.45).
- **Frozen jelly** stiffens up to 15× (capped for stability), shatters under
  the mallet, and tears at 1.12× stretch.
- **Molten jelly** turns to slush and sets into a new piece shortly after the
  spray moves off it.

**Controls.** Lab: Cryo cold.

**Open.** The freeze, shatter and tear thresholds are the same for every
material, and the stiffening cap depends on substep rate (see The jelly
itself).

## Melon baller
**Model.** A sphere cut (r 0.21) 0.14 s after the click. The ball is flung
out with a uniform velocity.

**Open.**
- The scoop uses where the jelly was at the click, not where it is 0.14 s
  later, so wobbling jelly gets scooped in the wrong place.
- The radius doesn't scale with size.
- The fling ignores mass.

## Cherry bomb
**Model.**
- **Fuse:** 1.9 s.
- **Crater:** a sphere cut (r 0.24); the debris becomes droplets.
- **Blast:** a radial velocity field (10 m/s at r 1.7) on every piece.

**Controls.** Lab: Bomb power (strength, plus radius scaled by its square
root).

**Open.**
- The blast is a pure velocity field: it ignores mass and density, and
  stretches each piece across its spread.
- Self-contact is switched off for every piece for 0.5 s after the blast.

## Syringe
**Model.**
- **Inflate:** tets within 0.4 m of the tip swell (`tVS` up to 3.2).
- **Burst:** at 3.1, a sphere cut plus droplets.
- **After the burst:** every tet everywhere relaxes 70% of the way back.

**Controls.** Lab: Syringe pump.

**Open.**
- The burst is on rest scale, not real stretch, so rubber bursts as soon as
  pudding.
- The relax afterwards is global and instant (it even un-slumps torch tets).
- Pulling out early leaves it inflated.
- Mass lags the inflation.

## Magnet
**Model.**
- **Pull:** an inverse-square pull on nails within 2.6 m.
- **Embedded nails:** they tug their anchors, slide out past a threshold, and
  then home in.
- **Free nails:** get a positional nudge.

**Controls.** Lab: Magnet pull.

**Open.**
- The pull on the jelly depends on mesh resolution (it goes through the
  anchors' vertex masses).
- Free nails feel about 3× the coded pull (a per-frame nudge read as a
  per-substep move). It's left alone because the feel was tuned with it.

## Jelly against floor and wall

**Model.**
- **Contact:** vertices are projected out of the floor and the wall.
- **Friction:** Coulomb friction on the floor (Grip).
- **Bounce:** a scripted per-piece rebound (Bounce), floor and wall only.

**Controls.** Feel: Grip, Bounce. Lab: Air drag.

**Fixed.** Wall friction was a fixed 0.4. It now follows Grip (0.4 at the
default).

**Open.**
- The rebound only moves the centre of mass, so an off-centre landing doesn't
  spin.
- Its trigger and window are fixed, and it can't tell a fall from being
  pressed down.
- Sleep thresholds aren't scaled by size.

## Jelly against jelly

**Model.**
- **Detection:** probes (surface vertices and face centres) look for a tet of
  another piece they're inside.
- **Push-out:** through the entry face, else the nearest face, else the
  escape field; mass-weighted with split impulses (no bounce).
- **Friction:** light friction on the slip.
- **Sleepers:** a sleeping piece is immovable until something pushes on it
  hard enough to wake it.

**Controls.** Lab: Jelly on jelly (friction).

**Open.**
- No restitution control between pieces.
- The correction cap is per substep, so push-out speed varies with device.
- Friction uses the full penetration rather than the applied correction.
- The broad phase is O(pieces²), the main cost after big cutting sprees.

## Self-contact
**Model.** It only applies to:
- hinged flaps;
- soft jelly (global Firmness < 110);
- pieces flagged as folded.

Fold and tangle checks catch what slips through and pull the piece back into
shape.

**Open.**
- The gate uses global Firmness, so melting or torn jelly doesn't
  self-collide.
- The 0.5 s "quiet" after any blast is global.
- Untangling writes positions and velocities directly, which removes spin.

## What I'd fix next, in order
1. **Make effects scale with mass and size.** Poke, nail kick, blasts, flings
   and the table whack add fixed velocities; they should add fixed impulses,
   with radii that follow cube size.
2. **Make behaviour independent of the device.** Express the grab cap and
   contact cap per second, so throws and push-outs don't change with load.
3. **Let the hand rotate the piece.** Rotate the held offsets with the
   patch's fitted rotation.
4. **Make tools material-aware.** Mallet dent depth from stiffness; syringe
   burst from real stretch; nail depth from material.
5. **Contain global side effects.** Ringing damping, the post-blast
   self-contact quiet, the syringe relax, wake-all on heat and nails.
6. **Speed up the broad phase.** It's O(pieces²) (see the sitrep on cut-spree
   lag).
