import type React from "react";
import { useCurrentFrame } from "remotion";
import { fontMono, ink, ink2 } from "../theme";
import { fadeUp, SceneFade } from "../ui";

export const TITLE_DURATION = 160;

export const Title: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFade duration={TITLE_DURATION}>
      <div style={{ position: "absolute", left: 220, top: 236 }}>
        <div
          style={{
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 30,
            letterSpacing: "0.14em",
            color: ink,
            ...fadeUp(frame, 8),
          }}
        >
          NAME
        </div>
        <div
          style={{
            marginTop: 44,
            fontFamily: fontMono,
            fontSize: 46,
            lineHeight: 1.6,
            color: ink,
            ...fadeUp(frame, 26),
          }}
        >
          <span style={{ fontWeight: 600 }}>capn</span> — don't grep the same
          mystery twice
        </div>
        <div
          style={{
            marginTop: 36,
            maxWidth: 1240,
            fontFamily: fontMono,
            fontSize: 36,
            lineHeight: 1.7,
            color: ink2,
            ...fadeUp(frame, 52),
          }}
        >
          Your agent's hard-won discoveries, charted — and recalled in one
          command.
        </div>
      </div>
    </SceneFade>
  );
};
