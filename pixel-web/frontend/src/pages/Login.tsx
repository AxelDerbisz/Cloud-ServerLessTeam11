import { useEffect, useState } from "react";

export default function LoginPage() {
  const API_URL =
    "https://pixel-canvas-gateway-86fcxr1p.ew.gateway.dev";

  const [visible, setVisible] = useState(false);

  //Here we animate on load.
  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
  }, []);

  const handleLogin = () => {
    window.location.href = `${API_URL}/auth/login`;
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, #020617, #0f172a, #1e293b)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          background: "rgba(15, 23, 42, 0.75)",
          padding: "50px 40px",
          borderRadius: 20,
          backdropFilter: "blur(15px)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
          textAlign: "center",
          color: "white",
          maxWidth: 400,
          width: "90%",
          transform: visible
            ? "translateY(0px)"
            : "translateY(40px)",
          opacity: visible ? 1 : 0,
          transition: "all 0.6s ease",
        }}
      >
        {/*Title*/}
        <h1
          style={{
            fontSize: 34,
            marginBottom: 10,
            fontWeight: 700,
          }}
        >
          Pixel Canvas
        </h1>

        <p
          style={{
            opacity: 0.7,
            marginBottom: 35,
          }}
        >
          Draw together in real time
        </p>

        {/*Discord button*/}
        <button
          onClick={handleLogin}
          style={{
            background: "#5865F2",
            color: "white",
            border: "none",
            padding: "14px 20px",
            fontSize: 16,
            borderRadius: 12,
            cursor: "pointer",
            width: "100%",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            transition: "all 0.2s",
            boxShadow: "0 10px 20px rgba(88,101,242,0.4)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform =
              "translateY(-2px) scale(1.02)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform =
              "translateY(0) scale(1)";
          }}
        >
          {/*Discord icon*/}
          <svg
            width="20"
            height="20"
            viewBox="0 0 245 240"
            fill="white"
          >
            <path d="M104.4 104.9c-5.7 0-10.2 5-10.2 11.2s4.6 11.2 10.2 11.2c5.7 0 10.3-5 10.2-11.2 0-6.2-4.6-11.2-10.2-11.2zm36.3 0c-5.7 0-10.2 5-10.2 11.2s4.6 11.2 10.2 11.2c5.7 0 10.3-5 10.2-11.2 0-6.2-4.6-11.2-10.2-11.2z" />
            <path d="M189.5 20h-134C24.9 20 0 44.9 0 75.5v89c0 30.6 24.9 55.5 55.5 55.5h113.7l-5.3-18.5 12.7 11.8 12 11.2 21.3 18.5V75.5c0-30.6-24.9-55.5-55.5-55.5zm-39.6 135s-3.7-4.4-6.8-8.3c13.5-3.8 18.6-12.2 18.6-12.2-4.2 2.8-8.2 4.8-11.8 6.1-5.2 2.2-10.2 3.7-15.1 4.6-10 1.9-19.2 1.4-27.2-.1-6.1-1.1-11.3-2.7-15.6-4.6-2.4-.9-5-2.1-7.6-3.6-.3-.2-.7-.3-1-.5-.2-.1-.3-.2-.4-.3-1.8-1-2.8-1.7-2.8-1.7s4.9 8.2 18 12.1c-3.1 3.9-6.9 8.5-6.9 8.5-22.8-.7-31.4-15.7-31.4-15.7 0-33.2 14.8-60.1 14.8-60.1 14.8-11.1 28.9-10.8 28.9-10.8l1 1.2c-18.6 5.4-27.2 13.6-27.2 13.6s2.3-1.2 6.1-3c10.9-4.8 19.6-6.1 23.2-6.4.6-.1 1.1-.2 1.7-.2 6.1-.8 13-.9 20.2-.1 9.5 1.1 19.7 3.9 30.1 9.6 0 0-8.2-7.8-25.9-13.2l1.4-1.6s14.1-.3 28.9 10.8c0 0 14.8 26.9 14.8 60.1 0 0-8.6 15-31.4 15.7z" />
          </svg>

          Login with Discord
        </button>

        <div
          style={{
            marginTop: 25,
            fontSize: 12,
            opacity: 0.5,
          }}
        >
          Powered by Serverless • Team 11
        </div>
      </div>
    </div>
  );
}