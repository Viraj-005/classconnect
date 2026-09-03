import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./styles/global.css";

/*
  Entry point.

  ThemeProvider sits above the router because branding applies to the
  login screen too, not only to authenticated surfaces. It bootstraps
  the session from GET /auth/session, so there is no fixture data left
  anywhere in the client.
*/

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
