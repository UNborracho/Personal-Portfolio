import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

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
