// Here we import React and hooks
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// Here we define the callback page
export default function Callback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Here we read the token from the URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    // Here we store the token locally
    if (token) {
      localStorage.setItem("token", token);
    }

    // Here we redirect the user to the home page
    navigate("/");
  }, [navigate]);

  // Here we show a loading message
  return <div>Logging you in...</div>;
}
