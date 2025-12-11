import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "J&L Tools Portal",
  description: "E-commerce Management Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
