import "./globals.css";

export const metadata = {
  title: "Payment Webhook Relay",
  description:
    "Monitor webhook ingestion, delivery attempts and the dead-letter queue.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
