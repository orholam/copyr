const STORAGE_KEY = "vl-demo-gate";
export const DEMO_PASSCODE = "hardtech";

export function hasDemoAccess(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function unlockDemo(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* private mode / blocked storage */
  }
}

export function checkDemoPasscode(value: string): boolean {
  return value.trim().toLowerCase() === DEMO_PASSCODE;
}
