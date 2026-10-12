# Unityâ€“web avatar parity plan

2026-10-12. Read-only source and packaged-data inspection by Patch. This is a plan for the next stage; no runtime, Unity asset, editor state, or publication changes were made.

## Outcome and immediate diagnosis

Use Unity's live avatar rules as the reference for the public creator. Keep unrestricted art inspection as an explicit review mode. Reproduce the current Unity **non-XR** creator presentation using actual captures and resolved layout metrics. Preserve the separately designed XR interaction panel.

The current website is an art-review snapshot with a creator attached. It is not currently a live-rule replica:

1. `browser_data/AviRevBrowserExportImplementation.cs:45` builds `OptionGroups` from `Assets/Systems/AvatarUI/Editor/AllOptionsCatalog.cs`, an intentionally unrestricted editor/photo-booth catalog. That produces art rows with `ClosedOrder = false` and empty unlock orders. The live Unity presenter instead uses its host's progression-backed catalog and `OptionAvailability`.
2. `builder.js:81â€“103` treats `previewIndex == 0` as All art. Manual tiles, shape capabilities, grades, and colour wheels become unrestricted. `randomizeAvatar()` additionally filters closed orders, but `rowOptions()` and manual picking do not. Thus manual selection and random selection do not have the same legal domain.
3. The exact packaged catalog contains Robot skin ordinals **1â€“58**, while its packaged reward snapshot lists **1â€“31** in the closed unlock order. The 27 additional authored skins are valid art assets, but the public manual creator currently offers them without corresponding rewards. A Unity live row built from that same reward snapshot excludes them entirely. This does not prove that today's API ladder is unchanged: the website has no freshness contract with it.
4. A selected preview level changes control availability, but does not derive a clamped worn configuration. `refresh()` passes the same config to `resolve()`; neither takes an allowance source. Import a high-level configuration, then preview Lv 1: unavailable picks can remain rendered while their tiles are disabled. Unity derives `WornConfig.For(...)` from an untouched stored copy and clamps selections, shapes, colours, toggles, visemes, and glow before resolving the appearance.
5. Browser default/layer rules are duplicated in `builder-model.mjs`, despite the exporter supplying `Rules`. For example `selectedOrdinal()` expects `defaults.ordinals`; the actual export has named `Outfit/Top/Bottom/HairStyle/...` fields, so it falls back to literals. `LAYERS`, `PIECES`, FemaleFrom=50, and lip/nail shade constants are also independent copies. The web resolver adds a skin default `#e9bfae`, which was an intentional browser visual change rather than an exported Unity default. Existing resolution fixtures do not cover the full current live pipeline.

## Stage 1 â€” Establish one native export contract

Extend the existing read-only native exporter; do not introduce a new service or replace the UI framework.

Authoritative producers:

- `Assets/Systems/AvatarUI/AvatarSection.cs` and `AvatarConfigKeeper.cs`: identity/loading, stored/live/preview state.
- `Packages/com.sidequest.avatar-ui/Runtime/Model/{AvatarOptionCatalog,OptionGroup,OptionAvailability,AllowanceRules,ClothingLayers,HeadgearRules,BodyShape,DefaultLook}.cs`: available rows, order, legality, defaults and action effects.
- `Packages/com.sidequest.avatar-ui/Runtime/Config/{AvatarConfigResolver,WornConfig}.cs`: preservation and clamping.
- `Assets/Systems/AvatarUI/CatalogRealOptions.cs`: actual available art and ordinal holes.
- `Assets/Systems/AvatarBake/{HumanAppearanceResolver,HumanPartCatalog,RobotPartCatalog}.cs`: chosen meshes, conflicts, shapes, textures and material values.
- `Packages/com.sidequest.progression/Runtime/Rewards/RewardCatalogBuilder.cs` and its existing global ladder source: cumulative closed orders, palette order and reward metadata.

Export **two distinctly named products**: `creatorContract` built from the native public/live catalog, and `reviewArt` built from AllOptionsCatalog. Both share exported geometry; archive/donor/legacy review assets remain review data rather than creator choices. Preserve stable category IDs, ordinals, retired IDs, mesh names, and configuration wire codes.

For creatorContract export the computed native `TileOrdinals()` order, row defaults, hidden/retired state, real ordinals, body scope, groups, colour slot modes/palettes, shape reward mapping and min/max, posture limits, semantic part rules, default look, hat/hair behavior, fits and corrections. Export reward-level states **after AllowanceRules.Apply**, including the stand-in outfit rule. Do not reimplement RewardCatalogBuilder in Python by parsing C# text. The existing `export_creator_ui.py` is a source-derived regex port; replace only its rule generation with native serialized results, retain its compact photo processing.

The native exporter must name the exact Resources/catalog assets used by the live app, not infer them from similar filenames. Export only public catalog/ladder metadata; exclude account snapshots, identity data, credentials, and ownership records. Account linking remains the separate backend integration already planned.

## Stage 2 â€” Use one browser legality path everywhere

Keep a stored config, a working preview config, and a derived worn config with the same semantics as Unity. Never save a clamp or destroy a locked pick during a temporary level change. After loading, importing, selecting, randomizing, resetting, changing family/body/level, or receiving account progression:

1. Validate the config DTO and supported schema.
2. Derive the source and native-equivalent allowance state.
3. Produce worn config with the Unity clamp rules.
4. Resolve geometry/material/coverage from that worn config.
5. Render control state from the same allowance source.

Move the current scattered browser availability decisions into the existing model boundary rather than adding parallel resolvers for DOM and XR. Both UI bindings, import/export, randomizer, and renderer consume the same result. A control disabled in the normal public UI cannot mutate state through its callback. Closed-order assets never appear as public creator tiles merely because a mesh exists.

Make normal creation use the Unity-equivalent level source. While account linking is unavailable, use a clearly labeled simulation/default level, not silent All-art mode. Keep unrestricted art and authoring controls behind the existing review unlock, with separate working state/export labeling so an unrestricted review look cannot masquerade as a live-legal config.

Preserve actual native behavior rather than old documentation: current `BodyShape.SetFemale` carries source hair/outfit picks to the new body and overwrites destination picks; the web implementation already agrees. `ClothingLayers.PiecesShown` is currently false, so public rows show outfits rather than independent top/bottom/dress/outerwear. Turning that native switch on in the future must flow through the contract rather than require a second browser fix.

## Stage 3 â€” Native reference cases become the release gate

Reuse `browser_data/unity_resolution_vectors.json` and `builder-native-check.mjs`, but extend vectors upstream to cover the entire pipeline: native action sequence â†’ stored/working config â†’ native allowance â†’ worn config â†’ Resolve â†’ coverage. The existing 995 vectors call `catalog.Resolve` directly and check mesh/shape/material/coverage; they do not demonstrate live allowance/presenter parity.

Include deterministic cases at every exported tier and boundaries just below/at unlock levels:

- Human male/female and Robot defaults, unset versus explicit None, required eyes/outfit fallback, unavailable/retired IDs and holes.
- Closed orders and API extras, an enabled outfit allowance with no unlocked outfit art, and the native stand-in rule.
- All 58 Robot skin IDs with public ladder state; 32â€“58 must be absent/illegal unless the native current reward catalog explicitly grants them.
- Hair-before-hat and hat-before-hair; every hatless hair ID; KeepsHair versus hatted mesh variants.
- Outfitâ†’piece and pieceâ†’outfit action order, while PiecesShown is false and in its test-only true state; part dependency conflicts and last-pick precedence.
- Every shape min/max and reward gate; crossing body_female 49â†”50; hidden shapes; boot fit, pants Height and correction keys.
- Imported high-level look viewed/worn at Lv 1, preview edits legal/illegal under live level, rank-down then rank-up restoration without changing stored JSON.
- Palette nearest-swatch clamp, custom-wheel enablement, hair-tip/eye-detail capabilities, glow and viseme limits, material texture choices and UV scale/offset.
- Seeded randomizer fixtures through the same legality path; no hidden/unavailable/unrewarded choices and the same resolved legal state.

Compare exact category/ordinal choices, ordered tile lists, clamp outputs, mesh names, shape weights, texture identifiers/scale-offset, coverage bitsets, and colours with a documented floating-point tolerance. Compare both pure browser model and actual DOM/XR callback consumers. Keep native expected files immutable during browser tests. An independent reviewer checks failures; publishing requires zero unresolved parity differences.

## Stage 4 â€” Reproduce the current Unity non-XR UI

Current implementation, rather than the older two-column README, is authoritative:

- `Packages/com.sidequest.avatar-ui/Runtime/UI/AvatarPanelPresenter.cs`: three columns, family/category navigation, central portrait, detail/colour accordion, status and tier footer.
- `AvatarPanelPresenter.{Options,Colour,Mirror}.cs`, `AvatarUiStyles.cs`, `OptionTile.cs`, `ColourColumn.cs`, and the existing colour-picker package: control construction, captions, focus, hover/locked states, photo behavior and picker layout.
- `Assets/Systems/AvatarUI/Editor/AvatarUiEditorMenu.cs`: existing live capture and resolved metrics dump.
- `Packages/com.sidequest.avatar-ui/Editor/AvatarUiScriptedCapture.cs`: deterministic level/group captures. These editor-window pictures are useful but do not replace the actual runtime Avatar tab reference.

Have Atlas coordinate one Unity capture window, preserving clean scene/editor state. Capture the actual non-XR creator at 1920Ã—1080 and its resolved panel bounds, font assets/settings, rendered labels, textures, group order and tooltips; capture narrower supported runtime sizes too. Reuse those dimensions and states in browser screenshots with fixed viewport/device scale. The menu surface and host padding affect layout, so do not guess from constants alone.

Known source metrics: nav basis 300/min 262/max 420; mirror basis 392/min 240/max 520; detail width 496; column gap 12; card padding 14; tiles 88/margin 8/radius 12; category rows 44; family rows 48; colour wheel 240; field width 200; locked opacity .35. Current CSS copies some of these, but uses Segoe UI/Arial and extra website chrome, Scene controls, filters and review tools. Native runtime fonts still need capture/asset inspection. Match the creator content rectangle and move website/XR/review utilities outside that rectangle.

Export style tokens/resolved text metrics from native code where useful. Keep plain HTML/CSS and existing browser colour picker; no framework migration. Match selection order, locked captions, colour collapse behavior, headers, scroll ownership, empty/loading states, and focus/tooltips, not merely the dark colour palette. Preserve XR canvas design and feed it the same legal creator data.

UI acceptance: screenshot overlays and measured element rectangles for Human outfits/hair/skin/sculpt and Robot skins/eyes/colours, selected/unselected/locked/hover/focused states, custom/preset/hidden colour modes, live versus preview tiers. Mobile cannot keep identical physical desktop dimensions and remain usable; scale/reflow the same hierarchy and controls while using the desktop runtime screenshot as the exact-size reference. Browser font rasterization/GPU shading may differ from Unity; exact configuration and UI layout should be tested separately from shader/animation fidelity.

## Stage 5 â€” Keep it synchronized without manual memory

Add a public contract manifest with schema version, Unity build/revision, catalog versions, source GUID/dependency hashes, native rule source hashes, public reward revision/hash, texture/geometry/coverage hashes, UI token revision, generation time and reference-vector hash. Use Unity dependency hashes for serialized/material/model changes and hash relevant rules/UI sources. A generation time by itself does not prove freshness.

Trigger the existing export/validation workflow after authoring/rebuild and in the release check. Skip regeneration when these fingerprints are unchanged. Build into a staging snapshot, run parity/UI checks, then publish one complete manifest-addressed release; HTML/current manifest goes last. The browser should verify compatible schema and matching catalog/rules/UI revision and show a refresh-required error on an incompatible mixture. Existing query-versioning and package delivery manifest handle cache busting, not native/API freshness.

Do not fetch or scrape Unity state continuously. A deployment is identical to its recorded Unity/reward snapshot; when either snapshot changes, rebuild and validate before claiming parity. Live account level/ownership must come from the authorized SideQuest account integration, and server-side authorization remains separate from local preview UI.

## Smallest delivery sequence

1. Fix the currently requested XR controller/Puppet/flight behavior independently.
2. Export native live creator rows/allowances and reference cases; label current review domain explicitly.
3. Implement shared stored/working/worn legality flow and fix all callbacks/import/randomizer consumers. Prove the reported Robot skin and low-level import cases first.
4. Reproduce non-XR UI against coordinated runtime captures; review exact layout/state comparisons.
5. Add freshness/publish gates and document the recorded release snapshot.

No editor operation was performed for this report. API freshness, actual native captures, and a full native live-clamp comparison remain to be run during implementation. The detailed packaged-data/source report remains in the local validation handoff; private diagnostics are not published here.
