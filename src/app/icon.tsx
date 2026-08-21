import { ImageResponse } from "next/og";

// Replaces the previous single-bubble favicon with "Diálogo en vivo" — two
// overlapping speech bubbles (the client/business back-and-forth) plus a
// small solid pulse dot on the front bubble (real-time messaging, not a
// static chat). Same Hostinger-aligned violet square as before.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#7c3aed", // primary (Hostinger-aligned purple)
          borderRadius: 6,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 5a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4.5A1.5 1.5 0 0 1 3 11z"
            stroke="#ffffff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.55"
          />
          <path
            d="M9.5 12.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-.5v2.2l-2.5-2.2H11a1.5 1.5 0 0 1-1.5-1.5z"
            stroke="#ffffff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="20" cy="10.5" r="1.5" fill="#ffffff" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
