const API_URL = import.meta.env.VITE_API_URL;

// Here we create a function to call the backend.
// All requests will pass through this function.
export async function apiFetch(
  path: string,
  options: RequestInit = {}
) {
  // Here we get the JWT token from localStorage
  const token = localStorage.getItem("token");

  // Here we create headers as a normal object so TypeScript is happy
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  // Here we attach Authorization header if token exists
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Here we perform the request
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  // Here we handle errors globally
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  // Here we return JSON response
  return res.json();
}