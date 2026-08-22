import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { forceOverviewOnLoad } from "./router"
import "./index.css"

// Refresh always starts at the overview route (user decision) — do it
// BEFORE mount so no component ever parses the stale hash.
forceOverviewOnLoad()

// Sync data-theme BEFORE React mounts so the very first paint already has
// the right --bg/--fg (no flash of wrong theme).
const saved = (() => {
  try {
    return localStorage.getItem("theme") || "light"
  } catch {
    return "light" // private mode
  }
})()
document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
