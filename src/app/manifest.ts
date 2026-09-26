import type { MetadataRoute } from "next";

// Mobile: installable web app. On iPhone, Share -> Add to Home Screen opens Nightfall full screen
// (standalone, landscape preferred); the Fullscreen API is not available for a canvas on iPhone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nightfall — A city in characters",
    short_name: "Nightfall",
    description: "A rain-soaked cyberpunk city rendered live in ASCII.",
    start_url: "/",
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "any", // landscape is best (a gentle in-game hint says so), portrait stays usable
    background_color: "#071015",
    theme_color: "#071015",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
