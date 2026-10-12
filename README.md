# AviRev avatar builder

The version-controlled browser avatar builder and asset review. The production site is https://avi-rev.bonto.run/builder.html. Bonto hosts the site directly. This repository contains the website source and exported browser assets; Unity/Blender authored projects, private diagnostics and account credentials are excluded.

## Run locally

From the repository root:

```sh
python -m http.server 8843 --bind 127.0.0.1
```

Open http://127.0.0.1:8843/builder.html. WebXR needs HTTPS on a phone/headset; localhost is suitable for desktop checks.

## Source and assets

`builder.js`, `builder-*.mjs`, `builder.html` and `builder.css` are the creator source. `browser_data`, `data`, `chunks` and thumbnails contain exported Unity catalogs, meshes, shapes, materials and browser previews. These exports come from Unity's existing **Tools → Character Diagnostics → Export browser review data** workflow. Keep saved numeric choices and catalog versions intact. Never hand-edit generated catalog IDs or bake/coverage data to fix a UI rule.

After changing a module, update its dependency cache hashes with:

```sh
python tools/version-runtime.py
```

`index.html` is the asset review; the creator hides its tab until the review cheat is used. Hiding this tab is not access control. Public source assets remain publicly accessible.

## XR controls

The scene panel controls Manual, Puppet and Follow. Left stick moves/strafe, right stick turns. Left click toggles run (hold option available). A jumps. Hold right-stick forward to stretch, and hold it for 2 seconds to enter flight; forward rises, back descends. At the lowest floor height, hold back for 2 seconds to land. Stationary ground crouch held for 2 seconds sits; right-stick forward stands. Grip does not sit/stand; it can move the panel using its bottom handle.

Puppet calibration: extend arms sideways in a T-pose and press both thumbsticks together. The scene panel offers mirrored/direct control and recalibration instructions. Only legs play idle; head, torso and hands use tracked IK.

Collision defaults to scanned Room geometry. Scene → Modes & controls → Collision offers Floor only for rooms with unreliable scans; it ignores furniture and walls. Follow aims for 1.5 m and can route around scanned furniture in Room mode. No stair navigation or climbing is provided.

The current UI redesign applies to XR only. Unity selection/UI parity work is planned in `docs/unity-web-parity.md`; account-linked live rewards await the backend client/API integration.

## Controller regression checks

With Node.js installed, run `npm test` (no dependency installation needed). This exercises real AR/controller consumers with synthetic headset/grip poses, mode guards, strafe, floor-only motion and timed flight gestures. Physical Quest validation remains separate.

## Publication and validation

Keep assets/modules before HTML when publishing cache-versioned files. Validate the deployed hashes and actual native renderer/UI bindings. Desktop/synthetic checks do not establish physical Quest controller comfort, tracking or frame performance. Source/native assertions and browser proofs are kept locally outside this public repository.

Third-party runtime/animation attribution and licences are under `libs/` and `animation/`. Compact preview textures are included; full authoring textures stay in their source projects.
