// Mobile: the app icon artwork shared by icon.tsx and apple-icon.tsx (rendered with next/og).
export function IconArt({ size }: { size: number }) {
  const rain = ["|  :   '  |", " ' |  :  ' ", ":  '  |   :"];
  return <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#071015", color: "#c4f1e2", fontFamily: "monospace", position: "relative" }}>
    <div style={{ position: "absolute", top: size * 0.08, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", color: "#2d6a66", fontSize: size * 0.09, lineHeight: 1.1 }}>
      {rain.map((line, i) => <span key={i} style={{ whiteSpace: "pre" }}>{line}</span>)}
    </div>
    <div style={{ display: "flex", fontSize: size * 0.5, fontWeight: 700, letterSpacing: -size * 0.04, marginTop: size * 0.12 }}>N<span style={{ color: "#739d9d" }}>/</span></div>
    <div style={{ position: "absolute", bottom: size * 0.12, width: size * 0.5, height: Math.max(2, size * 0.02), background: "#e6ad62" }} />
  </div>;
}
