import { createElement } from "react";
import { ImageResponse } from "next/og";

export const runtime = "edge";

export function GET() {
  return new ImageResponse(
    createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #18181b 0%, #3f3f46 100%)",
          color: "#f4f4f3",
          fontSize: 128,
          fontWeight: 700,
        },
      },
      "A",
    ),
    {
      width: 192,
      height: 192,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
}
