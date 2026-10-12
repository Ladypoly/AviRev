# AviRev agent handoff

Updated 12 October 2026. AviRev reviews exported avatar assets and builds Human/Robot avatars in a browser. It renders Unity-exported geometry, morphs, textures and body coverage with Three.js. It also offers phone AR and controller-driven WebXR placement, movement and a room-pinned configurator. Unity remains the authority for authored assets, identities and legal appearance rules.

## Release status

**Live on Bonto:** https://avi-rev.bonto.run/builder.html serves builder `6bd9b9bb07e3` (12 October 2026, fourth release of the day): [Release 6bd9b9bb07e3](#release-6bd9b9bb07e3) on top of `16b15af95ec5`. Its 10 changed runtime files were uploaded dependencies-first with `builder.html` last; all 22 builder runtime files (including `browser_data/creator_contract.json`) byte-matched local with HTTP 200, correct MIME and zero redirects, and the live page ran 8 creator states in headless Edge without console errors.

## Release 6bd9b9bb07e3

- **Unity-identical browser creator.** `builder.html`/`builder.css`/`builder.js` were rewritten after `AvatarPanelPresenter`, `AvatarUiStyles`, `OptionTile` and `ColourColumn`: nav card (family switch, groups with "n of m" captions), mirror card (Front/Side), detail card (rows, 88 px tiles with CDN pictures, sliders, segments) and the colour column (`ColorPickerElement` compact theme, presets, glow). Unity element ids (`veAvatarTab`, `btnAvatarColour`, `scrAvatarColour`…) are kept for cross-reference. The only extra chrome is the WebXR/AR launch button in the top-right corner; review tools sit in a drawer behind the existing review unlock.
- **Unity rules, not web approximations.** `builder-contract.mjs` ports `OptionAvailability`, `AvatarConfigResolver.Clamp`, `WornConfig.For`, `DefaultLook`, `ClothingLayers.Pick`, `BodyShape.SetFemale`, `HeadgearRules` and `HumanColourDefaults` over `browser_data/creator_contract.json`, a one-off read-only export of Unity's catalog, strings, palettes, allowances and glow limits at the top of the reward ladder (level 50; ladder saved 2026-10-12T09:48Z). The temporary Unity exporter was deleted after use; Unity has no trace of it.
- **Parity test.** `tests/unity-parity.mjs` (now in `npm test`) replays `tests/fixtures/unity_creator_vectors.json`: 600 Unity-computed clamps and 200 pick/body sequences, 1,802 checks. A mutation run confirmed it fails on rule drift.
- **Colours follow `HumanColourDefaults.Fill`.** Unset skin keeps the material's own colour (the web previously forced `#e9bfae`); lips (0.5) and nails (0.75, was 0.5) only follow a chosen skin.
- **Mirror framing.** Face/Head focus frames the posed head in world space (width and depth, so idle turns stay in frame) and keeps the head top visible in the narrow portrait mirror.
- **Picker swatches** apply on `click` (was `pointerdown` only, which synthetic/panel clicks never fired).
- **Headset panel bridge** reads the new DOM (`colour-tabs` + `scrAvatarColour`); tile picks, colour tab, HEX dispatch and scene controls were exercised in a browser.
- **Double jump enters fly mode** (`flyFromJump`), in addition to the stretch hold.
- Not done: no pixel overlay against a live Unity capture (`AvatarUiScriptedCapture` needs Unity in the foreground).

## Release 16b15af95ec5

- **Room collision step height:** `XRWorld.canOccupy` ignores the lowest 4 cm (`STEP_HEIGHT`). Quest room scans are bumpy (about ±1.5 cm); the old 3 mm clearance made scan noise block placement, standing, crawling and flight in Room mode, which matches the earlier "avatar gets stuck" reports.
- **Holds are 1 s** (fly, floor sit, land) with an orange progress ring at the avatar's feet. Mostly vertical right-stick input no longer turns; wobble under 0.3 s does not restart a hold. A completed stretch hold commits takeoff while clips load (pulling back cancels); gesture clips preload after placement. Takeoff clearance is checked 15 cm up; landing uses the standing capsule and accepts a bumpy floor.
- **Placement ring** draws above depth-only occluders and falls back to the floor plane when a scan triangle at floor height is too tilted.
- **Occlusion source** (Scene → Performance): Off, Room setup (planes), Scanned mesh, Setup + scan (default), Live depth (WebXR `depth-sensing`, gpu-optimized, consumed by three.js; requested at session start, unverified on hardware).
- **Wrist menu** reduced to Hide/Show panel and Reposition.
- `tests/native-xr.mjs` now also runs both rigs on a synthetic bumpy room scan: placement, crouch sit/stand, stretch takeoff, climb and pull-back landing.

## Release 6c23a0d23dcf The 7 changed runtime files were uploaded dependencies-first with `builder.html` last; all 20 builder runtime files then matched local SHA-256 with HTTP 200, correct MIME and zero redirects, and the live page loaded in headless Edge (SwiftShader WebGL) with GPU and `?cpu-skinning` modes and no console errors other than the absent favicon.

**Previous release `77c817dca138`:** the Puppet T-pose/hand/upper-body fixes, native strafe correction, Floor-only collision choice, landing timing, grip removal and stretch-to-fly gestures described below. All 610 release resources passed hosted HTTP/MIME/SHA checks then (40,940,912 bytes).

## Release 6c23a0d23dcf

- **Puppet hands:** hands now follow the absolute WebXR grip frame (spec: grip -Z toward the thumb, +Y up the arm, +X out of the right hand's back / -X for the left), mapped onto each rig's measured T-pose hand. The old delta-from-calibration mapping assumed palms down; holding controllers in a T-pose gives palms forward, a constant ~90° wrist error. Verified on both native rigs, direct and mirrored, with palms-forward and palms-down calibration.
- **Sitting:** `stopWalk()` no longer resets the AR frame clock. Seated frames call it every frame, which froze the pose transition at standing height (floor sit and chair sit). Floor sit now rests the pelvis 6–9 cm above the floor. Seated avatars ignore the right-stick turn.
- **Performance:** GPU skinning (`SkinnedMesh`, bone texture written by the animation player; CPU positions only on demand via `posedPositions()`), about 5× less animation CPU and no per-frame vertex uploads. `?cpu-skinning` restores the legacy path for A/B checks. Scene → Performance adds render quality (framebuffer scale at session start, live foveation), half-rate animation, room occlusion and avatar shadow toggles and a live fps readout; settings persist per browser. Cheaper Puppet IK and no per-frame duplicate-surface rebuilds from tracking jitter.
- **VR creator UI:** the headset panel was rebuilt from the "Studio Mirror" design (1 unit = 1 mm of the 0.96 × 1.04 m panel): header family/body switches with Undo/Redo, category rail, 3×3 thumbnail tiles with lock levels, Now wearing strip, hue ring + shade square colour picker, Scene sub-tabs (Modes, Move, Place, Performance, Preview) and a palm-up left-wrist quick menu. It still dispatches only through the native DOM controls. Hover-to-preview from the design is not implemented.
- **Tests:** `npm test` also runs `tests/native-xr.mjs` (real catalog, rigs and clips in Node): grip orientation, crouch-hold floor sit/stand, seated turn lock and GPU/CPU skin parity.

Unverified on hardware: GPU skinning, wrist-menu palm detection, panel legibility and real frame time on Quest.

**GitHub:** the same tested website snapshot, runnable controller test, this handoff and the Unity parity plan are published to `Ladypoly/AviRev` main. Verify the repository's latest commit before taking ownership. Do not upload this entire workstation parent directory.

**Only local:** validation reports, native/browser fixtures, screenshots, source backups and the private account-integration candidate. These are excluded from the public Git repository. There is no separate unshipped XR correction candidate in the source mirror; further changes need a new test/release. The actual physical Quest pass remains open.

**Planned, not implemented:** the Unity legality/export freshness and non-XR visual matching work in [Unity web parity plan](unity-web-parity.md). The current creator still defaults to unrestricted All art. Account-linked current-level/owned-reward selection still awaits the approved SideQuest client and backend API integration.

## Answers for the incoming agent

### Scope

Finish and verify the current release gate before starting another change. Native/controller/browser checks and the Bonto upload/hash verification are already complete for builder `77c817dca138`; the tested snapshot and handoff are on GitHub main. When GitHub main has this handoff and that builder hash, do not republish it merely because an older handoff said “local.” Run `npm test`, compare the live builder version and inspect Git status.

The current assignment is the XR fixes, release, and a concrete Unity parity plan—not a broad audit or a claim that parity is implemented. The next recommended assignment is Stage 1 of [the Unity parity plan](unity-web-parity.md): native live-contract export plus reproducible legality/clamp cases. Implement that stage when it is the next user-assigned task; do not start the non-XR visual rewrite ahead of the native legality contract.

### Bonto access

Release `6c23a0d23dcf` used the Bonto MCP connector after the user authorized a device-code login (`upload_file` to `v2/<relative path>`, then curl POST). Release `77c817dca138` used Bonto's official CLI (`@sidequestvr/bonto`), with an existing workstation login, because the MCP connector had timed out. The app is `avi-rev`; website uploads go to `v2/<relative path>`. With the CLI available, use `bonto auth status` to check access, and `bonto files upload avi-rev v2/<relative> <local-file>` for reviewed files. Dependencies/assets must precede modules and HTML; then verify the deployed bytes. No credential is stored in this public repository.

If your session cannot use the authenticated workstation CLI or a working Bonto connector, you cannot publish from that session. Ask the user to connect Bonto, complete `bonto auth login`, or have the existing authorized publisher perform the upload. Do not copy credentials between sessions or invent an alternative deploy identity. Since this correction is already live, lack of Bonto access does not block the next read-only/native parity work. Local packaging helper paths are in the workstation handoff, not this public repository.

### Physical Quest

Neither Atlas nor a remote agent can establish comfort, tracking, passthrough/controller orientation or headset frame time using the desktop fixtures. The user or an agent with an actual connected Quest must perform the numbered device pass below and report the device/browser/room setup. The user is the current hardware tester; there is no automatic headset test or background owner. You may improve the reproducible tests, but must leave the physical pass unverified until real evidence arrives.

### Unity and Blender ownership

No agent in this release team holds an active Unity or Blender editor reservation. All source writers are released; the web work did not require editor mutations. The last successful Unity MCP inspection found the correct Greenfield project in clean `Assets/Scenes/Main.unity`, Edit Mode, no selection. Blender's current filepath/dirty state was not inspected in this correction.

This is not a guarantee that the user or another chat is idle. Recheck `TEAM_STATUS.md`, actual connected editor filepath/scene, selection and unsaved state, and coordinate with any other active editor owner before play mode, import, export, rebuild, save or loading another file. Use one editor owner at a time. Read-only source work for the parity plan can proceed without taking a save/import lease. Never overwrite the existing unrelated dirty Unity assets.

## Architecture and ownership

| File or directory | Responsibility |
| --- | --- |
| `builder.js`, `builder.html`, `builder.css` | Native DOM creator, bindings, configuration storage, category/colour controls and browser bootstrap |
| `builder-model.mjs` | Configuration, body-type changes and appearance/part resolution |
| `builder-renderer.mjs` | Native mesh/morph/material/coverage consumers, rig playback and grounding |
| `builder-animation.mjs` | Retargeting, native skeleton playback, transition blends and Puppet upper-body IK |
| `builder-ar.mjs` | XR session/placement, controller arbitration, posture/flight/calibration and companion integration |
| `builder-movement.mjs` | Acceleration, gravity, jump and swept movement |
| `builder-xr-world.mjs` | Session-only mesh/plane tracking, BVH collisions, support and depth-only room occlusion |
| `builder-follow.mjs` | Bounded floor-route planning and 1.5 m Follow distance |
| `builder-xr-panel.mjs` | XR canvas panel consuming the native DOM callbacks, sliders, help and laser grabbing |
| `browser_data`, `data`, `chunks`, `thumbnails`, `animation` | Generated/exported browser assets and licensed animation previews |
| `index.html`, review scripts/render assets | Asset review, including legacy/archive/donor copies |

Keep one writer per source file and one owner of any shared Unity/Blender editor. Read the actual state before loading, saving or rebuilding. This task inspected Unity through MCP: the correct Greenfield project was in clean Main/Edit Mode. It did not change Unity/Blender assets or save editor scenes.

## Corrections already live in this release

- **Puppet calibration:** both thumbsticks pressed together while the player holds a T-pose. There is no automatic sides-down calibration. The panel button gives instructions/resets calibration; it does not calibrate a different pose. The chord consumes run-toggle input.
- **Hand orientation:** calibration uses deterministic true T-pose native wrists for both rigs, including Robot's authored A-pose. Controller grip rotation is calibrated against that frame. Mirrored/direct modes remain available.
- **Upper body:** head, torso and arms use bounded head/hand IK. Native reference finger locals stay stable; pelvis/legs use the actual idle animation. Puppet vertical-stick/jump gestures do not steal upper-body ownership. Explicit valid Scene pose actions switch to Manual. Puppet/Follow entry requires standing on the floor.
- **Strafe:** the actual directional clip carried about a 90-degree pelvis heading even when the avatar group's yaw never changed. Shared native retargeting now removes that unwanted heading while retaining lateral leg swing. Test the visible pelvis/body, not only group quaternion. Left stick translates; right horizontal turns.
- **Collision:** Room remains default. Scene → Modes & controls → Collision → Floor only ignores furniture/ceilings and uses the placement floor. It still requires current tracking, and can bypass bad/over-budget room geometry for movement. It deliberately allows the avatar through furniture/walls.
- **Landing:** impact animation is spread over 0.32 seconds, with a 0.30-second exit blend into idle/gait. Jump owns playback until landing completes.
- **Grip:** no sit/stand binding. Grip may still grab the configurator's bottom handle. Ground crouch held still for two seconds sits; right-stick forward stands.
- **Flight:** right-stick forward stretches; hold for two seconds to enter flight. Forward rises, backward descends. At lowest floor height hold backward for two seconds to land. Menu interaction, tracking loss and interrupted gestures cancel dwell timers.

The current UI correction remains XR only. The desktop/mobile layout and stylesheet have been preserved. The future non-XR Unity match is a separate planned stage.

## Validation and remaining device checks

Owner checks passed for real AR/motor consumers and native rigs/weighted geometry. Independently authored AR edge, native layer and transition checks passed; Atlas reran them against the released files (1,327 + 756,144 + 4,650 assertions). The reviewer found invalid Puppet/Follow entry during priority poses; it was fixed and the reproduction passed. The reviewer could not deliver a final prose verdict because agent execution hit model capacity, so final integration signoff is Atlas-reviewed. Real native WebGL passed 188 checks across both families/body types, plus 22 actual creator/XR bindings. `npm test` in the Git checkout passes 1,327 synthetic controller checks without installing dependencies. Physical Quest behavior is unverified.

The next physical Quest pass must verify:

1. Place the avatar in a scanned room; choose Floor only and compare movement through the formerly sticking areas. Verify Room still collides with furniture and UI stays above occlusion.
2. Enter Puppet while standing; T-pose plus both thumbstick clicks calibrates once. Lower hands into relaxed controller holding, rotate wrists and turn/lean head. Check mirror/direct sides, head-to-torso response, idle legs and reference fingers. Retry after lost controllers, changed avatar/proportions and room movement.
3. Move left/right at several avatar headings: body stays facing forward and feet visibly step sideways. Check diagonal movement and right-only turning, run toggle and hold.
4. Jump standing and moving; verify the landing has no pose/root/boot snap. Check low ceiling, tracking interruption and rapid repeat A.
5. Hold stretch for two seconds: takeoff, release to hover, forward climb, backward descend. Hold backward at floor for two seconds: land without immediately sitting. Verify menus/tracking loss cancel timers.
6. Grip must never sit/stand. Joystick crouch/sit/stand and panel grabbing must remain usable.
7. Measure headset frame time with the user's real room scan (Scene → Performance shows fps). Compare Sharp/Balanced/Fast, occlusion and shadow off, and `?cpu-skinning`. Synthetic BVH checks are not a Quest performance measurement.
8. Puppet: calibrate with palms forward, then relaxed controller hold; avatar wrists must match the controllers in mirror and direct modes.
9. Hold crouch 2 s: the avatar sits on the floor, not at hip height; right stick forward stands. Chair sit lands on the seat.
10. Headset panel: tabs, tiles, colour ring/square drag, Undo/Redo, Scene sub-tabs; turn the left palm up for the wrist menu and use it with the right ray.

## Confirmed unresolved Unity parity issues

The existing exported creator rows originate from Unity's unrestricted editor art catalog. Browser manual All-art selection bypasses progression; randomization already applies stricter closed-order rules. The packaged snapshot has 58 Robot skins but the public reward order includes only 1–31: the 27 extras appear in manual review creation despite lacking the same live Unity reward eligibility. Do not delete these authored assets or recycle ordinals.

Changing browser preview level currently disables tiles without deriving Unity's clamped worn configuration. Imported/saved high-level choices can remain rendered at a lower level. The appearance resolver also duplicates native layer/default rules. These are behavioral gaps, not a missing texture refresh.

Follow [the parity plan](unity-web-parity.md): native live contract separate from review art → shared stored/working/worn legality → native end-to-end expected cases → actual Unity non-XR UI captures and dimensions → fingerprinted release gate. Do not infer current Unity behavior from older READMEs; some describe outdated body-type/UI rules.

Other limits remain: Follow navigates continuous scanned floors without stairs/climbing; room mesh occlusion is static and does not provide live per-eye depth occlusion for moving unscanned objects; collision does not include every loose garment/hair strand. Review-tab hiding is a convenience, not authentication.

## Local development and safe release

Run `python -m http.server 8843 --bind 127.0.0.1` from the repository root and open `/builder.html`. WebXR on a headset needs HTTPS. Use `python tools/version-runtime.py` after source edits to update module/HTML hashes. Do not run it concurrently with another writer.

Before publishing, inspect Git status, preserve unrelated changes, run the relevant native/controller/UI checks, obtain focused independent review, then exercise actual native WebGL consumers. Publish one coherent exported snapshot, dependencies/assets first and HTML last. Verify hosted HTTP/MIME/SHA/no-redirect results and real browser load; only then push the same tested website snapshot. Never upload private diagnostics, account state, credentials, authoring Blender files or Unity source assets.

Third-party licences/provenance are bundled with `libs`/`animation`. Existing RPM custom-avatar/web-distribution permission was explicitly confirmed by the user. Do not add an arbitrary root project licence.

The Bonto builder version identifies the tested runtime snapshot. Use `git log -1` and the commit containing this handoff for the repository revision; private release proof records the final pushed SHA. Keep unshipped work and device/parity limits visible. There is no shutdown request in this session.
