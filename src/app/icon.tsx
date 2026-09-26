import { ImageResponse } from "next/og";
import { IconArt } from "@/components/app-icon-art";

// Mobile: PWA / favicon icon.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";
export default function Icon() {
  return new ImageResponse(<IconArt size={512} />, size);
}
