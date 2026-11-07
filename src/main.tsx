import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./themes.css";

// No browser right-click menu (Back, Refresh, Print, Inspect…) anywhere in the
// app. Text boxes keep theirs so cut, copy and paste still work.
window.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement | null;
  const editable = el?.closest("input, textarea, [contenteditable='true']");
  if (!editable) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
