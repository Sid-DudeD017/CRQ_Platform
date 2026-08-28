import type { Metadata } from "next";
import "./globals.css";
import SharedLayout from "@/components/SharedLayout";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";

export const metadata: Metadata = {
  title: "CRQ Platform Executive Dashboard",
  description: "AI-Powered Cyber Risk Quantification (CRQ) Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
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
