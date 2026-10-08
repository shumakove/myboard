import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRoutes } from "./routes";
import "./ui/theme.css";
import "./ui/ui.css";
import "./ui/layout.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root is missing in index.html");
}

createRoot(container).render(
  <StrictMode>
    <AppRoutes />
  </StrictMode>,
);
