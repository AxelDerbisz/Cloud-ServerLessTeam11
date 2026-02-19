import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function AuthSuccess() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  useEffect(() => {
    // Here we get token and user from URL.
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (token) {
      // Here we store token.
      localStorage.setItem("jwt", token);

      // Here we refresh user from backend.
      refreshUser().then(() => {
        navigate("/canvas");
      });
    } else {
      navigate("/");
    }
  }, []);

  return <div>Logging you in...</div>;
}