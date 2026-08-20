import "./globals.css";
import ClientLayout from "@/components/ClientLayout";

export const metadata = {
  title: "Ivent - Event Check-In System",
  description: "Secure event check-in with TOTP-based QR codes, real-time dashboards, and offline support.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
