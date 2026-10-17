# Roadster Simulator

A WebGPU (Three.js r186, `three/webgpu`) driving simulator of the 2nd-gen Tesla Roadster revealed Oct 15, 2026.
Specs and sources are in [SPECS.md](SPECS.md).

```
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```
WebGPURenderer falls back to WebGL2 automatically when WebGPU isn't available. The top-left chip shows which backend is active.

## Trims
| | Performance | Thrust | Rocket |
|---|---|---|---|
| Tesla 0-60 claim | < 1.6 s | < 0.9 s | < 0.59 s |
| Simulated 0-60 | 1.60 s | 0.88 s | 0.58 s |
| Thrusters | — | 4 rear cold-gas | rear + perimeter (lift, kickflip, attitude) |

Run `node tools/simtest.mjs` to re-check calibration headlessly. `node tools/jumptest.mjs` checks the Rocket's thruster kickflip over the Semi line (no ramps, as at the reveal).

## Controls
- **W A S D / arrows**: drive. In the air on the Rocket trim, pitch and roll (Z/X yaw)
- **Shift**: rear thrusters · **E**: lift thrusters (hover/fly) · **Q**: kickflip
- **Space**: handbrake/drift · **F**: suction fan · **G**: retractable wing mode (auto: stowed below ~35 mph, up above ~50 mph, airbrake under hard braking / track: always up / low drag) · **J**: jet assist (Rocket; fires only above ~120 mph under hard braking/cornering)
- HUD chips and flags are clickable: camera, day/night, sound, menu, suction, wing, jet assist
- **C**: camera (chase, far, cockpit, wheel, drone, cinematic) · **V**: doors · **R**: reset upright
- **T**: teleport (launch lane → Semi jump → lot) · **N**: day/night · **M**: mute · **Esc**: menu
- Gamepad (standard Xbox/PlayStation layout only; flight sticks and HOTAS are ignored): RT/LT, left stick, A handbrake, RB thrust, Y lift, B kickflip, X reset, LB fan

**Physics (independently reviewed):** load-sensitive tires (μ falls as load rises, so suction helps but doesn't double grip), slightly grippier rear tires for stability, friction-circle priority that keeps cornering force under braking and throttle (ideal ABS/traction control), front-biased brakes, power-limited regen, steer-by-wire angle limited to what the tires can use, and yaw-based stability control (switched off while the handbrake is held, for drifting). Measured: 2.1–2.5 g cornering with suction (Tesla claims ~2 g), 1.3–1.5 g without, and no spins in 72 limit tests. Total downforce is capped at Tesla's displayed 4,700 kg. The air tank is stored as impulse (N·s) at 3× a physically plausible 250 L / 700 bar tank; R refills it.

**Assists:** the suction fan adds 0.55 g of downforce cruising and launching, rising to 1 g under braking and cornering (HUD shows the live value). The Rocket's perimeter jets add retro-thrust under braking, push into corners, and automatically cushion landings, bringing touchdown from ~12 m/s to ~2 m/s. The Thrust trim's nozzles only face rearward, so they can't brake or corner. Check with `node tools/assisttest.mjs`.

**Thruster effects** are calibrated frame by frame against the reveal Semi-jump footage, a fixed camera on the whole Semi jump. It plays at 2.5× slow motion: 15 real frames/s, shown as 6 unique frames/s. Comparisons use a game camera solved per footage frame.
- Each nozzle emits a stream of gas points, and the jet is drawn as a soft camera-facing ribbon through them, with a halo, a mist sleeve and a ragged leading edge. Columns bend, trail and dissolve.
- Lift and landing jets are long bluish columns that end in a soft mist pool. Roll and attitude jets are cyan cones ~2.5 m long that splay outward and bloom: 2–3 at a time during the roll, longer while braking the roll, and flank cones during the descent from the drift correction.
- The roll starts as the pop ends (0.5 s), is inverted at 1.3 s, hangs to 2.0 s, reaches ~335° at 2.9 s and settles level by ~3.2 s. The landing burn already fires during that settle, so the columns slant with the banked body as in the footage. Through the settle and the descent the rear flank ports pulse alternately, left then right, to trim the sideways drift. The landing burn (rear pair first, with horizontal braking) runs to touchdown at 4.3 s. At takeoff each pop column throws a quick low mist where it hits the ground.
- Only gas that reaches the ground makes cloud. The landing cloud is a gas-parcel mesh (marching cubes in a worker) that bounds a ray-marched density volume. The march runs from the hull to the far side of the volume. Opacity and edge crispness follow the amount of gas. The young, thick core next to the car has crisp, brightly lit (HDR) billows and reads cyan-white. Older, thinner gas is soft, darker and see-through, with its noise stretched sideways into torn streaks, and the base fades out raggedly instead of ending in a straight line on the tarmac. It is lit by its own self-shadowing. A swelling parcel thins (density ~1/r²), ageing gas flattens and spreads sideways into low streaks, and there is no wind by default. Sizes come from the reveal side camera (hov frames, timed by the car's height, touchdown ≈ f32.5): ~10 m wide 0.9 s before touchdown, ~13 m × 4 m at touchdown, ~23 m by +1 s, ~26 m by +2 s, mostly gone by +3 s. A fountain of gas thrown up between the columns builds the mound under the hovering car, then rises at the car's front and rear ends once it is down. A ring roll-up that forms after touchdown carries the bank outward, mostly fore and aft. A clearing around the car (the jets keep the gas off the body) lets it show between the heaps, as in the footage. Dense gas keeps its billow structure, and dim, shadowed gas is drawn greyer, so the bank reads as structured smoke rather than a teal wash even from the Chase camera inside it. Gas within ~2–10 m of the camera is thinned.
- Every value is live-tunable in the FX editor (`src/game/fxParams.js`).

The launch timer arms whenever you come to a full stop. It records 0-60, 0-100 and the ¼ mile, and keeps a best time per trim.

## Layout
- `src/car/RoadsterModel.js`: procedural Roadster model. `PlaceholderRoadster.js` is the fallback
- `src/game/Vehicle.js`: rigid body with raycast suspension, a Pacejka-lite tire model, aero, fan suction and thrusters
- `src/game/World.js`: a normal parking lot, day or night: worn asphalt, painted stalls, parked cars, LED poles, curbed islands, warehouse, fence, road with utility poles, and the Semi line from the demo
- `src/game/Effects.js`: thruster jets (vapor-core shader per nozzle), allocation of jets to thrust/lift/torque demand, emission of gas parcels
- `src/game/CloudSim.js` + `CloudCore.js` + `cloudWorker.js`: condensation clouds as dynamic meshes. Gas parcels have physics (jet momentum, drag, cold-gas sinking that warms toward neutral, curl-noise turbulence, parcel pressure, ground and car collision). Each frame a Web Worker meshes their density field with marching cubes, so clouds merge, billow, fray and evaporate as real geometry
- `src/game/layout.js`: shared lot layout (with a spatial grid) used by both physics and visuals

## License & disclaimer
Code is MIT-licensed (see [LICENSE](LICENSE)). This is an unofficial fan project, not affiliated with or endorsed by Tesla, Inc. "Tesla", "Roadster" and "Semi" are trademarks of their respective owners. The car is a procedural approximation built in code; no Tesla assets or footage are included. Reference photos and video used during development are not distributed.
