import "./globals.css";

export const metadata = { title: "CompareLife", description: "Compare where to live and retire, using real data." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto max-w-4xl p-4">{children}</body>
    </html>
  );
}
