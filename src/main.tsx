import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import App from "./App";
import { useStore } from "./store";

(window as unknown as { __bn: typeof useStore }).__bn = useStore; // handy for dev/testing
createRoot(document.getElementById("root")!).render(<App />);
