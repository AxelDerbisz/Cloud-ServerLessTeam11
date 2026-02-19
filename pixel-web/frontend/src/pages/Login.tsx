//import React from "react";

export default function LoginPage() {

  const API_URL =
    "https://pixel-canvas-gateway-86fcxr1p.ew.gateway.dev";

  const handleLogin = () => {
    window.location.href = `${API_URL}/auth/login`;
  };

  return (
    <div style={{ padding: 40 }}>
      <h1>Pixel Canvas</h1>

      <button onClick={handleLogin}>
        Login with Discord
      </button>
    </div>
  );
}