import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "./dashboard-shell";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";

// Server layout: declara "no indexar" y es el punto de verificación
// REAL de sesión (el middleware solo mira presencia de cookie — corre
// en el edge sin acceso a Postgres). Una cookie muerta rebota aquí.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) {
    redirect("/login");
  }
  return <DashboardShell>{children}</DashboardShell>;
}
