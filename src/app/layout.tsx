import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getRequestStaff } from "@/lib/auth/session";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-serif",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "CAS CRM — Complete Accident Solutions",
  description: "Claims management prototype for Complete Accident Solutions Ltd",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerStore = await headers();
  const pathname = headerStore.get("x-cas-pathname") || "";
  const isPublic = headerStore.get("x-cas-public") === "1" || pathname === "/login";
  const staff = await getRequestStaff();
  if (!isPublic && !staff) {
    redirect("/login");
  }

  return (
    <html lang="en-GB">
      <body className={`${sans.variable} ${serif.variable} ${mono.variable} antialiased`}>
        <AppShell staffName={staff?.name ?? ""} staffUsername={staff?.username ?? ""}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
