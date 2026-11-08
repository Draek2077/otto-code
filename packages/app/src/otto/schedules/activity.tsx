import { createContext, useContext } from "react";
/** The app owns visibility and retention. Schedule controls have no demand or
 * mutation authority outside an explicitly active surface. */
export const ScheduleActivity = createContext(false);
export function useScheduleActivity() {
  return useContext(ScheduleActivity);
}
