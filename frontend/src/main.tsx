import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ToastHost } from "./Toast";
import "./styles.css";
import "./mobile-polish.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <ToastHost />
  </React.StrictMode>
);
