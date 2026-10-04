import { useTransform, type MotionValue } from "motion/react";

/**
 * Piecewise-linear map of a scroll progress value, computed in JS. Used instead
 * of array-form useTransform so the browser's native scroll-timeline
 * acceleration (which disagrees with sticky section ranges) is never used.
 */
export function useRamp(p: MotionValue<number>, input: number[], output: number[]) {
  return useTransform(p, (v) => {
    if (v <= input[0]) return output[0];
    for (let i = 1; i < input.length; i++) {
      if (v <= input[i]) {
        const t = (v - input[i - 1]) / (input[i] - input[i - 1] || 1);
        return output[i - 1] + (output[i] - output[i - 1]) * t;
      }
    }
    return output[output.length - 1];
  });
}
