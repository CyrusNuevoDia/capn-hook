import type React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { fontMono, fontSans, green, ink, ink2, ink3 } from "../theme";
import { SceneFade, clamp, fadeUp } from "../ui";

export const RESULTS_DURATION = 340;

const HERO_REVEAL = 24;
const COLD_BAR_REVEAL = 46;
const RECALL_BAR_REVEAL = 64;
const CORRECTNESS_REVEAL = 120;
const FOOTNOTE_REVEAL = 150;
const KICKER_REVEAL = 240;

const MAX_TOKENS = 260_000;
const BAR_WIDTH = 760;
const COLD_TOKENS = 242_000;
const RECALL_TOKENS = 55_000;

const tokenWidth = (tokens: number): number => (tokens / MAX_TOKENS) * BAR_WIDTH;

export const Results: React.FC = () => {
  const frame = useCurrentFrame();
  const percent = Math.round(
    interpolate(frame, [HERO_REVEAL, HERO_REVEAL + 34], [0, 77], clamp),
  );
  const coldWidth = interpolate(
    frame,
    [COLD_BAR_REVEAL, COLD_BAR_REVEAL + 24],
    [0, tokenWidth(COLD_TOKENS)],
    clamp,
  );
  const recallWidth = interpolate(
    frame,
    [RECALL_BAR_REVEAL, RECALL_BAR_REVEAL + 24],
    [0, tokenWidth(RECALL_TOKENS)],
    clamp,
  );

  const barLabel: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 25,
    color: ink2,
  };
  const valueLabel: React.CSSProperties = {
    position: "absolute",
    top: 0,
    height: 32,
    display: "flex",
    alignItems: "center",
    fontFamily: fontMono,
    fontSize: 25,
    whiteSpace: "nowrap",
    color: ink,
  };

  return (
    <SceneFade duration={RESULTS_DURATION}>
      <div style={{ position: "absolute", left: 220, top: 154, right: 160 }}>
        <div
          style={{
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 28,
            letterSpacing: "0.14em",
            color: ink3,
            ...fadeUp(frame, 8),
          }}
        >
          RESULTS — 180 AGENT RUNS · 5 REAL CODEBASES
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "420px 1fr",
            columnGap: 104,
            marginTop: 80,
            alignItems: "start",
          }}
        >
          <div style={fadeUp(frame, HERO_REVEAL)}>
            <div
              style={{
                fontFamily: fontMono,
                fontWeight: 600,
                fontSize: 150,
                lineHeight: 0.92,
                color: green,
              }}
            >
              {`${percent}%`}
            </div>
            <div
              style={{
                marginTop: 34,
                fontFamily: fontSans,
                fontSize: 40,
                lineHeight: 1.18,
                color: ink2,
              }}
            >
              <div>fewer tokens</div>
              <div>on repeat questions</div>
            </div>
          </div>

          <div style={{ paddingTop: 24 }}>
            <div style={{ ...fadeUp(frame, COLD_BAR_REVEAL) }}>
              <div style={barLabel}>cold exploration</div>
              <div style={{ position: "relative", marginTop: 14, height: 58 }}>
                <div
                  style={{
                    width: coldWidth,
                    height: 32,
                    backgroundColor: ink3,
                  }}
                />
                <div
                  style={{
                    ...valueLabel,
                    left: coldWidth + 18,
                  }}
                >
                  avg 242K tokens / question
                </div>
              </div>
            </div>

            <div style={{ marginTop: 66, ...fadeUp(frame, RECALL_BAR_REVEAL) }}>
              <div style={barLabel}>capn recall · repeat question</div>
              <div style={{ position: "relative", marginTop: 14, height: 58 }}>
                <div
                  style={{
                    width: recallWidth,
                    height: 32,
                    backgroundColor: green,
                  }}
                />
                <div
                  style={{
                    ...valueLabel,
                    left: recallWidth + 18,
                    fontWeight: 600,
                  }}
                >
                  avg 55K
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 72,
            fontFamily: fontMono,
            fontSize: 31,
            color: ink2,
            ...fadeUp(frame, CORRECTNESS_REVEAL),
          }}
        >
          <span style={{ color: green, fontWeight: 600 }}>✓ </span>
          100% correct answers — every arm, every question
        </div>

        <div
          style={{
            marginTop: 28,
            fontFamily: fontMono,
            fontSize: 28,
            color: ink3,
            ...fadeUp(frame, FOOTNOTE_REVEAL),
          }}
        >
          best case 912K → 56K · 94% saved (posthog)
        </div>

        <div
          style={{
            marginTop: 68,
            fontFamily: fontSans,
            fontSize: 42,
            color: ink,
            ...fadeUp(frame, KICKER_REVEAL),
          }}
        >
          You already paid to learn this once.
        </div>
      </div>
    </SceneFade>
  );
};
