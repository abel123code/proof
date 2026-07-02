import React from "react";
import { Composition } from "remotion";
import { Main } from "./Main";
import type { RenderProps } from "./types";

export const FPS = 30;

const defaultProps: RenderProps = {
  baseVideoFile: "base.mp4",
  durationMs: 10000,
  width: 1080,
  height: 1920,
  words: [],
  keywordCues: [],
  overlayCues: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Main"
      component={Main}
      durationInFrames={300}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.ceil((props.durationMs / 1000) * FPS)),
        fps: FPS,
        width: props.width,
        height: props.height,
      })}
    />
  );
};
