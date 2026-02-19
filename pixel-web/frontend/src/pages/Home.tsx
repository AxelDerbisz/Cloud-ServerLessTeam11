export default function Home() {
  const API_URL = import.meta.env.VITE_API_URL;

  //Here we start login
  function login() {
    window.location.href = `${API_URL}/auth/login`;
  }

  return (
    <div>
      <h1>Pixel Canvas</h1>
      <button onClick={login}>Login with Discord</button>
    </div>
  );
}