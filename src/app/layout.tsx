import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "7sCstore — Gas Station Business Reporting",
  description:
    "Record and understand the financial performance of your gas station — sales, expenses, purchases, and profit.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-background text-on-background antialiased">{children}</body>
    </html>
  );
}
