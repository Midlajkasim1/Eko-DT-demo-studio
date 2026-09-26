# IFC Fragment Viewer

A lightweight, fully client-side web application that lets anyone upload an IFC file,
converts it instantly to the optimized `.frag` binary format, renders it in a
high-performance 3D viewer, and allows downloading the converted file for fast reuse.

> Built with Vite + React + TypeScript + @thatopen/fragments

---

## Quick Links

- [Why This Stack?](./docs/01-why-this-stack.md)
- [Architecture](./docs/02-architecture.md)
- [Project Structure](./docs/03-project-structure.md)
- [Core Concepts](./docs/04-core-concepts.md)
- [Component Reference](./docs/05-components.md)
- [Hooks Reference](./docs/06-hooks.md)
- [State Management](./docs/07-state-management.md)
- [Configuration](./docs/08-configuration.md)
- [Development Guide](./docs/09-development-guide.md)
- [Build & Deployment](./docs/10-build-and-deployment.md)
- [Performance Guide](./docs/11-performance.md)
- [Roadmap](./docs/12-roadmap.md)
- [View Templates](./docs/VIEW_TEMPLATES.md) — Photoreal / Minimalist / X-ray, and the dashboard API

---

## What It Does

```
User uploads .ifc file
        ↓
IfcImporter (WASM, Web Worker) converts → .frag binary
        ↓
FragmentsModels loads buffer → Three.js scene renders model
        ↓
User explores model in 3D + downloads .frag for fast future loads
```

Everything runs in the browser. No server. No data leaves the user's machine.

---

## Key Technologies

| Tool                 | Role                                      |
| -------------------- | ----------------------------------------- |
| Vite                 | Build tool, WASM support, dev server      |
| React 18             | UI component model                        |
| TypeScript           | Type safety across BIM data structures    |
| @thatopen/fragments  | IFC→FRAG conversion + 3D rendering engine |
| @thatopen/components | Scene, camera, renderer helpers           |
| Three.js             | WebGL 3D engine underneath                |
| Zustand              | Lightweight global state                  |
| web-ifc (WASM)       | IFC geometry parser, runs in Web Worker   |
