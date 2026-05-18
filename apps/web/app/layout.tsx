export const metadata = {
  title: "Daymo",
  description: "Interactive product manuals",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
