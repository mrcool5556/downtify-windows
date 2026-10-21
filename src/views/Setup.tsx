import { useState } from "react";
import { api, ServerInfo, Settings } from "../api";
import { WindowControls } from "../components/WindowControls";

export function Setup({ onPaired }: { onPaired: (s: Settings) => void }) {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    setBusy(true);
    setError("");
    setInfo(null);
    try {
      setInfo(await api.checkServer(url));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pair() {
    setBusy(true);
    setError("");
    try {
      onPaired(await api.pair(url, code));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup" data-tauri-drag-region>
      <div className="setup-chrome">
        <WindowControls />
      </div>
      <div className="card">
        <h1>
          <span className="logo" aria-hidden>
            ♫
          </span>{" "}
          Connect to your Downtify server
        </h1>

        <label>
          Server address
          <div className="row">
            <input
              placeholder="http://nas:8000"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && check()}
              autoFocus
            />
            <button onClick={check} disabled={busy || !url.trim()}>
              Check
            </button>
          </div>
        </label>

        {info && (
          <div className="ok">
            Found <b>{info.name || "Downtify"}</b> (v{info.version}, API {info.api_version}).
          </div>
        )}

        {info && (
          <>
            <p className="hint">
              In the Downtify web page open <b>Settings → Apps → Pair a phone</b> and type the 8-character code it shows.
            </p>
            <label>
              Pairing code
              <div className="row">
                <input
                  placeholder="XXXX-XXXX"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && pair()}
                  maxLength={12}
                />
                <button className="primary" onClick={pair} disabled={busy || code.trim().length < 8}>
                  Pair
                </button>
              </div>
            </label>
          </>
        )}

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
