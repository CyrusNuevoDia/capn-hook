import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontMono, ink, ink2, ink3, paper, paperNoise, rule } from "./theme";

export const easeOut = Easing.out(Easing.cubic);

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** Opacity + rise-in for a line entering at `start`. */
export const fadeUp = (
  frame: number,
  start: number,
  duration = 14,
): React.CSSProperties => {
  const progress = interpolate(frame, [start, start + duration], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  return {
    opacity: progress,
    transform: `translateY(${(1 - progress) * 14}px)`,
  };
};

/** Warm paper stock with the grain overlay above everything. */
export const Paper: React.FC<{ readonly children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: paper }}>
      {children}
      <AbsoluteFill
        style={{
          backgroundImage: paperNoise,
          backgroundRepeat: "repeat",
          mixBlendMode: "multiply",
          opacity: 0.5,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

/** Persistent man-page chrome: CAPN(1) masthead and running footer. */
export const Chrome: React.FC = () => {
  const row: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    fontFamily: fontMono,
    fontSize: 26,
    letterSpacing: "0.02em",
  };
  return (
    <>
      <div style={{ position: "absolute", top: 0, left: 96, right: 96 }}>
        <div
          style={{
            ...row,
            color: ink2,
            paddingTop: 44,
            paddingBottom: 20,
            borderBottom: `1px solid ${rule}`,
          }}
        >
          <span>CAPN(1)</span>
          <span>User Commands</span>
          <span>CAPN(1)</span>
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 96, right: 96 }}>
        <div
          style={{
            ...row,
            color: ink3,
            paddingTop: 20,
            paddingBottom: 40,
            borderTop: `1px solid ${rule}`,
          }}
        >
          <span>capn</span>
          <span>2026-07-05</span>
          <span>github.com/CyrusNuevoDia/capn-hook</span>
        </div>
      </div>
    </>
  );
};

/** Fade a scene in over its first frames and out over its last. */
export const SceneFade: React.FC<{
  readonly duration: number;
  readonly out?: boolean;
  readonly children: React.ReactNode;
}> = ({ duration, out = true, children }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 10], [0, 1], clamp);
  const fadeOut = out
    ? interpolate(frame, [duration - 14, duration - 2], [1, 0], clamp)
    : 1;
  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      {children}
    </AbsoluteFill>
  );
};

/** Character count typed so far — slice strings, never per-character opacity. */
export const useTyped = (text: string, start: number, cps = 30): string => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const count = Math.max(0, Math.floor(((frame - start) * cps) / fps));
  return text.slice(0, Math.min(text.length, count));
};

export const typedDuration = (text: string, fps: number, cps = 30): number =>
  Math.ceil((text.length * fps) / cps);

/** Terminal block cursor. Blinks unless `solid`. */
export const Cursor: React.FC<{
  readonly solid?: boolean;
  readonly color?: string;
}> = ({ solid = false, color = ink }) => {
  const frame = useCurrentFrame();
  const on = solid || Math.floor(frame / 16) % 2 === 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: "0.6em",
        height: "1.1em",
        verticalAlign: "text-bottom",
        backgroundColor: color,
        opacity: on ? 1 : 0,
      }}
    />
  );
};
