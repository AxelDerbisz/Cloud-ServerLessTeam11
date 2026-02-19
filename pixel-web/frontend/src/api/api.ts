//const API_URL = import.meta.env.VITE_API_URL;

// Here we create a reusable API fetch.
export async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(
    `${import.meta.env.VITE_API_URL}${path}`,
    {
      ...options,
      credentials: "include", // Here we send cookies automatically
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }
  );

  if (!res.ok) {
    throw new Error("API error");
  }

  return res.json();
}

// Here we get user.
export function getUser() {
  return apiFetch("/auth/me");
}

// Here we get pixels.
export function getPixels() {
  return apiFetch("/api/pixels");
}

// Here we get canvas.
export function getCanvas() {
  return apiFetch("/api/canvas");
}

// Here we place pixel.
export function placePixel(x: number, y: number, color: string) {
  return apiFetch("/api/pixels", {
    method: "POST",
    body: JSON.stringify({ x, y, color }),
  });
}