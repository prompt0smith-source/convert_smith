import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PdfEditorWindowApp } from "./PdfEditorWindowApp";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const RootApp = params.get("convertSmithWindow") === "pdfEditor" ? PdfEditorWindowApp : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
