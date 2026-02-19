import { BrowserRouter, Routes, Route } from "react-router-dom";

import LoginPage from "./pages/Login";
import CanvasPage from "./pages/CanvasPage";
import AuthSuccess from "./pages/AuthSuccess";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/canvas" element={<CanvasPage />} />
        <Route path="/auth/success" element={<AuthSuccess />} />
      </Routes>
    </BrowserRouter>
  );
}