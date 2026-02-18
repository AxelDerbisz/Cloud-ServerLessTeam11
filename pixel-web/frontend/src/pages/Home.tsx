import { useState } from "react";

const API_URL = import.meta.env.VITE_API_URL;

export default function Home() {
  const [user, setUser] = useState<any>(null);

  // Here we handle login click
  const login = () => {
    window.location.href = `${API_URL}/auth/login`;
  };

  // Here we fetch the user using JWT
  const getUser = async () => {
    const token = localStorage.getItem("token");

    if (!token) {
      alert("Not logged in");
      return;
    }

    const res = await fetch(`${API_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json();
    setUser(data);
  };

  return (
    <div>
      <h1>Pixel Canvas</h1>

      <button onClick={login}>Login with Discord</button>

      <button onClick={getUser}>Get User</button>

      {user && (
        <div>
          <h2>Logged in</h2>
          <pre>{JSON.stringify(user, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
