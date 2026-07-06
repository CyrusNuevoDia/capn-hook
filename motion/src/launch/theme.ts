import { loadFont as loadIBMPlexMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadIBMPlexSans } from "@remotion/google-fonts/IBMPlexSans";

/**
 * The launch video is the printed CAPN(1) man page brought to life:
 * warm paper stock, four ink levels, hairline rules, and green reserved
 * for the prompt glyph and the moments the chart pays off. Paper is the
 * product metaphor — capn draws charts of explored coastline.
 */

export const paper = "#f2eee2";
export const card = "#faf7ec";
export const ink = "#211f15";
export const ink2 = "#56523f";
export const ink3 = "#8a8470";
export const ink4 = "#aaa48d";
export const rule = "rgba(34, 31, 20, 0.16)";
export const line2 = "rgba(34, 31, 20, 0.22)";
export const green = "#2c7a4c";
export const greenDim = "rgba(44, 122, 76, 0.1)";

/** Paper grain from globals.css body::before — multiply-blended fractal noise. */
export const paperNoise =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E\")";

export const fontMono = loadIBMPlexMono("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
}).fontFamily;

export const fontSans = loadIBMPlexSans("normal", {
  weights: ["400", "600"],
  subsets: ["latin"],
}).fontFamily;
