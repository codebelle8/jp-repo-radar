import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { Providers } from "@/components/providers";

export const metadata = {
  title: "JP Repo Radar",
  description: "Public GitHub repositories of Japanese web-development companies: branches and issues per company.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%232a78d6'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%23fff'/%3E%3C/svg%3E",
  },
};

export const viewport = { width: "device-width", initialScale: 1 };

// Apply the saved theme before the first paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem("jprr-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
