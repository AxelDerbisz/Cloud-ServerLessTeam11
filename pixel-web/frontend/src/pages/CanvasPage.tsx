import { useEffect, useState } from "react";
import { apiFetch } from "../api/api";
import { useAuth } from "../auth/AuthContext";

// Here we define the type of a pixel.
type Pixel = {
  x: number;
  y: number;
  color: string;
};

// Here we define canvas size.
const WIDTH = 50;
const HEIGHT = 50;

// Here we define available colors.
const COLORS = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff00ff",
  "#00ffff",
];

export default function Canvas() {
  const { user, loading } = useAuth();

  // Here we store all pixels.
  const [pixels, setPixels] = useState<Record<string, string>>({});

  // Here we store the selected color.
  const [selectedColor, setSelectedColor] = useState("#000000");

  // Here we store loading state.
  const [canvasLoading, setCanvasLoading] = useState(true);

  // Here we load pixels from backend.
  async function loadPixels() {
    try {
      const data = await apiFetch("/api/pixels");

      const pixelMap: Record<string, string> = {};
      data.pixels.forEach((p: Pixel) => {
        pixelMap[`${p.x}_${p.y}`] = p.color;
      });

      setPixels(pixelMap);
    } catch (err) {
      console.error("Failed to load pixels", err);
    } finally {
      setCanvasLoading(false);
    }
  }

  // Here we load pixels when component mounts.
  useEffect(() => {
    loadPixels();
  }, []);

  // Here we handle placing a pixel.
  async function handlePixelClick(x: number, y: number) {
    if (!user) {
      alert("You must be logged in to place pixels.");
      return;
    }

    try {
      await apiFetch("/api/pixels", {
        method: "POST",
        body: JSON.stringify({
          x,
          y,
          color: selectedColor,
        }),
      });

      // Here we update the local canvas instantly.
      setPixels((prev) => ({
        ...prev,
        [`${x}_${y}`]: selectedColor,
      }));
    } catch (err) {
      console.error("Failed to place pixel", err);
    }
  }

  // Here we wait for authentication to finish.
  if (loading) {
    return <div>Loading authentication...</div>;
  }

  // Here we wait for canvas data.
  if (canvasLoading) {
    return <div>Loading canvas...</div>;
  }

  return (
    <div style={{ padding: "20px" }}>
      {/* Here we show user info */}
      <h2>
        Welcome {user ? user.username : "Guest"}
      </h2>

      {/* Here we show color picker */}
      <div style={{ marginBottom: "10px" }}>
        <h3>Select color</h3>
        {COLORS.map((color) => (
          <button
            key={color}
            onClick={() => setSelectedColor(color)}
            style={{
              backgroundColor: color,
              width: 30,
              height: 30,
              margin: 2,
              border:
                selectedColor === color
                  ? "3px solid black"
                  : "1px solid gray",
              cursor: "pointer",
            }}
          />
        ))}
      </div>

      {/* Here we render the canvas grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${WIDTH}, 10px)`,
          gap: "1px",
          backgroundColor: "#ccc",
          width: "fit-content",
        }}
      >
        {Array.from({ length: WIDTH * HEIGHT }).map((_, i) => {
          const x = i % WIDTH;
          const y = Math.floor(i / WIDTH);
          const key = `${x}_${y}`;
          const color = pixels[key] || "#ffffff";

          return (
            <div
              key={key}
              onClick={() => handlePixelClick(x, y)}
              style={{
                width: 10,
                height: 10,
                backgroundColor: color,
                cursor: "pointer",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}