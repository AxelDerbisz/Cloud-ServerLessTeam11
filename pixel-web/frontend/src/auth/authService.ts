const LOGIN_URL =
  "https://pixel-canvas-gateway-86fcxr1p.ew.gateway.dev/auth/login";

// Here we start the login process by redirecting to Discord.
export function login() {
  window.location.href = LOGIN_URL;
}

// Here we log out the user by clearing the token.
export function logout() {
  localStorage.removeItem("token");
  window.location.href = "/login";
}

// Here we check if the user is authenticated.
export function isAuthenticated() {
  return !!localStorage.getItem("token");
}
