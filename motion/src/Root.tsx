import { Composition } from "remotion";

import { LAUNCH_DURATION, Launch } from "./launch/Launch";

export const RemotionRoot = () => {
  return (
    <Composition
      id="Launch"
      component={Launch}
      durationInFrames={LAUNCH_DURATION}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
