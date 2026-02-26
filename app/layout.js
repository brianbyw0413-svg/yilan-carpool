import "./globals.css";

export const metadata = {
  title: "宜蘭共乘平台 — PickYouUP",
  description: "宜蘭 ↔ 台北 免費共乘媒合平台，找到你的每日通勤夥伴。由 PickYouUP 機場接送提供。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Noto+Sans+TC:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="theme-color" content="#0c0a09" />
      </head>
      <body>{children}</body>
    </html>
  );
}
