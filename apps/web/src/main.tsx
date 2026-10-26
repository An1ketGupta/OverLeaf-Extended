import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { App } from "./App.js";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");
createRoot(root).render(
  <StrictMode>
    <RouterProvider
      router={createBrowserRouter([{ path: "*", element: <App /> }])}
    />
  </StrictMode>,
);
