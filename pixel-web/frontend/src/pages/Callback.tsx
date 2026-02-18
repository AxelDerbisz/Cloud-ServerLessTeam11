import { useEffect } from "react";

// Here we handle the OAuth2 callback.
export default function Callback() {
  useEffect(() => {
    // Here we extract the token from the URL.
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    // Here we store the token.
    if (token) {
      localStorage.setItem("token", token);
    }

    // Here we redirect to the canvas.
    window.location.href = "/";
  }, []);

  return <p>Authenticating...</p>;
}
