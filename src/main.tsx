import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./themes.css";

// No browser right-click menu (Back, Refresh, Print, Inspect…) anywhere in
// the app, text boxes included. Ctrl+C / Ctrl+V / Ctrl+X still work there.
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
