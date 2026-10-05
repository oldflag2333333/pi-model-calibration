import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { registerCalibration } from "./src/extension.ts";

export default function modelCalibration(pi: ExtensionAPI) {
  registerCalibration(pi, join(getAgentDir(), "model-calibration.json"));
}
