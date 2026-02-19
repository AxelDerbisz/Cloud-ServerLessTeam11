import { useEffect, useState, useRef } from "react";
import { collection, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { apiFetch } from "../api/api";
import { useAuth } from "../auth/AuthContext";

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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Here we store all pixels.
  const [pixels, setPixels] = useState<Record<string, string>>({});

  // Here we store the selected color.
  const [selectedColor, setSelectedColor] = useState("#000000");

  // Here we store loading state.
  const [canvasLoading, setCanvasLoading] = useState(true);

  // Here we store canvas dimensions from session.
  const [canvasWidth, setCanvasWidth] = useState(100);
  const [canvasHeight, setCanvasHeight] = useState(100);

  // Here we load session dimensions once.
  useEffect(() => {
    const loadSession = async () => {
      try {
        const sessionDoc = await getDoc(doc(db, "sessions", "current"));
        if (sessionDoc.exists()) {
          const session = sessionDoc.data();
          setCanvasWidth(session.canvasWidth || 100);
          setCanvasHeight(session.canvasHeight || 100);
        }
      } catch (error) {
        console.error("Failed to load session", error);
      }
    };
    loadSession();
  }, []);

  // Here we stream pixels from Firestore in real-time.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "pixels"),
      (snapshot) => {
        setPixels((prev) => {
          const updated = { ...prev };
          snapshot.docChanges().forEach((change) => {
            const docId = change.doc.id;
            if (change.type === "removed") {
              delete updated[docId];
            } else {
              const data = change.doc.data();
              updated[docId] = data.color;
            }
          });
          return updated;
        });
        setCanvasLoading(false);
      },
      (error) => {
        console.error("Firestore stream error", error);
        setCanvasLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Here we render pixels to canvas whenever they change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Calculate display size - fit to max 800px
    const maxDisplaySize = 800;
    const scale = Math.min(1, maxDisplaySize / Math.max(canvasWidth, canvasHeight));
    const displayWidth = canvasWidth * scale;
    const displayHeight = canvasHeight * scale;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    // Clear canvas
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Draw pixels
    Object.entries(pixels).forEach(([key, color]) => {
      const [x, y] = key.split("_").map(Number);
      ctx.fillStyle = `#${color}`;
      ctx.fillRect(x, y, 1, 1);
    });
  }, [pixels, canvasWidth, canvasHeight]);

  // Here we handle canvas clicks.
  const handleCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!user) {
      alert("You must be logged in to place pixels.");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;

    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    if (x < 0 || x >= canvasWidth || y < 0 || y >= canvasHeight) {
      return;
    }

    // Optimistic update
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = selectedColor;
      ctx.fillRect(x, y, 1, 1);
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
    } catch (err) {
      console.error("Failed to place pixel", err);
    }
  };

  // Here we wait for authentication to finish.
  if (loading) {
    return <div style={{ padding: "20px" }}>Loading authentication...</div>;
  }

  // Here we wait for canvas data.
  if (canvasLoading) {
    return <div style={{ padding: "20px" }}>Loading canvas...</div>;
  }

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      {/* Here we show user info */}
      <h2>
        Welcome {user ? user.username : "Guest"}
      </h2>
      <p>Canvas size: {canvasWidth} x {canvasHeight} | Pixels placed: {Object.keys(pixels).length}</p>

      {/* Here we show color picker */}
      <div style={{ marginBottom: "20px" }}>
        <h3 style={{ margin: "10px 0" }}>Select color:</h3>
        <div style={{ display: "flex", gap: "5px" }}>
          {COLORS.map((color) => (
            <button
              key={color}
              onClick={() => setSelectedColor(color)}
              style={{
                backgroundColor: color,
                width: 40,
                height: 40,
                border: selectedColor === color ? "3px solid #000" : "1px solid #999",
                cursor: "pointer",
                borderRadius: "4px",
              }}
              title={color}
            />
          ))}
        </div>
      </div>

      {/* Here we render the canvas */}
      <div style={{
        border: "2px solid #999",
        display: "inline-block",
        background: "#f0f0f0",
        borderRadius: "4px",
        padding: "2px"
      }}>
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          style={{
            cursor: "crosshair",
            imageRendering: "pixelated",
            display: "block",
          }}
        />
      </div>

      {!user && (
        <div style={{ marginTop: "20px", padding: "10px", background: "#fff3cd", borderRadius: "4px" }}>
          <strong>Note:</strong> You must be logged in to place pixels.
        </div>
      )}
    </div>
  );
}
