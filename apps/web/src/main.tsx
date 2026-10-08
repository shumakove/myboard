import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Тема и компоненты — раньше модульных стилей экранов: экраны уточняют их, а не наоборот.
import "./ui/theme.css";
import "./ui/ui.css";
import "./ui/layout.css";
import { AppRoutes } from "./routes";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root is missing in index.html");
}

createRoot(container).render(
  <StrictMode>
    <AppRoutes />
  </StrictMode>,
);
