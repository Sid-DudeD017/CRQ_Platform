import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import SharedLayout from "@/components/SharedLayout";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";
import { ErrorTrackerInit } from "@/lib/errorTracking";

export const metadata: Metadata = {
  title: "CRQ Platform",
  description: "AI-Powered Cyber Risk Quantification (CRQ) Platform",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@600;700&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500&family=Baloo+2:wght@500;600;700;800&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ErrorTrackerInit />
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <SharedLayout>{children}</SharedLayout>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
