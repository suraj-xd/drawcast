import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Architects_Daughter } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const architectsDaughter = Architects_Daughter({
  variable: "--font-hand",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Drawcast Beta",
  description:
    "Speak your idea and watch it become an editable diagram. Drawcast is a beta voice-to-Excalidraw canvas.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://drawcast.vercel.app"
  ),
  openGraph: {
    title: "Drawcast Beta",
    description:
      "Speak your idea and watch it become an editable diagram. Drawcast is a beta voice-to-Excalidraw canvas.",
    siteName: "Drawcast",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Drawcast Beta voice-to-diagram canvas",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Drawcast Beta",
    description:
      "Speak your idea and watch it become an editable diagram. Drawcast is a beta voice-to-Excalidraw canvas.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${architectsDaughter.variable} dark`}
    >
      <body className="antialiased h-full">
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var theme = localStorage.getItem('drawcast-theme');
              if (theme === 'light') {
                document.documentElement.classList.remove('dark');
              } else if (theme === 'dark' || !theme) {
                document.documentElement.classList.add('dark');
              } else {
                if (!window.matchMedia('(prefers-color-scheme: dark)').matches) {
                  document.documentElement.classList.remove('dark');
                }
              }
            } catch(e) {}
          })();
        `}} />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
