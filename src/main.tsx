// React はStrictMode用に保持（現在無効化中）
import _React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  // StrictModeを一時的に無効化（ドラッグ&ドロップ重複問題のデバッグ用）
  // <React.StrictMode>
    <App />,
  // </React.StrictMode>,
);
