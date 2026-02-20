import { useEffect, useState, useRef, useCallback, useLayoutEffect } from "react";
import { collection, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { apiFetch } from "../api/api";
import { useAuth } from "../auth/AuthContext";

//Here we define available colors.
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

interface PixelData {
  color: string;
  username: string;
  updatedAt: string;
  userId: string;
}

interface TooltipData {
  x: number;
  y: number;
  pixel: PixelData;
}

export default function CanvasPage() {
  const { user, loading } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  //Here we store pixels.
  const [pixels, setPixels] = useState<Record<string, PixelData>>({});

  //Here we store selected color.
  const [selectedColor, setSelectedColor] = useState("#000000");

  const [canvasLoading, setCanvasLoading] = useState(true);
  const [canvasWidth, setCanvasWidth] = useState(100);
  const [canvasHeight, setCanvasHeight] = useState(100);

  //Here we store tooltip.
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  //Here we store live cursor coordinates.
  const [cursorCoords, setCursorCoords] = useState<{ x: number; y: number } | null>(null);

  //Here we store zoom level.
  const [zoom, setZoom] = useState(1.0);

  //Here we store pan mode and offset.
  const [isPanMode, setIsPanMode] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  //Here we store error message.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  //Here we render canvas function.
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const maxWidth = window.innerWidth * 0.95;
    const maxHeight = window.innerHeight * 0.9;

    const baseScale = Math.min(
      maxWidth / canvasWidth,
      maxHeight / canvasHeight
    );

    const scale = baseScale * zoom;

    const displayWidth = canvasWidth * scale;
    const displayHeight = canvasHeight * scale;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    Object.entries(pixels).forEach(([key, pixel]) => {
      const [x, y] = key.split("_").map(Number);
      ctx.fillStyle = `#${pixel.color}`;
      ctx.fillRect(x, y, 1, 1);
    });
  }, [pixels, canvasWidth, canvasHeight, zoom]);

  //Here we load session.
  useEffect(() => {
    const loadSession = async () => {
      const sessionDoc = await getDoc(doc(db, "sessions", "current"));
      if (sessionDoc.exists()) {
        const s = sessionDoc.data();
        setCanvasWidth(s.canvasWidth || 100);
        setCanvasHeight(s.canvasHeight || 100);
      }
    };
    loadSession();
  }, []);

  //Here we stream pixels.
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "pixels"), (snapshot) => {
      setPixels((prev) => {
        const updated = { ...prev };
        snapshot.docChanges().forEach((change) => {
          const id = change.doc.id;
          if (change.type === "removed") {
            delete updated[id];
          } else {
            const data = change.doc.data();
            updated[id] = {
              color: data.color,
              username: data.username || "Unknown",
              updatedAt: data.updatedAt || new Date().toISOString(),
              userId: data.userId || "",
            };
          }
        });
        return updated;
      });
      setCanvasLoading(false);
    });

    return () => unsub();
  }, []);

  //Here we add non-passive wheel listener after canvas loads.
  useEffect(() => {
    if (canvasLoading) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheelEvent = (e: WheelEvent) => {
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((prev) => Math.max(0.1, Math.min(10, prev * zoomDelta)));
    };

    canvas.addEventListener('wheel', handleWheelEvent, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleWheelEvent);
    };
  }, [canvasLoading]);

  //Here we render pixels whenever dependencies change.
  useLayoutEffect(() => {
    if (!canvasLoading) {
      renderCanvas();
    }
  }, [pixels, canvasWidth, canvasHeight, zoom, canvasLoading, renderCanvas]);

  //Here we hover and track cursor.
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    //Here we handle pan dragging.
    handlePanMove(e);

    if (isPanMode) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;

    const pixelX = Math.floor((e.clientX - rect.left) * scaleX);
    const pixelY = Math.floor((e.clientY - rect.top) * scaleY);

    setCursorCoords({ x: pixelX, y: pixelY });
    setMousePos({ x: e.clientX, y: e.clientY });

    const key = `${pixelX}_${pixelY}`;
    const pixelData = pixels[key];

    if (pixelData) {
      setTooltip({ x: pixelX, y: pixelY, pixel: pixelData });
    } else {
      setTooltip(null);
    }
  };

  const handleMouseLeave = () => {
    setTooltip(null);
    setMousePos(null);
    setCursorCoords(null);
  };


  //Here we handle pan drag start.
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanMode) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  //Here we handle pan drag move.
  const handlePanMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging && isPanMode) {
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  //Here we handle pan drag end.
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  //Here we place pixel.
  const handleCanvasClick = async (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    if (!user || isPanMode) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;

    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    //Here we optimistically update the pixel immediately.
    const key = `${x}_${y}`;
    const optimisticPixel: PixelData = {
      color: selectedColor.replace(/^#/, ''),
      username: user.username,
      updatedAt: new Date().toISOString(),
      userId: user.id,
    };

    setPixels((prev) => ({
      ...prev,
      [key]: optimisticPixel,
    }));

    //Here we send to backend (Firestore will reconcile later).
    try {
      await apiFetch("/api/pixels", {
        method: "POST",
        body: JSON.stringify({
          x,
          y,
          color: selectedColor,
        }),
      });
    } catch (error) {
      //Here we revert on error by creating new object without the key.
      setPixels((prev) => {
        const { [key]: _, ...updated } = prev;
        return updated;
      });

      //Here we show error message.
      setErrorMessage("⚠️ Rate limit exceeded! (20 pixels/min max)");
      setTimeout(() => setErrorMessage(null), 3000);

      console.error("Failed to place pixel:", error);
    }
  };

  if (loading || canvasLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div
      style={{
        height: "100vh",
        background: "linear-gradient(135deg,#020617,#0f172a)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/*Toolbar*/}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          background: "rgba(15,23,42,0.9)",
          padding: 15,
          borderRadius: 12,
          backdropFilter: "blur(10px)",
          color: "white",
          zIndex: 10,
        }}
      >
        <div style={{ marginBottom: 10 }}>
          {user ? user.username : "Guest"}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedColor(c)}
              style={{
                background: c,
                width: 30,
                height: 30,
                borderRadius: 6,
                border:
                  selectedColor === c
                    ? "2px solid white"
                    : "1px solid #444",
              }}
            />
          ))}
        </div>
      </div>

      {/*Zoom controls*/}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          background: "rgba(15,23,42,0.9)",
          padding: 15,
          borderRadius: 12,
          backdropFilter: "blur(10px)",
          color: "white",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <button
          onClick={() => setZoom((prev) => Math.min(10, prev * 1.2))}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "white",
            padding: "8px 12px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          +
        </button>
        <div style={{ textAlign: "center", fontSize: 12 }}>
          {Math.round(zoom * 100)}%
        </div>
        <button
          onClick={() => setZoom((prev) => Math.max(0.1, prev * 0.8))}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "white",
            padding: "8px 12px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          −
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPanOffset({ x: 0, y: 0 });
          }}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "white",
            padding: "6px 8px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          Reset View
        </button>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.2)", margin: "8px 0" }} />
        <button
          onClick={() => setIsPanMode(!isPanMode)}
          style={{
            background: isPanMode ? "rgba(88,101,242,0.3)" : "rgba(255,255,255,0.1)",
            border: isPanMode ? "1px solid rgba(88,101,242,0.5)" : "1px solid rgba(255,255,255,0.2)",
            color: "white",
            padding: "8px 12px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 20,
          }}
          title={isPanMode ? "Draw mode (click)" : "Pan mode (click)"}
        >
          {isPanMode ? "✏️" : "✋"}
        </button>
      </div>

      {/*Live cursor coordinates*/}
      {cursorCoords && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            background: "rgba(0,0,0,0.7)",
            color: "white",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 14,
          }}
        >
          Cursor: ({cursorCoords.x}, {cursorCoords.y})
        </div>
      )}

      {/*Canvas*/}
      <div
        style={{
          height: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
            transition: isDragging ? "none" : "transform 0.1s ease-out",
          }}
        >
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              handleMouseLeave();
              handleMouseUp();
            }}
            style={{
              imageRendering: "pixelated",
              cursor: isPanMode ? (isDragging ? "grabbing" : "grab") : "crosshair",
            }}
          />
        </div>
      </div>

      {/*Pixel tooltip*/}
      {tooltip && mousePos && (
        <div
          style={{
            position: "fixed",
            left: mousePos.x + 15,
            top: mousePos.y + 15,
            background: "rgba(0,0,0,0.9)",
            padding: "10px",
            borderRadius: 8,
            color: "white",
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          <div><strong>({tooltip.x}, {tooltip.y})</strong></div>
          <div>#{tooltip.pixel.color}</div>
          <div>{tooltip.pixel.username}</div>
        </div>
      )}

      {/*Error notification*/}
      {errorMessage && (
        <div
          style={{
            position: "fixed",
            top: 100,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(220, 38, 38, 0.95)",
            color: "white",
            padding: "15px 25px",
            borderRadius: 12,
            boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            fontSize: 14,
            fontWeight: 600,
            zIndex: 1000,
          }}
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}