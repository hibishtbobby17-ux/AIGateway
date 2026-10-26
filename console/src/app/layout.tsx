import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Console — Distributed Control Plane',
  description: 'Production Control Plane for AI Gateway & Model Context Protocol Aggregation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="theme-saas">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="theme-saas">{children}</body>
    </html>
  );
}
