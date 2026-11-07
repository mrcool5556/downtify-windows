import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TextMenu } from "./components/TextMenu";
import "./styles.css";
import "./themes.css";

// No browser right-click menu (Back, Refresh, Print, Inspect…) anywhere in
// the app. Text boxes get the app's own Cut / Copy / Paste menu (TextMenu).
window.addEventListener("contextmenu", (e) => e.preventDefault());
// No red spellcheck squiggles: song and band names aren't dictionary words.
// TextMenu suggests fixes from your library instead.
document.documentElement.spellcheck = false;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <TextMenu />
  </React.StrictMode>,
);
