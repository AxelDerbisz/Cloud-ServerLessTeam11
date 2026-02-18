// Here we import routing
import { BrowserRouter, Routes, Route } from "react-router-dom";

// Here we import pages
import Home from "./pages/Home";
import Callback from "./pages/Callback";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Here we define the home page */}
        <Route path="/" element={<Home />} />

        {/* Here we handle OAuth callback */}
        <Route path="/callback" element={<Callback />} />
      </Routes>
    </BrowserRouter>
  );
}
