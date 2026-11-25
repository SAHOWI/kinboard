import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, routeFromHash } from "./App.tsx";
import { useStore } from "./data/store.ts";
import "./styles/index.css";

// Display tokens receive the server-side projection without private lists (spec §9).
void useStore.getState().init(routeFromHash() === "display" ? "display" : "app");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
