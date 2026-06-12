import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creator Discovery Platform",
  description: "Internal creator search and management platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        `}</style>
      </head>
      <body style={{ margin: 0, background: "#030712", color: "#f9fafb", minHeight: "100vh" }}>
        {children}
      </body>
    </html>
  );
}
