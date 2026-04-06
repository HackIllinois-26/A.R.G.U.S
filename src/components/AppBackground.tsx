"use client";

import { MeshGradient } from "@paper-design/shaders-react";

const ShaderProps = { backgroundColor: "#000000" } as Record<string, unknown>;
const WireframeProps = { wireframe: "true", backgroundColor: "transparent" } as Record<string, unknown>;

export function AppBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <MeshGradient
        className="absolute inset-0 w-full h-full"
        colors={["#000000", "#10b981", "#059669", "#064e3b", "#f97316"]}
        speed={0.15}
        {...ShaderProps}
      />
      <MeshGradient
        className="absolute inset-0 w-full h-full opacity-40"
        colors={["#000000", "#ffffff", "#10b981", "#f97316"]}
        speed={0.1}
        {...WireframeProps}
      />
      <div className="absolute inset-0 bg-black/25" />
    </div>
  );
}
