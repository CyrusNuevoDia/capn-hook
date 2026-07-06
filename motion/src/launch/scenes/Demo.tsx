import type React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import {
  card,
  fontMono,
  green,
  greenDim,
  ink,
  ink2,
  ink3,
  ink4,
  line2,
  rule,
} from "../theme";
import { Cursor, clamp, fadeUp, SceneFade, useTyped } from "../ui";

export const DEMO_DURATION = 560;

const QUESTION = "where are payment webhooks handled?";

const CHART_CMD = [
  'capn chart "where are payment webhooks handled?" \\',
  "  --files src/api/webhooks.ts,src/billing/handlers/stripe.ts \\",
  '  --details "router at :40 — stripe handler owns signature checks"',
];

const HIT = [
  '{"id":"9f3a1c2e","files":["src/api/webhooks.ts",',
  '  "src/billing/handlers/stripe.ts"],',
  '  "details":"router at :40 — stripe handler owns signature checks"}',
];

const CHART_START = 24;
const CHART_STEP = 16;
const CHARTED_AT = 92;
const CHART_OUT = [160, 178] as const;
const NEXT_AT = 188;
const ASK_TYPE_START = 208;
const ASK_CMD_AT = 262;
const HIT_AT = 296;
const HIT_STEP = 8;
const FLASH_AT = 350;

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = useTyped(QUESTION, ASK_TYPE_START, 30);
  const chartOpacity = interpolate(frame, [...CHART_OUT], [1, 0], clamp);
  const flash = interpolate(frame, [FLASH_AT, FLASH_AT + 14], [0, 1], clamp);

  const line: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 33,
    lineHeight: 1.72,
    whiteSpace: "pre",
  };

  return (
    <SceneFade duration={DEMO_DURATION}>
      <div
        style={{
          position: "absolute",
          left: 140,
          right: 140,
          top: 168,
          bottom: 148,
          backgroundColor: card,
          border: `1px solid ${line2}`,
          borderRadius: 12,
          overflow: "hidden",
          ...fadeUp(frame, 0, 14),
        }}
      >
        <div
          style={{
            padding: "20px 40px",
            borderBottom: `1px solid ${rule}`,
            fontFamily: fontMono,
            fontSize: 24,
            color: ink3,
          }}
        >
          ~/startup — claude
        </div>

        <div style={{ padding: "38px 56px", position: "relative" }}>
          <div style={{ opacity: chartOpacity }}>
            {CHART_CMD.map((l, i) => (
              <div
                key={l}
                style={{
                  ...line,
                  color: ink2,
                  ...fadeUp(frame, CHART_START + i * CHART_STEP, 10),
                }}
              >
                {i === 0 ? <span style={{ color: ink4 }}>{"$ "}</span> : "  "}
                {l}
              </div>
            ))}
            <div
              style={{
                ...line,
                marginTop: 24,
                color: ink,
                ...fadeUp(frame, CHARTED_AT, 12),
              }}
            >
              <span style={{ color: green, fontWeight: 600 }}>{"✓ "}</span>
              charted 9f3a1c2e · 2 files fingerprinted sha256
            </div>
          </div>

          <div style={{ position: "absolute", top: 38, left: 56, right: 56 }}>
            <div
              style={{
                ...line,
                fontSize: 26,
                letterSpacing: "0.12em",
                color: ink4,
                ...fadeUp(frame, NEXT_AT, 12),
              }}
            >
              — NEXT SESSION —
            </div>
            <div style={{ ...line, marginTop: 26, color: ink }}>
              <span style={{ opacity: frame >= ASK_TYPE_START - 8 ? 1 : 0 }}>
                <span style={{ color: green, fontWeight: 600 }}>{"❯ "}</span>
                {typed}
                {frame < ASK_CMD_AT ? (
                  <Cursor solid={frame < ASK_TYPE_START + 38} />
                ) : null}
              </span>
            </div>
            <div
              style={{
                ...line,
                marginTop: 22,
                color: ink2,
                ...fadeUp(frame, ASK_CMD_AT, 10),
              }}
            >
              <span style={{ color: ink4 }}>{"$ "}</span>
              capn ask "where are payment webhooks handled?"
            </div>
            <div style={{ marginTop: 18 }}>
              {HIT.map((l, i) => (
                <div
                  key={l}
                  style={{
                    ...line,
                    fontSize: 29,
                    color: ink3,
                    ...fadeUp(frame, HIT_AT + i * HIT_STEP, 10),
                  }}
                >
                  {l}
                </div>
              ))}
            </div>
            <div
              style={{ ...line, marginTop: 28, ...fadeUp(frame, FLASH_AT, 12) }}
            >
              <span
                style={{
                  color: green,
                  fontWeight: 600,
                  backgroundColor: greenDim,
                  opacity: flash,
                  padding: "2px 14px",
                  marginLeft: -14,
                  borderRadius: 4,
                }}
              >
                ✓ answered in 0.3s — search skipped
              </span>
            </div>
          </div>
        </div>
      </div>
    </SceneFade>
  );
};
