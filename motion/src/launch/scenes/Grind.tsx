import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { fontMono, fontSans, green, ink, ink2, ink3, ink4 } from "../theme";
import { Cursor, SceneFade, clamp, fadeUp } from "../ui";

export const GRIND_DURATION = 300;

const QUESTION = "where are payment webhooks handled?";

const SEARCH: { readonly kind: "cmd" | "out"; readonly text: string }[] = [
  { kind: "cmd", text: 'rg -l "webhook" src/' },
  { kind: "out", text: "→ 42 matches" },
  { kind: "cmd", text: "cat src/api/routes.ts" },
  { kind: "cmd", text: 'rg "stripe" src/billing/' },
  { kind: "cmd", text: "cat src/billing/handlers/stripe.ts" },
  { kind: "out", text: "⋯ eleven minutes later" },
];

const FOUND_AT = 128;
const DIM_AT = [168, 186] as const;
const AGAIN_AT = 194;
const PUNCH_AT = 236;

export const Grind: React.FC = () => {
  const frame = useCurrentFrame();
  const dim = interpolate(frame, [...DIM_AT], [1, 0.32], clamp);

  const line: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 34,
    lineHeight: 1.6,
    whiteSpace: "pre",
  };

  return (
    <SceneFade duration={GRIND_DURATION}>
      <div style={{ position: "absolute", left: 220, top: 148 }}>
        <div style={{ opacity: dim }}>
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
            SESSION 1 — TUESDAY
          </div>
          <div
            style={{
              ...line,
              fontSize: 40,
              marginTop: 30,
              color: ink,
              ...fadeUp(frame, 22),
            }}
          >
            <span style={{ color: green, fontWeight: 600 }}>{"❯ "}</span>
            {QUESTION}
          </div>
          <div style={{ marginTop: 22 }}>
            {SEARCH.map((l, i) => (
              <div
                key={l.text}
                style={{
                  ...line,
                  fontSize: l.kind === "cmd" ? 34 : 31,
                  color: l.kind === "cmd" ? ink2 : ink3,
                  ...fadeUp(frame, 46 + i * 13, 10),
                }}
              >
                {l.kind === "cmd" ? (
                  <span style={{ color: ink4 }}>{"$ "}</span>
                ) : (
                  "  "
                )}
                {l.text}
              </div>
            ))}
            <div
              style={{
                ...line,
                marginTop: 8,
                color: ink,
                fontWeight: 500,
                ...fadeUp(frame, FOUND_AT, 12),
              }}
            >
              found it: src/api/webhooks.ts · src/billing/handlers/stripe.ts
            </div>
          </div>
        </div>

        <div
          style={{
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 28,
            letterSpacing: "0.14em",
            marginTop: 34,
            color: ink3,
            ...fadeUp(frame, AGAIN_AT),
          }}
        >
          SESSION 2 — WEDNESDAY
        </div>
        <div
          style={{
            ...line,
            fontSize: 40,
            marginTop: 30,
            color: ink,
            ...fadeUp(frame, AGAIN_AT + 14),
          }}
        >
          <span style={{ color: green, fontWeight: 600 }}>{"❯ "}</span>
          {QUESTION} <Cursor />
        </div>

        <div
          style={{
            marginTop: 36,
            fontFamily: fontSans,
            fontSize: 40,
            color: ink,
            ...fadeUp(frame, PUNCH_AT),
          }}
        >
          Every session pays for the same discovery.
        </div>
      </div>
    </SceneFade>
  );
};
