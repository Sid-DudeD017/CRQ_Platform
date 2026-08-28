import type { Metadata } from "next";
import "./globals.css";
import SharedLayout from "@/components/SharedLayout";
import { AuthProvider } from "@/context/AuthContext";

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
        <AuthProvider>
          <SharedLayout>{children}</SharedLayout>
        </AuthProvider>
      </body>
    </html>
  );
}
