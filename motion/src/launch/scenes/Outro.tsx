import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { fontMono, fontSans, green, ink, ink2 } from "../theme";
import { fadeUp, SceneFade } from "../ui";

export const OUTRO_DURATION = 200;

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFade duration={OUTRO_DURATION} out={false}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 44,
            ...fadeUp(frame, 8, 18),
          }}
        >
          <span style={{ fontSize: 110, lineHeight: 1 }}>🧢🪝</span>
          <span
            style={{
              fontFamily: fontMono,
              fontWeight: 600,
              fontSize: 148,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              color: ink,
            }}
          >
            cap'n hook
          </span>
        </div>
        <div
          style={{
            marginTop: 52,
            fontFamily: fontSans,
            fontSize: 42,
            color: ink2,
            ...fadeUp(frame, 42),
          }}
        >
          Don't grep the same mystery twice.
        </div>
        <div
          style={{
            marginTop: 56,
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 46,
            color: green,
            ...fadeUp(frame, 78),
          }}
        >
          ❯ npm install -g capn-hook
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
