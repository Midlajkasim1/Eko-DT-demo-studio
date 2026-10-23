// Dev server for BROWSER TESTS only (npm run dev:test): the project's Vite config with every /api proxy aimed at the
// fake backend on FAKE_PORT (default 8010) instead of the developer's real backend on :8000. Used with
// scripts/fake-backend.mjs, which refuses to run unless the app proves it reaches the fake. Not part of the build.
import { mergeConfig } from 'vite'
import base from '../vite.config'

const target = `http://127.0.0.1:${process.env.FAKE_PORT || 8010}`
const api = { target, changeOrigin: true, secure: false }

export default mergeConfig(base, { server: { proxy: { '/api/fin': api, '/api/auth': api, '/api/notifications': api } } })
