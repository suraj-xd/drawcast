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
  title: "Drawcast",
  description:
    "Speak your idea — watch it become a diagram. Drawcast turns voice into Excalidraw diagrams in real time.",
  icons: {
    icon: "/drawcast-logo.png",
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://drawcast.vercel.app"
  ),
  openGraph: {
    title: "Drawcast",
    description:
      "Speak your idea — watch it become a diagram. Drawcast turns voice into Excalidraw diagrams in real time.",
    siteName: "Drawcast",
    images: [
      {
        url: "/drawcast-logo.png",
        width: 1200,
        height: 630,
        alt: "Drawcast — voice-to-diagram",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Drawcast",
    description:
      "Speak your idea — watch it become a diagram. Drawcast turns voice into Excalidraw diagrams in real time.",
    images: ["/drawcast-logo.png"],
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
