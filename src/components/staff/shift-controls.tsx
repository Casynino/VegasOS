import type { ComponentProps } from "react";
import { getCurrentUser } from "@/server/auth";
import { ManagerCloseShiftView, ShiftControlsView } from "./shift-controls-client";

/**
 * My shift's controls ("Start my shift" / "On shift · since" / "End my shift"). A shift belongs to a real person (it holds one of the desk's two
 * places and its closing counts their cash), so while a Developer WORKS AS someone the controls are not drawn at all — the server refuses a
 * Developer's start, end, take-over or close in any case (server/shift-wall.ts). Everyone else sees exactly what they always saw.
 */
export async function ShiftControls(props: ComponentProps<typeof ShiftControlsView>) {
  const user = await getCurrentUser();
  if (user?.workAs) return null;
  return <ShiftControlsView {...props} />;
}

/**
 * A manager closes someone's open shift. Not drawn for a Developer (also while it works as a manager): closing a shift counts the
 * person's cash and sends their report to the Boss, which the Developer never does.
 */
export async function ManagerCloseShift(props: ComponentProps<typeof ManagerCloseShiftView>) {
  const user = await getCurrentUser();
  if (user?.actorType === "DEVELOPER" && !user.workAs) return null;
  return <ManagerCloseShiftView {...props} />;
}
