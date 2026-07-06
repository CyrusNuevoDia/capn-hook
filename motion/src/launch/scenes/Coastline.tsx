import type React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import {
  card,
  fontMono,
  fontSans,
  ink,
  ink2,
  ink3,
  ink4,
  line2,
  rule,
} from "../theme";
import { clamp, fadeUp, SceneFade } from "../ui";

export const COASTLINE_DURATION = 300;

const EDIT_AT = 95;
const CHANGED_AT = 112;
const FLIP_AT = 132;
const STAMP_AT = 156;
const PUNCH_AT = 200;
const SUB_AT = 238;

export const Coastline: React.FC = () => {
  const frame = useCurrentFrame();
  const entryDim = interpolate(
    frame,
    [STAMP_AT, STAMP_AT + 16],
    [1, 0.4],
    clamp
  );
  const stamp = interpolate(frame, [STAMP_AT, STAMP_AT + 8], [0, 1], clamp);
  const stampScale = interpolate(frame, [STAMP_AT, STAMP_AT + 8], [1.5, 1], {
    ...clamp,
  });
  const flipped = frame >= FLIP_AT;

  const mono: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 30,
    lineHeight: 1.7,
    whiteSpace: "pre",
  };

  return (
    <SceneFade duration={COASTLINE_DURATION}>
      <div style={{ position: "absolute", left: 220, top: 176 }}>
        <div
          style={{
            position: "relative",
            width: 1130,
            backgroundColor: card,
            border: `1px solid ${line2}`,
            borderRadius: 12,
            overflow: "hidden",
            opacity: entryDim,
            ...fadeUp(frame, 10, 14),
          }}
        >
          <div
            style={{
              padding: "16px 36px",
              borderBottom: `1px solid ${rule}`,
              fontFamily: fontMono,
              fontSize: 24,
              color: ink3,
            }}
          >
            .capn/entries/9f3a1c2e.md
          </div>
          <div style={{ padding: "26px 36px" }}>
            <div style={{ ...mono, color: ink4, ...fadeUp(frame, 24, 10) }}>
              files:
            </div>
            <div style={{ ...mono, color: ink2, ...fadeUp(frame, 34, 10) }}>
              {"  src/api/webhooks.ts              "}
              <span
                style={
                  flipped
                    ? { color: ink4, textDecoration: "line-through" }
                    : { color: ink3 }
                }
              >
                2f4c0b9c…
              </span>
              {flipped ? <span style={{ color: ink }}> a91e77c3…</span> : null}
            </div>
            <div style={{ ...mono, color: ink2, ...fadeUp(frame, 44, 10) }}>
              {"  src/billing/handlers/stripe.ts   "}
              <span style={{ color: ink3 }}>88ac41d2…</span>
            </div>
            <div
              style={{
                ...mono,
                marginTop: 18,
                fontWeight: 600,
                color: ink,
                ...fadeUp(frame, 56, 10),
              }}
            >
              # Where are payment webhooks handled?
            </div>
            <div style={{ ...mono, color: ink2, ...fadeUp(frame, 66, 10) }}>
              router at :40 — stripe handler owns signature checks
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontFamily: fontMono,
                fontWeight: 600,
                fontSize: 58,
                letterSpacing: "0.22em",
                color: ink,
                border: `5px solid ${ink}`,
                borderRadius: 10,
                padding: "10px 36px",
                transform: `rotate(-9deg) scale(${stampScale})`,
                opacity: stamp * 0.8,
              }}
            >
              UNCHARTED
            </div>
          </div>
        </div>

        <div
          style={{
            ...mono,
            fontSize: 33,
            marginTop: 40,
            color: ink2,
            ...fadeUp(frame, EDIT_AT, 10),
          }}
        >
          <span style={{ color: ink4 }}>{"$ "}</span>
          git commit -m "rework webhook routing"
        </div>
        <div
          style={{
            ...mono,
            fontSize: 31,
            color: ink3,
            ...fadeUp(frame, CHANGED_AT, 10),
          }}
        >
          {"  → src/api/webhooks.ts changed"}
        </div>

        <div
          style={{
            marginTop: 44,
            fontFamily: fontSans,
            fontSize: 40,
            color: ink,
            ...fadeUp(frame, PUNCH_AT),
          }}
        >
          When the coastline shifts, the chart is thrown out.
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: fontSans,
            fontSize: 32,
            color: ink2,
            ...fadeUp(frame, SUB_AT),
          }}
        >
          Stale answers can't exist. Worst case, the agent re-explores — the
          status quo.
        </div>
      </div>
    </SceneFade>
  );
};
