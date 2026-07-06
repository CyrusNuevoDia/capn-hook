import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { fontSans, ink } from "../theme";
import { fadeUp, SceneFade } from "../ui";

export const TURN_DURATION = 120;

export const Turn: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFade duration={TURN_DURATION}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            fontFamily: fontSans,
            fontWeight: 600,
            fontSize: 68,
            color: ink,
            ...fadeUp(frame, 10, 18),
          }}
        >
          Chart it once.
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
