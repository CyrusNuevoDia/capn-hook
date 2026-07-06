import React from "react";
import { Series } from "remotion";
import { Chrome, Paper } from "./ui";
import { RESULTS_DURATION, Results } from "./scenes/Results";
import { TITLE_DURATION, Title } from "./scenes/Title";
import { GRIND_DURATION, Grind } from "./scenes/Grind";
import { TURN_DURATION, Turn } from "./scenes/Turn";
import { DEMO_DURATION, Demo } from "./scenes/Demo";
import { COASTLINE_DURATION, Coastline } from "./scenes/Coastline";
import { OUTRO_DURATION, Outro } from "./scenes/Outro";

export const LAUNCH_DURATION =
  RESULTS_DURATION +
  TITLE_DURATION +
  GRIND_DURATION +
  TURN_DURATION +
  DEMO_DURATION +
  COASTLINE_DURATION +
  OUTRO_DURATION;

export const Launch: React.FC = () => {
  return (
    <Paper>
      <Chrome />
      <Series>
        <Series.Sequence durationInFrames={RESULTS_DURATION}>
          <Results />
        </Series.Sequence>
        <Series.Sequence durationInFrames={TITLE_DURATION}>
          <Title />
        </Series.Sequence>
        <Series.Sequence durationInFrames={GRIND_DURATION}>
          <Grind />
        </Series.Sequence>
        <Series.Sequence durationInFrames={TURN_DURATION}>
          <Turn />
        </Series.Sequence>
        <Series.Sequence durationInFrames={DEMO_DURATION}>
          <Demo />
        </Series.Sequence>
        <Series.Sequence durationInFrames={COASTLINE_DURATION}>
          <Coastline />
        </Series.Sequence>
        <Series.Sequence durationInFrames={OUTRO_DURATION}>
          <Outro />
        </Series.Sequence>
      </Series>
    </Paper>
  );
};
