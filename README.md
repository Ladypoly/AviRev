# AviRev

Static avatar asset review and browser builder, published with GitHub Pages.

Open `index.html` through HTTP to review source asset versions, studio textures,
clay, diagnostic and wireframe views. `builder.html` loads exported Unity meshes,
shape keys, materials, choices and compiled body coverage.

Browser textures use 512px previews, with clipped hair maps at 1024px. Geometry
and configuration data are retained. Wireframe image previews use higher quality
compression. Blender/Unity authored projects and full-quality images stay outside
this repository. Browser lighting and static posture are previews; live tracking,
animation, progression services and PC/Quest parity are checked in Unity.

The website uses vendored Three.js under its included MIT license.
