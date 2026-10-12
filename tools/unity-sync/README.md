# Unity → web asset sync

Used for the 2026-10-12 sync (release `3d745ad99df0`). See docs/HANDOFF.md, "Release 3d745ad99df0 — Unity sync", for the full pipeline.

- `browser.rsp` / `contract.rsp`: Roslyn response files. Run from the Unity project root with Unity's `NetCoreRuntime/dotnet.exe DotNetSdkRoslyn/csc.dll @<rsp>`; they compile `../browser_data/AviRevBrowserExportImplementation.cs` and `AviRevContractExport.cs` into DLLs outside the project. Fix the `-out:` and source paths first; they point at a session temp folder.
- `AviRevSyncShim.cs.txt`: the only file placed in Unity, as `Assets/_AviRevSync/Editor/AviRevSyncShim.cs`. Set `Dir` to the folder holding the two DLLs, create `request.txt` there and focus Unity. The exports run once, write `result.txt`, and you then move the folder (and its `.meta`) back out. Check that `git status` in Unity is unchanged.
- `AviRevContractExport.cs.txt`: the creator-contract and Unity-vector exporter (writes `browser_data/creator_contract.json` and `tests/fixtures/unity_creator_vectors.json`).
- `package_builder_data.py`: packages the hybrid host output into this repo (chunks, `browser_data/textures_<tag>/`, manifest hash in `builder-assets.mjs`). Bump `TEXTURES` for every release.
