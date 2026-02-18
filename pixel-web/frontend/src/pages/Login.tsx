import { login } from "../auth/authService";

export default function Login() {
  return (
    <div>
      <h1>Pixel Canvas</h1>
      <button onClick={login}>Login with Discord</button>
    </div>
  );
}
